// Spec 005 B (UI): reply + quote jump, reactions live, message search → jump, voice note, announcements.
import { launch, close, openAs, tap, type, key, text, js, home, shot, sleep, ok, report } from '../br.mjs';

const openChatWith = (p, name) => js(p, (n) => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes(n)).click(), name);

await launch();
try {
  const a = await openAs('a'), b = await openAs('b');
  // A writes 30 messages to B so the first one scrolls far up
  await tap(a, '[data-go=chatlist]'); await sleep(400);
  await tap(a, '[data-new]'); await tap(a, '[data-id=b]'); await sleep(900);
  await js(a, async () => {
    const h = { 'content-type': 'application/json', 'X-Telegram-Init-Data': Telegram.WebApp.initData };
    const id = document.querySelector('[data-scr=conv]')._chat;
    for (let i = 0; i < 30; i++) await fetch(`/api/me/chats/${id}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ text: i === 0 ? 'Пароль від wi-fi: alliance-guest' : 'повідомлення ' + i }) });
  });
  await sleep(1500);

  // B: search → jump to the old message
  await tap(b, '[data-go=chatlist]'); await sleep(600);
  await type(b, '[data-q]', 'wi-fi'); await sleep(900);
  ok((await text(b)).includes('ПОВІДОМЛЕННЯ') || (await text(b)).toLowerCase().includes('повідомлення'), 'search shows message section');
  await tap(b, '[data-f]'); await sleep(1500);
  ok(await js(b, () => { const el = document.querySelector('[data-scr=conv] .pbub.phl'); if (!el) return false; const r = el.getBoundingClientRect(), c = document.querySelector('[data-scr=conv] [data-conv]').getBoundingClientRect(); return r.top >= c.top && r.bottom <= c.bottom && el.innerText.includes('wi-fi'); }), 'jumped to found message (visible + highlighted)');
  await shot(b, 'b5-search-jump');

  // B replies to it
  await js(b, () => [...document.querySelectorAll('[data-scr=conv] .pbub')].find((e) => e.innerText.includes('wi-fi')).click()); await sleep(300);
  await tap(b, '[data-a=reply]');
  ok((await text(b, '[data-actbar]')).includes('↩️'), 'reply bar shown');
  await type(b, '[data-in]', 'Дякую!'); await key(b, '[data-in]', 'Enter'); await sleep(1000);
  ok(await js(a, () => { const q = [...document.querySelectorAll('[data-scr=conv] .pquote')].pop(); return !!q && q.innerText.includes('wi-fi'); }), 'A sees reply with quote live');
  // A taps the quote → jumps up
  await js(a, () => [...document.querySelectorAll('[data-scr=conv] .pquote')].pop().click()); await sleep(600);
  ok(await js(a, () => !!document.querySelector('[data-scr=conv] .pbub.phl')), 'quote tap jumps to original');

  // reactions: A reacts ❤️ on B's reply → B sees it; B taps it too
  await js(a, () => [...document.querySelectorAll('[data-scr=conv] .pbub.them')].pop().click()); await sleep(300);
  await tap(a, '[data-r="❤️"]'); await sleep(900);
  ok((await js(b, () => [...document.querySelectorAll('[data-scr=conv] .prx')].map((x) => x.innerText).join())).includes('❤️ 1'), 'B sees ❤️ 1 live');
  await tap(b, '.prx'); await sleep(900);
  ok((await js(a, () => [...document.querySelectorAll('[data-scr=conv] .prx')].map((x) => x.innerText).join())).includes('❤️ 2'), 'A sees ❤️ 2');
  await shot(a, 'b5-reactions');

  // voice note (fake mic)
  await tap(b, '[data-mic]'); await sleep(1800);
  ok(await js(b, () => !!document.querySelector('[data-scr=conv] .prec')), 'recording bar');
  await tap(b, '.prec [data-ok]'); await sleep(2500);
  ok(await js(a, () => { const au = [...document.querySelectorAll('[data-scr=conv] audio')].pop(); return !!au && /\/me\/attachments\//.test(au.src); }), 'A receives voice note with player');
  ok(await js(a, async () => { const au = [...document.querySelectorAll('[data-scr=conv] audio')].pop(); const r = await fetch(au.src); return r.ok && /^audio\//.test(r.headers.get('content-type')) && (await r.arrayBuffer()).byteLength > 500; }), 'voice file playable (audio/*, has data)');

  // announcement from A (no ANNOUNCE_ALLOWED in devstack → everyone may)
  await home(a); await tap(a, '[data-go=broadcast]'); await sleep(300);
  await type(a, '[data-txt]', 'У пʼятницю офіс працює до 16:00');
  await tap(a, '[data-send]'); await sleep(1200);
  await home(b); await tap(b, '[data-go=chatlist]'); await sleep(700);
  ok((await text(b)).includes('📢 У пʼятницю'), 'B list shows 📢 preview');
  await openChatWith(b, 'Весь офіс'); await sleep(1000);
  ok(await js(b, () => { const x = document.querySelector('[data-scr=conv] .pbub.ann'); return !!x && x.innerText.includes('Оголошення') && x.innerText.includes('16:00'); }), 'announcement bubble styled');
  await shot(b, 'b5-announce');
  ok(await js(b, () => [...document.querySelectorAll('#pbody, #pbody .pscreen')].every((e) => e.scrollLeft === 0)), 'phone frame not shifted sideways');

  // web HR without code → told to log in
  const w = await openAs('web');
  await js(w, () => document.getElementById('phoneFab').click()); await sleep(400);
  await tap(w, '[data-go=broadcast]'); await type(w, '[data-txt]', 'x'); await tap(w, '[data-send]');
  ok(await js(w, () => document.getElementById('toast').textContent.includes('код')), 'web without HR code refused');
  ok([a, b].every((p) => p.errors.length === 0), 'no console errors: ' + [a, b].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
