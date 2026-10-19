import express from 'express';
import { query } from '../lib/db.js';
import { signSession } from '../lib/session.js';
import { emit } from '../lib/realtime.js';
import { queueNotif } from '../lib/notify.js';
import { requireEditToken } from '../lib/auth.js';
import { occurrences, nextOccurrence, FREQS, todayWindow, TZ } from '../lib/recur.js';
import { invalidateOffice } from '../office/live.js';

// Personal phone: calendar, tasks, notification prefs (spec 004). Everything under /me is
// scoped to req.me — the HR edit token deliberately grants NO access to these routes.
// Auth: requireMe is mounted on /me in index.js. /bot/* is the bot's token-gated side
// (inline buttons "Прийняти/Виконано" act on behalf of the Telegram user who pressed them).
export const personal = express.Router();

export { TZ }; // office timezone (re-exported for older imports)
export const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 9);

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
const nf = (res) => res.status(404).json({ error: 'not found' });
const isId = (v) => /^\d+$/.test(String(v));

// Human date for Telegram texts, always in the office timezone.
export function fmtWhen(iso, allDay = false) {
  const o = allDay ? { weekday: 'short', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
  return new Date(iso).toLocaleString('uk-UA', { ...o, timeZone: TZ });
}
const evLine = (e) => `«${e.title}» · ${fmtWhen(e.starts_at ?? e.startsAt, e.all_day ?? e.allDay)}${e.place ? ' · ' + e.place : ''}`;

// Only colleagues who linked Telegram can be invited / assigned.
async function linkedIds(ids, exclude) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => id !== exclude);
  if (!want.length) return [];
  const { rows } = await query('SELECT id FROM employees WHERE id = ANY($1::text[]) AND telegram_id IS NOT NULL', [want]);
  return rows.map((r) => r.id);
}

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
  place: r.place, room: r.room || null, note: r.note, color: r.color, organizerId: r.organizer_id,
  repeat: r.repeat_freq || null, repeatUntil: r.repeat_until || null,
  seriesStart: r.starts_at, // occurrences keep the series' first start here
  myStatus: r.my_status, remindMin: r.remind_min, attendees,
});
// Occurrences of an API event object inside [from, to).
const ms = (d) => new Date(d).getTime();
const asSeries = (ev) => ({
  starts_at: ev.seriesStart || ev.startsAt,
  ends_at: ev.endsAt && ev.startsAt ? new Date(ms(ev.seriesStart || ev.startsAt) + ms(ev.endsAt) - ms(ev.startsAt)) : null,
  repeat_freq: ev.repeat, repeat_until: ev.repeatUntil,
});
export const expandEvent = (ev, from, to) =>
  occurrences(asSeries(ev), from, to, TZ).map((o) => ({ ...ev, startsAt: o.start, endsAt: o.end }));
// SQL for "series that may have an occurrence in [$2, $3)".
const IN_RANGE = `e.starts_at < $3 AND (COALESCE(e.ends_at, e.starts_at) >= $2
  OR (e.repeat_freq IS NOT NULL AND (e.repeat_until IS NULL OR e.repeat_until >= $2::timestamptz - interval '1 day')))`;

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
export const loadEvent = async (meId, id) => (isId(id) ? (await loadEvents(meId, 'e.id = $2', [id]))[0] || null : null);

// Live refresh for everyone involved: their own view of the event, or "removed".
async function pushEvent(eventId, ids) {
  for (const id of new Set(ids)) {
    const ev = await loadEvent(id, eventId);
    emit([id], ev ? 'event' : 'event_removed', ev || { id: String(eventId) });
  }
}
const attendeeIds = (ev) => ev.attendees.map((a) => a.id);
const invitePayload = (id) => ({
  open: `event_${id}`,
  buttons: [{ text: '✅ Прийняти', data: `ev:acc:${id}` }, { text: '❌ Відхилити', data: `ev:dec:${id}` }],
});

// Any calendar write can change who is in a meeting / which room is booked → drop the
// /office/now cache once the response is out.
personal.use(['/me/events', '/bot/events'], (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', invalidateOffice);
  next();
});

personal.get('/me/events', async (req, res, next) => {
  try {
    const from = when(req.query.from), to = when(req.query.to);
    if (!from || !to) return bad(res, 'from and to required');
    const series = await loadEvents(req.me.id, IN_RANGE, [from, to]);
    res.json(series.flatMap((ev) => expandEvent(ev, new Date(from), new Date(to)))
      .sort((a, b) => a.startsAt - b.startsAt));
  } catch (err) { next(err); }
});

