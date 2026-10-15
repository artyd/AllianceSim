import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query } from './db.js';
import { attach, emit, setViewing, isViewing } from './realtime.js';
import { queueNotif } from './notify.js';

// Real chats between colleagues (spec 004). Only members can read or write a chat; the
// HR edit token grants nothing here. Live updates go out over SSE (/me/stream).
export const chats = express.Router(); // requireMe is mounted on /me in index.js

const PAGE = 50;
const MSG_MAX = 4000;
const GROUP_MAX = 200;
export const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const FILE_MAX = 20 * 1024 * 1024;
const TTL_DAYS = Number(process.env.ATTACHMENT_TTL_DAYS || 90);
const bad = (res, error) => res.status(400).json({ error });
const nf = (res) => res.status(404).json({ error: 'not found' });
const isId = (v) => /^\d+$/.test(String(v));

// ── shapes ───────────────────────────────────────────────────────────────────
// Messages are always read joined with their attachment (if any).
const MSG_SELECT = `SELECT m.*, a.filename AS a_name, a.mime AS a_mime, a.size AS a_size, a.deleted_at AS a_deleted
  FROM messages m LEFT JOIN attachments a ON a.id = m.attachment_id`;
const toMsg = (r) => ({
  id: String(r.id), chatId: String(r.chat_id), senderId: r.sender_id,
  text: r.deleted_at ? null : r.text, createdAt: r.created_at, editedAt: r.edited_at, deleted: !!r.deleted_at,
  attachment: r.attachment_id && !r.deleted_at
    ? { id: r.attachment_id, name: r.a_name, mime: r.a_mime, size: r.a_size, expired: !!r.a_deleted }
    : null,
});
const msgById = async (id) => toMsg((await query(`${MSG_SELECT} WHERE m.id = $1`, [id])).rows[0]);

export async function memberIds(chatId) {
  const { rows } = await query('SELECT employee_id FROM chat_members WHERE chat_id = $1', [chatId]);
  return rows.map((r) => r.employee_id);
}
async function membership(chatId, empId) {
  if (!isId(chatId)) return null;
  const { rows } = await query(
    `SELECT c.*, m.muted, m.last_read_id FROM chats c JOIN chat_members m ON m.chat_id = c.id AND m.employee_id = $2
     WHERE c.id = $1`,
    [chatId, empId]
  );
  return rows[0] || null;
}

// Full chat cards for one member: members + read marks, last message, unread count.
export async function loadChats(meId, onlyId = null) {
  const { rows } = await query(
    `SELECT c.*, m.muted, m.last_read_id FROM chats c JOIN chat_members m ON m.chat_id = c.id AND m.employee_id = $1
     ${onlyId ? 'WHERE c.id = $2' : ''}`,
    onlyId ? [meId, onlyId] : [meId]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ rows: mem }, { rows: last }, { rows: unread }] = await Promise.all([
    query('SELECT chat_id, employee_id, last_read_id FROM chat_members WHERE chat_id = ANY($1::bigint[]) ORDER BY joined_at', [ids]),
    query(`SELECT DISTINCT ON (m.chat_id) * FROM (${MSG_SELECT} WHERE m.chat_id = ANY($1::bigint[])) m ORDER BY m.chat_id, m.id DESC`, [ids]),
    query(
      `SELECT msg.chat_id, count(*)::int AS n FROM messages msg
       JOIN chat_members m ON m.chat_id = msg.chat_id AND m.employee_id = $1
       WHERE msg.chat_id = ANY($2::bigint[]) AND msg.id > m.last_read_id
         AND msg.sender_id IS DISTINCT FROM $1 AND msg.deleted_at IS NULL
       GROUP BY msg.chat_id`,
      [meId, ids]
    ),
  ]);
  const memBy = new Map();
  for (const m of mem) { const k = String(m.chat_id); if (!memBy.has(k)) memBy.set(k, []); memBy.get(k).push(m); }
  const lastBy = new Map(last.map((r) => [String(r.chat_id), r]));
  const unBy = new Map(unread.map((r) => [String(r.chat_id), r.n]));
  const out = rows.map((c) => {
    const l = lastBy.get(String(c.id));
    return {
      id: String(c.id), kind: c.kind, title: c.title, dept: c.dept, createdBy: c.created_by,
      muted: c.muted, unread: unBy.get(String(c.id)) || 0,
      members: (memBy.get(String(c.id)) || []).map((m) => ({ id: m.employee_id, lastRead: String(m.last_read_id) })),
      last: l ? toMsg(l) : null,
      lastAt: l ? l.created_at : c.created_at,
    };
  });
  // An opened-but-empty 1:1 chat stays out of the list until someone writes.
  return out.filter((c) => onlyId || c.kind !== 'direct' || c.last)
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}
export const loadChat = async (meId, id) => (await loadChats(meId, id))[0] || null;

