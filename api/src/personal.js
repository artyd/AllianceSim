import express from 'express';
import { query } from './db.js';
import { signSession } from './session.js';

// Personal phone: calendar, tasks, notification prefs (spec 004). Everything here is
// scoped to req.me — the HR edit token deliberately grants NO access to these routes.
// Auth: requireMe is mounted on /me in index.js.
export const personal = express.Router();

// ── input helpers ────────────────────────────────────────────────────────────
const str = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const when = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); // undefined = invalid
};
const REMINDS = new Set([null, 10, 30, 60]);
const remind = (v) => (v == null || v === '' ? null : Number(v));
const bad = (res, error) => res.status(400).json({ error });

// ── session / identity ───────────────────────────────────────────────────────
personal.post('/me/session', (req, res) => {
  const s = signSession(req.me.id);
  res.json({ ...s, me: req.me });
});

// Linked colleagues with their Telegram username — only for authenticated callers, so
// usernames are never on the public /employees list.
personal.get('/me/contacts', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, telegram_username FROM employees WHERE telegram_id IS NOT NULL ORDER BY name'
    );
    res.json(rows.map((r) => ({ id: r.id, username: r.telegram_username || null })));
  } catch (err) { next(err); }
});

// ── calendar ─────────────────────────────────────────────────────────────────
const toEvent = (r, attendees = []) => ({
  id: String(r.id), title: r.title, startsAt: r.starts_at, endsAt: r.ends_at, allDay: r.all_day,
  place: r.place, note: r.note, color: r.color, organizerId: r.organizer_id,
  myStatus: r.my_status, remindMin: r.remind_min, attendees,
});

async function loadEvents(meId, where, params) {
  const { rows } = await query(
    `SELECT e.*, a.status AS my_status, a.remind_min
     FROM events e JOIN event_attendees a ON a.event_id = e.id AND a.employee_id = $1
     WHERE e.cancelled_at IS NULL AND ${where}
     ORDER BY e.starts_at, e.id`,
    [meId, ...params]
  );
  if (!rows.length) return [];
  const { rows: att } = await query(
    'SELECT event_id, employee_id, status FROM event_attendees WHERE event_id = ANY($1::bigint[])',
    [rows.map((r) => r.id)]
  );
  const by = new Map();
  for (const a of att) {
    const k = String(a.event_id);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ id: a.employee_id, status: a.status });
  }
  return rows.map((r) => toEvent(r, by.get(String(r.id)) || []));
}
export const loadEvent = async (meId, id) => (await loadEvents(meId, 'e.id = $2', [id]))[0] || null;

personal.get('/me/events', async (req, res, next) => {
  try {
    const from = when(req.query.from), to = when(req.query.to);
    if (!from || !to) return bad(res, 'from and to required');
    res.json(await loadEvents(req.me.id, 'e.starts_at < $3 AND COALESCE(e.ends_at, e.starts_at) >= $2', [from, to]));
  } catch (err) { next(err); }
});

personal.get('/me/events/:id', async (req, res, next) => {
  try {
    const ev = await loadEvent(req.me.id, req.params.id);
    if (!ev) return res.status(404).json({ error: 'not found' });
    res.json(ev);
  } catch (err) { next(err); }
});

function eventFields(b, partial) {
  const f = {};
  if (!partial || 'title' in b) { f.title = str(b.title, 200); if (!f.title) return 'title required'; }
  if (!partial || 'startsAt' in b) { f.starts_at = when(b.startsAt); if (!f.starts_at) return 'startsAt invalid'; }
  if ('endsAt' in b) { f.ends_at = when(b.endsAt); if (f.ends_at === undefined) return 'endsAt invalid'; }
  if ('allDay' in b) f.all_day = !!b.allDay;
  if ('place' in b) f.place = str(b.place, 200);
  if ('note' in b) f.note = str(b.note, 2000);
  if ('color' in b) f.color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : null;
  return f;
}

personal.post('/me/events', async (req, res, next) => {
  try {
    const b = req.body || {};
    const f = eventFields(b, false);
    if (typeof f === 'string') return bad(res, f);
    const rm = remind(b.remindMin);
    if (!REMINDS.has(rm)) return bad(res, 'remindMin must be 10/30/60 or null');
    const cols = ['organizer_id', ...Object.keys(f)];
    const vals = [req.me.id, ...Object.values(f)];
    const { rows: [ev] } = await query(
      `INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`,
      vals
    );
    await query(
      `INSERT INTO event_attendees (event_id, employee_id, status, remind_min) VALUES ($1, $2, 'accepted', $3)`,
      [ev.id, req.me.id, rm]
    );
    res.status(201).json(await loadEvent(req.me.id, ev.id));
  } catch (err) { next(err); }
});

