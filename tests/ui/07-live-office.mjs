// Spec 005 D (UI): first-run tour, hot desk ("Моє місце"), birthday badge, walking to a meeting.
import { URLS, launch, close, openAs, tap, type, text, js, shot, sleep, ok, report } from '../br.mjs';

const hr = (method, p, body) => fetch(new URL('/api' + p, URLS.web), { method, headers: { 'content-type': 'application/json', 'X-Edit-Token': 'hr-token' }, body: body ? JSON.stringify(body) : undefined });
await launch();
try {
  // tour on first open, gone after "Почати", not shown again
  const c = await openAs('c', { tour: true });
  ok(await js(c, () => !!document.querySelector('.ptour')), 'tour shown on first open');
  await shot(c, 'd7-tour');
  for (let i = 0; i < 4; i++) await js(c, () => document.querySelector('.ptour [data-next]').click());
  ok(!(await js(c, () => !!document.querySelector('.ptour'))), 'tour closed');
  await c.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
  ok(!(await js(c, () => !!document.querySelector('.ptour'))), 'tour not repeated');

  // hot desk
  await tap(c, '[data-go=desk]'); await sleep(900);
  ok((await text(c)).includes('Стіл 1') && (await text(c)).includes('Опен-спейс'), 'desks listed with room');
  await tap(c, '[data-book]'); await sleep(900);
  ok((await text(c)).includes('ваше на сьогодні'), 'desk booked');
  const b = await openAs('b');
  await tap(b, '[data-go=desk]'); await sleep(900);
  ok((await text(b)).includes('Віра Мак'), 'B sees the desk taken by Vira');
  await shot(b, 'd7-desks');

  // birthday today via profile
  const md = await js(c, () => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0'); });
  await js(c, () => { const b = document.querySelector('#pbar'); b.click(); }); await sleep(400);
  await tap(c, '[data-go=profile]'); await sleep(400);
  // iOS-style wheel: day + month drums in a bottom sheet
  await tap(c, '[data-bdpick]'); await sleep(500);
  ok(await js(c, () => document.querySelectorAll('.pwov.on .pwcol').length === 2), 'birthday wheel picker opens');
  await js(c, (md) => { const [d, m] = md.split('.').map(Number); const cols = document.querySelectorAll('.pwov .pwcol');
    cols[0].scrollTop = (d - 1) * 36; cols[1].scrollTop = (m - 1) * 36; cols.forEach((c) => c.dispatchEvent(new Event('scroll'))); }, md);
  await sleep(400); await js(c, () => document.querySelector('.pwov [data-done]').click()); await sleep(900);
  ok(await js(c, () => document.getElementById('toast').textContent.includes('Збережено')), 'birthday saved');

  // a meeting right now in «Київ» (r12) for Anna
  const a = await openAs('a');
  await js(a, async () => {
    const h = { 'content-type': 'application/json', 'X-Telegram-Init-Data': Telegram.WebApp.initData };
    await fetch('/api/me/events', { method: 'POST', headers: h, body: JSON.stringify({ title: 'Дзвінок', startsAt: new Date(Date.now() - 60e3).toISOString(), endsAt: new Date(Date.now() + 20 * 60e3).toISOString(), room: 'r12', place: 'Переговорна «Київ»' }) });
  });

  // office (web viewer): Vira sits at her desk (tag + card), 🎂, Anna walks into «Київ»
  const w = await openAs('web');
  await w.setViewport({ width: 1280, height: 820 });
  await w.goto(URLS.web + '?mode=viewer', { waitUntil: 'networkidle2' }); await sleep(2500);
  ok(await js(w, () => !!document.querySelector('.tag[data-emp="c"]')), 'Vira has a desk tag (hot desk = seat today)');
  await js(w, () => document.querySelector('.tag[data-emp="c"]').click()); await sleep(1500);
  const card = await js(w, () => document.getElementById('empcard').innerText);
  ok(card.includes('Місце на сьогодні') && card.includes('День народження сьогодні'), 'card: hot desk + birthday');
  let where = null;
  for (let i = 0; i < 60; i++) { where = await js(w, () => window.__where('a')); if (where && where.room === 'r12') break; await sleep(1000); }
  ok(where && where.room === 'r12', 'Anna walked into «Київ»: ' + JSON.stringify(where));
  for (let i = 0; i < 15; i++) { where = await js(w, () => window.__where('a')); if (where && where.pose !== 'walk') break; await sleep(1000); }
  ok(where && where.room === 'r12' && where.pose !== 'walk', 'and stays there (pose ' + (where && where.pose) + ')');
  await shot(w, 'd7-office');
  ok([a, b, c, w].every((p) => p.errors.length === 0), 'no console errors: ' + [a, b, c, w].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
