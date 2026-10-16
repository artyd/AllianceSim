import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query } from './db.js';
import { attach, emit, setViewing, isViewing } from './realtime.js';
import { queueNotif } from './notify.js';
import { requireEditToken } from './auth.js';

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
  id: String(r.id), chatId: String(r.chat_id), senderId: r.sender_id, kind: r.kind || null,
  text: r.deleted_at ? null : r.text, createdAt: r.created_at, editedAt: r.edited_at, deleted: !!r.deleted_at,
  attachment: r.attachment_id && !r.deleted_at
    ? { id: r.attachment_id, name: r.a_name, mime: r.a_mime, size: r.a_size, expired: !!r.a_deleted }
    : null,
  replyTo: r.reply_to ? String(r.reply_to) : null,
  reactions: [],
  meta: r.meta || null, // spec 007: game invite {gameId, kind, state} | poll {options}
});
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Add the quoted message (for replies) and reaction groups to a page of messages.
async function enrich(msgs) {
  const ids = msgs.map((m) => m.id), quoted = [...new Set(msgs.map((m) => m.replyTo).filter(Boolean))];
  if (!ids.length) return msgs;
  const [{ rows: reacts }, { rows: src }] = await Promise.all([
    query(
      `SELECT message_id, emoji, array_agg(employee_id ORDER BY created_at) AS ids, min(created_at) AS t
       FROM message_reactions WHERE message_id = ANY($1::bigint[]) GROUP BY message_id, emoji ORDER BY t`, [ids]),
    quoted.length ? query(`${MSG_SELECT} WHERE m.id = ANY($1::bigint[])`, [quoted]) : { rows: [] },
  ]);
  const srcBy = new Map(src.map((r) => [String(r.id), r]));
  const pollIds = msgs.filter((m) => m.meta && m.meta.poll).map((m) => m.id);
  const { rows: votes } = pollIds.length
    ? await query('SELECT message_id, option, array_agg(employee_id) AS ids FROM poll_votes WHERE message_id = ANY($1::bigint[]) GROUP BY message_id, option', [pollIds])
    : { rows: [] };
  for (const m of msgs) {
    if (m.meta && m.meta.poll) m.poll = { options: m.meta.poll.options, votes: m.meta.poll.options.map((_, i) => (votes.find((v) => String(v.message_id) === m.id && v.option === i) || { ids: [] }).ids) };
    m.reactions = reacts.filter((r) => String(r.message_id) === m.id).map((r) => ({ emoji: r.emoji, ids: r.ids }));
    if (m.replyTo) {
      const q = srcBy.get(m.replyTo);
      m.quote = q ? {
        id: String(q.id), senderId: q.sender_id, deleted: !!q.deleted_at,
        text: q.deleted_at ? null : (q.text || '').slice(0, 140), attachment: q.attachment_id && !q.deleted_at ? q.a_name : null,
      } : { id: m.replyTo, deleted: true, text: null };
    }
  }
  return msgs;
}
const msgById = async (id) => (await enrich([toMsg((await query(`${MSG_SELECT} WHERE m.id = $1`, [id])).rows[0])]))[0];

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
         AND msg.sender_id IS DISTINCT FROM $1 AND msg.deleted_at IS NULL AND msg.kind IS DISTINCT FROM 'system'
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
  // Onboarding (spec 005): a newcomer joining their department chat gets a welcome post, once.
  for (const d of depts) {
    const ids = added.get(String(d.id)) || [];
    if (!ids.length) continue;
    const { rows: fresh } = await query(
      `SELECT e.id, e.name, e.position FROM employees e
       WHERE e.id = ANY($1::text[]) AND e.created_at > now() - interval '3 days'
         AND NOT EXISTS (SELECT 1 FROM system_posts s WHERE s.kind = 'welcome' AND s.employee_id = e.id)`, [ids]);
    for (const e of fresh) {
      await query(`INSERT INTO system_posts (day, kind, employee_id) VALUES (CURRENT_DATE, 'welcome', $1) ON CONFLICT DO NOTHING`, [e.id]);
      await systemPost(d.dept, `👋 Вітаємо в команді: ${e.name}${e.position ? ' — ' + e.position : ''}! Напишіть привіт 🙂`);
    }
  }
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