// Organizer edits the event; any attendee may change their own reminder.
personal.patch('/me/events/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const ev = await loadEvent(req.me.id, req.params.id);
    if (!ev) return res.status(404).json({ error: 'not found' });
    if ('remindMin' in b) {
      const rm = remind(b.remindMin);
      if (!REMINDS.has(rm)) return bad(res, 'remindMin must be 10/30/60 or null');
      await query('UPDATE event_attendees SET remind_min = $3, reminded_at = NULL WHERE event_id = $1 AND employee_id = $2',
        [ev.id, req.me.id, rm]);
    }
    const f = eventFields(b, true);
    if (typeof f === 'string') return bad(res, f);
    if (Object.keys(f).length) {
      if (ev.organizerId !== req.me.id) return res.status(403).json({ error: 'only the organizer can edit' });
      const keys = Object.keys(f);
      await query(
        `UPDATE events SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
        [ev.id, ...Object.values(f)]
      );
      if ('starts_at' in f) await query('UPDATE event_attendees SET reminded_at = NULL WHERE event_id = $1', [ev.id]);
    }
    res.json(await loadEvent(req.me.id, ev.id));
  } catch (err) { next(err); }
});

personal.delete('/me/events/:id', async (req, res, next) => {
  try {
    const ev = await loadEvent(req.me.id, req.params.id);
    if (!ev) return res.status(404).json({ error: 'not found' });
    if (ev.organizerId !== req.me.id) return res.status(403).json({ error: 'only the organizer can delete' });
    await query('UPDATE events SET cancelled_at = now(), updated_at = now() WHERE id = $1', [ev.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── tasks ────────────────────────────────────────────────────────────────────
const toTask = (r) => ({
  id: String(r.id), text: r.text, dueAt: r.due_at, done: !!r.done_at, doneAt: r.done_at,
  authorId: r.author_id, assigneeId: r.assignee_id, createdAt: r.created_at,
});
const loadTask = async (meId, id) => {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1 AND (author_id = $2 OR assignee_id = $2)', [id, meId]);
  return rows[0] || null;
};

personal.get('/me/tasks', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM tasks WHERE assignee_id = $1 OR author_id = $1
       ORDER BY (done_at IS NOT NULL), due_at NULLS LAST, id DESC`,
      [req.me.id]
    );
    res.json(rows.map(toTask));
  } catch (err) { next(err); }
});

personal.post('/me/tasks', async (req, res, next) => {
  try {
    const b = req.body || {};
    const text = str(b.text, 500);
    if (!text) return bad(res, 'text required');
    const due = when(b.dueAt);
    if (due === undefined) return bad(res, 'dueAt invalid');
    const { rows: [t] } = await query(
      'INSERT INTO tasks (author_id, assignee_id, text, due_at) VALUES ($1, $1, $2, $3) RETURNING *',
      [req.me.id, text, due]
    );
    res.status(201).json(toTask(t));
  } catch (err) { next(err); }
});

// Author edits text/deadline; either side may toggle done.
personal.patch('/me/tasks/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const t = await loadTask(req.me.id, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    const sets = [], vals = [t.id];
    if ('text' in b || 'dueAt' in b) {
      if (t.author_id !== req.me.id) return res.status(403).json({ error: 'only the author can edit' });
      if ('text' in b) { const s = str(b.text, 500); if (!s) return bad(res, 'text required'); vals.push(s); sets.push(`text = $${vals.length}`); }
      if ('dueAt' in b) {
        const d = when(b.dueAt); if (d === undefined) return bad(res, 'dueAt invalid');
        vals.push(d); sets.push(`due_at = $${vals.length}`, 'due_notified_at = NULL', 'overdue_notified_at = NULL');
      }
    }
    if ('done' in b) sets.push(b.done ? 'done_at = COALESCE(done_at, now())' : 'done_at = NULL');
    if (!sets.length) return bad(res, 'nothing to update');
    const { rows: [u] } = await query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals);
    res.json(toTask(u));
  } catch (err) { next(err); }
});

personal.delete('/me/tasks/:id', async (req, res, next) => {
  try {
    const t = await loadTask(req.me.id, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    if (t.author_id !== req.me.id) return res.status(403).json({ error: 'only the author can delete' });
    await query('DELETE FROM tasks WHERE id = $1', [t.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── notification preferences ─────────────────────────────────────────────────
const PREF_KEYS = ['messages', 'events', 'tasks', 'digest'];
export async function getPrefs(empId) {
  const { rows } = await query('SELECT * FROM notify_prefs WHERE employee_id = $1', [empId]);
  const r = rows[0] || {};
  return Object.fromEntries(PREF_KEYS.map((k) => [k, r[k] !== false]));
}
personal.get('/me/prefs', async (req, res, next) => {
  try { res.json(await getPrefs(req.me.id)); } catch (err) { next(err); }
});
personal.put('/me/prefs', async (req, res, next) => {
  try {
    const p = { ...(await getPrefs(req.me.id)) };
    for (const k of PREF_KEYS) if (k in (req.body || {})) p[k] = !!req.body[k];
    await query(
      `INSERT INTO notify_prefs (employee_id, messages, events, tasks, digest) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id) DO UPDATE SET messages = $2, events = $3, tasks = $4, digest = $5`,
      [req.me.id, p.messages, p.events, p.tasks, p.digest]
    );
    res.json(p);
  } catch (err) { next(err); }
});
