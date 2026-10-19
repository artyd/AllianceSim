import express from 'express';
import { query } from './db.js';
import { requireMe } from './session.js';
import { queueNotif } from './notify.js';
import { isoWeek, ymdTz } from './kv.js';
import { pulseQuestion, onboardingTemplate } from './people.js';
import { snapshotDay } from './office.js';
import { buildXlsx, buildPdf, fileBase } from './export.js';

// Spec 008: HR analytics v2 — period/department filters with the previous period for Δ,
// presence (+ timesheet), mood, weekly pulse (anonymous groups only), engagement, people,
// «needs attention» signals and a per-person card. Everything is built from
// daily_snapshots + employees + pulse_answers + onboarding_done; the team is small
// (≤ a few hundred people × 90 days), so rows are aggregated in JS.
export const analytics = express.Router();

// ── who is HR ────────────────────────────────────────────────────────────────
// Web: the EDIT_TOKEN code. Telegram: a linked employee listed in HR_NAMES (comma list,
// every word of an entry must appear in the name, any order) or HR_TG_IDS.
const words = (s) => String(s || '').toLocaleLowerCase('uk').replace(/[’'ʼ`]/g, '').split(/[\s,]+/).filter(Boolean);
export function nameMatches(name, entry) {
  const have = new Set(words(name)), need = words(entry);
  return need.length > 0 && need.every((w) => have.has(w));
}
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const hrNames = () => list(process.env.HR_NAMES || process.env.REPORT_HR_NAME || process.env.COFFEE_HR_NAME);
const hrTgIds = () => list(process.env.HR_TG_IDS || process.env.REPORT_HR_TG || process.env.COFFEE_HR_TG).map((s) => s.replace(/[^0-9]/g, ''));
export const isHr = (me) => !!me && (hrTgIds().includes(String(me.tgId)) || hrNames().some((n) => nameMatches(me.name, n)));

export function requireHR(req, res, next) {
  const expected = process.env.EDIT_TOKEN, provided = req.get('X-Edit-Token');
  if (provided) {
    if (expected && provided === expected) { req.hr = { via: 'token' }; return next(); }
    return res.status(401).json({ error: 'invalid or missing edit token' });
  }
  requireMe(req, res, (err) => {
    if (err) return next(err);
    if (!isHr(req.me)) return res.status(403).json({ error: 'HR only' });
    req.hr = { via: 'telegram', me: req.me };
    next();
  });
}

// ── calendar helpers on 'YYYY-MM-DD' strings (office-local days) ─────────────
const toUtc = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (k, n) => fromUtc(toUtc(k) + n * 864e5);
export const dayDiff = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 864e5);
const weekday = (k) => new Date(toUtc(k)).getUTCDay(); // 0 = Sun
const isWorkday = (k) => { const w = weekday(k); return w >= 1 && w <= 5; };
const daysBetween = (from, to) => { const out = []; for (let k = from; k <= to; k = addDays(k, 1)) out.push(k); return out; };
const dayKey = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const isoWeekOf = (k) => isoWeek(new Date(toUtc(k) + 12 * 3600e3));
const isDay = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ''));

export const STATUSES = ['office', 'remote', 'absent', 'sick', 'vacation'];
const AWAY = new Set(['sick', 'vacation']); // not expected to check in
export const MOOD_SCORE = { great: 5, good: 4, ok: 3, tired: 2, stressed: 1 };
const LOW = new Set(['tired', 'stressed']);
const PULSE_MIN = () => Number(process.env.PULSE_MIN_GROUP || 3);
const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 100) / 100);
const avgOf = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const pct = (a, b) => (b ? r1((a / b) * 100) : null);
const deptOf = (e) => (e.department || '').trim() || '—';

// Period from the query: from/to (inclusive) or the last `days` days ending today.
export function parseRange(q = {}, today = ymdTz()) {
  let to = isDay(q.to) && q.to <= today ? q.to : today;
  let from = isDay(q.from) ? q.from : addDays(to, -(Math.min(366, Math.max(1, Number(q.days) || 30)) - 1));
  if (from > to) [from, to] = [to, from];
  if (dayDiff(from, to) > 365) from = addDays(to, -365);
  const len = dayDiff(from, to) + 1;
  return { from, to, len, prev: { from: addDays(from, -len), to: addDays(from, -1) } };
}

