import express from 'express';
import { query } from './db.js';
import { attach, emit, setViewing, isViewing } from './realtime.js';
import { queueNotif } from './notify.js';

// Real chats between colleagues (spec 004). Only members can read or write a chat; the
// HR edit token grants nothing here. Live updates go out over SSE (/me/stream).
export const chats = express.Router(); // requireMe is mounted on /me in index.js

const PAGE = 50;
const MSG_MAX = 4000;
const bad = (res, error) => res.status(400).json({ error });
const nf = (res) => res.status(404).json({ error: 'not found' });

// ── shapes ───────────────────────────────────────────────────────────────────
const toMsg = (r) => ({
  id: String(r.id), chatId: String(r.chat_id), senderId: r.sender_id,
  text: r.deleted_at ? null : r.text, createdAt: r.created_at, editedAt: r.edited_at, deleted: !!r.deleted_at,
});

export async function memberIds(chatId) {
  const { rows } = await query('SELECT employee_id FROM chat_members WHERE chat_id = $1', [chatId]);
  return rows.map((r) => r.employee_id);
}
async function membership(chatId, empId) {
  if (!/^\d+$/.test(String(chatId))) return null;
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
    query('SELECT chat_id, employee_id, last_read_id FROM chat_members WHERE chat_id = ANY($1::bigint[])', [ids]),
    query('SELECT DISTINCT ON (chat_id) * FROM messages WHERE chat_id = ANY($1::bigint[]) ORDER BY chat_id, id DESC', [ids]),
    query(
      `SELECT msg.chat_id, count(*)::int AS n FROM messages msg
       JOIN chat_members m ON m.chat_id = msg.chat_id AND m.employee_id = $1
       WHERE msg.chat_id = ANY($2::bigint[]) AND msg.id > m.last_read_id
         AND msg.sender_id IS DISTINCT FROM $1 AND msg.deleted_at IS NULL
       GROUP BY msg.chat_id`,
      [meId, ids]
    ),
  ]);
  const group = (arr, k) => arr.reduce((m, r) => m.set(String(r[k]), [...(m.get(String(r[k])) || []), r]), new Map());
  const memBy = group(mem, 'chat_id'), lastBy = new Map(last.map((r) => [String(r.chat_id), r]));
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

// Open (or create) the 1:1 chat with a linked colleague.
chats.post('/me/chats/direct', async (req, res, next) => {
  try {
    const other = String((req.body || {}).employeeId || '');
    if (!other || other === req.me.id) return bad(res, 'employeeId required');
    const { rows: [o] } = await query('SELECT id FROM employees WHERE id = $1 AND telegram_id IS NOT NULL', [other]);
    if (!o) return res.status(404).json({ error: 'colleague is not in the bot yet' });
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

// ── messages ─────────────────────────────────────────────────────────────────
chats.get('/me/chats/:id/messages', async (req, res, next) => {
  try {
    if (!(await membership(req.params.id, req.me.id))) return nf(res);
    const { before, after } = req.query;
    let rows;
    if (after) {
      ({ rows } = await query('SELECT * FROM messages WHERE chat_id = $1 AND id > $2 ORDER BY id LIMIT 500', [req.params.id, after]));
    } else {
      ({ rows } = await query(
        `SELECT * FROM messages WHERE chat_id = $1 ${before ? 'AND id < $3' : ''} ORDER BY id DESC LIMIT $2`,
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
  const preview = msg.text || '📎 Вкладення';
  for (const r of rows) {
    if (r.muted || isViewing(r.employee_id, chat.id)) continue;
    const k = `${chat.id}:${r.employee_id}`;
    if (Date.now() - (lastPing.get(k) || 0) < PING_GAP) continue;
    lastPing.set(k, Date.now());
    await queueNotif(r.employee_id, 'chat', {
      text: preview, fromName: sender.name, pref: 'messages',
      payload: { open: `chat_${chat.id}`, chatTitle: chat.kind === 'direct' ? null : chat.title || null },
    });
  }
}

export async function postMessage(chat, sender, { text = null, attachmentId = null } = {}) {
  const { rows: [m] } = await query(
    'INSERT INTO messages (chat_id, sender_id, text) VALUES ($1, $2, $3) RETURNING *',
    [chat.id, sender.id, text]
  );
  await query('UPDATE chat_members SET last_read_id = $3 WHERE chat_id = $1 AND employee_id = $2', [chat.id, sender.id, m.id]);
  const msg = toMsg(m);
  emit(await memberIds(chat.id), 'message', msg);
  notifyMembers(chat, msg, sender).catch((e) => console.error('[api] notify failed:', e.message));
  return msg;
}

chats.post('/me/chats/:id/messages', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    const text = String((req.body || {}).text ?? '').trim().slice(0, MSG_MAX) || null;
    if (!text) return bad(res, 'text required');
    res.status(201).json(await postMessage(chat, req.me, { text }));
  } catch (err) { next(err); }
});

async function ownMessage(id, meId) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await query('SELECT * FROM messages WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL', [id, meId]);
  return rows[0] || null;
}

chats.patch('/me/messages/:id', async (req, res, next) => {
  try {
    const m = await ownMessage(req.params.id, req.me.id);
    if (!m) return nf(res);
    const text = String((req.body || {}).text ?? '').trim().slice(0, MSG_MAX);
    if (!text) return bad(res, 'text required');
    const { rows: [u] } = await query('UPDATE messages SET text = $2, edited_at = now() WHERE id = $1 RETURNING *', [m.id, text]);
    const msg = toMsg(u);
    emit(await memberIds(m.chat_id), 'message_update', msg);
    res.json(msg);
  } catch (err) { next(err); }
});

// Deleting wipes the text server-side (not just hidden) — only a placeholder remains.
chats.delete('/me/messages/:id', async (req, res, next) => {
  try {
    const m = await ownMessage(req.params.id, req.me.id);
    if (!m) return nf(res);
    const { rows: [u] } = await query('UPDATE messages SET text = NULL, deleted_at = now() WHERE id = $1 RETURNING *', [m.id]);
    const msg = toMsg(u);
    emit(await memberIds(m.chat_id), 'message_update', msg);
    res.json(msg);
  } catch (err) { next(err); }
});

chats.post('/me/chats/:id/read', async (req, res, next) => {
  try {
    const chat = await membership(req.params.id, req.me.id);
    if (!chat) return nf(res);
    const upTo = String((req.body || {}).upTo || '');
    if (!/^\d+$/.test(upTo)) return bad(res, 'upTo required');
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
