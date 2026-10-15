import express from 'express';
import { query } from './db.js';
import { occurrences, TZ } from './recur.js';

// "Live office" data derived from calendars (spec 005): who is in a meeting right now and
// which rooms are booked. The public view gets only times and room keys — never titles.
export const office = express.Router();

const DEFAULT_MIN = 60; // an event without an end counts as one hour
const ROOM_RE = /^(r\d{1,3}|rz:[\w-]{1,40})$/;

// Occurrences (with an end) of events overlapping [from, to); extra columns via `cols`.
async function slots(from, to, where = 'TRUE', params = []) {
  const { rows } = await query(
    `SELECT e.* FROM events e
     WHERE e.cancelled_at IS NULL AND NOT e.all_day AND ${where}
       AND e.starts_at < $1 AND (COALESCE(e.ends_at, e.starts_at + interval '${DEFAULT_MIN} minutes') >= $2
         OR (e.repeat_freq IS NOT NULL AND (e.repeat_until IS NULL OR e.repeat_until >= $2::timestamptz - interval '1 day')))`,
    [to.toISOString(), new Date(from - DEFAULT_MIN * 60e3).toISOString(), ...params]);
  const out = [];
  for (const e of rows) {
    const series = { ...e, ends_at: e.ends_at || new Date(new Date(e.starts_at).getTime() + DEFAULT_MIN * 60e3) };
    for (const o of occurrences(series, from, to, TZ)) if (o.end > from) out.push({ ev: e, start: o.start, end: o.end });
  }
  return out;
}

let cache = null, cacheAt = 0;
export const invalidateOffice = () => { cache = null; };
export async function officeNow(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30e3) return cache;
  const now = new Date(), soon = new Date(now.getTime() + 1);
  const cur = await slots(now, soon);
  const ids = cur.map((s) => s.ev.id);
  const { rows: att } = ids.length
    ? await query(`SELECT event_id, employee_id FROM event_attendees WHERE status = 'accepted' AND event_id = ANY($1::bigint[])`, [ids])
    : { rows: [] };
  const rooms = {}, busy = {};
  for (const s of cur) {
    if (s.ev.room) rooms[s.ev.room] = { until: s.end > (rooms[s.ev.room]?.until || 0) ? s.end : rooms[s.ev.room].until };
    for (const a of att.filter((x) => String(x.event_id) === String(s.ev.id))) {
      const b = busy[a.employee_id];
      if (!b || s.end > b.until) busy[a.employee_id] = { until: s.end, room: s.ev.room || null };
    }
  }
  cache = { at: now, rooms, busy };
  cacheAt = Date.now();
  return cache;
}

// Public: rooms booked now + people in a meeting now (until, room key).
office.get('/office/now', async (_req, res, next) => {
  try { res.json(await officeNow(_req.query.fresh === '1')); } catch (err) { next(err); }
});

// Mini App: bookings of plan rooms in [from, to) — for the room picker / conflict warning.
office.get('/me/rooms', async (req, res, next) => {
  try {
    const from = new Date(String(req.query.from || '')), to = new Date(String(req.query.to || ''));
    if (Number.isNaN(+from) || Number.isNaN(+to) || to - from > 40 * 864e5) return res.status(400).json({ error: 'bad range' });
    const list = await slots(from, to, 'e.room IS NOT NULL');
    const { rows: names } = list.length
      ? await query('SELECT id, name FROM employees WHERE id = ANY($1::text[])', [[...new Set(list.map((s) => s.ev.organizer_id))]])
      : { rows: [] };
    const nm = new Map(names.map((r) => [r.id, r.name]));
    res.json(list.map((s) => ({ room: s.ev.room, eventId: String(s.ev.id), start: s.start, end: s.end, organizer: nm.get(s.ev.organizer_id) || null }))
      .sort((a, b) => a.start - b.start));
  } catch (err) { next(err); }
});

export const validRoom = (r) => ROOM_RE.test(String(r || ''));