async function loadAll(from, to) {
  const { rows: emps } = await query(
    `SELECT id, name, department, position, telegram_id, hired_on, birthday, status, mood FROM employees ORDER BY name`);
  const { rows: snaps } = await query(
    `SELECT day, employee_id, status, mood, checked_in FROM daily_snapshots WHERE day BETWEEN $1::date AND $2::date ORDER BY day`, [from, to]);
  for (const s of snaps) s.day = dayKey(s.day);
  return { emps, snaps };
}

// ── attention signals (relative to today, whatever the period) ───────────────
// quiet: 5+ workdays without a check-in (sick/vacation days don't count);
// low: tired/stressed on the last 3 answers in a row (answers within 14 days);
// drop: last-7-day avg ≥ 1.0 below the person's previous-30-day avg (≥ 3 answers each).
export function attentionFor(e, snaps, today) {
  const mine = snaps.filter((s) => s.employee_id === e.id && s.day < today).sort((a, b) => (a.day < b.day ? 1 : -1));
  const reasons = [];
  if (e.telegram_id) {
    let missed = 0, last = null;
    for (const s of mine) {
      if (s.checked_in) { last = s.day; break; }
      if (isWorkday(s.day) && !AWAY.has(s.status)) missed++;
    }
    if (missed >= 5) reasons.push({ code: 'quiet', days: missed, last });
  }
  const answers = mine.filter((s) => s.checked_in && MOOD_SCORE[s.mood]);
  const recent = answers.filter((s) => dayDiff(s.day, today) <= 14).slice(0, 3);
  if (recent.length === 3 && recent.every((s) => LOW.has(s.mood))) reasons.push({ code: 'low', streak: 3 });
  const wk = answers.filter((s) => dayDiff(s.day, today) <= 7).map((s) => MOOD_SCORE[s.mood]);
  const base = answers.filter((s) => dayDiff(s.day, today) > 7 && dayDiff(s.day, today) <= 37).map((s) => MOOD_SCORE[s.mood]);
  if (wk.length >= 3 && base.length >= 3 && avgOf(base) - avgOf(wk) >= 1) reasons.push({ code: 'drop', now: r1(avgOf(wk)), base: r1(avgOf(base)) });
  return reasons;
}

// ── one period's aggregates for a set of people ─────────────────────────────
function periodStats(people, snaps, from, to) {
  const ids = new Set(people.map((e) => e.id)), linked = new Set(people.filter((e) => e.telegram_id).map((e) => e.id));
  const rows = snaps.filter((s) => ids.has(s.employee_id) && s.day >= from && s.day <= to);
  const moods = rows.filter((s) => s.checked_in && MOOD_SCORE[s.mood]).map((s) => MOOD_SCORE[s.mood]);
  const expected = rows.filter((s) => linked.has(s.employee_id) && isWorkday(s.day) && !AWAY.has(s.status));
  const work = rows.filter((s) => isWorkday(s.day));
  const remote = work.filter((s) => s.status === 'remote').length, office = work.filter((s) => (s.status || 'office') === 'office').length;
  return {
    rows, mood: r2(avgOf(moods)), moodN: moods.length,
    checkin: pct(expected.filter((s) => s.checked_in).length, expected.length),
    remoteShare: pct(remote, remote + office),
  };
}

async function pulseWeeks(people, from, to, deptFilter) {
  const weeks = [...new Set(daysBetween(from, to).map(isoWeekOf))];
  const { rows } = await query(
    `SELECT week, COALESCE(dept, '—') AS dept, score FROM pulse_answers WHERE week = ANY($1::text[])`, [weeks]);
  const min = PULSE_MIN(), linked = people.filter((e) => e.telegram_id).length;
  const out = [];
  for (const w of weeks) {
    const xs = rows.filter((r) => r.week === w && (!deptFilter || r.dept === deptFilter));
    out.push({ week: w, question: await pulseQuestion(w), n: xs.length, rate: pct(xs.length, linked),
      avg: xs.length >= min ? r2(avgOf(xs.map((r) => r.score))) : null });
  }
  return { minGroup: min, weeks: out };
}

