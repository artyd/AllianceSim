// Spec 006 (UI): AllianceOS 2.0 shell — widgets, tab bars, sheets, Control Center, lock screen, island.
import { launch, close, openAs, tap, type, text, js, shot, sleep, ok, report, home } from '../br.mjs';

await launch();
try {
  const a = await openAs('a');
  await sleep(800);
  ok(await js(a, () => document.querySelectorAll('#wMood [data-mood-set]').length === 5), 'status widget: 5 mood buttons');
  ok(await js(a, () => !!document.querySelector('.pdock [data-go=calendar] #pCalD')), 'dock calendar icon shows the date');
  await shot(a, 'g10-home');

  // Зв’язок: chat list → floating tab bar → Контакти
  await tap(a, '[data-go=chatlist]'); await sleep(600);
  ok(await js(a, () => document.querySelector('.ptabbar').classList.contains('on')), 'tab bar shown on chats');
  ok(await js(a, () => document.querySelectorAll('[data-scr=chatlist] [data-flt] .pchip').length === 3), 'chat filters');
  await shot(a, 'g10-chats');
  await js(a, () => document.querySelector('.ptabbar [data-tab-go=contacts]').click()); await sleep(700);
  ok(await js(a, () => !!document.querySelector('#pbody .pscreen.show[data-scr=contacts]') && !document.querySelector('#pbody .pscreen.show[data-scr=chatlist]')), 'tab switches to contacts');
  await shot(a, 'g10-contacts');
  await home(a);
  ok(await js(a, () => !document.querySelector('.ptabbar').classList.contains('on')), 'tab bar hidden at home');

  // forms open as bottom sheets
  await tap(a, '[data-go=calendar]'); await sleep(500);
  await tap(a, '[data-new]'); await sleep(600);
  ok(await js(a, () => document.querySelector('[data-scr=evform]').classList.contains('sheet')), 'event form is a sheet');
  await shot(a, 'g10-sheet');
  await home(a);

  // profile hero, settings, coffee
  await tap(a, '[data-go=profile]'); await sleep(500);
  ok(await js(a, () => !!document.querySelector('[data-scr=profile] .phero')), 'profile hero');
  await shot(a, 'g10-profile');
  // «Анкета»: the user edits their own card in a sheet; department from a wheel
  await tap(a, '[data-edit]'); await sleep(600);
  ok(await js(a, () => document.querySelector('[data-scr=meedit]').classList.contains('sheet')), 'profile edit is a sheet');
  await type(a, '[data-f=position]', 'Провідна дизайнерка'); await type(a, '[data-f=phone]', '+380 50 123 45 67');
  await tap(a, '[data-dept]'); await sleep(500);
  ok(await js(a, () => document.querySelectorAll('.pwov.on .pwcol').length === 1), 'department wheel opens');
  await js(a, () => document.querySelector('.pwov [data-done]').click()); await sleep(400);
  await shot(a, 'g10-meedit');
  await tap(a, 'button[type=submit]'); await sleep(900);
  ok((await text(a)).includes('Провідна дизайнерка') && (await text(a)).includes('+380 50 123 45 67'), 'profile shows edited fields');
  ok(await js(a, async () => { const r = await fetch('/api/employees'); const l = await r.json(); return l.some((e) => e.position === 'Провідна дизайнерка'); }), 'edit saved on the server');
  await home(a);
  await tap(a, '[data-go=coffee]'); await sleep(500); await shot(a, 'g10-coffee'); await home(a);

  // Control Center: pull down on the home screen
  await js(a, () => { const h = document.querySelector('[data-scr=home]');
    h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 20, bubbles: true }));
    h.dispatchEvent(new PointerEvent('pointerup', { clientY: 220, bubbles: true })); });
  await sleep(600);
  ok(await js(a, () => document.querySelector('.pcc').classList.contains('on')), 'control center opens');
  await shot(a, 'g10-cc');
  await js(a, () => document.querySelector('.pcc [data-cc=glass]').click()); await sleep(200);
  ok(await js(a, () => document.getElementById('phone').hasAttribute('data-reduce')), 'reduce transparency toggle');
  await js(a, () => document.querySelector('.pcc [data-cc=glass]').click());
  await js(a, () => document.querySelector('.pcc [data-ccx]').click()); await sleep(400);
  ok(await js(a, () => !document.querySelector('.pcc').classList.contains('on')), 'control center closes');

  // web office frame: lock screen first, swipe/tap to unlock
  const w = await openAs('web');
  await js(w, () => document.getElementById('phoneFab').click()); await sleep(700);
  ok(await js(w, () => document.querySelector('.plock').classList.contains('on')), 'lock screen on open (web)');
  await shot(w, 'g10-lock');
  await js(w, () => document.querySelector('.plock .tm').click()); await sleep(500);
  ok(await js(w, () => !document.querySelector('.plock').classList.contains('on')), 'lock screen unlocks');
  await shot(w, 'g10-web-home');
  ok([a, w].every((p) => p.errors.length === 0), 'no console errors: ' + [a, w].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
