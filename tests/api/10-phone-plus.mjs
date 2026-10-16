// Spec 007: status with timer + Focus, polls (app + Telegram), mini-games (invites via chat +
// Telegram buttons, turn/seq guard, results, leaderboard, resign), server quiz with bots,
// HR game schedule, who's online, weekly pulse (anonymous groups), onboarding.
import { start, stop, call, seed, ok, eq, report, BASE } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pend = async () => (await call('GET', '/notifications/pending', { hr: true })).data;
const drain = async () => { for (const n of await pend()) await call('POST', `/notifications/${n.id}/sent`, { hr: true }); };
// Keep a live stream open so the person counts as "online".
async function goOnline(tg) {
  const tok = (await call('POST', '/me/session', { as: tg })).data.token;
  const ctl = new AbortController();
  fetch(`${BASE}/me/stream?t=${encodeURIComponent(tok)}`, { signal: ctl.signal }).then((r) => r.body.getReader().read()).catch(() => {});
  await sleep(300);
  return ctl;
}

await start({ ANNOUNCE_ALLOWED: 'Анна Коваль', QUIZ_Q_MS: '700', QUIZ_REVEAL_MS: '150', QUIZ_N: '3', PULSE_MIN_GROUP: '2' });
const streams = [];
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
    { id: 'n', name: 'Ніхто Неприв', dept: 'IT' },
  ]);
  await sleep(1200); await drain();

  // ── status with timer + Focus ──
  const until = new Date(Date.now() + 3600e3).toISOString();
  let r = await call('PUT', '/employees/b', { as: 1002, body: { statusNote: 'Фокус', statusUntil: until } });
  ok(r.status === 200 && r.data.statusNote === 'Фокус' && r.data.statusUntil, 'status note with timer saved');
  const dm = (await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'b' } })).data;
  await call('POST', `/me/chats/${dm.id}/messages`, { as: 1001, body: { text: 'Ти тут?' } });
  ok(!(await pend()).some((n) => n.kind === 'chat' && n.telegram_id === '1002'), 'Focus mutes chat pings');
  await call('PUT', '/employees/b', { as: 1002, body: { statusNote: 'На обіді', statusUntil: new Date(Date.now() - 1000).toISOString() } });
  r = await call('GET', '/employees');
  ok(r.data.find((e) => e.id === 'b').statusNote === null, 'expired note reads as none');
  await drain();

  // ── polls ──
  r = await call('POST', '/me/announce', { as: 1001, body: { target: 'office', text: 'Куди йдемо на корпоратив?', poll: ['Боулінг', 'Караоке', 'Квест'] } });
  ok(r.status === 201 && r.data.poll && r.data.poll.options.length === 3, 'announcement with a poll');
  const pollId = r.data.id;
  eq((await call('POST', '/me/announce', { as: 1001, body: { target: 'office', text: 'x', poll: ['одна'] } })).status, 400, 'poll needs 2+ options');
  const pn = (await pend()).find((n) => n.kind === 'announce' && n.telegram_id === '1002');
  ok(pn && pn.payload.buttons.length === 3 && pn.payload.buttons[1].data === `pv:${pollId}:1`, 'Telegram announce carries vote buttons');
  r = await call('POST', `/me/messages/${pollId}/vote`, { as: 1002, body: { option: 1 } });
  eq(r.data.poll.votes.map((v) => v.length), [0, 1, 0], 'vote in app');
  r = await call('POST', `/bot/messages/${pollId}/vote`, { hr: true, body: { tgId: 1003, option: 2 } });
  eq(r.data.counts, [0, 1, 1], 'vote from Telegram');
  r = await call('POST', `/me/messages/${pollId}/vote`, { as: 1002, body: { option: 2 } });
  eq(r.data.poll.votes.map((v) => v.length), [0, 0, 2], 'changing the vote');
  eq((await call('POST', `/me/messages/${pollId}/vote`, { as: 1002, body: { option: 9 } })).status, 400, 'bad option');
  await drain();

  // ── who's online ──
  streams.push(await goOnline(1002), await goOnline(1003));
  r = await call('GET', '/me/online', { as: 1001 });
  eq(r.data.map((p) => p.id).sort(), ['b', 'c'], 'online colleagues (live stream open)');

  // ── duel invite → chat card + Telegram buttons → accept → moves ──
  eq((await call('POST', '/me/games', { as: 1001, body: { kind: 'ttt' } })).status, 400, 'duel needs an invitee');
  eq((await call('POST', '/me/games', { as: 1001, body: { kind: 'ttt', invite: ['n'] } })).status, 404, 'cannot invite an unlinked colleague');
  r = await call('POST', '/me/games', { as: 1001, body: { kind: 'ttt', invite: ['b'] } });
  ok(r.status === 201 && r.data.status === 'lobby' && r.data.players[1].state === 'invited', 'game lobby created');
  const g1 = r.data.id;
  const card = (await call('GET', `/me/chats/${dm.id}/messages`, { as: 1002 })).data.messages.find((m) => m.kind === 'game');
  ok(card && card.meta.gameId === g1 && card.meta.state === 'invited', 'invite card in the 1:1 chat');
  const gi = (await pend()).find((n) => n.kind === 'game_invite' && n.telegram_id === '1002');
  ok(gi && gi.payload.buttons[0].data === `gm:acc:${g1}` && gi.payload.open === `game_${g1}`, 'Telegram invite with Прийняти/Відхилити');
  eq((await call('POST', `/me/games/${g1}/respond`, { as: 1003, body: { accept: true } })).status, 404, 'outsider cannot accept');
  r = await call('POST', `/me/games/${g1}/respond`, { as: 1002, body: { accept: true } });
  ok(r.data.status === 'active' && r.data.me === 1, 'accepted → active');
  const card2 = (await call('GET', `/me/chats/${dm.id}/messages`, { as: 1001 })).data.messages.find((m) => m.kind === 'game');
  eq(card2.meta.state, 'accepted', 'card shows accepted');
  r = await call('POST', `/me/games/${g1}/move`, { as: 1001, body: { seq: 0, state: { board: 'X........', turn: 1 } } });
  ok(r.status === 200 && r.data.seq === 1, 'host moves');
  eq((await call('POST', `/me/games/${g1}/move`, { as: 1001, body: { seq: 1, state: { board: 'XX.......', turn: 1 } } })).status, 409, 'not your turn');
  eq((await call('POST', `/me/games/${g1}/move`, { as: 1002, body: { seq: 0, state: { board: 'XO.......', turn: 0 } } })).status, 409, 'stale seq');
  r = await call('POST', `/me/games/${g1}/move`, { as: 1002, body: { seq: 1, state: { board: 'XO.......', turn: 0 } } });
  ok(r.status === 200, 'guest moves');
  r = await call('POST', `/me/games/${g1}/move`, { as: 1001, body: { seq: 2, state: { board: 'XOX......', turn: null }, result: { winner: 0 } } });
  ok(r.data.status === 'done' && r.data.winner === 0, 'final move with result');

  // decline + Telegram accept path + resign
  r = await call('POST', '/me/games', { as: 1001, body: { kind: 'chess', invite: ['c'] } });
  const g2 = r.data.id;
  r = await call('POST', `/me/games/${g2}/respond`, { as: 1003, body: { accept: false } });
  ok(r.data.status === 'cancelled', 'declined duel is cancelled');
  ok((await pend()).some((n) => n.kind === 'game_declined' && n.telegram_id === '1001'), 'host told about the decline');
  r = await call('POST', '/me/games', { as: 1003, body: { kind: 'checkers', invite: ['b'] } });
  const g3 = r.data.id;
  r = await call('POST', `/bot/games/${g3}/respond`, { hr: true, body: { tgId: 1002, accept: true } });
  ok(r.status === 200 && r.data.status === 'active', 'accept from the Telegram button');
  eq((await call('POST', `/bot/games/${g3}/respond`, { hr: true, body: { tgId: 1002, accept: true } })).status, 409, 'second press → no longer active');
  r = await call('POST', `/me/games/${g3}/leave`, { as: 1002 });
  ok(r.data.status === 'done' && r.data.winner === 0, 'leaving a running duel = resign');

  // bot / solo records + leaderboard
  await call('POST', '/me/games/result', { as: 1001, body: { kind: 'chess', outcome: 'win', level: 'hard' } });
  await call('POST', '/me/games/result', { as: 1002, body: { kind: '2048', score: 4096 } });
  await call('POST', '/me/games/result', { as: 1003, body: { kind: '2048', score: 1024 } });
  eq((await call('POST', '/me/games/result', { as: 1001, body: { kind: 'poker', outcome: 'win' } })).status, 400, 'unknown game rejected');
  r = await call('GET', '/me/games/leaderboard', { as: 1001 });
  ok(r.data.pvp[0].employee_id === 'a' && r.data.pvp[0].points === 3, 'PvP leaderboard (3 pts per win)');
  eq(r.data.solo['2048'].map((x) => x.name), ['Богдан Лис', 'Віра Мак'], '2048 records');
  ok(r.data.me.bot_wins === 1 && r.data.me.pvp_wins === 1, 'my stats');

  // ── quiz: server-run, bots fill seats ──
  r = await call('POST', '/me/games', { as: 1001, body: { kind: 'quiz', invite: ['b'], bots: 2, level: 'hard' } });
  const q = r.data.id;
  ok(r.data.players.length === 4 && r.data.players.filter((p) => p.bot).length === 2, 'quiz lobby with bots');
  eq((await call('POST', `/me/games/${q}/start`, { as: 1002 })).status, 404, 'only the host starts');
  await call('POST', `/me/games/${q}/respond`, { as: 1002, body: { accept: true } });
  r = await call('POST', `/me/games/${q}/start`, { as: 1001 });
  ok(r.data.status === 'active' && r.data.state.phase === 'q' && r.data.state.answer === null && r.data.state.q.options.length >= 2, 'quiz started, answer hidden');
  for (let i = 0; i < 40; i++) {
    const s = (await call('GET', `/me/games/${q}`, { as: 1001 })).data;
    if (s.status === 'done') break;
    if (s.state.phase === 'q') for (const tg of [1001, 1002]) await call('POST', `/me/games/${q}/answer`, { as: tg, body: { option: 0 } });
    await sleep(120);
  }
  r = await call('GET', `/me/games/${q}`, { as: 1001 });
  ok(r.data.status === 'done' && r.data.state.phase === 'end' && r.data.state.scores.length === 4, 'quiz finished');
  ok(r.data.state.scores.some((v, i) => r.data.players[i].bot && v > 0), 'bots scored');
  r = await call('GET', '/me/games/leaderboard', { as: 1002 });
  ok(r.data.quiz.length >= 1, 'quiz points on the leaderboard');

  // ── HR schedule ──
  eq((await call('PUT', '/games/settings', { body: { enabled: false } })).status, 401, 'settings need HR');
  await call('PUT', '/games/settings', { hr: true, body: { enabled: false } });
  r = await call('POST', '/me/games', { as: 1001, body: { kind: 'ttt', invite: ['b'] } });
  ok(r.status === 403 && r.data.settings.open === false, 'games closed by HR');
  ok((await call('GET', '/me/games/config', { as: 1001 })).data.open === false, 'config says closed');
  await call('PUT', '/games/settings', { hr: true, body: { enabled: true, windows: [{ from: '00:00', to: '00:01' }], quiz: [{ q: 'Де кавоварка?', options: ['Кухня', 'Склад'], answer: 0 }] } });
  r = await call('GET', '/games/settings', { hr: true });
  ok(r.data.windows.length === 1 && r.data.quiz.length === 1, 'windows + HR quiz questions saved');
  await call('PUT', '/games/settings', { hr: true, body: { enabled: true, windows: [] } });

  // ── pulse ──
  r = await call('GET', '/me/pulse', { as: 1002 });
  ok(r.data.question && r.data.answered === null, 'weekly pulse question');
  eq((await call('POST', '/me/pulse', { as: 1002, body: { score: 7 } })).status, 400, 'score 1–5');
  await call('POST', '/me/pulse', { as: 1002, body: { score: 4 } });
  await call('POST', '/me/pulse', { as: 1003, body: { score: 2 } });
  r = await call('POST', '/me/pulse', { as: 1001, body: { score: 5 } });
  eq(r.data.answered, 5, 'answer saved');
  r = await call('GET', '/pulse', { hr: true });
  const wk = r.data.weeks[0];
  ok(wk.n === 3 && wk.avg === 3.67, 'HR sees the weekly average');
  ok(wk.depts.length === 1 && wk.depts[0].dept === 'IT', 'groups below the minimum are hidden (HR has 1)');
  await call('PUT', '/pulse/question', { hr: true, body: { question: 'Чи вистачає кави?' } });
  eq((await call('GET', '/me/pulse', { as: 1001 })).data.question, 'Чи вистачає кави?', 'HR sets this week’s question');

  // ── onboarding ──
  eq((await call('GET', '/me/onboarding', { as: 1003 })).data.active, false, 'not a newcomer');
  const today = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  await call('PUT', '/employees/c', { hr: true, body: { hired_on: today } });
  r = await call('GET', '/me/onboarding', { as: 1003 });
  ok(r.data.active && r.data.day >= 3 && r.data.items.length === 8, 'newcomer checklist');
  await call('POST', `/me/onboarding/${r.data.items[0].id}`, { as: 1003, body: { done: true } });
  r = await call('GET', '/onboarding', { hr: true });
  ok(r.data.people.length === 1 && r.data.people[0].done === 1, 'HR sees progress');
  await call('PUT', '/onboarding/template', { hr: true, body: { items: [{ text: 'Отримати ноутбук' }, { id: 'pass', text: 'Перепустка' }] } });
  r = await call('GET', '/me/onboarding', { as: 1003 });
  ok(r.data.items.length === 2 && r.data.items[1].done, 'HR template, progress kept by id');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
for (const s of streams) s.abort();
const f = report();
await stop();
process.exit(f ? 1 : 0);