// Upcoming invitations I haven't answered (calendar badge).
personal.get('/me/invites', async (req, res, next) => {
  try {
    res.json(await loadEvents(req.me.id, `a.status = 'pending' AND COALESCE(e.ends_at, e.starts_at) >= now() - interval '1 day'`, []));
  } catch (err) { next(err); }
});

personal.get('/me/events/:id', async (req, res, next) => {
  try {
    const ev = await loadEvent(req.me.id, req.params.id);
    if (!ev) return nf(res);
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
  if ('room' in b) f.room = /^(r\d{1,3}|rz:[\w-]{1,40})$/.test(String(b.room || '')) ? b.room : null;
  if ('repeat' in b) {
    f.repeat_freq = b.repeat ? String(b.repeat) : null;
    if (f.repeat_freq && !FREQS.has(f.repeat_freq)) return 'repeat must be daily/weekdays/weekly/monthly';
  }
  if ('repeatUntil' in b) { f.repeat_until = when(b.repeatUntil); if (f.repeat_until === undefined) return 'repeatUntil invalid'; }
  return f;
}

async function invite(ev, ids, me) {
  if (!ids.length) return;
  await query(
    `INSERT INTO event_attendees (event_id, employee_id, status, remind_min) SELECT $1, unnest($2::text[]), 'pending', 30
     ON CONFLICT DO NOTHING`, [ev.id, ids]);
  for (const id of ids) {
    await queueNotif(id, 'event_invite', { text: evLine(ev), fromName: me.name, pref: 'events', payload: invitePayload(ev.id) });
  }
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
      `INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`,
      vals
    );
    await query(
      `INSERT INTO event_attendees (event_id, employee_id, status, remind_min) VALUES ($1, $2, 'accepted', $3)`,
      [ev.id, req.me.id, rm]
    );
    const guests = await linkedIds(b.attendeeIds, req.me.id);
    await invite(ev, guests, req.me);
    await pushEvent(ev.id, guests);
    res.status(201).json(await loadEvent(req.me.id, ev.id));
  } catch (err) { next(err); }
});

