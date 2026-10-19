// Spec 008: deterministic 60-day history for the analytics UI (devstack DB, after /__reset).
// Adds a few colleagues across departments, newcomers/birthdays, and signals: Віра answers
// "tired" lately (low streak), Богдан stopped answering the check-in (quiet).
import path from 'path';
import { createRequire } from 'module';
import { PG_URL, REPO } from '../harness.mjs';

export async function seedHistory() {
  const pg = createRequire(path.join(REPO, 'api', 'package.json'))('pg');
  const db = new pg.Client({ connectionString: PG_URL }); await db.connect();
  const extra = [['d1', 'Дмитро Гай', 'Sales'], ['d2', 'Олена Бойко', 'Sales'], ['d3', 'Ірина Шевчук', 'Sales'],
    ['f1', 'Марія Кравець', 'Фінанси'], ['f2', 'Тарас Мельник', 'Фінанси'], ['i4', 'Свистельник Артем', 'IT'], ['h2', 'Тахтаулова Аліна', 'HR']];
  let tg = 2001;
  for (const [id, name, dept] of extra) await db.query(`INSERT INTO employees (id, name, department, telegram_id, status, mood) VALUES ($1,$2,$3,$4,'office','good') ON CONFLICT (id) DO NOTHING`, [id, name, dept, tg++]);
  await db.query(`UPDATE employees SET hired_on = CURRENT_DATE - 9 WHERE id = 'f2'`);
  await db.query(`UPDATE employees SET hired_on = CURRENT_DATE - 400, birthday = to_char(CURRENT_DATE + 5, 'MM-DD') WHERE id = 'd1'`);
  await db.query(`UPDATE employees SET status = 'vacation' WHERE id = 'd3'`);
  await db.query(`UPDATE employees SET status = 'remote' WHERE id IN ('b', 'i4')`);
  await db.query(`UPDATE employees SET telegram_id = 1003 WHERE id = 'c' AND telegram_id IS NULL`);
  const { rows } = await db.query(`SELECT id, department FROM employees`);
  const M = ['great', 'good', 'good', 'ok', 'tired', 'stressed'];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 1; i <= 60; i++) {
    for (const e of rows) {
      const wd = new Date(Date.now() - i * 864e5).getDay(), work = wd > 0 && wd < 6;
      let st = rnd() < 0.3 ? 'remote' : 'office';
      if (e.id === 'd3' && i < 12) st = 'vacation';
      if (e.id === 'f1' && i > 20 && i < 24) st = 'sick';
      if (!work) st = rnd() < 0.5 ? 'absent' : st;
      let mood = M[Math.floor(rnd() * (i < 15 ? 6 : 4))];
      if (e.id === 'c' && i <= 6) mood = 'tired';
      const ci = work && e.id !== 'n' && !(e.id === 'b' && i < 12) && (e.id === 'c' || rnd() < 0.88);
      await db.query(`INSERT INTO daily_snapshots (day, employee_id, department, status, mood, checked_in) VALUES (CURRENT_DATE - $1::int, $2, $3, $4, $5, $6)
        ON CONFLICT (day, employee_id) DO UPDATE SET status = EXCLUDED.status, mood = EXCLUDED.mood, checked_in = EXCLUDED.checked_in`, [i, e.id, e.department, st, mood, ci]);
    }
  }
  await db.query(`INSERT INTO onboarding_done (employee_id, item_id) VALUES ('f2','pass'), ('f2','desk'), ('f2','accounts') ON CONFLICT DO NOTHING`);
  await db.end();
}
