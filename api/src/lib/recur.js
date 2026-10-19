// Repeating events (spec 005): expand a series into occurrences inside [from, to).
// Steps are taken in the office's wall-clock time (TZ), so "every weekday 09:30" stays at
// 09:30 across DST changes.
export const TZ = process.env.CHECKIN_TZ || 'Europe/Kyiv';
export const FREQS = new Set(['daily', 'weekdays', 'weekly', 'monthly']);
const MAX_OCC = 500;

// Wall-clock parts of an instant in a time zone.
const fmts = new Map();
export function parts(date, tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  }));
  const p = Object.fromEntries(fmts.get(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: p.weekday };
}
// Instant for a wall-clock time in a time zone (two-pass offset fix-up handles DST).
export function fromWall(y, m, d, h, mi, s, tz) {
  let t = Date.UTC(y, m - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t), tz);
    t += Date.UTC(y, m - 1, d, h, mi, s) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  }
  return new Date(t);
}

// occurrences(series) → [{start: Date, end: Date|null}] with start in [from, to).
export function occurrences(ev, from, to, tz) {
  const start = new Date(ev.starts_at), end = ev.ends_at ? new Date(ev.ends_at) : null;
  const dur = end ? end - start : null;
  if (!ev.repeat_freq || !FREQS.has(ev.repeat_freq)) {
    const e = end || start;
    return start < to && e >= from ? [{ start, end }] : [];
  }
  const until = ev.repeat_until ? new Date(ev.repeat_until) : null;
  const base = parts(start, tz), out = [];
  // Skip straight to just before the window (old daily series would otherwise walk years).
  const DAY = 864e5, gap = from - start;
  const i0 = gap <= 0 ? 0 : ev.repeat_freq === 'monthly' ? Math.max(0, Math.floor(gap / (31 * DAY)) - 1)
    : ev.repeat_freq === 'weekly' ? Math.max(0, Math.floor(gap / (7 * DAY)) - 1) : Math.max(0, Math.floor(gap / DAY) - 2);
  for (let i = i0, n = 0; n < MAX_OCC && i < i0 + 100000; i++) {
    let y = base.y, m = base.m, d = base.d;
    if (ev.repeat_freq === 'monthly') { m += i; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1; }
    else { const step = ev.repeat_freq === 'weekly' ? 7 * i : i; const t = new Date(Date.UTC(y, m - 1, d + step)); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
    if (ev.repeat_freq === 'monthly' && new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) continue; // no 31st in this month
    if (ev.repeat_freq === 'weekdays') { const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (wd === 0 || wd === 6) continue; }
    const s = fromWall(y, m, d, base.h, base.mi, base.s, tz);
    if (s >= to) break;
    if (until && s > new Date(until.getTime() + 864e5 - 1)) break; // until is a day (inclusive)
    const e = dur != null ? new Date(s.getTime() + dur) : null;
    if ((e || s) >= from) { out.push({ start: s, end: e }); n++; }
  }
  return out;
}

// Next occurrence starting at or after `after` (for reminders / "busy now").
export function nextOccurrence(ev, after, tz, horizonMs = 400 * 864e5) {
  return occurrences(ev, after, new Date(after.getTime() + horizonMs), tz).find((o) => o.start >= after) || null;
}

// [start, end) of "today" in the time zone.
export function todayWindow(tz, now = new Date()) {
  const p = parts(now, tz);
  const start = fromWall(p.y, p.m, p.d, 0, 0, 0, tz);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return { start, end: fromWall(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 0, 0, 0, tz) };
}
