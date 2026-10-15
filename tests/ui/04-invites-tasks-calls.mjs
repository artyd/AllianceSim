// Phase 4 browser check: invites + RSVP live, task assignment live, calls, deep links.
import { URLS, launch, close, openAs, tap, type, key, text, js, home, shot, sleep, ok, report } from '../br.mjs';


await launch();
try {
  const a = await openAs('a'), b = await openAs('b');
  // A: event with B invited
  await tap(a, '[data-go=calendar]'); await sleep(500);
  await tap(a, '[data-new]');
  await type(a, '[data-title]', 'Планерка');
  await type(a, '[data-st]', '15:00'); await type(a, '[data-en]', '15:30');
  await tap(a, '[data-addp]'); await sleep(300);
  ok(!(await text(a)).includes('Ніхто'), 'invite picker: linked only');
  await tap(a, '[data-id=b]'); await tap(a, '[data-ok]'); await sleep(300);
  ok((await text(a)).includes('Богдан ✕'), 'B chip in form');
  await tap(a, 'button[type=submit]'); await sleep(1200);
  // B: live badge
  ok((await js(b, () => document.getElementById('calBadge').textContent)) === '1', 'B calendar badge 1 (live)');
  await tap(b, '[data-go=calendar]'); await sleep(800);
  ok((await text(b)).includes('очікує відповіді'), 'B sees pending invite');
  await tap(b, '[data-ev]'); await sleep(400);
  ok((await text(b)).includes('Анна Коваль') && (await text(b)).includes('Буду'), 'B event detail with RSVP');
  // A opens own event detail to watch statuses
  await tap(a, '[data-ev]'); await sleep(400);
  ok((await text(a)).includes('ще не відповів'), 'A sees B pending');
  await tap(b, '[data-resp=accepted]'); await sleep(1200);
  ok((await text(a)).includes('✅ буде'), 'A sees B accepted live');
  ok((await js(b, () => document.getElementById('calBadge').style.display)) === 'none', 'B badge cleared');
  await shot(a, 'p4-a-event');
  await shot(b, 'p4-b-event');

  // A edits title → B's open detail refreshes live
  await tap(a, '[data-edit]'); await type(a, '[data-title]', 'Планерка IT'); await tap(a, 'button[type=submit]'); await sleep(1200);
  ok((await text(b)).includes('Планерка IT'), 'B sees edit live');

  // tasks: A assigns to B
  await home(a); await tap(a, '[data-go=tasks]'); await sleep(500);
  await tap(a, '[data-new]');
  await type(a, '[data-text]', 'Підготувати звіт');
  await tap(a, '[data-other]'); await sleep(300);
  await tap(a, '[data-id=b]'); await tap(a, '[data-id=c]');
  ok(await js(a, () => document.querySelectorAll('[data-scr=pick] [aria-checked=true]').length === 1), 'single-choice picker');
  await tap(a, '[data-ok]'); await sleep(300);
  ok((await text(a)).includes('Віра Мак ✎'), 'assignee chosen');
  await tap(a, 'button[type=submit]'); await sleep(1200);
  ok((await text(a)).includes('Поставлені мною') && (await text(a)).includes('→ Віра'), 'A sees it under "set by me"');
  const c = await openAs('c');
  await tap(c, '[data-go=tasks]'); await sleep(800);
  ok((await text(c)).includes('Підготувати звіт') && (await text(c)).includes('від Анна Коваль'), 'C sees assigned task');
  await tap(c, '.ptask .cb'); await sleep(1200);
  ok(await js(a, () => !!document.querySelector('[data-scr=tasks] .ptask.done')), 'A sees done live');
  await tap(c, '.ptask .t'); await sleep(300);
  ok(!(await js(c, () => !!document.querySelector('[data-scr=taskform] [data-del]'))), 'assignee cannot delete');
  await shot(a, 'p4-a-tasks');

  // calls: B has @user1002 → Telegram link
  await home(a);
  await js(a, () => { window.__tl = null; Telegram.WebApp.openTelegramLink = (u) => { window.__tl = u; }; });
  await tap(a, '[data-go=calls]'); await sleep(400);
  ok((await text(a)).includes('@user1002'), 'calls list shows @username');
  await tap(a, '[data-id=b]');
  ok((await js(a, () => window.__tl)) === 'https://t.me/user1002', 'call opens Telegram profile');

  // deep link: ?open=event_1 straight into the event
  const ev = await js(b, () => [...document.querySelectorAll('[data-scr=event]')].length);
  const evId = await js(a, async () => (await (await fetch('/api/me/events?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z', { headers: { 'X-Telegram-Init-Data': Telegram.WebApp.initData } })).json())[0].id);
  const d = await openAs('b');
  await d.goto(URLS.b.replace('/#', `/?open=event_${evId}#`), { waitUntil: 'networkidle2' }); await sleep(2000);
  ok((await text(d)).includes('Планерка IT'), 'deep link opens event');
  ok([a, b, c, d].every((p) => p.errors.length === 0), 'no console errors: ' + [a, b, c, d].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
