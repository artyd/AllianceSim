// Phase 1 browser check: personal tasks, calendar, settings; web lock screen.
import { reset, launch, close, openAs, tap, type, key, text, js, home, shot, sleep, ok, report } from '../br.mjs';

await launch();
try {
  const a = await openAs('a'); await reset(a);
  ok(await js(a, () => !!document.querySelector('html.tgapp')), 'tg mode active');
  await shot(a, 'p1-home');

  // tasks
  await tap(a, '[data-go=tasks]');
  await sleep(600);
  ok((await text(a)).includes('Задач немає'), 'empty tasks');
  await type(a, '[data-in]', 'Купити воду');
  await key(a, '[data-in]', 'Enter');
  await sleep(500);
  ok((await text(a)).includes('Купити воду'), 'quick task added');
  await tap(a, '[data-new]');
  await type(a, '[data-text]', 'Звіт за квартал');
  const today = await js(a, () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await type(a, '[data-dd]', today);
  await type(a, '[data-dt]', '00:01');
  await tap(a, 'button[type=submit]');
  await sleep(600);
  const tt = await text(a);
  ok(tt.includes('Звіт за квартал') && tt.includes('прострочено'), 'deadline task overdue shown');
  ok((await js(a, () => document.getElementById('taskBadge').textContent)) === '1', 'task badge = 1');
  await shot(a, 'p1-tasks');
  await tap(a, '.ptask .cb');
  await sleep(500);
  ok(await js(a, () => document.querySelectorAll('[data-scr=tasks] .ptask.done').length === 1), 'toggle done');
  // edit + delete via taskform
  await tap(a, '.ptask .t');
  await tap(a, '[data-del]'); await tap(a, '[data-del]');
  await sleep(500);
  ok(await js(a, () => document.querySelectorAll('[data-scr=tasks] .ptask').length === 1), 'task deleted');
  await home(a);

  // calendar
  await tap(a, '[data-go=calendar]');
  await sleep(600);
  await tap(a, '[data-new]');
  await type(a, '[data-title]', 'Стендап');
  await type(a, '[data-st]', '10:00'); await type(a, '[data-en]', '10:30');
  await type(a, '[data-place]', 'Переговорна');
  await tap(a, 'button[type=submit]');
  await sleep(800);
  ok((await text(a)).includes('Стендап') && (await text(a)).includes('10:00–10:30'), 'event in day list');
  await shot(a, 'p1-calendar');
  // all-day note
  await tap(a, '[data-new]');
  await type(a, '[data-title]', 'День народження Віри');
  await tap(a, '[data-allday]');
  await tap(a, 'button[type=submit]');
  await sleep(800);
  ok((await text(a)).includes('Весь день'), 'all-day note');
  await js(a, () => [...document.querySelectorAll('[data-scr=calendar] [data-ev]')].find((e) => e.innerText.includes('10:00')).click()); await sleep(450);
  ok((await text(a)).toLowerCase().includes('нагадування'), 'event detail');
  await tap(a, '[data-remind] [data-v="60"]');
  await sleep(400);
  await tap(a, '[data-edit]');
  await type(a, '[data-title]', 'Стендап IT');
  await tap(a, 'button[type=submit]');
  await sleep(800);
  ok((await text(a)).includes('Стендап IT'), 'edited event detail refreshed');
  await shot(a, 'p1-event');
  await tap(a, '[data-del]'); await tap(a, '[data-del]');
  await sleep(800);
  ok(!(await text(a)).includes('Стендап IT'), 'event deleted');
  await home(a);

  // settings
  await tap(a, '[data-go=settings]');
  await sleep(700);
  await tap(a, '[data-pref=digest]');
  await sleep(500);
  ok(await js(a, async () => (await (await fetch('/api/me/prefs', { headers: { 'X-Telegram-Init-Data': Telegram.WebApp.initData } })).json()).digest === false), 'digest pref saved');
  await shot(a, 'p1-settings');
  ok(a.errors.length === 0, 'no console errors (a): ' + a.errors.join(' | '));

  // web: lock screen
  const w = await openAs('web');
  await js(w, () => document.getElementById('phoneFab').click()); await sleep(500);
  await tap(w, '[data-go=calendar]');
  ok((await text(w)).includes('Доступно в Telegram'), 'web calendar locked');
  await shot(w, 'p1-web-locked');
  ok(w.errors.filter((e) => !/layout|employees|404/.test(e)).length === 0, 'no console errors (web): ' + w.errors.join(' | '));
  // stranger (tg, no character)
  const x = await openAs('stranger');
  await tap(x, '[data-go=tasks]');
  ok((await text(x)).includes('Спочатку створіть персонажа'), 'stranger locked');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
