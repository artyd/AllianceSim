// Spec 005 E (UI): HR "Аналітика" tab — tiles, mood line with hover tooltip, remote bars, quiet table.
import path from 'path';
import { createRequire } from 'module';
import { URLS, launch, close, openAs, js, shot, sleep, ok, report } from '../br.mjs';

process.env.STACK = 'dev';
const { PG_URL, REPO } = await import('../harness.mjs');
await launch();
try {
  const pg = createRequire(path.join(REPO, 'api', 'package.json'))('pg');
  const db = new pg.Client({ connectionString: PG_URL }); await db.connect();
  const moods = ['great', 'good', 'ok', 'tired', 'good', 'great', 'ok', 'good', 'great', 'good', 'ok', 'good', 'tired', 'good'];
  for (let i = 1; i <= 14; i++) {
    await db.query(`INSERT INTO daily_snapshots (day, employee_id, department, status, mood, checked_in) VALUES
      (CURRENT_DATE - $1::int, 'a', 'HR', 'office', $2, true), (CURRENT_DATE - $1::int, 'b', 'IT', $3, 'good', true),
      (CURRENT_DATE - $1::int, 'c', 'IT', 'office', 'ok', $4) ON CONFLICT DO NOTHING`, [i, moods[i - 1], i % 3 ? 'remote' : 'office', i > 9]);
  }
  await db.query(`UPDATE employees SET updated_at = now() - interval '12 days' WHERE id = 'c'`);
  await db.query(`DELETE FROM daily_snapshots WHERE day = CURRENT_DATE AND employee_id = 'c'`); // reset already snapshotted her as fresh
  await db.end();

  // web without the HR code → asked for it
  const w0 = await openAs('web');
  await w0.setViewport({ width: 1280, height: 860 });
  await js(w0, () => document.querySelector('#tabs [data-tab="stats"]').click()); await sleep(600);
  ok(await js(w0, () => document.getElementById('stats').innerText.includes('код')), 'no code → asks for the HR code');

  // HR (code stored in the browser as after login)
  const w = await openAs('web');
  await w.evaluateOnNewDocument(() => { try { localStorage.setItem('alliancesim.edit_token', 'hr-token'); } catch (e) {} });
  await w.setViewport({ width: 1280, height: 860 });
  await w.goto(URLS.web, { waitUntil: 'networkidle2' }); await sleep(2000);
  await js(w, () => document.querySelector('#tabs [data-tab="stats"]').click()); await sleep(1500);
  const t = await js(w, () => document.getElementById('stats').innerText);
  ok(/сьогодні в офісі/.test(t) && /настрій сьогодні/.test(t), 'tiles');
  ok(await js(w, () => { const p = document.querySelector('#stMood path'); return !!p && p.getAttribute('d').split('L').length > 10; }), 'mood line drawn over 14+ days');
  ok(await js(w, () => document.querySelectorAll('#stRemote g[data-i]').length === 2), 'two department bars');
  ok(/IT/.test(t) && /\d+%/.test(t), 'bar labels with %');
  ok(/Віра Мак/.test(t), 'quiet table lists Vira');
  // hover → crosshair tooltip
  await js(w, () => { const h = document.getElementById('stHit'), r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width * .5, clientY: r.top + 20, bubbles: true })); });
  ok(await js(w, () => { const tp = document.getElementById('stTip'); return tp.style.display === 'block' && /\/5|немає/.test(tp.textContent); }), 'hover tooltip');
  await shot(w, 'e8-analytics');
  // dark theme keeps working (uses the dark --viz step)
  ok(await js(w, () => getComputedStyle(document.getElementById('app')).getPropertyValue('--viz').trim().length > 0), '--viz defined');
  ok([w0, w].every((p) => p.errors.length === 0), 'no console errors: ' + [w0, w].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