// Push a fresh chat card to each member (their own unread/muted view).
export async function pushChat(chatId, ids = null) {
  for (const id of ids || (await memberIds(chatId))) {
    const c = await loadChat(id, chatId);
    if (c) emit([id], 'chat', c);
  }
}
const pushRemoved = (chatId, ids) => ids.length && emit(ids, 'chat_removed', { chatId: String(chatId) });

// ── system chats: whole office + one per department, membership follows the roster ──
// Idempotent; run on boot, after employee writes (debounced) and periodically.
export async function syncSystemChats() {
  const added = new Map(), removed = new Map(); // chatId → [empIds]
  const note = (m, chatId, rows) => rows.length && m.set(String(chatId), [...(m.get(String(chatId)) || []), ...rows.map((r) => r.employee_id)]);

  await query(`INSERT INTO chats (kind, title) VALUES ('office', 'Весь офіс') ON CONFLICT DO NOTHING`);
  const { rows: [office] } = await query(`SELECT id FROM chats WHERE kind = 'office'`);
  note(added, office.id, (await query(
    `INSERT INTO chat_members (chat_id, employee_id) SELECT $1, id FROM employees WHERE telegram_id IS NOT NULL
     ON CONFLICT DO NOTHING RETURNING employee_id`, [office.id])).rows);
  note(removed, office.id, (await query(
    `DELETE FROM chat_members cm USING employees e WHERE cm.chat_id = $1 AND e.id = cm.employee_id AND e.telegram_id IS NULL
     RETURNING cm.employee_id`, [office.id])).rows);

  await query(
    `INSERT INTO chats (kind, dept, title)
     SELECT DISTINCT 'dept', btrim(department), btrim(department) FROM employees
     WHERE telegram_id IS NOT NULL AND btrim(coalesce(department, '')) <> ''
     ON CONFLICT DO NOTHING`
  );
  const { rows: depts } = await query(`SELECT id, dept FROM chats WHERE kind = 'dept'`);
  for (const d of depts) {
    note(added, d.id, (await query(
      `INSERT INTO chat_members (chat_id, employee_id)
       SELECT $1, id FROM employees WHERE telegram_id IS NOT NULL AND btrim(coalesce(department, '')) = $2
       ON CONFLICT DO NOTHING RETURNING employee_id`, [d.id, d.dept])).rows);
    note(removed, d.id, (await query(
      `DELETE FROM chat_members cm USING employees e
       WHERE cm.chat_id = $1 AND e.id = cm.employee_id
         AND (e.telegram_id IS NULL OR btrim(coalesce(e.department, '')) <> $2)
       RETURNING cm.employee_id`, [d.id, d.dept])).rows);
  }
  for (const [chatId, ids] of removed) pushRemoved(chatId, ids);
  for (const [chatId, ids] of added) await pushChat(chatId, ids);
}
let syncT = null;
export function scheduleSync() {
  clearTimeout(syncT);
  syncT = setTimeout(() => syncSystemChats().catch((e) => console.error('[api] chat sync failed:', e.message)), 500);
}

// ── stream & presence ────────────────────────────────────────────────────────
chats.get('/me/stream', (req, res) => attach(req.me.id, req, res));
chats.post('/me/presence', (req, res) => {
  setViewing(req.me.id, (req.body || {}).chatId ?? null);
  res.json({ ok: true });
});

// ── chats ────────────────────────────────────────────────────────────────────
chats.get('/me/chats', async (req, res, next) => {
  try { res.json(await loadChats(req.me.id)); } catch (err) { next(err); }
});

chats.get('/me/chats/:id', async (req, res, next) => {
  try {
    if (!(await membership(req.params.id, req.me.id))) return nf(res);
    res.json(await loadChat(req.me.id, req.params.id));
  } catch (err) { next(err); }
});

// Only colleagues who linked Telegram can be chatted with / added to groups.
async function linkedIds(ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!want.length) return [];
  const { rows } = await query('SELECT id FROM employees WHERE id = ANY($1::text[]) AND telegram_id IS NOT NULL', [want]);
  return rows.map((r) => r.id);
}