// The 1:1 chat between two people (created on first use).
export async function directChatId(a, b) {
  const key = [a, b].sort().join('|');
  await query(`INSERT INTO chats (kind, direct_key, created_by) VALUES ('direct', $1, $2) ON CONFLICT (direct_key) DO NOTHING`, [key, a]);
  const { rows: [c] } = await query('SELECT id FROM chats WHERE direct_key = $1', [key]);
  await query(`INSERT INTO chat_members (chat_id, employee_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`, [c.id, a, b]);
  return c.id;
}
export const chatRow = async (id) => (await query('SELECT * FROM chats WHERE id = $1', [id])).rows[0] || null;
export { msgById };

// Open (or create) the 1:1 chat with a linked colleague.
chats.post('/me/chats/direct', async (req, res, next) => {
  try {
    const other = String((req.body || {}).employeeId || '');
    if (!other || other === req.me.id) return bad(res, 'employeeId required');
    if (!(await linkedIds([other])).length) return res.status(404).json({ error: 'colleague is not in the bot yet' });
    res.json(await loadChat(req.me.id, await directChatId(req.me.id, other)));
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
    res.json({ messages: await enrich(rows.map(toMsg)), hasMore: !after && rows.length === PAGE });
  } catch (err) { next(err); }
});

// Search my chats: message text (not deleted) — newest first.
chats.get('/me/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const { rows } = await query(
      `${MSG_SELECT} JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.employee_id = $1
       WHERE m.deleted_at IS NULL AND m.kind IS DISTINCT FROM 'system' AND m.text ILIKE $2 ORDER BY m.id DESC LIMIT 50`, [req.me.id, like]);
    res.json(rows.map(toMsg));
  } catch (err) { next(err); }
});

// Per-recipient throttle so a burst of messages is one Telegram ping a minute per chat.
const lastPing = new Map();
const PING_GAP = 60 * 1000;

// Announcements reach everyone (muted chats too, no throttle); normal messages respect
// mute, "currently reading" and the 1/min throttle.
async function notifyMembers(chat, msg, sender) {
  const { rows } = await query(
    'SELECT employee_id, muted FROM chat_members WHERE chat_id = $1 AND employee_id IS DISTINCT FROM $2',
    [chat.id, sender.id]
  );
  const loud = msg.kind === 'announce';
  const preview = msg.text || (msg.attachment ? `📎 ${msg.attachment.name}` : '…');
  const title = chat.kind === 'direct' ? null : chat.kind === 'office' ? 'Весь офіс' : chat.title || chat.dept || null;
  for (const r of rows) {
    if (!loud && (r.muted || isViewing(r.employee_id, chat.id))) continue;
    const k = `${chat.id}:${r.employee_id}`;
    if (!loud && Date.now() - (lastPing.get(k) || 0) < PING_GAP) continue;
    lastPing.set(k, Date.now());
    await queueNotif(r.employee_id, loud ? 'announce' : 'chat', {
      text: preview, fromName: sender.name, pref: 'messages',
      payload: { open: `chat_${chat.id}`, chatTitle: title, reply: !loud,
        buttons: msg.poll ? msg.poll.options.map((o, i) => ({ text: o.slice(0, 40), data: `pv:${msg.id}:${i}` })) : undefined },
    });
  }
}

// sender = {id, name}; id null for HR (web) / system posts.
export async function postMessage(chat, sender, { text = null, attachmentId = null, replyTo = null, kind = null, meta = null } = {}) {
  const { rows: [m] } = await query(
    'INSERT INTO messages (chat_id, sender_id, text, attachment_id, reply_to, kind, meta) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [chat.id, sender.id, text, attachmentId, replyTo, kind, meta ? JSON.stringify(meta) : null]
  );
  if (sender.id) await query('UPDATE chat_members SET last_read_id = $3 WHERE chat_id = $1 AND employee_id = $2', [chat.id, sender.id, m.id]);
  const msg = await msgById(m.id);
  emit(await memberIds(chat.id), 'message', msg);
  // game cards send their own Telegram invite (with Прийняти/Відхилити) — see games.js
  if (kind !== 'system' && kind !== 'game') notifyMembers(chat, msg, sender).catch((e) => console.error('[api] notify failed:', e.message));
  return msg;
}

