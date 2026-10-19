// Spec 008: HR analytics v2 — HR auth (token / HR_NAMES Telegram user), filters + previous
// period, presence/timesheet, mood, anonymous pulse, attention rules, person card, export queue.
import path from 'path';
import { createRequire } from 'module';
import { start, stop, call, seed, ok, eq, report, REPO, PG_URL, BASE, HR } from '../harness.mjs';

await start({ HR_NAMES: 'Коваль Анна, Свистельник', PULSE_MIN_GROUP: '3' });
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001, extra: { status: 'office', mood: 'great' } },
    { id: 's', name: 'Свистельник Артем', dept: 'IT', tg: 1005, extra: { status: 'office', mood: 'good' } },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002, extra: { status: 'remote', mood: 'tired' } },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003, extra: { status: 'office' } },
    { id: 'd', name: 'Дмитро Гай', dept: 'Sales', tg: 1004, extra: { status: 'office', mood: 'ok' } },
    { id: 'v', name: 'Олег Відпустка', dept: 'Sales', tg: 1006, extra: { status: 'vacation' } },
    { id: 'n', name: 'Ніхто Неприв', dept: 'Sales' },
  ]);

  // ── auth ──
  eq((await call('GET', '/analytics/v2')).status, 401, 'no credentials → 401');
  eq((await call('GET', '/analytics/v2', { as: 1002 })).status, 403, 'non-HR Telegram user → 403');
  eq((await call('GET', '/analytics/v2', { as: 1001 })).status, 200, 'HR_NAMES (surname-first entry) → Анна');
  eq((await call('GET', '/me/hr/analytics', { as: 1005 })).status, 200, 'HR_NAMES single surname → Свистельник');
  eq((await call('GET', '/me/hr', { as: 1001 })).data, { hr: true }, '/me/hr true for HR');
  eq((await call('GET', '/me/hr', { as: 1002 })).data, { hr: false }, '/me/hr false otherwise');
  const today = (await call('GET', '/analytics/v2', { hr: true })).data.today;

  // ── 40 past days of history ──
  const add = (k, n) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);
  const wd = (k) => new Date(k + 'T12:00:00Z').getUTCDay();
  const work = (k) => wd(k) >= 1 && wd(k) <= 5;
  const pg = createRequire(path.join(REPO, 'api', 'package.json'))('pg');
  const db = new pg.Client({ connectionString: PG_URL }); await db.connect();
  const ins = (day, id, dept, status, mood, ci) => db.query(
    `INSERT INTO daily_snapshots (day, employee_id, department, status, mood, checked_in) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (day, employee_id) DO UPDATE SET status=EXCLUDED.status, mood=EXCLUDED.mood, checked_in=EXCLUDED.checked_in`, [day, id, dept, status, mood, ci]);
  // Bohdan's last three answer days (workdays) are tired/stressed; before that good.
  const past = []; for (let i = 1; i <= 40; i++) past.push(add(today, -i));
  const bLow = past.filter(work).slice(0, 3);
  for (const [i, day] of past.entries()) {
    const n = i + 1;
    await ins(day, 'a', 'HR', 'office', 'great', true);
    await ins(day, 's', 'IT', 'office', 'good', true);
    await ins(day, 'b', 'IT', 'remote', bLow.includes(day) ? (n % 2 ? 'tired' : 'stressed') : 'good', work(day));
    await ins(day, 'c', 'IT', 'office', null, false);                       // never answers
    await ins(day, 'd', 'Sales', 'office', n <= 7 ? 'ok' : 'great', true);  // 5 → 3 this week
    await ins(day, 'v', 'Sales', 'vacation', null, false);                   // away: not "quiet"
    await ins(day, 'n', 'Sales', 'office', null, false);                     // not linked
  }
  await db.end();

  // ── overview, filters, previous period ──
  let a = (await call('GET', '/analytics/v2?days=30', { hr: true })).data;
  eq([a.range.days, a.range.to, a.prev.to], [30, today, add(today, -30)], 'range + previous period');
  eq(a.depts, ['HR', 'IT', 'Sales'], 'department list');
  eq([a.kpi.headcount, a.kpi.linked], [7, 6], 'headcount / linked');
  eq(a.kpi.today, { office: 5, remote: 1, absent: 0, sick: 0, vacation: 1 }, 'today status mix');
  const att = Object.fromEntries(a.attention.map((x) => [x.id, x.reasons.map((r) => r.code).sort()]));
  eq(att.c, ['quiet'], 'Віра: 5+ workdays without a check-in');
  ok(att.b && att.b.includes('low'), 'Богдан: 3 low answers in a row');
  eq(att.d, ['drop'], 'Дмитро: mood dropped 5 → 3');
  ok(!att.v && !att.a && !att.n && !att.s, 'vacation / steady / unlinked people are not flagged');
  ok(a.attention.find((x) => x.id === 'c').reasons[0].days >= 5, 'quiet carries a workday count');

  // mood avg over the window = average of answered (checked-in) moods
  const S = { great: 5, good: 4, ok: 3, tired: 2, stressed: 1 };
  const win = past.slice(0, 29); // today has only live snapshots (no answers yet in fixtures)
  const xs = [S.great, S.good, S.tired, S.ok]; // today: the api's own snapshot (seeded today = checked in)
  for (const [i, day] of past.entries()) {
    if (!win.includes(day)) continue;
    xs.push(S.great, S.good, S[i + 1 <= 7 ? 'ok' : 'great']);
    if (work(day)) xs.push(S[bLow.includes(day) ? ((i + 1) % 2 ? 'tired' : 'stressed') : 'good']);
  }
  const exp = Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
  ok(Math.abs(a.kpi.mood.v - exp) < 0.02, `team mood avg ${a.kpi.mood.v} ≈ ${exp}`);
  ok(a.kpi.mood.prev != null, 'previous-period mood for Δ');
  ok(a.kpi.checkin.v > 0 && a.kpi.checkin.v < 100, 'check-in rate between 0 and 100');

  // presence
  eq(a.presence.sheet.days.length, 30, 'timesheet columns = days');
  const vrow = a.presence.sheet.people.find((p) => p.id === 'v');
  eq(vrow.totals.vacation, a.presence.sheet.days.filter(work).length, 'vacation totals = workdays');
  const d0 = a.presence.daily[0];
  eq(d0.office + d0.remote + d0.vacation + d0.absent + d0.sick, 7, 'daily stacked counts everyone');
  eq(a.presence.weekday.length, 5, 'office load Mon–Fri');
  const it = a.presence.byDept.find((x) => x.dept === 'IT');
  eq(it.remoteShare, 33.3, 'IT remote share (1 of 3 at work)');

  // department filter
  a = (await call('GET', '/analytics/v2?days=30&dept=Sales', { hr: true })).data;
  eq([a.dept, a.kpi.headcount, a.presence.sheet.people.length], ['Sales', 3, 3], 'dept filter narrows people');
  eq(a.attention.map((x) => x.id), ['d'], 'dept filter narrows attention');

  // custom range
  a = (await call('GET', `/analytics/v2?from=${add(today, -9)}&to=${add(today, -3)}`, { hr: true })).data;
  eq([a.range.from, a.range.to, a.range.days, a.prev.from], [add(today, -9), add(today, -3), 7, add(today, -16)], 'custom from/to');

  // ── pulse stays anonymous below the group minimum ──
  const db2 = new pg.Client({ connectionString: PG_URL }); await db2.connect();
  const wk = (await call('GET', '/me/pulse', { as: 1001 })).data.week;
  await db2.query(`INSERT INTO pulse_answers (week, employee_id, dept, score) VALUES ($1,'s','IT',5),($1,'b','IT',3),($1,'a','HR',4)`, [wk]);
  await db2.end();
  a = (await call('GET', '/analytics/v2?days=7', { hr: true })).data;
  const pw = a.pulse.weeks.find((w) => w.week === wk);
  eq([pw.n, pw.avg], [3, 4], 'pulse avg shown for a group of 3');
  a = (await call('GET', '/analytics/v2?days=7&dept=IT', { hr: true })).data;
  const pi = a.pulse.weeks.find((w) => w.week === wk);
  eq([pi.n, pi.avg], [2, null], 'IT group of 2 → average hidden');
  ok(!JSON.stringify(a.pulse).includes('"employee'), 'no per-person pulse data');

  // ── person card ──
  eq((await call('GET', '/analytics/person/zzz', { hr: true })).status, 404, 'unknown person');
  eq((await call('GET', '/analytics/person/b', { as: 1002 })).status, 403, 'person card is HR only');
  const p = (await call('GET', '/analytics/person/b?days=14', { hr: true })).data;
  eq(p.timeline.length, 14, 'timeline = period days');
  ok(p.timeline.some((t) => t.mood === 'tired' || t.mood === 'stressed'), 'personal mood by day');
  eq(p.attention.some((r) => r.code === 'low'), true, 'card repeats the attention signals');
  ok(p.checkin > 0 && p.totals.remote > 0, 'check-in rate + status totals');
  ok(!('pulse' in p), 'no pulse in the person card');

  // ── Mini App export → queued for the bot ──
  eq((await call('POST', '/me/hr/export', { as: 1002, body: {} })).status, 403, 'export: HR only');
  const r = await call('POST', '/me/hr/export', { as: 1001, body: { days: 7, dept: 'IT' } });
  eq([r.status, r.data.to], [200, today], 'export queued');
  const pend = (await call('GET', '/notifications/pending', { hr: true })).data.find((n) => n.kind === 'hr_export');
  ok(pend && pend.telegram_id === '1001' && pend.payload.dept === 'IT' && pend.payload.from === add(today, -6), 'hr_export notification with the period');

  // ── exports (same filters) ──
  const fs = await import('fs');
  const get = async (p, opts = {}) => { const r = await fetch(BASE + p, { headers: { 'X-Edit-Token': HR, ...opts } }); return { status: r.status, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) }; };
  eq((await fetch(BASE + '/analytics/export.xlsx')).status, 401, 'export needs HR');
  const x = await get('/analytics/export.xlsx?days=30');
  ok(x.status === 200 && /spreadsheetml/.test(x.type) && /analytics_/.test(x.disp), 'xlsx download');
  const ExcelJS = createRequire(path.join(REPO, 'api', 'package.json'))('exceljs');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf);
  eq(wb.worksheets.map((w) => w.name), ['Огляд', 'Табель', 'Присутність', 'Настрій', 'Залученість', 'Люди'], 'xlsx sheets');
  const ts = wb.getWorksheet('Табель');
  eq(ts.getRow(1).getCell(1).value, 'Працівник', 'timesheet header');
  ok(ts.rowCount >= 8 && ts.getRow(2).cellCount >= 32, 'timesheet rows × day columns');
  const pdf = await get('/analytics/export.pdf?days=30&dept=IT');
  ok(pdf.status === 200 && pdf.type === 'application/pdf' && pdf.buf.slice(0, 5).toString() === '%PDF-', 'pdf download');
  ok(/filename\*=UTF-8''analytics_.*_IT\.pdf/.test(pdf.disp), 'pdf filename carries the department');
  fs.mkdirSync(path.join(REPO, 'tests', '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'tests', '.tmp', 'analytics.xlsx'), x.buf);
  fs.writeFileSync(path.join(REPO, 'tests', '.tmp', 'analytics.pdf'), (await get('/analytics/export.pdf?days=30')).buf);

  // old endpoint still works
  eq((await call('GET', '/analytics?days=7', { hr: true })).status, 200, 'legacy /analytics');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
