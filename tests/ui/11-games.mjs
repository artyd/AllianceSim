// Spec 007 (UI): «Ігри» — bot duels, solo games, invite a colleague online (island banner →
// accept → play over the network → chat card), server quiz with bots, leaderboard.
import { launch, close, openAs, tap, text, js, shot, sleep, ok, report, home } from '../br.mjs';

const click = (p, sel) => js(p, (sel) => { const s = [...document.querySelectorAll('#pbody .pscreen.show')].sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0]; const el = (s && s.querySelector(sel)) || document.querySelector(sel); if (!el) return false; el.click(); return true; }, sel);
const statusOf = (p) => js(p, () => { const s = document.querySelector('[data-scr=game] .gstatus'); return s ? s.innerText : ''; });

await launch();
try {
  const a = await openAs('a');
  await tap(a, '[data-go=games]'); await sleep(700);
  ok((await text(a)).includes('Хрестики-нулики') && (await text(a)).includes('Шахи') && (await text(a)).includes('Слово'), 'catalogue lists the games');
  await shot(a, 'h11-games');

  // ── tic-tac-toe vs the easy bot, play until the game ends ──
  await click(a, '[data-k=ttt]'); await sleep(500);
  await click(a, '[data-mode] [data-v=bot]'); await sleep(200);
  await click(a, '[data-level] [data-v=easy]'); await sleep(200);
  await click(a, '[data-go-play]'); await sleep(600);
  for (let i = 0; i < 9; i++) {
    if (/Перемога|Поразка|Нічия/.test(await statusOf(a))) break;
    await js(a, () => { const b = [...document.querySelectorAll('[data-scr=game] .tc')].find((x) => !x.classList.contains('mX') && !x.classList.contains('mO')); if (b) b.click(); });
    await sleep(900);
  }
  ok(/Перемога|Поразка|Нічия/.test(await statusOf(a)), 'TTT vs bot reaches a result: ' + (await statusOf(a)));
  await shot(a, 'h11-ttt-bot');
  await home(a);

  // ── chess vs bot: e2–e4, the bot answers ──
  await tap(a, '[data-go=games]'); await sleep(500);
  await click(a, '[data-k=chess]'); await sleep(400);
  await click(a, '[data-mode] [data-v=bot]'); await sleep(200);
  await click(a, '[data-go-play]'); await sleep(600);
  await click(a, '.cq[data-i="52"]'); await sleep(250);
  ok(await js(a, () => document.querySelectorAll('[data-scr=game] .cq.tg').length === 2), 'pawn e2 shows two targets');
  await click(a, '.cq[data-i="36"]'); await sleep(1500);
  ok(await js(a, () => document.querySelector('[data-scr=game] .gsan') && document.querySelector('[data-scr=game] .gstatus').innerText.includes('Ваш хід')), 'bot replied, my turn again');
  await shot(a, 'h11-chess');
  await home(a);

  // ── 2048 + Слово ──
  await tap(a, '[data-go=games]'); await sleep(500);
  await click(a, '[data-k="2048"]'); await sleep(500);
  const before = await js(a, () => [...document.querySelectorAll('.t2')].map((t) => t.textContent).join(','));
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) await a.keyboard.press(k);
  await sleep(300);
  ok(before !== (await js(a, () => [...document.querySelectorAll('.t2')].map((t) => t.textContent).join(','))), '2048 tiles move with arrow keys');
  await home(a); await tap(a, '[data-go=games]'); await sleep(500);
  await click(a, '[data-k=word]'); await sleep(500);
  for (const ch of 'книга') await click(a, `.wk[data-key="${ch}"]`);
  await click(a, '.wk[data-key=enter]'); await sleep(300);
  ok(await js(a, () => document.querySelectorAll('.wrow')[0].querySelectorAll('.mg,.my,.mx').length === 5), 'Слово scores a guess');
  await shot(a, 'h11-word');
  await home(a);

  // ── invite a colleague who is online ──
  const b = await openAs('b');
  await sleep(1500);
  await tap(a, '[data-go=games]'); await sleep(500);
  await click(a, '[data-k=ttt]'); await sleep(1200);
  ok(await js(a, () => !!document.querySelector('[data-scr=gsetup] .gpick[data-id=b]')), 'B listed as online');
  await click(a, '.gpick[data-id=b]'); await sleep(200);
  await click(a, '[data-go-play]'); await sleep(1500);
  ok(await js(a, () => !!document.querySelector('#pbody .pscreen.show[data-scr=lobby]')), 'host waits in the lobby');
  ok(await js(b, () => document.querySelector('.pnotch').classList.contains('big') && document.querySelector('#pisl').innerText.includes('Анна')), 'B gets the island invite');
  await shot(b, 'h11-invite');
  await js(b, () => document.querySelector('#pisl [data-ia]').click()); await sleep(1800);
  ok(await js(a, () => !!document.querySelector('#pbody .pscreen.show[data-scr=game]')), 'host jumps into the game');
  ok(await js(b, () => !!document.querySelector('#pbody .pscreen.show[data-scr=game]')), 'guest is in the game');
  // X: 0,1,2 — O: 3,4
  for (const [p, i] of [[a, 0], [b, 3], [a, 1], [b, 4], [a, 2]]) {
    await js(p, (i) => document.querySelector(`[data-scr=game] .tc[data-i="${i}"]`).click(), i); await sleep(1200);
  }
  ok((await statusOf(a)).includes('Перемога'), 'host wins over the network');
  ok((await statusOf(b)).includes('Поразка'), 'guest sees the loss live');
  await shot(b, 'h11-net-ttt');
  await home(b);
  await tap(b, '[data-go=chatlist]'); await sleep(800);
  await js(b, () => [...document.querySelectorAll('[data-scr=chatlist] [data-c]')].find((e) => e.innerText.includes('Анна')).click()); await sleep(1200);
  ok(await js(b, () => { const c = document.querySelector('[data-scr=conv] .gchat'); return !!c && c.innerText.includes('Виклик прийнято'); }), 'chat card shows the accepted invite');
  await shot(b, 'h11-chat-card');
  await home(b); await home(a);

  // ── quiz with bots only ──
  await tap(a, '[data-go=games]'); await sleep(500);
  await click(a, '[data-k=quiz]'); await sleep(1000);
  await click(a, '[data-go-play]'); await sleep(1500);
  ok(await js(a, () => !!document.querySelector('[data-scr=game] .qq')), 'quiz question on screen');
  await shot(a, 'h11-quiz');
  for (let i = 0; i < 20; i++) {
    const done = await js(a, () => !!document.querySelector('[data-scr=game] [data-again]'));
    if (done) break;
    await js(a, () => { const o = document.querySelector('[data-scr=game] .qo:not([disabled])'); if (o) o.click(); });
    await sleep(800);
  }
  ok(await js(a, () => !!document.querySelector('[data-scr=game] [data-again]')), 'quiz finished with a ranking');
  await shot(a, 'h11-quiz-end');
  await home(a);

  // ── leaderboard ──
  await tap(a, '[data-go=games]'); await sleep(500);
  await click(a, '[data-top]'); await sleep(1000);
  ok((await text(a)).includes('Анна Коваль'), 'leaderboard lists the winner');
  await shot(a, 'h11-top');
  ok([a, b].every((p) => p.errors.length === 0), 'no console errors: ' + [a, b].flatMap((p) => p.errors).join(' | '));
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await close();
process.exit(f ? 1 : 0);