async function replyTarget(chatId, id) {
  if (id == null || id === '') return null;
  if (!isId(id)) return undefined;
  const { rows: [r] } = await query('SELECT id FROM messages WHERE id = $1 AND chat_id = $2', [id, chatId]);
  return r ? r.id : undefined;
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
    const replyTo = await replyTarget(chat.id, b.replyTo);
    if (replyTo === undefined) return bad(res, 'replyTo invalid');
    res.status(201).json(await postMessage(chat, req.me, { text, attachmentId, replyTo }));
  } catch (err) { next(err); }
});

// Toggle a reaction (one of each emoji per person).
chats.post('/me/messages/:id/react', async (req, res, next) => {
  try {
    const emoji = String((req.body || {}).emoji || '');
    if (!REACTIONS.includes(emoji)) return bad(res, 'unknown reaction');
    if (!isId(req.params.id)) return nf(res);
    const { rows: [m] } = await query(
      `SELECT m.id, m.chat_id FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.employee_id = $2
       WHERE m.id = $1 AND m.deleted_at IS NULL`, [req.params.id, req.me.id]);
    if (!m) return nf(res);
    const del = await query('DELETE FROM message_reactions WHERE message_id = $1 AND employee_id = $2 AND emoji = $3', [m.id, req.me.id, emoji]);
    if (!del.rowCount) await query('INSERT INTO message_reactions (message_id, employee_id, emoji) VALUES ($1, $2, $3)', [m.id, req.me.id, emoji]);
    const msg = await msgById(m.id);
    emit(await memberIds(m.chat_id), 'message_update', msg);
    res.json(msg);
  } catch (err) { next(err); }
});

