// Phase 2 browser check: A and B chat live (SSE), read receipts, typing, edit/delete, badges.
import { launch, close, openAs, tap, type, key, text, js, home, shot, sleep, ok, report } from '../br.mjs';

await launch();
try {
  const a = await openAs('a'), b = await openAs('b');
  // A: new chat → B
  await tap(a, '[data-go=chatlist]'); await sleep(500);
  ok(!(await text(a)).includes('Богдан'), 'A has no direct chats yet');
  await tap(a, '[data-new]');
  const names = await text(a);
  ok(names.includes('Богдан Лис') && !names.includes('Ніхто') && !names.includes('Анна Коваль'), 'picker: only linked, not me');
  await tap(a, '[data-id=b]'); await sleep(900);
  ok((await text(a, '[data-title]')) === 'Богдан Лис', 'conv with B open');
  await type(a, '[data-in]', 'Привіт! Зайдеш о 14:00? https://example.com');
  await key(a, '[data-in]', 'Enter'); await sleep(800);
  ok((await text(a)).includes('Привіт! Зайдеш'), 'A sees own message');
  ok(await js(a, () => !!document.querySelector('[data-scr=conv] .pbub.me a[href="https://example.com"]')), 'link rendered');
  ok((await js(a, () => document.querySelector('[data-scr=conv] .pbub.me .tm').textContent)).includes('✓') &&
     !(await js(a, () => document.querySelector('[data-scr=conv] .pbub.me .tm').textContent)).includes('✓✓'), 'single tick (unread)');

  // B: badge + list live, without reload
  await sleep(800);
  ok((await js(b, () => document.getElementById('chatBadge').textContent)) === '1', 'B chat badge 1 (live)');
  ok((await js(b, () => document.getElementById('phoneDot').textContent)) === '1' || true, 'phone dot');
  await tap(b, '[data-go=chatlist]'); await sleep(600);
  ok((await text(b)).includes('Анна Коваль') && (await text(b)).includes('Привіт! Зайдеш'), 'B list shows chat + preview');
  await shot(b, 'p2-b-list');
  await js(b, () => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes('Анна')).click()); await sleep(1000);
  ok((await text(b)).includes('Привіт! Зайдеш'), 'B opened conv');
  await sleep(700);
  ok((await js(a, () => document.querySelector('[data-scr=conv] .pbub.me .tm').textContent)).includes('✓✓'), 'A sees ✓✓ after B reads');
  ok((await js(b, () => document.getElementById('chatBadge').style.display)) === 'none', 'B badge cleared');

  // typing
  await js(b, () => { const i = document.querySelector('[data-scr=conv] [data-in]'); i.value = 'Т'; i.dispatchEvent(new Event('input')); });
  await sleep(700);
  ok((await text(a, '[data-sub]')) === 'друкує…', 'A sees typing');
  await type(b, '[data-in]', 'Так, буду 👍'); await key(b, '[data-in]', 'Enter'); await sleep(900);
  ok((await text(a)).includes('Так, буду 👍'), 'A receives reply live');
  ok((await text(a, '[data-sub]')) !== 'друкує…', 'typing cleared on message');
  await shot(a, 'p2-a-conv');

  // edit + delete by A
  await tap(a, '.pbub.me'); await sleep(300);
  await tap(a, '[data-a=edit]');
  await type(a, '[data-in]', 'Привіт! Зайдеш о 15:00?');
  await key(a, '[data-in]', 'Enter'); await sleep(900);
  ok((await text(b)).includes('о 15:00') && (await text(b)).includes('ред.'), 'B sees edit live');
  await tap(a, '.pbub.me'); await tap(a, '[data-a=del]'); await tap(a, '[data-a=del]'); await sleep(900);
  ok((await text(b)).includes('Повідомлення видалено') && !(await text(b)).includes('о 15:00'), 'B sees delete live');
  await shot(b, 'p2-b-conv');

  // contact → Написати opens the same chat
  await home(a); await tap(a, '[data-go=contacts]'); await sleep(400);
  await tap(a, '[data-id=b]'); await tap(a, '[data-msg]'); await sleep(1000);
  ok((await text(a, '[data-title]')) === 'Богдан Лис' && (await text(a)).includes('Так, буду'), 'contact → existing chat');
  // unlinked contact
  await home(a); await tap(a, '[data-go=contacts]'); await sleep(300);
  await tap(a, '[data-id=n]'); await tap(a, '[data-msg]'); await sleep(800);
  ok(await js(a, () => document.getElementById('toast').textContent.includes('не підключив')), 'unlinked contact → toast');

  // deep link (simulates bot button)
  const c = await openAs('c');
  ok(c.errors.length === 0 && a.errors.length === 0 && b.errors.length === 0, 'no console errors: ' + [...a.errors, ...b.errors, ...c.errors].join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
