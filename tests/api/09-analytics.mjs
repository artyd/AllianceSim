// Spec 005 E: HR analytics from daily snapshots.
import path from 'path';
import { createRequire } from 'module';
import { start, stop, call, seed, ok, eq, report, REPO, PG_URL } from '../harness.mjs';

await start();
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001, extra: { status: 'office', mood: 'great' } },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002, extra: { status: 'remote', mood: 'ok' } },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003, extra: { status: 'office', mood: 'tired' } },
  ]);
  const pg = createRequire(path.join(REPO, 'api', 'package.json'))('pg');
  const db = new pg.Client({ connectionString: PG_URL }); await db.connect();
  // 10 past days: Anna office+great, Bohdan remote+ok (both answer daily); Vira office+tired,
  // last answered 10 days ago and her profile hasn't changed since.
  for (let i = 1; i <= 10; i++) {
    await db.query(`INSERT INTO daily_snapshots (day, employee_id, department, status, mood, checked_in) VALUES
      (CURRENT_DATE - $1::int, 'a', 'HR', 'office', 'great', true),
      (CURRENT_DATE - $1::int, 'b', 'IT', 'remote', 'ok', true),
      (CURRENT_DATE - $1::int, 'c', 'IT', 'office', 'tired', $2)`, [i, i === 10]);
  }
  await db.query(`UPDATE employees SET updated_at = now() - interval '10 days' WHERE id = 'c'`);
  await db.query(`DELETE FROM daily_snapshots WHERE day = CURRENT_DATE`);
  await db.end();

  eq((await call('GET', '/analytics')).status, 401, 'HR only');
  eq((await call('GET', '/analytics', { as: 1001 })).status, 401, 'a Telegram user is not HR');
  const a = (await call('GET', '/analytics?days=30', { hr: true })).data;
  eq(a.mood.length, 11, '10 past days + today');
  ok(a.mood.every((d) => d.avg === 3.33 && d.n === 3), 'daily mood avg (5+3+2)/3 = 3.33');
  eq(a.mood[a.mood.length - 1].status, { office: 2, remote: 1 }, 'today status mix');
  const it = a.remote.find((r) => r.dept === 'IT'), hrd = a.remote.find((r) => r.dept === 'HR');
  ok(it.share === 50 && it.people === 2 && hrd.share === 0, 'remote share per dept (IT 50%, HR 0%)');
  eq(a.remote[0].dept, 'IT', 'sorted by share');
  eq(a.quiet.map((q) => q.id), ['c'], 'Vira has been quiet 7+ days');
  ok(a.quiet[0].last && a.quiet[0].last < a.today, 'last check-in date reported');
  eq((await call('GET', '/analytics?days=7', { hr: true })).data.mood.length, 7, 'window size');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