// ── announcements ────────────────────────────────────────────────────────────
// Mini App: into the office chat or my department chat (ANNOUNCE_ALLOWED = names, '*' or
// empty = everyone). HR (edit token, web): into the office chat or any department chat.
const words = (s) => String(s || '').toLocaleLowerCase('uk').replace(/[’'ʼ`]/g, '').split(/[\s,]+/).filter(Boolean);
const ANNOUNCERS = String(process.env.ANNOUNCE_ALLOWED || '').split(',').map((s) => s.trim()).filter(Boolean);
export const canAnnounce = (name) => !ANNOUNCERS.length || ANNOUNCERS.includes('*') ||
  ANNOUNCERS.some((e) => { const have = new Set(words(name)), need = words(e); return need.length && need.every((w) => have.has(w)); });

async function systemChat(target) {
  const { rows: [c] } = target === 'office'
    ? await query(`SELECT * FROM chats WHERE kind = 'office'`)
    : await query(`SELECT * FROM chats WHERE kind = 'dept' AND dept = $1`, [String(target || '').trim()]);
  return c || null;
}
chats.post('/me/announce', async (req, res, next) => {
  try {
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, MSG_MAX);
    if (!text) return bad(res, 'text required');
    if (!canAnnounce(req.me.name)) return res.status(403).json({ error: 'announcements not allowed' });
    const chat = await systemChat(b.target === 'office' ? 'office' : req.me.dept);
    if (!chat || !(await membership(chat.id, req.me.id))) return nf(res);
    const poll = pollOf(b.poll);
    if (poll === undefined) return bad(res, 'poll needs 2–6 options');
    res.status(201).json(await postMessage(chat, req.me, { text, kind: 'announce', meta: poll ? { poll } : null }));
  } catch (err) { next(err); }
});
export async function hrAnnounce(target, text, pollIn) {
  const chat = await systemChat(target);
  if (!chat) return null;
  const poll = pollOf(pollIn);
  return postMessage(chat, { id: null, name: 'HR' }, { text, kind: 'announce', meta: poll ? { poll } : null });
}
// Poll options: null = no poll, undefined = invalid.
function pollOf(v) {
  if (v == null || v === '') return null;
  const options = (Array.isArray(v) ? v : Array.isArray(v.options) ? v.options : []).map((o) => String(o || '').trim().slice(0, 80)).filter(Boolean);
  return options.length >= 2 && options.length <= 6 ? { options } : undefined;
}
// One vote per person; voting the same option again takes it back.
export async function votePoll(empId, msgId, option) {
  if (!isId(msgId)) return null;
  const { rows: [m] } = await query(
    `SELECT m.id, m.chat_id, m.meta FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.employee_id = $2
     WHERE m.id = $1 AND m.deleted_at IS NULL`, [msgId, empId]);
  if (!m || !m.meta || !m.meta.poll) return null;
  const o = Number(option);
  if (!Number.isInteger(o) || o < 0 || o >= m.meta.poll.options.length) return undefined;
  const del = await query('DELETE FROM poll_votes WHERE message_id = $1 AND employee_id = $2 AND option = $3', [m.id, empId, o]);
  if (!del.rowCount) await query(`INSERT INTO poll_votes (message_id, employee_id, option) VALUES ($1, $2, $3)
    ON CONFLICT (message_id, employee_id) DO UPDATE SET option = EXCLUDED.option`, [m.id, empId, o]);
  const msg = await msgById(m.id);
  emit(await memberIds(m.chat_id), 'message_update', msg);
  return msg;
}
chats.post('/me/messages/:id/vote', async (req, res, next) => {
  try {
    const msg = await votePoll(req.me.id, req.params.id, (req.body || {}).option);
    if (msg === null) return nf(res);
    if (msg === undefined) return bad(res, 'option invalid');
    res.json(msg);
  } catch (err) { next(err); }
});
// The bot: a poll button pressed in Telegram votes on behalf of that user.
chats.post('/bot/messages/:id/vote', requireEditToken, async (req, res, next) => {
  try {
    const { rows: [e] } = await query('SELECT id FROM employees WHERE telegram_id = $1', [String((req.body || {}).tgId || '')]);
    const msg = e ? await votePoll(e.id, req.params.id, (req.body || {}).option) : null;
    if (!msg) return nf(res);
    res.json({ ok: true, options: msg.poll.options, counts: msg.poll.votes.map((v) => v.length) });
  } catch (err) { next(err); }
});
// Bot-authored posts (birthday greetings…): no Telegram ping, sender = null.
export async function systemPost(target, text) {
  const chat = await systemChat(target);
  return chat ? postMessage(chat, { id: null, name: 'AllianceSim' }, { text, kind: 'system' }) : null;
}

// ── reply from Telegram: the bot forwards a reply to one of its chat pings ───
export async function replyFromTelegram(tgId, tgMessageId, text) {
  const { rows: [n] } = await query(
    `SELECT n.payload, e.id AS emp_id, e.name FROM notifications n JOIN employees e ON e.id = n.employee_id
     WHERE e.telegram_id = $1 AND n.tg_message_id = $2 AND n.kind = 'chat'`, [String(tgId), tgMessageId]);
  const m = n && /^chat_(\d+)$/.exec((n.payload || {}).open || '');
  if (!m) return null;
  const chat = await membership(m[1], n.emp_id);
  if (!chat) return null;
  const body = String(text || '').trim().slice(0, MSG_MAX);
  if (!body) return null;
  return { chat, msg: await postMessage(chat, { id: n.emp_id, name: n.name }, { text: body }) };
}

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

// Only plain raster images (and audio for voice notes) render inline; everything else downloads with an opaque type,
// so an uploaded .html/.svg can never run script on this origin.
const INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav']); // voice messages
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
    // sendFile handles Range requests (Safari won't play audio without them).
    res.sendFile(path.resolve(UPLOAD_DIR, a.path), { cacheControl: false, lastModified: false, acceptRanges: true }, (err) => {
      if (err && !res.headersSent) res.status(410).json({ error: 'gone' });
    });
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

// ── token-gated: HR web announcements, bot reply forwarding ─────────────────
chats.post('/announce', requireEditToken, async (req, res, next) => {
  try {
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, MSG_MAX);
    if (!text) return bad(res, 'text required');
    const msg = await hrAnnounce(b.target === 'office' || !b.target ? 'office' : b.target, text, b.poll);
    if (!msg) return nf(res);
    res.status(201).json(msg);
  } catch (err) { next(err); }
});
chats.post('/bot/reply', requireEditToken, async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await replyFromTelegram(String(b.tgId || '').replace(/\D/g, ''), Number(b.replyTo) || 0, b.text);
    if (!r) return nf(res);
    res.json({ ok: true, chatId: String(r.chat.id) });
  } catch (err) { next(err); }
});