// Organizer edits the event (and its guest list); any attendee may change their own reminder.
personal.patch('/me/events/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const ev = await loadEvent(req.me.id, req.params.id);
    if (!ev) return nf(res);
    if ('remindMin' in b) {
      const rm = remind(b.remindMin);
      if (!REMINDS.has(rm)) return bad(res, 'remindMin must be 10/30/60 or null');
      await query('UPDATE event_attendees SET remind_min = $3, reminded_at = NULL WHERE event_id = $1 AND employee_id = $2',
        [ev.id, req.me.id, rm]);
    }
    const f = eventFields(b, true);
    if (typeof f === 'string') return bad(res, f);
    const guestsChange = Array.isArray(b.attendeeIds);
    if ((Object.keys(f).length || guestsChange) && ev.organizerId !== req.me.id) {
      return res.status(403).json({ error: 'only the organizer can edit' });
    }
    const before = attendeeIds(ev);
    if (Object.keys(f).length) {
      const keys = Object.keys(f);
      const { rows: [u] } = await query(
        `UPDATE events SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
        [ev.id, ...Object.values(f)]
      );
      // Tell guests only about changes that matter to them (time, place, title).
      const norm = (v) => (v instanceof Date || /^\d{4}-\d\d-\d\dT/.test(String(v)) ? new Date(v).getTime() : v ?? null);
      const KEY = { starts_at: 'startsAt', ends_at: 'endsAt', all_day: 'allDay', title: 'title', place: 'place' };
      const moved = Object.keys(KEY).some((k) => k in f && norm(f[k]) !== norm(ev[KEY[k]]));
      if ('starts_at' in f) await query('UPDATE event_attendees SET reminded_at = NULL WHERE event_id = $1', [ev.id]);
      if (moved) {
        for (const id of before.filter((x) => x !== req.me.id)) {
          await queueNotif(id, 'event_changed', { text: evLine(u), fromName: req.me.name, pref: 'events', payload: { open: `event_${ev.id}` } });
        }
      }
    }
    let removed = [];
    if (guestsChange) {
      const want = await linkedIds(b.attendeeIds, req.me.id);
      const { rows: [cur] } = await query('SELECT * FROM events WHERE id = $1', [ev.id]);
      await invite(cur, want.filter((id) => !before.includes(id)), req.me);
      removed = before.filter((id) => id !== req.me.id && !want.includes(id));
      if (removed.length) {
        await query('DELETE FROM event_attendees WHERE event_id = $1 AND employee_id = ANY($2::text[])', [ev.id, removed]);
        for (const id of removed) await queueNotif(id, 'event_cancelled', { text: evLine(cur), fromName: req.me.name, pref: 'events' });
      }
    }
    const after = await loadEvent(req.me.id, ev.id);
    await pushEvent(ev.id, [...attendeeIds(after), ...removed].filter((id) => id !== req.me.id));
    res.json(after);
  } catch (err) { next(err); }
});

personal.delete('/me/events/:id', async (req, res, next) => {
  try {
    const ev = await loadEvent(req.me.id, req.params.id);
    if (!ev) return nf(res);
    if (ev.organizerId !== req.me.id) return res.status(403).json({ error: 'only the organizer can delete' });
    const { rows: [u] } = await query('UPDATE events SET cancelled_at = now(), updated_at = now() WHERE id = $1 RETURNING *', [ev.id]);
    const others = attendeeIds(ev).filter((id) => id !== req.me.id);
    for (const id of others) {
      const a = ev.attendees.find((x) => x.id === id);
      if (a.status !== 'declined') await queueNotif(id, 'event_cancelled', { text: evLine(u), fromName: req.me.name, pref: 'events' });
    }
    await pushEvent(ev.id, others);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Accept / decline an invitation (Mini App or the bot's inline buttons).
export async function respondEvent(me, id, status) {
  if (!['accepted', 'declined'].includes(status)) return { error: 400 };
  const ev = await loadEvent(me.id, id);
  if (!ev) return { error: 404 };
  if (ev.organizerId === me.id) return { error: 403 };
  const changed = ev.myStatus !== status;
  await query('UPDATE event_attendees SET status = $3 WHERE event_id = $1 AND employee_id = $2', [ev.id, me.id, status]);
  if (changed) {
    await queueNotif(ev.organizerId, 'event_response', {
      text: evLine(ev), fromName: me.name, pref: 'events', payload: { open: `event_${ev.id}`, status },
    });
  }
  const after = await loadEvent(me.id, ev.id);
  await pushEvent(ev.id, attendeeIds(after));
  return { event: after };
}
personal.post('/me/events/:id/respond', async (req, res, next) => {
  try {
    const r = await respondEvent(req.me, req.params.id, (req.body || {}).status);
    if (r.error) return res.status(r.error).json({ error: 'cannot respond' });
    res.json(r.event);
  } catch (err) { next(err); }
});

// ── tasks ────────────────────────────────────────────────────────────────────
const toTask = (r) => ({
  id: String(r.id), text: r.text, dueAt: r.due_at, done: !!r.done_at, doneAt: r.done_at,
  authorId: r.author_id, assigneeId: r.assignee_id, createdAt: r.created_at,
});
const loadTask = async (meId, id) => {
  if (!isId(id)) return null;
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1 AND (author_id = $2 OR assignee_id = $2)', [id, meId]);
  return rows[0] || null;
};
const pushTask = (t, type = 'task') => emit([t.author_id, t.assignee_id], type, type === 'task' ? toTask(t) : { id: String(t.id) });
const taskLine = (t) => `«${t.text}»${t.due_at ? ' · до ' + fmtWhen(t.due_at) : ''}`;

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
    let assignee = req.me.id;
    if (b.assigneeId && String(b.assigneeId) !== req.me.id) {
      [assignee] = await linkedIds([b.assigneeId], req.me.id);
      if (!assignee) return bad(res, 'assignee must be a colleague in the bot');
    }
    const { rows: [t] } = await query(
      'INSERT INTO tasks (author_id, assignee_id, text, due_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.me.id, assignee, text, due]
    );
    if (assignee !== req.me.id) {
      await queueNotif(assignee, 'task_assigned', {
        text: taskLine(t), fromName: req.me.name, pref: 'tasks',
        payload: { open: `task_${t.id}`, buttons: [{ text: '✓ Виконано', data: `tk:done:${t.id}` }] },
      });
      pushTask(t);
    }
    res.status(201).json(toTask(t));
  } catch (err) { next(err); }
});

// Mark done / undone (author or assignee). Notifies the author when someone else finishes.
export async function setTaskDone(me, id, done) {
  const t = await loadTask(me.id, id);
  if (!t) return { error: 404 };
  const { rows: [u] } = await query(
    `UPDATE tasks SET done_at = ${done ? 'COALESCE(done_at, now())' : 'NULL'}, updated_at = now() WHERE id = $1 RETURNING *`, [t.id]);
  if (done && !t.done_at && me.id !== t.author_id) {
    await queueNotif(t.author_id, 'task_done', { text: taskLine(u), fromName: me.name, pref: 'tasks', payload: { open: `task_${t.id}` } });
  }
  pushTask(u);
  return { task: u };
}

// Author edits text/deadline; either side may toggle done.
personal.patch('/me/tasks/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    let t = await loadTask(req.me.id, req.params.id);
    if (!t) return nf(res);
    if ('text' in b || 'dueAt' in b) {
      if (t.author_id !== req.me.id) return res.status(403).json({ error: 'only the author can edit' });
      const sets = [], vals = [t.id];
      if ('text' in b) { const s = str(b.text, 500); if (!s) return bad(res, 'text required'); vals.push(s); sets.push(`text = $${vals.length}`); }
      if ('dueAt' in b) {
        const d = when(b.dueAt); if (d === undefined) return bad(res, 'dueAt invalid');
        vals.push(d); sets.push(`due_at = $${vals.length}`, 'due_notified_at = NULL', 'overdue_notified_at = NULL');
      }
      ({ rows: [t] } = await query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals));
      pushTask(t);
    }
    if ('done' in b) ({ task: t } = await setTaskDone(req.me, t.id, !!b.done));
    else if (!('text' in b || 'dueAt' in b)) return bad(res, 'nothing to update');
    res.json(toTask(t));
  } catch (err) { next(err); }
});

personal.delete('/me/tasks/:id', async (req, res, next) => {
  try {
    const t = await loadTask(req.me.id, req.params.id);
    if (!t) return nf(res);
    if (t.author_id !== req.me.id) return res.status(403).json({ error: 'only the author can delete' });
    await query('DELETE FROM tasks WHERE id = $1', [t.id]);
    pushTask(t, 'task_removed');
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

// ── bot side (token-gated): inline buttons + morning digest ───────────────────
async function byTg(tgId) {
  const { rows: [r] } = await query('SELECT id, name FROM employees WHERE telegram_id = $1', [String(tgId || '').replace(/\D/g, '') || null]);
  return r || null;
}
personal.post('/bot/events/:id/respond', requireEditToken, async (req, res, next) => {
  try {
    const me = await byTg((req.body || {}).tgId);
    if (!me) return nf(res);
    const r = await respondEvent(me, req.params.id, (req.body || {}).status);
    if (r.error) return res.status(r.error).json({ error: 'cannot respond' });
    res.json({ ok: true, title: r.event.title, status: r.event.myStatus });
  } catch (err) { next(err); }
});
personal.post('/bot/tasks/:id/done', requireEditToken, async (req, res, next) => {
  try {
    const me = await byTg((req.body || {}).tgId);
    if (!me) return nf(res);
    const r = await setTaskDone(me, req.params.id, true);
    if (r.error) return res.status(r.error).json({ error: 'not found' });
    res.json({ ok: true, text: r.task.text });
  } catch (err) { next(err); }
});

// Today's agenda per linked person who wants the digest (office timezone).
personal.get('/bot/digests', requireEditToken, async (_req, res, next) => {
  try {
    const today = `(now() AT TIME ZONE '${TZ.replace(/'/g, '')}')::date`;
    const local = (col) => `(${col} AT TIME ZONE '${TZ.replace(/'/g, '')}')`;
    const { rows: people } = await query(
      `SELECT e.id, e.telegram_id FROM employees e LEFT JOIN notify_prefs p ON p.employee_id = e.id
       WHERE e.telegram_id IS NOT NULL AND COALESCE(p.digest, true)`);
    // Today's occurrences (repeating series expanded), all-day first.
    const win = todayWindow(TZ);
    const { rows: cand } = await query(
      `SELECT a.employee_id, a.status, e.* FROM event_attendees a JOIN events e ON e.id = a.event_id
       WHERE e.cancelled_at IS NULL AND a.status <> 'declined' AND ${IN_RANGE.replace(/\$2/g, '$1').replace(/\$3/g, '$2')}`,
      [win.start.toISOString(), win.end.toISOString()]);
    const evs = cand.flatMap((e) => occurrences(e, win.start, win.end, TZ).map((o) => ({ ...e, starts_at: o.start })))
      .sort((x, y) => (y.all_day - x.all_day) || (x.starts_at - y.starts_at));
    const { rows: tasks } = await query(
      `SELECT assignee_id, text, due_at, (due_at < now()) AS overdue,
              (due_at IS NOT NULL AND ${local('due_at')}::date <= ${today}) AS due
       FROM tasks WHERE done_at IS NULL ORDER BY due_at NULLS LAST`);
    const out = people.map((p) => {
      const mine = evs.filter((e) => e.employee_id === p.id);
      const t = tasks.filter((x) => x.assignee_id === p.id);
      return {
        telegram_id: String(p.telegram_id),
        events: mine.filter((e) => e.status === 'accepted').map((e) => ({
          title: e.title, place: e.place, time: e.all_day ? null : new Date(e.starts_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: TZ }),
        })),
        invites: mine.filter((e) => e.status === 'pending').length,
        due: t.filter((x) => x.due).map((x) => ({ text: x.text, overdue: x.overdue })),
        open: t.length,
      };
    });
    res.json(out);
  } catch (err) { next(err); }
});

