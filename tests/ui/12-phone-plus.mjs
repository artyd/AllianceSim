// Spec 007 (UI): «Мій день» (pulse + onboarding), timed status from the Control Center,
// Spotlight search, free rooms now (1-tap booking), poll in an announcement, coffee
// «Як зазвичай» + «Принесли», offline pill.
import { URLS, launch, close, openAs, tap, type, text, js, shot, sleep, ok, report, home } from '../br.mjs';

const hr = (method, p, body) => fetch(new URL('/api' + p, URLS.web), { method, headers: { 'content-type': 'application/json', 'X-Edit-Token': 'hr-token' }, body: body ? JSON.stringify(body) : undefined });
const low = async (p) => ((await text(p)) || '').toLowerCase();
const topIs = (p, id) => js(p, (id) => { const s = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0]; return !!s && s.dataset.scr === id; }, id);

await launch();
try {
  // Anna is a newcomer (hired 2 days ago) → onboarding card in «Мій день»
  await hr('PUT', '/employees/a', { hired_on: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) });
  const a = await openAs('a', { myday: true });
  await sleep(1800);
  ok(await topIs(a, 'myday'), '«Мій день» opens on the first visit of the day');
  ok((await low(a)).includes('зустрічі сьогодні') && (await low(a)).includes('перші кроки'), 'day screen: meetings + onboarding');
  await shot(a, 'i12-myday');
  await js(a, () => document.querySelector('[data-scr=myday] [data-ps="4"]').click()); await sleep(800);
  ok((await text(a)).includes('Дякуємо за відповідь'), 'pulse answered (anonymous)');
  await js(a, () => document.querySelector('[data-scr=myday] [data-onb]').click()); await sleep(900);
  ok(await topIs(a, 'onboard'), 'onboarding checklist opens');
  await js(a, () => document.querySelector('[data-scr=onboard] .ptask .cb').click()); await sleep(600);
  ok((await text(a)).includes('1 з 8 виконано'), 'onboarding item ticked');
  await shot(a, 'i12-onboard');
  await home(a);

  // timed status from the Control Center
  await js(a, () => { const h = document.querySelector('[data-scr=home]'); h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 20, bubbles: true })); h.dispatchEvent(new PointerEvent('pointerup', { clientY: 240, bubbles: true })); });
  await sleep(600);
  await js(a, () => document.querySelector('.pcc [data-note="На обіді"]').click()); await sleep(1000);
  await shot(a, 'i12-cc');
  await js(a, () => document.querySelector('.pcc [data-ccx]').click()); await sleep(400);
  ok(await js(a, () => document.getElementById('wMeSt').textContent.startsWith('На обіді · до')), 'home widget shows «На обіді · до …»');
  const r = await (await fetch(new URL('/api/employees', URLS.web))).json();
  ok(r.find((e) => e.id === 'a').statusNote === 'На обіді', 'note saved on the server');

  // Spotlight search → colleague card
  await tap(a, '.psrchpill'); await sleep(600);
  await type(a, '[data-q]', 'бог'); await js(a, () => document.querySelector('[data-scr=search] [data-q]').dispatchEvent(new Event('input'))); await sleep(500);
  ok((await low(a)).includes('богдан лис') && (await low(a)).includes('колеги'), 'search finds a colleague');
  await shot(a, 'i12-search');
  await js(a, () => document.querySelector('[data-scr=search] [data-kind=emp]').click()); await sleep(700);
  ok(await topIs(a, 'contact'), 'search result opens the card');
  await home(a);

  // free rooms now → book 30 min
  await js(a, () => { const h = document.querySelector('[data-scr=home]'); h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 20, bubbles: true })); h.dispatchEvent(new PointerEvent('pointerup', { clientY: 240, bubbles: true })); });
  await sleep(500); await js(a, () => document.querySelector('.pcc [data-ccgo=rooms]').click()); await sleep(1200);
  ok((await text(a)).includes('Переговорна') && (await text(a)).includes('Вільна'), 'rooms listed with free/busy');
  await shot(a, 'i12-rooms');
  await js(a, () => document.querySelector('[data-scr=rooms] [data-book][data-min="30"]:not([disabled])').click()); await sleep(1300);
  ok((await text(a)).includes('Зайнято до'), 'booked room shows as busy');
  await home(a);

  // announcement with a poll → B votes
  await tap(a, '[data-go=broadcast]'); await sleep(500);
  await type(a, '[data-txt]', 'Куди йдемо на обід?');
  await js(a, () => document.querySelector('[data-scr=broadcast] [data-pt]').click()); await sleep(200);
  await js(a, () => { const i = document.querySelectorAll('[data-scr=broadcast] [data-po]'); i[0].value = 'Піца'; i[1].value = 'Суші'; });
  await shot(a, 'i12-poll-create');
  await js(a, () => document.querySelector('[data-scr=broadcast] [data-send]').click()); await sleep(1200);
  const b = await openAs('b');
  await tap(b, '[data-go=chatlist]'); await sleep(800);
  await js(b, () => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes('Весь офіс')).click()); await sleep(1300);
  ok(await js(b, () => document.querySelectorAll('[data-scr=conv] .ppo').length === 2), 'poll in the office chat');
  await js(b, () => document.querySelector('[data-scr=conv] .ppo[data-pv="1"]').click()); await sleep(900);
  ok(await js(b, () => document.querySelector('[data-scr=conv] .ppo[data-pv="1"]').innerText.includes('100%')), 'vote shows live %');
  await shot(b, 'i12-poll-vote');

  // coffee: order → «уже в дорозі» + «Принесли»; «Як зазвичай» remembers it
  await home(a); await tap(a, '[data-go=coffee]'); await sleep(500);
  await js(a, () => document.querySelector('[data-scr=coffee] [data-drink] [data-v="Лате"]').click());
  await js(a, () => document.querySelector('[data-scr=coffee] [data-order]').click()); await sleep(700);
  await tap(a, '[data-go=coffee]'); await sleep(500);
  ok((await low(a)).includes('уже в дорозі') && (await low(a)).includes('як зазвичай'), 'coffee en route + history');
  await shot(a, 'i12-coffee');
  await js(a, () => document.querySelector('[data-scr=coffee] [data-got]').click()); await sleep(400);
  ok(!(await text(a)).includes('уже в дорозі'), '«Принесли» ends it');
  await home(a);

  // offline pill
  await a.setOfflineMode(true); await sleep(2600);
  ok(await js(a, () => document.querySelector('.poffline').classList.contains('on')), 'offline pill shows');
  await a.setOfflineMode(false); await sleep(2600);
  ok(!(await js(a, () => document.querySelector('.poffline').classList.contains('on'))), 'offline pill hides when back online');
  const errs = [a, b].flatMap((p) => p.errors).filter((e) => !/^reqfail:|net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)); // offline window is deliberate
  ok(errs.length === 0, 'no console errors: ' + errs.join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
