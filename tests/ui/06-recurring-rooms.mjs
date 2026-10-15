// Spec 005 C (UI): repeating event + room picker with clash warning; office map shows the
// booked room and the person "in a meeting".
import { URLS, launch, close, openAs, tap, type, text, js, shot, sleep, ok, report } from '../br.mjs';

const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
await launch();
try {
  const a = await openAs('a'), b = await openAs('b');
  // A: weekly stand-up in «Київ», running right now (started 10 min ago, ends in 30)
  await tap(a, '[data-go=calendar]'); await sleep(500);
  await tap(a, '[data-new]'); await sleep(400);
  ok((await text(a)).includes('Переговорна «Київ»') && (await text(a)).includes('Переговорна «Львів»'), 'room chips from the office plan');
  const st = new Date(Date.now() - 10 * 60e3), en = new Date(Date.now() + 30 * 60e3);
  await type(a, '[data-title]', 'Планерка');
  await type(a, '[data-st]', hhmm(st)); await type(a, '[data-en]', hhmm(en));
  await js(a, () => document.querySelector('[data-scr=evform] [data-en]').dispatchEvent(new Event('change')));
  await tap(a, '[data-room="r12"]'); await sleep(600);
  ok((await text(a, '[data-roominfo]')).includes('Вільна'), 'room shown free');
  ok((await js(a, () => document.querySelector('[data-scr=evform] [data-place]').value)) === 'Переговорна «Київ»', 'place filled from room');
  await tap(a, '[data-repeat] [data-v="weekly"]');
  ok(await js(a, () => getComputedStyle(document.querySelector('[data-scr=evform] [data-untilw]')).display !== 'none'), 'until field appears');
  await tap(a, 'button[type=submit]'); await sleep(1200);
  ok((await text(a)).includes('🔁') && (await text(a)).includes('Планерка'), 'calendar shows repeating event');
  await tap(a, '[data-ev]'); await sleep(400);
  ok((await text(a)).includes('щотижня') && (await text(a)).includes('🚪'), 'event detail: repeat + room');
  await shot(a, 'c6-event');

  // B tries the same room at the same time → clash warning
  await tap(b, '[data-go=calendar]'); await sleep(400); await tap(b, '[data-new]'); await sleep(300);
  await type(b, '[data-st]', hhmm(new Date(Date.now() + 5 * 60e3))); await type(b, '[data-en]', hhmm(new Date(Date.now() + 20 * 60e3)));
  await js(b, () => document.querySelector('[data-scr=evform] [data-en]').dispatchEvent(new Event('change')));
  await tap(b, '[data-room="r12"]'); await sleep(900);
  const info = await text(b, '[data-roominfo]');
  ok(info.includes('Зайнято') && info.includes('Анна Коваль'), 'clash warning names the organizer: ' + info);
  ok(await js(b, () => document.querySelector('[data-scr=evform] [data-room="r12"]').classList.contains('busy')), 'busy chip marked');
  ok(!(await js(b, () => document.querySelector('[data-scr=evform] [data-room="r6"]').classList.contains('busy'))), 'other room free');
  await shot(b, 'c6-clash');

  // Office map (web viewer): seat Anna at a desk so she has a name tag, then check overlay
  await fetch(new URL('/api/employees/a', URLS.web), { method: 'PUT', headers: { 'content-type': 'application/json', 'X-Edit-Token': 'hr-token' }, body: JSON.stringify({ seat: { f: 'd1', i: 0 } }) });
  const w = await openAs('web');
  await w.setViewport({ width: 1280, height: 820 });
  await w.goto(URLS.web + '?mode=viewer', { waitUntil: 'networkidle2' }); await sleep(2500);
  const lbl = await js(w, () => { const el = [...document.querySelectorAll('.rl')].find((x) => x.innerText.includes('Київ')); return el ? { busy: el.classList.contains('busy'), t: el.innerText } : null; });
  ok(lbl && lbl.busy && /до \d\d:\d\d/.test(lbl.t), 'room label busy on the map: ' + JSON.stringify(lbl));
  ok(!(await js(w, () => [...document.querySelectorAll('.rl')].find((x) => x.innerText.includes('Львів')).classList.contains('busy'))), 'free room not marked');
  await js(w, () => document.querySelector('.tag[data-emp="a"]').click()); await sleep(1500);
  ok((await js(w, () => document.getElementById('empcard').innerText)).includes('На зустрічі до'), 'person card: in a meeting');
  await shot(w, 'c6-office');
  ok([a, b, w].every((p) => p.errors.length === 0), 'no console errors: ' + [a, b, w].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
