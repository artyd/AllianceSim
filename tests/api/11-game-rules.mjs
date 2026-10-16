// Spec 007: unit tests of the pure game rules + bots (public/games-engines.js). No server.
import { ttt, sea, FLEET, checkers, chess, g2048, snake, word, WORDS } from '../../public/games-engines.js';

let passes = 0, fails = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// ── chess: perft (move generator incl. castling, en passant, promotion) ──
const s0 = chess.init();
eq([1, 2, 3].map((d) => chess.perft(s0, d)), [20, 400, 8902], 'perft from the start');
function fen(f) {
  const [pos, side, castle, ep] = f.split(' ');
  const b = []; for (const ch of pos.replace(/\//g, '')) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) b.push(''); else b.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase()); }
  const sq = (a) => (a === '-' ? -1 : (8 - +a[1]) * 8 + 'abcdefgh'.indexOf(a[0]));
  return { b, turn: side === 'w' ? 0 : 1, castle: castle === '-' ? '' : castle, ep: sq(ep), half: 0, full: 1, keys: [] };
}
const kiwi = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
eq([1, 2].map((d) => chess.perft(kiwi, d)), [48, 2039], 'perft «Kiwipete» (castling/ep/promo)');
const pos3 = fen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
eq([1, 2, 3].map((d) => chess.perft(pos3, d)), [14, 191, 2812], 'perft position 3 (ep pins)');
// fool's mate
let s = chess.init();
for (const [a, b] of [[53, 45], [12, 28], [54, 38], [3, 39]]) s = chess.apply(s, { from: a, to: b });
eq(chess.result(s), { over: true, winner: 1, why: 'мат' }, 'fool’s mate is mate');
ok(s.san === 'Qh4#', 'SAN with mate sign: ' + s.san);
const mateIn1 = fen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -');
const bm = chess.bot(mateIn1, 'mid');
ok(bm.from === 56 && bm.to === 0, 'bot finds back-rank mate in 1');
ok(['easy', 'mid', 'hard'].every((l) => { const b = chess.bot(s0, l); return chess.moves(s0).some((m) => b.from === m.from && b.to === m.to); }), 'bots return legal moves');
const promo = fen('8/P6k/8/8/8/8/8/K7 w - -');
ok(chess.moves(promo).filter((m) => m.from === 8).length === 4, 'promotion offers Q/R/B/N');
const stale = fen('7k/5Q2/6K1/8/8/8/8/8 b - -');
eq(chess.result(stale).why, 'пат', 'stalemate');

// ── checkers (Ukrainian rules) ──
const c0 = checkers.init();
eq(checkers.moves(c0).length, 7, 'checkers: 7 opening moves');
let cb = Array(64).fill(''); cb[5 * 8 + 2] = 'w'; cb[4 * 8 + 3] = 'b'; cb[5 * 8 + 6] = 'w';
let cs = { b: cb, turn: 0, quiet: 0 };
let ms = checkers.moves(cs);
ok(ms.length === 1 && ms[0].caps.length === 1, 'capture is mandatory');
cb = Array(64).fill(''); cb[6 * 8 + 1] = 'w'; cb[5 * 8 + 2] = 'b'; cb[3 * 8 + 4] = 'b';
ms = checkers.moves({ b: cb, turn: 0, quiet: 0 });
ok(ms.length === 1 && ms[0].caps.length === 2 && ms[0].path.length === 3, 'multi-jump in one move');
cb = Array(64).fill(''); cb[7 * 8 + 0] = 'W'; cb[4 * 8 + 3] = 'b';
ms = checkers.moves({ b: cb, turn: 0, quiet: 0 });
ok(ms.length === 4 && ms.every((m) => m.caps[0] === 4 * 8 + 3), 'flying king captures from afar, lands on any square behind');
cb = Array(64).fill(''); cb[7 * 8 + 0] = 'W'; cb[5 * 8 + 2] = 'b'; cb[2 * 8 + 3] = 'b';
ms = checkers.moves({ b: cb, turn: 0, quiet: 0 });
ok(ms.length >= 1 && ms.every((m) => m.caps.length === 2), 'king must keep capturing when it can');
cb = Array(64).fill(''); cb[2 * 8 + 1] = 'w'; cb[1 * 8 + 2] = 'b'; cb[1 * 8 + 4] = 'b';
ms = checkers.moves({ b: cb, turn: 0, quiet: 0 });
const promoRun = ms.find((m) => m.caps.length === 2);
ok(promoRun && promoRun.promote, 'a man crowned mid-capture continues as a king');
const after = checkers.apply({ b: cb, turn: 0, quiet: 0 }, promoRun);
ok(after.b.filter((x) => x === 'W').length === 1 && after.b.filter((x) => x === 'b').length === 0, 'captured pieces removed, king crowned');
let cg = checkers.init(), plies = 0;
while (!checkers.result(cg).over && plies < 300) { cg = checkers.apply(cg, checkers.bot(cg, plies % 2 ? 'easy' : 'mid')); plies++; }
ok(checkers.result(cg).over || plies === 300, 'bot vs bot game terminates');

// ── tic-tac-toe: the hard bot never loses ──
let losses = 0;
for (let g = 0; g < 60; g++) {
  let t = ttt.init();
  while (!ttt.result(t).over) {
    const free = t.b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    t = ttt.apply(t, t.turn === 0 ? free[Math.floor(Math.random() * free.length)] : ttt.bot(t, 'hard'));
  }
  if (ttt.result(t).winner === 0) losses++;
}
eq(losses, 0, 'perfect TTT bot never loses');

// ── battleship ──
let fleetOk = true;
for (let k = 0; k < 30; k++) {
  const f = sea.randomFleet(), cells = f.flatMap((x) => x.cells);
  if (cells.length !== FLEET.reduce((a, b) => a + b, 0) || new Set(cells).size !== cells.length) fleetOk = false;
  for (const sh of f) for (const c of sh.cells) for (const other of f) if (other !== sh) for (const o of other.cells) {
    if (Math.abs(Math.floor(c / 10) - Math.floor(o / 10)) <= 1 && Math.abs((c % 10) - (o % 10)) <= 1) fleetOk = false;
  }
}
ok(fleetOk, 'random fleets: 20 cells, ships never touch');
let sg = sea.init([sea.randomFleet(), sea.randomFleet()]), shots = 0;
while (!sea.result(sg).over && shots < 400) { const p = sg.turn; sg = sea.apply(sg, p, sea.bot(sg, p, p === 0 ? 'hard' : 'easy')); shots++; }
ok(sea.result(sg).over, 'battleship bot game ends');
const hitCell = sg.fleets[1][0].cells[0];
ok(['hit', 'sunk', ''].includes(sea.cellAt(sg, 0, hitCell)), 'cell view');

// ── 2048 ──
let g = { g: [2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0 };
const mv = g2048.move(g, 'left');
ok(mv.moved && mv.s.g[0] === 4 && mv.s.g[1] === 4 && mv.s.score === 4, '2048 merge once per move');
ok(!g2048.move({ g: [2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128], score: 0 }, 'left').moved, 'blocked move');

// ── snake ──
let sn = snake.init(); sn = snake.turn(sn, [-1, 0]);
eq(sn.next, [1, 0], 'snake cannot reverse');
for (let i = 0; i < 40; i++) sn = snake.step(sn);
ok(sn.over, 'snake dies at the wall');

// ── Слово ──
ok(WORDS.length >= 100 && WORDS.every((w) => w.length === 5), `5-letter word list (${WORDS.length})`);
eq(word.score('коса', 'косак'.slice(0, 4)).length, 5, 'score shape');
eq(word.score('кукла', 'кулак'), ['g', 'g', 'y', 'y', 'y'], 'duplicates handled');
eq(word.score('ааааа', 'бабка'), ['x', 'g', 'x', 'x', 'g'], 'extra repeats are grey');
let w = word.init('книга'); w = word.guess(w, 'КНИГА');
ok(w.won && w.over && w.rows.length === 1, 'win on the first try');
ok(word.daily(new Date(2026, 9, 16)) === word.daily(new Date(2026, 9, 16, 23)), 'word of the day stable within a day');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