export async function buildAnalytics(q = {}) {
  await snapshotDay(); // make sure today is in
  const today = ymdTz();
  const range = parseRange(q, today);
  // previous period for Δ, and 40 days back from today for the attention rules
  const loadFrom = range.prev.from < addDays(today, -40) ? range.prev.from : addDays(today, -40);
  const { emps, snaps } = await loadAll(loadFrom, today);
  const dept = q.dept && q.dept !== 'all' ? String(q.dept) : null;
  const depts = [...new Set(emps.map(deptOf))].sort((a, b) => a.localeCompare(b, 'uk'));
  const people = dept ? emps.filter((e) => deptOf(e) === dept) : emps;
  const cur = periodStats(people, snaps, range.from, range.to), prev = periodStats(people, snaps, range.prev.from, range.prev.to);
  const days = daysBetween(range.from, range.to);
  const byPerson = new Map(people.map((e) => [e.id, e]));

  // presence
  const daily = days.map((d) => {
    const o = { day: d, work: isWorkday(d) }; for (const s of STATUSES) o[s] = 0;
    for (const s of cur.rows) if (s.day === d) o[STATUSES.includes(s.status) ? s.status : 'office']++;
    return o;
  });
  const weekdayLoad = [1, 2, 3, 4, 5].map((w) => {
    const ds = daily.filter((d) => weekday(d.day) === w && d.office + d.remote + d.absent + d.sick + d.vacation > 0);
    return { wd: w, office: r1(avgOf(ds.map((d) => d.office))), remote: r1(avgOf(ds.map((d) => d.remote))), days: ds.length };
  });
  const groups = new Map();
  for (const e of people) { const k = deptOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const byDept = [...groups].map(([name, ps]) => {
    const c = periodStats(ps, snaps, range.from, range.to), p = periodStats(ps, snaps, range.prev.from, range.prev.to);
    const st = {}; for (const s of STATUSES) st[s] = c.rows.filter((r) => isWorkday(r.day) && (STATUSES.includes(r.status) ? r.status : 'office') === s).length;
    return { dept: name, people: ps.length, linked: ps.filter((e) => e.telegram_id).length, ...st,
      remoteShare: c.remoteShare, mood: c.mood, moodN: c.moodN, moodPrev: p.mood, checkin: c.checkin, checkinPrev: p.checkin };
  }).sort((a, b) => a.dept.localeCompare(b.dept, 'uk'));
  const sheet = people.map((e) => {
    const mine = new Map(cur.rows.filter((s) => s.employee_id === e.id).map((s) => [s.day, s]));
    const cells = days.map((d) => { const s = mine.get(d); return s ? (STATUSES.includes(s.status) ? s.status : 'office') : null; });
    const totals = {}; for (const s of STATUSES) totals[s] = cells.filter((c, i) => c === s && isWorkday(days[i])).length;
    return { id: e.id, name: e.name, dept: deptOf(e), cells, totals };
  });

  // mood
  const answered = cur.rows.filter((s) => s.checked_in && MOOD_SCORE[s.mood]);
  const moodDaily = days.map((d) => { const xs = answered.filter((s) => s.day === d).map((s) => MOOD_SCORE[s.mood]); return { day: d, avg: r2(avgOf(xs)), n: xs.length }; });
  const dist = {}; for (const k of Object.keys(MOOD_SCORE)) dist[k] = answered.filter((s) => s.mood === k).length;

  // engagement: check-in rate per day (linked people expected at work)
  const linked = new Set(people.filter((e) => e.telegram_id).map((e) => e.id));
  const checkinDaily = days.filter(isWorkday).map((d) => {
    const exp = cur.rows.filter((s) => s.day === d && linked.has(s.employee_id) && !AWAY.has(s.status));
    return { day: d, of: exp.length, n: exp.filter((s) => s.checked_in).length, rate: pct(exp.filter((s) => s.checked_in).length, exp.length) };
  });

  // people
  const tpl = await onboardingTemplate();
  const { rows: done } = await query('SELECT employee_id, item_id FROM onboarding_done');
  const tplIds = new Set(tpl.map((i) => i.id));
  const newcomers = people.filter((e) => e.hired_on && dayDiff(dayKey(e.hired_on), today) >= 0 && dayDiff(dayKey(e.hired_on), today) < 60).map((e) => ({
    id: e.id, name: e.name, dept: deptOf(e), hiredOn: dayKey(e.hired_on), day: dayDiff(dayKey(e.hired_on), today) + 1,
    done: done.filter((d) => d.employee_id === e.id && tplIds.has(d.item_id)).length, total: tpl.length,
  })).sort((a, b) => a.day - b.day);
  const TENURE = [['до 3 міс', 0, 91], ['3–12 міс', 91, 365], ['1–3 роки', 365, 1096], ['3+ роки', 1096, Infinity]];
  const tenure = TENURE.map(([label, a, b]) => ({ label, n: people.filter((e) => e.hired_on && dayDiff(dayKey(e.hired_on), today) >= a && dayDiff(dayKey(e.hired_on), today) < b).length }));
  tenure.push({ label: 'не вказано', n: people.filter((e) => !e.hired_on).length });
  const upcoming = [];
  for (const e of people) {
    const next = (md) => { let k = `${today.slice(0, 4)}-${md}`; if (!isDay(k)) return null; if (k < today) k = `${Number(today.slice(0, 4)) + 1}-${md}`; return k; };
    if (/^\d\d-\d\d$/.test(e.birthday || '')) { const k = next(e.birthday); if (k && dayDiff(today, k) <= 30) upcoming.push({ id: e.id, name: e.name, dept: deptOf(e), kind: 'birthday', date: k, inDays: dayDiff(today, k) }); }
    if (e.hired_on) {
      const h = dayKey(e.hired_on), k = next(h.slice(5));
      const years = k ? Number(k.slice(0, 4)) - Number(h.slice(0, 4)) : 0;
      if (k && years > 0 && dayDiff(today, k) <= 30) upcoming.push({ id: e.id, name: e.name, dept: deptOf(e), kind: 'anniversary', date: k, years, inDays: dayDiff(today, k) });
    }
  }
  upcoming.sort((a, b) => a.inDays - b.inDays);

  // attention + today's tiles
  const attention = people.map((e) => ({ id: e.id, name: e.name, dept: deptOf(e), reasons: attentionFor(e, snaps, today) })).filter((a) => a.reasons.length);
  const todayMix = {}; for (const s of STATUSES) todayMix[s] = people.filter((e) => (STATUSES.includes(e.status) ? e.status : 'office') === s).length;
  const pulse = await pulseWeeks(people, range.from, range.to, dept);
  const prevPulse = await pulseWeeks(people, range.prev.from, range.prev.to, dept);
  const pulseAvg = (p) => { const xs = p.weeks.filter((w) => w.avg != null); return xs.length ? r2(avgOf(xs.map((w) => w.avg))) : null; };

  return {
    today, range: { from: range.from, to: range.to, days: range.len, workdays: days.filter(isWorkday).length }, prev: range.prev,
    dept, depts,
    kpi: {
      headcount: people.length, linked: linked.size, today: todayMix,
      mood: { v: cur.mood, prev: prev.mood, n: cur.moodN },
      checkin: { v: cur.checkin, prev: prev.checkin },
      remoteShare: { v: cur.remoteShare, prev: prev.remoteShare },
      pulse: { v: pulseAvg(pulse), prev: pulseAvg(prevPulse) },
      attention: attention.length,
    },
    attention,
    presence: { daily, weekday: weekdayLoad, byDept, sheet: { days, people: sheet } },
    mood: { daily: moodDaily, dist, byDept: byDept.map((d) => ({ dept: d.dept, avg: d.mood, n: d.moodN, prev: d.moodPrev })) },
    pulse,
    engagement: { daily: checkinDaily, byDept: byDept.map((d) => ({ dept: d.dept, rate: d.checkin, prev: d.checkinPrev, linked: d.linked })), pulse: pulse.weeks.map((w) => ({ week: w.week, n: w.n, rate: w.rate })) },
    people: { byDept: byDept.map((d) => ({ dept: d.dept, n: d.people, linked: d.linked })), newcomers, tenure, upcoming },
  };
}

export async function buildPerson(id, q = {}) {
  await snapshotDay();
  const today = ymdTz();
  const range = parseRange(q, today);
  const { rows: [e] } = await query(
    `SELECT id, name, department, position, telegram_id, hired_on, birthday, status, mood FROM employees WHERE id = $1`, [id]);
  if (!e) return null;
  const from = range.from < addDays(today, -40) ? range.from : addDays(today, -40);
  const { rows: snaps } = await query(
    `SELECT day, employee_id, status, mood, checked_in FROM daily_snapshots WHERE employee_id = $1 AND day BETWEEN $2::date AND $3::date ORDER BY day`, [id, from, today]);
  for (const s of snaps) s.day = dayKey(s.day);
  const days = daysBetween(range.from, range.to), mine = new Map(snaps.map((s) => [s.day, s]));
  const timeline = days.map((d) => { const s = mine.get(d); return { day: d, work: isWorkday(d), status: s ? (STATUSES.includes(s.status) ? s.status : 'office') : null, mood: s && s.checked_in ? s.mood || null : null, checkedIn: !!(s && s.checked_in) }; });
  const totals = {}; for (const s of STATUSES) totals[s] = timeline.filter((t) => t.work && t.status === s).length;
  const exp = timeline.filter((t) => t.work && t.status && !AWAY.has(t.status));
  const moods = timeline.filter((t) => MOOD_SCORE[t.mood]).map((t) => MOOD_SCORE[t.mood]);
  let onboarding = null;
  if (e.hired_on && dayDiff(dayKey(e.hired_on), today) < 60) {
    const tpl = await onboardingTemplate();
    const { rows: done } = await query('SELECT item_id FROM onboarding_done WHERE employee_id = $1', [id]);
    const ds = new Set(done.map((d) => d.item_id));
    onboarding = { day: dayDiff(dayKey(e.hired_on), today) + 1, items: tpl.map((i) => ({ ...i, done: ds.has(i.id) })) };
  }
  return {
    id: e.id, name: e.name, dept: deptOf(e), position: e.position || null, linked: !!e.telegram_id,
    hiredOn: e.hired_on ? dayKey(e.hired_on) : null, birthday: e.birthday || null, status: e.status || 'office', mood: e.mood || null,
    range: { from: range.from, to: range.to }, timeline, totals,
    checkin: e.telegram_id ? pct(exp.filter((t) => t.checkedIn).length, exp.length) : null,
    moodAvg: r2(avgOf(moods)), moodN: moods.length,
    attention: attentionFor(e, snaps, today), onboarding,
  };
}

// ── routes ───────────────────────────────────────────────────────────────────
analytics.get(['/analytics/v2', '/me/hr/analytics'], requireHR, async (req, res, next) => {
  try { res.json(await buildAnalytics(req.query)); } catch (err) { next(err); }
});
analytics.get(['/analytics/person/:id', '/me/hr/person/:id'], requireHR, async (req, res, next) => {
  try { const p = await buildPerson(req.params.id, req.query); if (!p) return res.status(404).json({ error: 'not found' }); res.json(p); } catch (err) { next(err); }
});
// Downloads (web) and the bot's reports: same filters as /analytics/v2.
const sendFile = (res, buf, name, type) => {
  res.set({ 'Content-Type': type, 'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="${name.replace(/[^ -~]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
  res.end(buf);
};
analytics.get('/analytics/export.xlsx', requireHR, async (req, res, next) => {
  try { const a = await buildAnalytics(req.query); sendFile(res, await buildXlsx(a), fileBase(a) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } catch (err) { next(err); }
});
analytics.get('/analytics/export.pdf', requireHR, async (req, res, next) => {
  try { const a = await buildAnalytics(req.query); sendFile(res, await buildPdf(a), fileBase(a) + '.pdf', 'application/pdf'); } catch (err) { next(err); }
});
// Bot: who gets the weekly/monthly reports (linked employees matching HR_NAMES / HR_TG_IDS).
analytics.get('/analytics/hr-recipients', requireHR, async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT id, name, telegram_id FROM employees WHERE telegram_id IS NOT NULL ORDER BY name');
    res.json(rows.filter((r) => isHr({ name: r.name, tgId: String(r.telegram_id) })).map((r) => ({ id: r.id, name: r.name, telegram_id: String(r.telegram_id) })));
  } catch (err) { next(err); }
});
// Phone: show the «Аналітика» app only to HR (requireMe is mounted on /me).
analytics.get('/me/hr', (req, res) => res.json({ hr: isHr(req.me) }));
// Mini App export: the bot builds the files and sends them to the caller's chat.
analytics.post('/me/hr/export', requireHR, async (req, res, next) => {
  try {
    const b = req.body || {}, range = parseRange(b);
    const dept = b.dept && b.dept !== 'all' ? String(b.dept).slice(0, 80) : null;
    await queueNotif(req.me.id, 'hr_export', { text: `${range.from} — ${range.to}`, payload: { from: range.from, to: range.to, dept } });
    res.json({ ok: true, from: range.from, to: range.to });
  } catch (err) { next(err); }
});