// ── reminders job (every minute) ─────────────────────────────────────────────
export async function runReminders() {
  const tz = TZ.replace(/'/g, '');
  // Event reminders: N minutes before start, once per attendee (not declined, not all-day).
  const { rows: due } = await query(
    `UPDATE event_attendees a SET reminded_at = now()
     FROM events e
     WHERE e.id = a.event_id AND e.cancelled_at IS NULL AND NOT e.all_day AND e.repeat_freq IS NULL
       AND a.remind_min IS NOT NULL AND a.reminded_at IS NULL AND a.status <> 'declined'
       AND e.starts_at - make_interval(mins => a.remind_min) <= now() AND e.starts_at > now() - interval '5 minutes'
     RETURNING a.employee_id, e.id, e.title, e.starts_at, e.all_day, e.place, a.remind_min`);
  // Repeating series: remind before the next occurrence (reminded_at marks the last one sent).
  const now = new Date();
  const { rows: rec } = await query(
    `SELECT a.employee_id, a.remind_min, a.reminded_at, e.* FROM event_attendees a JOIN events e ON e.id = a.event_id
     WHERE e.cancelled_at IS NULL AND NOT e.all_day AND e.repeat_freq IS NOT NULL
       AND a.remind_min IS NOT NULL AND a.status <> 'declined'
       AND (e.repeat_until IS NULL OR e.repeat_until >= now() - interval '1 day') AND e.starts_at < now() + interval '2 hours'`);
  for (const r of rec) {
    const o = nextOccurrence(r, new Date(now - 5 * 60e3), TZ, 2 * 864e5);
    if (!o) continue;
    const fireAt = new Date(o.start - r.remind_min * 60e3);
    if (now < fireAt || (r.reminded_at && new Date(r.reminded_at) >= fireAt)) continue;
    const { rowCount } = await query(
      `UPDATE event_attendees SET reminded_at = now() WHERE event_id = $1 AND employee_id = $2 AND (reminded_at IS NULL OR reminded_at < $3)`,
      [r.id, r.employee_id, fireAt]);
    if (rowCount) due.push({ ...r, starts_at: o.start });
  }
  for (const r of due) {
    await queueNotif(r.employee_id, 'event_reminder', {
      text: `${evLine(r)}\nчерез ${r.remind_min >= 60 ? r.remind_min / 60 + ' год' : r.remind_min + ' хв'}`,
      pref: 'events', payload: { open: `event_${r.id}` },
    });
  }
  // Task deadline today — once, from the morning check-in hour (tasks that existed by then).
  const { rows: today } = await query(
    `UPDATE tasks SET due_notified_at = now()
     WHERE done_at IS NULL AND due_at IS NOT NULL AND due_notified_at IS NULL AND due_at > now()
       AND (due_at AT TIME ZONE '${tz}')::date = (now() AT TIME ZONE '${tz}')::date
       AND extract(hour FROM now() AT TIME ZONE '${tz}') >= $1::int
       AND created_at < date_trunc('day', now() AT TIME ZONE '${tz}') AT TIME ZONE '${tz}' + make_interval(hours => $1::int)
     RETURNING *`, [CHECKIN_HOUR]);
  for (const t of today) {
    await queueNotif(t.assignee_id, 'task_due', { text: taskLine(t), pref: 'tasks', payload: { open: `task_${t.id}`, buttons: [{ text: '✓ Виконано', data: `tk:done:${t.id}` }] } });
  }
  // Overdue — once.
  const { rows: late } = await query(
    `UPDATE tasks SET overdue_notified_at = now(), due_notified_at = COALESCE(due_notified_at, now())
     WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at < now() AND overdue_notified_at IS NULL
     RETURNING *`);
  for (const t of late) {
    await queueNotif(t.assignee_id, 'task_overdue', { text: taskLine(t), pref: 'tasks', payload: { open: `task_${t.id}`, buttons: [{ text: '✓ Виконано', data: `tk:done:${t.id}` }] } });
  }
}