// Open (or create) the 1:1 chat with a linked colleague.
chats.post('/me/chats/direct', async (req, res, next) => {
  try {
    const other = String((req.body || {}).employeeId || '');
    if (!other || other === req.me.id) return bad(res, 'employeeId required');
    if (!(await linkedIds([other])).length) return res.status(404).json({ error: 'colleague is not in the bot yet' });
    const key = [req.me.id, other].sort().join('|');
    await query(`INSERT INTO chats (kind, direct_key, created_by) VALUES ('direct', $1, $2) ON CONFLICT (direct_key) DO NOTHING`, [key, req.me.id]);
    const { rows: [c] } = await query('SELECT id FROM chats WHERE direct_key = $1', [key]);
    await query(
      `INSERT INTO chat_members (chat_id, employee_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
      [c.id, req.me.id, other]
    );
    res.json(await loadChat(req.me.id, c.id));
  } catch (err) { next(err); }
});

// Create a group: creator + chosen linked colleagues.
chats.post('/me/chats', async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 80);
    if (!title) return bad(res, 'title required');
    const ids = (await linkedIds(b.memberIds)).filter((id) => id !== req.me.id);
    if (!ids.length) return bad(res, 'add at least one colleague');
    if (ids.length + 1 > GROUP_MAX) return bad(res, 'too many members');
    const { rows: [c] } = await query(`INSERT INTO chats (kind, title, created_by) VALUES ('group', $1, $2) RETURNING id`, [title, req.me.id]);
    await query(
      `INSERT INTO chat_members (chat_id, employee_id) SELECT $1, unnest($2::text[])`,
      [c.id, [req.me.id, ...ids]]
    );
    await pushChat(c.id, ids);
    res.status(201).json(await loadChat(req.me.id, c.id));
  } catch (err) { next(err); }
});

// Mute: any member. Rename / add / remove: the group's creator only.
chats.patch('/me/chats/:id', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    const b = req.body || {};
    if ('muted' in b) {
      await query('UPDATE chat_members SET muted = $3 WHERE chat_id = $1 AND employee_id = $2', [chat.id, req.me.id, !!b.muted]);
    }
    const admin = 'title' in b || 'add' in b || 'remove' in b;
    if (admin) {
      if (chat.kind !== 'group') return res.status(403).json({ error: 'only groups can be edited' });
      if (chat.created_by !== req.me.id) return res.status(403).json({ error: 'only the creator can edit the group' });
      if ('title' in b) {
        const title = String(b.title || '').trim().slice(0, 80);
        if (!title) return bad(res, 'title required');
        await query('UPDATE chats SET title = $2 WHERE id = $1', [chat.id, title]);
      }
      let removed = [];
      if (Array.isArray(b.remove) && b.remove.length) {
        const rm = b.remove.map(String).filter((id) => id !== req.me.id);
        ({ rows: removed } = await query(
          'DELETE FROM chat_members WHERE chat_id = $1 AND employee_id = ANY($2::text[]) RETURNING employee_id', [chat.id, rm]));
        pushRemoved(chat.id, removed.map((r) => r.employee_id));
      }
      if (Array.isArray(b.add) && b.add.length) {
        const add = await linkedIds(b.add);
        if ((await memberIds(chat.id)).length + add.length > GROUP_MAX) return bad(res, 'too many members');
        if (add.length) await query(
          'INSERT INTO chat_members (chat_id, employee_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [chat.id, add]);
      }
    }
    await pushChat(chat.id, admin ? null : [req.me.id]);
    res.json(await loadChat(req.me.id, chat.id));
  } catch (err) { next(err); }
});

// Leave a group. If the creator leaves, the longest-standing member takes over;
// an empty group is deleted with its messages and files.
chats.post('/me/chats/:id/leave', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    if (chat.kind !== 'group') return res.status(403).json({ error: 'only groups can be left' });
    await query('DELETE FROM chat_members WHERE chat_id = $1 AND employee_id = $2', [chat.id, req.me.id]);
    pushRemoved(chat.id, [req.me.id]);
    const { rows } = await query('SELECT employee_id FROM chat_members WHERE chat_id = $1 ORDER BY joined_at LIMIT 1', [chat.id]);
    if (!rows.length) {
      await dropChatFiles(chat.id);
      await query('DELETE FROM chats WHERE id = $1', [chat.id]);
    } else {
      if (chat.created_by === req.me.id) await query('UPDATE chats SET created_by = $2 WHERE id = $1', [chat.id, rows[0].employee_id]);
      await pushChat(chat.id);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── messages ─────────────────────────────────────────────────────────────────
chats.get('/me/chats/:id/messages', async (req, res, next) => {
  try {
    if (!(await membership(req.params.id, req.me.id))) return nf(res);
    const { before, after } = req.query;
    if ((before && !isId(before)) || (after && !isId(after))) return bad(res, 'bad cursor');
    let rows;
    if (after) {
      ({ rows } = await query(`${MSG_SELECT} WHERE m.chat_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 500`, [req.params.id, after]));
    } else {
      ({ rows } = await query(
        `${MSG_SELECT} WHERE m.chat_id = $1 ${before ? 'AND m.id < $3' : ''} ORDER BY m.id DESC LIMIT $2`,
        before ? [req.params.id, PAGE, before] : [req.params.id, PAGE]
      ));
      rows.reverse();
    }
    res.json({ messages: rows.map(toMsg), hasMore: !after && rows.length === PAGE });
  } catch (err) { next(err); }
});

// Per-recipient throttle so a burst of messages is one Telegram ping a minute per chat.
const lastPing = new Map();
const PING_GAP = 60 * 1000;

async function notifyMembers(chat, msg, sender) {
  const { rows } = await query(
    'SELECT employee_id, muted FROM chat_members WHERE chat_id = $1 AND employee_id <> $2',
    [chat.id, sender.id]
  );
  const preview = msg.text || (msg.attachment ? `📎 ${msg.attachment.name}` : '…');
  const title = chat.kind === 'direct' ? null : chat.kind === 'office' ? 'Весь офіс' : chat.title || chat.dept || null;
  for (const r of rows) {
    if (r.muted || isViewing(r.employee_id, chat.id)) continue;
    const k = `${chat.id}:${r.employee_id}`;
    if (Date.now() - (lastPing.get(k) || 0) < PING_GAP) continue;
    lastPing.set(k, Date.now());
    await queueNotif(r.employee_id, 'chat', {
      text: preview, fromName: sender.name, pref: 'messages',
      payload: { open: `chat_${chat.id}`, chatTitle: title },
    });
  }
}

export async function postMessage(chat, sender, { text = null, attachmentId = null } = {}) {
  const { rows: [m] } = await query(
    'INSERT INTO messages (chat_id, sender_id, text, attachment_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [chat.id, sender.id, text, attachmentId]
  );
  await query('UPDATE chat_members SET last_read_id = $3 WHERE chat_id = $1 AND employee_id = $2', [chat.id, sender.id, m.id]);
  const msg = await msgById(m.id);
  emit(await memberIds(chat.id), 'message', msg);
  notifyMembers(chat, msg, sender).catch((e) => console.error('[api] notify failed:', e.message));
  return msg;
}

chats.post('/me/chats/:id/messages', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    const b = req.body || {};
    const text = String(b.text ?? '').trim().slice(0, MSG_MAX) || null;
    let attachmentId = null;
    if (b.attachmentId) {
      // Must be my own upload, for this chat, not yet used by another message.
      const { rows: [a] } = await query(
        `SELECT a.id FROM attachments a WHERE a.id::text = $1 AND a.owner_id = $2 AND a.chat_id = $3 AND a.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM messages WHERE attachment_id = a.id)`,
        [String(b.attachmentId), req.me.id, chat.id]
      );
      if (!a) return bad(res, 'attachment invalid');
      attachmentId = a.id;
    }
    if (!text && !attachmentId) return bad(res, 'text required');
    res.status(201).json(await postMessage(chat, req.me, { text, attachmentId }));
  } catch (err) { next(err); }
});

async function ownMessage(id, meId) {
  if (!isId(id)) return null;
  const { rows } = await query('SELECT * FROM messages WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL', [id, meId]);
  return rows[0] || null;
}

chats.patch('/me/messages/:id', async (req, res, next) => {
  try {
    const m = await ownMessage(req.params.id, req.me.id);
    if (!m) return nf(res);
    const text = String((req.body || {}).text ?? '').trim().slice(0, MSG_MAX);
    if (!text) return bad(res, 'text required');
    await query('UPDATE messages SET text = $2, edited_at = now() WHERE id = $1', [m.id, text]);
    const msg = await msgById(m.id);
    emit(await memberIds(m.chat_id), 'message_update', msg);
    res.json(msg);
  } catch (err) { next(err); }
});

// Deleting wipes the text and the file server-side (not just hidden) — only a placeholder remains.
chats.delete('/me/messages/:id', async (req, res, next) => {
  try {
    const m = await ownMessage(req.params.id, req.me.id);
    if (!m) return nf(res);
    await query('UPDATE messages SET text = NULL, deleted_at = now() WHERE id = $1', [m.id]);
    if (m.attachment_id) await dropAttachments(`id = $1`, [m.attachment_id]);
    const msg = await msgById(m.id);
    emit(await memberIds(m.chat_id), 'message_update', msg);
    res.json(msg);
  } catch (err) { next(err); }
});

chats.post('/me/chats/:id/read', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    const upTo = String((req.body || {}).upTo || '');
    if (!isId(upTo)) return bad(res, 'upTo required');
    const { rows: [r] } = await query(
      `UPDATE chat_members SET last_read_id = GREATEST(last_read_id, LEAST($3::bigint, (SELECT COALESCE(max(id), 0) FROM messages WHERE chat_id = $1)))
       WHERE chat_id = $1 AND employee_id = $2 RETURNING last_read_id`,
      [chat.id, req.me.id, upTo]
    );
    emit(await memberIds(chat.id), 'read', { chatId: String(chat.id), employeeId: req.me.id, lastRead: String(r.last_read_id) });
    res.json({ ok: true, lastRead: String(r.last_read_id) });
  } catch (err) { next(err); }
});

chats.post('/me/chats/:id/typing', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    emit((await memberIds(chat.id)).filter((id) => id !== req.me.id), 'typing', { chatId: String(chat.id), employeeId: req.me.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── attachments ──────────────────────────────────────────────────────────────
// Upload = raw body (sent as application/octet-stream), ?chatId=&name=&mime=. Then the
// client sends a message with attachmentId. Files are only ever served to chat members.
chats.post('/me/attachments', express.raw({ type: () => true, limit: FILE_MAX }), async (req, res, next) => {
  try {
    const chat = await membership(req.query.chatId, req.me.id);
    if (!chat) return nf(res);
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length) return bad(res, 'empty file');
    const name = String(req.query.name || 'file').replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'file';
    const t = String(req.query.mime || '').toLowerCase();
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(t) ? t : 'application/octet-stream';
    const id = crypto.randomUUID();
    const rel = path.join(new Date().toISOString().slice(0, 7), id);
    await fs.promises.mkdir(path.join(UPLOAD_DIR, path.dirname(rel)), { recursive: true });
    await fs.promises.writeFile(path.join(UPLOAD_DIR, rel), buf);
    await query(
      `INSERT INTO attachments (id, owner_id, chat_id, filename, mime, size, path, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8))`,
      [id, req.me.id, chat.id, name, mime, buf.length, rel, TTL_DAYS]
    );
    res.status(201).json({ id, name, mime, size: buf.length });
  } catch (err) { next(err); }
});

// Only plain raster images render inline; everything else downloads with an opaque type,
// so an uploaded .html/.svg can never run script on this origin.
const INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
chats.get('/me/attachments/:id', async (req, res, next) => {
  try {
    const { rows: [a] } = await query(
      `SELECT a.* FROM attachments a JOIN chat_members m ON m.chat_id = a.chat_id AND m.employee_id = $2
       WHERE a.id::text = $1`,
      [String(req.params.id), req.me.id]
    );
    if (!a) return nf(res);
    if (a.deleted_at) return res.status(410).json({ error: 'expired' });
    const inline = INLINE.has(a.mime) && !req.query.dl;
    res.set({
      'Content-Type': inline ? a.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(path.join(UPLOAD_DIR, a.path)).on('error', () => res.status(410).end()).pipe(res);
  } catch (err) { next(err); }
});

// Mark attachments gone and remove their files. `where` is a trusted SQL fragment.
async function dropAttachments(where, params) {
  const { rows } = await query(
    `UPDATE attachments SET deleted_at = now() WHERE deleted_at IS NULL AND ${where} RETURNING path`, params);
  for (const r of rows) await fs.promises.unlink(path.join(UPLOAD_DIR, r.path)).catch(() => {});
  return rows.length;
}
const dropChatFiles = (chatId) => dropAttachments('chat_id = $1', [chatId]);

// Expired files (TTL) and uploads never attached to a message within a day.
export async function cleanupAttachments() {
  const n = await dropAttachments(
    `(expires_at < now() OR (created_at < now() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM messages WHERE attachment_id = attachments.id)))`, []);
  if (n) console.log(`[api] removed ${n} expired attachment(s)`);
}
