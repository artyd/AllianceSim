import express from 'express';
import { query } from './db.js';
import { occurrences, parts, TZ } from './recur.js';
import { systemPost } from './chats.js';
import { queueNotif } from './notify.js';

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
  // Hot desks booked for today, birthdays / work anniversaries today (office time zone).
  const today = localDay(now);
  const { rows: desks } = await query('SELECT employee_id, furniture_uid, seat_i FROM desk_bookings WHERE day = $1', [today]);
  const md = today.slice(5);
  const { rows: bd } = await query('SELECT id FROM employees WHERE birthday = $1', [md]);
  const { rows: an } = await query(
    `SELECT id, extract(year FROM $1::date)::int - extract(year FROM hired_on)::int AS years FROM employees
     WHERE hired_on IS NOT NULL AND to_char(hired_on, 'MM-DD') = $2 AND hired_on < $1::date`, [today, md]);
  cache = {
    at: now, rooms, busy,
    desks: Object.fromEntries(desks.map((d) => [d.employee_id, { f: d.furniture_uid, i: d.seat_i }])),
    birthdays: bd.map((r) => r.id),
    anniversaries: an.map((r) => ({ id: r.id, years: r.years })),
  };
  cacheAt = Date.now();
  return cache;
}
// 'YYYY-MM-DD' of an instant in the office time zone.
export function localDay(d = new Date()) {
  const p = parts(d, TZ);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
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

// ── hot desks (spec 005 D): "my place for today" ─────────────────────────────
const DESK_SEATS = { desk: 1, doubleDesk: 2 };
async function layoutFurniture() {
  const { rows: [l] } = await query('SELECT data FROM office_layout WHERE id = 1');
  return (l && l.data && Array.isArray(l.data.furniture)) ? l.data.furniture : [];
}
// Bookable desks with who holds them today: permanent seat (employees.desk_id) or a booking.
office.get('/me/desks', async (req, res, next) => {
  try {
    const day = localDay();
    const furn = (await layoutFurniture()).filter((f) => DESK_SEATS[f.type]);
    const { rows: perm } = await query('SELECT id, name, desk_id, seat_i FROM employees WHERE desk_id IS NOT NULL');
    const { rows: book } = await query(
      'SELECT b.furniture_uid, b.seat_i, b.employee_id, e.name FROM desk_bookings b JOIN employees e ON e.id = b.employee_id WHERE b.day = $1', [day]);
    const out = [];
    for (const f of furn) for (let i = 0; i < DESK_SEATS[f.type]; i++) {
      const p = perm.find((x) => x.desk_id === f.uid && Number(x.seat_i ?? 0) === i);
      const b = book.find((x) => x.furniture_uid === f.uid && x.seat_i === i);
      out.push({ f: f.uid, i, x: f.x, z: f.z, owner: p ? { id: p.id, name: p.name, permanent: true } : b ? { id: b.employee_id, name: b.name } : null });
    }
    const mine = book.find((x) => x.employee_id === req.me.id);
    res.json({ day, desks: out, mine: mine ? { f: mine.furniture_uid, i: mine.seat_i } : null });
  } catch (err) { next(err); }
});
office.post('/me/desk', async (req, res, next) => {
  try {
    const f = String((req.body || {}).f || ''), i = Number((req.body || {}).i || 0);
    const desk = (await layoutFurniture()).find((x) => x.uid === f && DESK_SEATS[x.type]);
    if (!desk || !Number.isInteger(i) || i < 0 || i >= DESK_SEATS[desk.type]) return res.status(400).json({ error: 'not a bookable desk' });
    const { rows: [me] } = await query('SELECT desk_id FROM employees WHERE id = $1', [req.me.id]);
    if (me && me.desk_id) return res.status(409).json({ error: 'you already have a permanent seat' });
    const { rows: [perm] } = await query('SELECT id FROM employees WHERE desk_id = $1 AND COALESCE(seat_i, 0) = $2', [f, i]);
    if (perm) return res.status(409).json({ error: 'desk is someone\'s permanent seat' });
    const day = localDay();
    await query('DELETE FROM desk_bookings WHERE day = $1 AND employee_id = $2', [day, req.me.id]); // one desk per day
    const r = await query(
      'INSERT INTO desk_bookings (day, furniture_uid, seat_i, employee_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING furniture_uid', [day, f, i, req.me.id]);
    if (!r.rowCount) return res.status(409).json({ error: 'desk already taken today' });
    invalidateOffice();
    res.status(201).json({ ok: true, day, f, i });
  } catch (err) { next(err); }
});
office.delete('/me/desk', async (req, res, next) => {
  try {
    await query('DELETE FROM desk_bookings WHERE day = $1 AND employee_id = $2', [localDay(), req.me.id]);
    invalidateOffice();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── daily jobs: birthday / anniversary posts, HR snapshots ───────────────────
const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 9);
async function once(day, kind, empId) {
  const r = await query('INSERT INTO system_posts (day, kind, employee_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [day, kind, empId]);
  return r.rowCount > 0;
}
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
export async function runDailyPosts(now = new Date()) {
  if (parts(now, TZ).h < CHECKIN_HOUR) return;
  const day = localDay(now), md = day.slice(5);
  const { rows: bd } = await query('SELECT id, name FROM employees WHERE birthday = $1 AND telegram_id IS NOT NULL', [md]);
  for (const e of bd) {
    if (!(await once(day, 'birthday', e.id))) continue;
    await systemPost('office', `🎂 Сьогодні день народження у ${e.name}! Привітаймо 🎉`);
    await queueNotif(e.id, 'birthday', { text: e.name.split(' ')[0] });
  }
  const { rows: an } = await query(
    `SELECT id, name, extract(year FROM $1::date)::int - extract(year FROM hired_on)::int AS years FROM employees
     WHERE telegram_id IS NOT NULL AND hired_on IS NOT NULL AND to_char(hired_on, 'MM-DD') = $2 AND hired_on < $1::date`, [day, md]);
  for (const e of an) {
    if (!(await once(day, 'anniversary', e.id))) continue;
    await systemPost('office', `🏅 ${e.name} з нами вже ${e.years} ${plural(e.years, 'рік', 'роки', 'років')}! Дякуємо 💛`);
  }
}
// Today's status/mood per person (upserted all day → the last value wins) for HR analytics.
export async function snapshotDay(now = new Date()) {
  const day = localDay(now);
  await query(
    `INSERT INTO daily_snapshots (day, employee_id, department, status, mood, checked_in)
     SELECT $1::date, id, department, status, mood, (updated_at AT TIME ZONE $2)::date = $1::date FROM employees
     ON CONFLICT (day, employee_id) DO UPDATE SET department = EXCLUDED.department, status = EXCLUDED.status,
       mood = EXCLUDED.mood, checked_in = daily_snapshots.checked_in OR EXCLUDED.checked_in`, [day, TZ]);
}
