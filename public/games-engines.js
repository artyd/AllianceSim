// AllianceOS mini-games — pure rules + bots (spec 007). No DOM here: the phone UI (games.js)
// and the unit tests (tests/api/11-game-rules.mjs) both import this module.
// State objects are plain JSON so a network game can ship them through the server as-is.

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const clone = (o) => JSON.parse(JSON.stringify(o));
export const LEVEL_N = { easy: 'Легкий', mid: 'Середній', hard: 'Сильний' };

// ════════════════════════════════════════ Хрестики-нулики ═════
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const ttt = {
  init: () => ({ b: Array(9).fill(''), turn: 0 }),
  mark: (p) => (p === 0 ? 'X' : 'O'),
  winLine(b) { for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return l; return null; },
  result(s) {
    const l = ttt.winLine(s.b);
    if (l) return { over: true, winner: s.b[l[0]] === 'X' ? 0 : 1, line: l };
    if (s.b.every(Boolean)) return { over: true, winner: null };
    return { over: false };
  },
  legal: (s, i) => !s.b[i] && !ttt.result(s).over,
  apply(s, i) { const n = clone(s); n.b[i] = ttt.mark(s.turn); n.turn = 1 - s.turn; return n; },
  bot(s, level) {
    const free = s.b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (level === 'easy' && Math.random() < 0.7) return pick(free);
    const me = ttt.mark(s.turn), op = ttt.mark(1 - s.turn);
    const winning = (who) => free.find((i) => { const b = s.b.slice(); b[i] = who; return ttt.winLine(b); });
    if (level !== 'hard') {
      const w = winning(me); if (w != null) return w;
      const bl = winning(op); if (bl != null) return bl;
      if (!s.b[4]) return 4;
      return pick(free);
    }
    // perfect play: minimax
    const mm = (b, turn, depth) => {
      const l = ttt.winLine(b);
      if (l) return b[l[0]] === me ? 10 - depth : depth - 10;
      if (b.every(Boolean)) return 0;
      let best = turn === me ? -99 : 99;
      for (let i = 0; i < 9; i++) if (!b[i]) {
        b[i] = turn; const v = mm(b, turn === 'X' ? 'O' : 'X', depth + 1); b[i] = '';
        best = turn === me ? Math.max(best, v) : Math.min(best, v);
      }
      return best;
    };
    let bestV = -99, moves = [];
    for (const i of free) { const b = s.b.slice(); b[i] = me; const v = mm(b, op, 1); if (v > bestV) { bestV = v; moves = [i]; } else if (v === bestV) moves.push(i); }
    return pick(moves);
  },
};

// ════════════════════════════════════════ Морський бій ═════
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const N = 10;
export const sea = {
  // Random legal fleet: ships never touch, not even diagonally. Returns [{cells:[i...]}].
  randomFleet() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const busy = new Set(), ships = [];
      let okAll = true;
      for (const len of FLEET) {
        let placed = false;
        for (let t = 0; t < 300 && !placed; t++) {
          const hor = Math.random() < 0.5, r = rnd(hor ? N : N - len + 1), c = rnd(hor ? N - len + 1 : N);
          const cells = Array.from({ length: len }, (_, k) => (hor ? r * N + c + k : (r + k) * N + c));
          if (cells.some((x) => busy.has(x))) continue;
          for (const x of cells) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const rr = Math.floor(x / N) + dr, cc = (x % N) + dc;
            if (rr >= 0 && rr < N && cc >= 0 && cc < N) busy.add(rr * N + cc);
          }
          ships.push({ cells }); placed = true;
        }
        if (!placed) { okAll = false; break; }
      }
      if (okAll) return ships;
    }
    throw new Error('fleet');
  },
  init: (fleets) => ({ phase: fleets && fleets[0] && fleets[1] ? 'play' : 'place', fleets: fleets || [null, null], shots: [[], []], turn: fleets && fleets[0] && fleets[1] ? 0 : null }),
  // shots[p] = cells player p has fired at (on the opponent's grid).
  cellAt(s, p, i) { // what player p sees at cell i of the opponent's grid
    if (!s.shots[p].includes(i)) return '';
    const ship = s.fleets[1 - p].find((sh) => sh.cells.includes(i));
    if (!ship) return 'miss';
    return ship.cells.every((c) => s.shots[p].includes(c)) ? 'sunk' : 'hit';
  },
  legal: (s, p, i) => s.phase === 'play' && s.turn === p && !s.shots[p].includes(i) && i >= 0 && i < N * N,
  apply(s, p, i) {
    const n = clone(s);
    n.shots[p].push(i);
    const ship = n.fleets[1 - p].find((sh) => sh.cells.includes(i));
    if (ship && ship.cells.every((c) => n.shots[p].includes(c))) {
      // a sunk ship reveals the water around it (auto-marked misses)
      for (const x of ship.cells) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = Math.floor(x / N) + dr, cc = (x % N) + dc, y = rr * N + cc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && !n.shots[p].includes(y)) n.shots[p].push(y);
      }
    }
    if (!ship) n.turn = 1 - p; // a hit shoots again
    return n;
  },
  result(s) {
    if (s.phase !== 'play') return { over: false };
    for (const p of [0, 1]) if (s.fleets[1 - p].every((sh) => sh.cells.every((c) => s.shots[p].includes(c)))) return { over: true, winner: p };
    return { over: false };
  },
  bot(s, p, level) {
    const shot = new Set(s.shots[p]);
    const free = Array.from({ length: N * N }, (_, i) => i).filter((i) => !shot.has(i));
    const hits = s.shots[p].filter((i) => sea.cellAt(s, p, i) === 'hit');
    if (level !== 'easy' && hits.length) {
      // finish the wounded ship: extend along the line of hits, else try neighbours
      const near = (i) => [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => { const r = Math.floor(i / N) + dr, c = (i % N) + dc; return r >= 0 && r < N && c >= 0 && c < N ? r * N + c : -1; }).filter((x) => x >= 0 && !shot.has(x));
      if (hits.length >= 2) {
        const hor = Math.floor(hits[0] / N) === Math.floor(hits[1] / N);
        const cand = hits.flatMap(near).filter((x) => (hor ? Math.floor(x / N) === Math.floor(hits[0] / N) : x % N === hits[0] % N));
        if (cand.length) return pick(cand);
      }
      const cand = hits.flatMap(near);
      if (cand.length) return pick(cand);
    }
    if (level === 'hard') {
      // probability density of the ships still afloat
      const alive = s.fleets[1 - p].filter((sh) => !sh.cells.every((c) => shot.has(c))).map((sh) => sh.cells.length);
      const heat = new Array(N * N).fill(0);
      for (const len of alive) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const hor of [true, false]) {
        const cells = Array.from({ length: len }, (_, k) => (hor ? (c + k < N ? r * N + c + k : -1) : (r + k < N ? (r + k) * N + c : -1)));
        if (cells.some((x) => x < 0 || shot.has(x))) continue;
        for (const x of cells) heat[x]++;
      }
      const max = Math.max(...free.map((i) => heat[i]));
      return pick(free.filter((i) => heat[i] === max));
    }
    // mid: parity hunting
    const parity = free.filter((i) => (Math.floor(i / N) + (i % N)) % 2 === 0);
    return pick(level === 'mid' && parity.length ? parity : free);
  },
};

// ════════════════════════════════════════ Шашки (українські правила) ═════
// 8×8, dark squares; white (player 0) at the bottom moves up. Men move forward, capture both
// ways; capturing is mandatory; kings fly; captured pieces come off after the whole run
// (no jumping a piece twice); a man reaching the last row mid-capture continues as a king.
// Pieces: 'w','W','b','B' ('' empty). Index = r*8+c, r=0 at the top.
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const checkers = {
  init() {
    const b = Array(64).fill('');
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = r < 3 ? 'b' : r > 4 ? 'w' : '';
    return { b, turn: 0, quiet: 0 };
  },
  own: (pc, p) => !!pc && (p === 0 ? pc.toLowerCase() === 'w' : pc.toLowerCase() === 'b'),
  isKing: (pc) => pc === 'W' || pc === 'B',
  // All legal moves for the side to move: [{path:[from, ..., to], caps:[idx...], promote}]
  moves(s) {
    const p = s.turn, caps = [], quiet = [];
    for (let i = 0; i < 64; i++) {
      if (!checkers.own(s.b[i], p)) continue;
      checkers._captures(s.b, i, s.b[i], p, [i], [], caps);
      if (!caps.length) quiet.push(...checkers._quiet(s.b, i, p));
    }
    const out = caps.length ? caps : quiet, last = p === 0 ? 0 : 7;
    for (const m of out) if (!checkers.isKing(s.b[m.path[0]])) m.promote = m.path.slice(1).some((i) => Math.floor(i / 8) === last);
    return out;
  },
  _quiet(b, i, p) {
    const out = [], r = Math.floor(i / 8), c = i % 8, king = checkers.isKing(b[i]);
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== (p === 0 ? -1 : 1)) continue;
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc) && !b[rr * 8 + cc]) {
        const to = rr * 8 + cc;
        out.push({ path: [i, to], caps: [], promote: !king && (p === 0 ? rr === 0 : rr === 7) });
        if (!king) break;
        rr += dr; cc += dc;
      }
    }
    return out;
  },
  _captures(b, at, pc, p, path, caps, out) {
    const r = Math.floor(at / 8), c = at % 8, king = checkers.isKing(pc);
    let extended = false;
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc;
      if (king) while (inB(rr, cc) && !b[rr * 8 + cc]) { rr += dr; cc += dc; }
      if (!inB(rr, cc)) continue;
      const vi = rr * 8 + cc, victim = b[vi];
      if (!victim || checkers.own(victim, p) || caps.includes(vi)) continue;
      // every landing square behind the victim (one for a man, any for a king)
      const lands = [];
      let lr = rr + dr, lc = cc + dc;
      while (inB(lr, lc) && (!b[lr * 8 + lc] || lr * 8 + lc === path[0])) {
        lands.push(lr * 8 + lc);
        if (!king) break;
        lr += dr; lc += dc;
      }
      const runs = lands.map((land) => {
        const lr2 = Math.floor(land / 8);
        const becomesKing = !king && (p === 0 ? lr2 === 0 : lr2 === 7);
        const np = becomesKing ? (p === 0 ? 'W' : 'B') : pc;
        const nb = b.slice(); nb[at] = ''; nb[land] = np;
        const more = [];
        checkers._captures(nb, land, np, p, [...path, land], [...caps, vi], more);
        return { land, becomesKing, more };
      });
      // a king must land where the capture can go on, if such a square exists
      const goOn = runs.filter((x) => x.more.length);
      for (const x of goOn.length ? goOn : runs) {
        extended = true;
        if (x.more.length) out.push(...x.more);
        else out.push({ path: [...path, x.land], caps: [...caps, vi], promote: x.becomesKing || checkers.isKing(pc) === false && x.becomesKing });
      }
    }
    return extended;
  },
  apply(s, m) {
    const n = clone(s), from = m.path[0], to = m.path[m.path.length - 1];
    let pc = n.b[from];
    n.b[from] = '';
    for (const x of m.caps) n.b[x] = '';
    const tr = Math.floor(to / 8);
    if (m.promote || (!checkers.isKing(pc) && ((s.turn === 0 && tr === 0) || (s.turn === 1 && tr === 7)))) pc = s.turn === 0 ? 'W' : 'B';
    n.b[to] = pc;
    n.quiet = m.caps.length || !checkers.isKing(s.b[from]) ? 0 : (s.quiet || 0) + 1;
    n.turn = 1 - s.turn;
    n.last = m.path;
    return n;
  },
  result(s) {
    if (!checkers.moves(s).length) return { over: true, winner: 1 - s.turn };
    if ((s.quiet || 0) >= 30) return { over: true, winner: null }; // 15 king moves each, nothing taken
    return { over: false };
  },
  eval(s, p) {
    let v = 0;
    for (let i = 0; i < 64; i++) {
      const pc = s.b[i]; if (!pc) continue;
      const r = Math.floor(i / 8), mine = checkers.own(pc, p);
      let w = checkers.isKing(pc) ? 3 : 1 + (pc === 'w' ? (7 - r) : pc === 'b' ? r : 0) * 0.04;
      if (!checkers.isKing(pc) && (i % 8 === 0 || i % 8 === 7)) w += 0.05;
      v += mine ? w : -w;
    }
    return v;
  },
  bot(s, level) {
    const ms = checkers.moves(s);
    if (ms.length === 1) return ms[0];
    if (level === 'easy' && Math.random() < 0.5) return pick(ms);
    const depth = level === 'hard' ? 6 : level === 'mid' ? 3 : 1, me = s.turn;
    const search = (st, d, a, b) => {
      const r = checkers.result(st);
      if (r.over) return r.winner == null ? 0 : r.winner === me ? 1000 + d : -1000 - d;
      if (d === 0) return checkers.eval(st, me);
      const list = checkers.moves(st);
      if (st.turn === me) { let v = -1e9; for (const m of list) { v = Math.max(v, search(checkers.apply(st, m), d - 1, a, b)); a = Math.max(a, v); if (a >= b) break; } return v; }
      let v = 1e9; for (const m of list) { v = Math.min(v, search(checkers.apply(st, m), d - 1, a, b)); b = Math.min(b, v); if (a >= b) break; } return v;
    };
    let best = -1e9, bestMoves = [];
    for (const m of ms) {
      const v = search(checkers.apply(s, m), depth - 1, -1e9, 1e9) + Math.random() * 0.01;
      if (v > best) { best = v; bestMoves = [m]; }
    }
    return bestMoves[0];
  },
};

// ════════════════════════════════════════ Шахи (повні правила) ═════
// Board: 64 squares, index = r*8+c, r=0 = rank 8 (black side). Pieces 'wP','bK'… ('' empty).
// State: {b, turn:0 white|1 black, castle:'KQkq', ep:-1|idx, half, full, keys:[]}.
const PV = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const PST = {
  P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const color = (pc) => (pc ? (pc[0] === 'w' ? 0 : 1) : -1);
export const chess = {
  init() {
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'], b = Array(64).fill('');
    for (let c = 0; c < 8; c++) { b[c] = 'b' + back[c]; b[8 + c] = 'bP'; b[48 + c] = 'wP'; b[56 + c] = 'w' + back[c]; }
    const s = { b, turn: 0, castle: 'KQkq', ep: -1, half: 0, full: 1, keys: [] };
    s.keys = [chess.key(s)];
    return s;
  },
  key: (s) => s.b.join(',') + '|' + s.turn + '|' + s.castle + '|' + s.ep,
  attacked(b, sq, by) { // is square sq attacked by colour `by`?
    const r = Math.floor(sq / 8), c = sq % 8, pre = by === 0 ? 'w' : 'b';
    const pr = by === 0 ? r + 1 : r - 1; // pawns attack "forward"
    for (const dc of [-1, 1]) if (inB(pr, c + dc) && b[pr * 8 + c + dc] === pre + 'P') return true;
    for (const [dr, dc] of KN) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === pre + 'N') return true;
    for (const [dr, dc] of KG) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === pre + 'K') return true;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const diag = dr && dc;
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) {
        const pc = b[rr * 8 + cc];
        if (pc) { if (pc[0] === pre && (pc[1] === 'Q' || pc[1] === (diag ? 'B' : 'R'))) return true; break; }
        rr += dr; cc += dc;
      }
    }
    return false;
  },
  kingSq: (b, side) => b.indexOf((side === 0 ? 'w' : 'b') + 'K'),
  inCheck: (s, side = s.turn) => chess.attacked(s.b, chess.kingSq(s.b, side), 1 - side),
  // Pseudo-legal moves {from,to,promo?,castle?,ep?}
  pseudo(s) {
    const out = [], b = s.b, me = s.turn, pre = me === 0 ? 'w' : 'b';
    for (let i = 0; i < 64; i++) {
      const pc = b[i]; if (!pc || pc[0] !== pre) continue;
      const r = Math.floor(i / 8), c = i % 8, t = pc[1];
      const add = (to, extra = {}) => out.push({ from: i, to, ...extra });
      if (t === 'P') {
        const d = me === 0 ? -1 : 1, start = me === 0 ? 6 : 1, last = me === 0 ? 0 : 7;
        const one = (r + d) * 8 + c;
        const promoAdd = (to, extra = {}) => { if (Math.floor(to / 8) === last) for (const p of ['Q', 'R', 'B', 'N']) add(to, { ...extra, promo: p }); else add(to, extra); };
        if (inB(r + d, c) && !b[one]) {
          promoAdd(one);
          const two = (r + 2 * d) * 8 + c;
          if (r === start && !b[two]) add(two, { double: true });
        }
        for (const dc of [-1, 1]) {
          if (!inB(r + d, c + dc)) continue;
          const to = (r + d) * 8 + c + dc;
          if (b[to] && color(b[to]) !== me) promoAdd(to);
          else if (to === s.ep) add(to, { ep: true });
        }
      } else if (t === 'N' || t === 'K') {
        for (const [dr, dc] of t === 'N' ? KN : KG) {
          if (!inB(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (!b[to] || color(b[to]) !== me) add(to);
        }
        if (t === 'K') {
          const row = me === 0 ? 56 : 0, rights = me === 0 ? s.castle.replace(/[a-z]/g, '') : s.castle.replace(/[A-Z]/g, '').toUpperCase();
          if (i === row + 4 && !chess.attacked(b, i, 1 - me)) {
            if (rights.includes('K') && !b[row + 5] && !b[row + 6] && b[row + 7] === pre + 'R' && !chess.attacked(b, row + 5, 1 - me) && !chess.attacked(b, row + 6, 1 - me)) add(row + 6, { castle: 'K' });
            if (rights.includes('Q') && !b[row + 3] && !b[row + 2] && !b[row + 1] && b[row] === pre + 'R' && !chess.attacked(b, row + 3, 1 - me) && !chess.attacked(b, row + 2, 1 - me)) add(row + 2, { castle: 'Q' });
          }
        }
      } else {
        const dirs = t === 'B' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : t === 'R' ? [[-1, 0], [1, 0], [0, -1], [0, 1]] : [...KG];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (inB(rr, cc)) {
            const to = rr * 8 + cc;
            if (b[to]) { if (color(b[to]) !== me) add(to); break; }
            add(to); rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  },
  make(s, m) { // no legality check, no repetition bookkeeping (fast path for search)
    const b = s.b.slice(), me = s.turn, pc = b[m.from];
    const n = { b, turn: 1 - me, castle: s.castle, ep: -1, half: s.half + 1, full: s.full + (me === 1 ? 1 : 0), keys: s.keys };
    if (pc[1] === 'P' || b[m.to]) n.half = 0;
    b[m.to] = m.promo ? pc[0] + m.promo : pc; b[m.from] = '';
    if (m.ep) b[m.to + (me === 0 ? 8 : -8)] = '';
    if (m.double) n.ep = (m.from + m.to) / 2;
    if (m.castle) { const row = me === 0 ? 56 : 0; if (m.castle === 'K') { b[row + 5] = b[row + 7]; b[row + 7] = ''; } else { b[row + 3] = b[row]; b[row] = ''; } }
    // castling rights
    const strip = (chars) => { for (const ch of chars) n.castle = n.castle.replace(ch, ''); };
    if (pc[1] === 'K') strip(me === 0 ? 'KQ' : 'kq');
    for (const [sq, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) strip(ch);
    return n;
  },
  moves(s) { return chess.pseudo(s).filter((m) => !chess.inCheck(chess.make(s, m), s.turn)); },
  apply(s, m) {
    const legal = chess.moves(s).find((x) => x.from === m.from && x.to === m.to && (x.promo || '') === (m.promo || ''));
    if (!legal) throw new Error('illegal move');
    const n = chess.make(s, legal);
    n.keys = [...(s.keys || []).slice(-120), chess.key(n)];
    n.last = [legal.from, legal.to];
    n.san = chess.san(s, legal);
    return n;
  },
  san(s, m) {
    const pc = s.b[m.from], file = 'abcdefgh', sq = (i) => file[i % 8] + (8 - Math.floor(i / 8));
    if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
    const cap = s.b[m.to] || m.ep ? 'x' : '';
    const n = chess.make(s, m);
    const check = chess.inCheck(n) ? (chess.moves(n).length ? '+' : '#') : '';
    return (pc[1] === 'P' ? (cap ? file[m.from % 8] : '') : pc[1]) + cap + sq(m.to) + (m.promo ? '=' + m.promo : '') + check;
  },
  result(s) {
    const ms = chess.moves(s);
    if (!ms.length) return chess.inCheck(s) ? { over: true, winner: 1 - s.turn, why: 'мат' } : { over: true, winner: null, why: 'пат' };
    if (s.half >= 100) return { over: true, winner: null, why: 'правило 50 ходів' };
    const k = chess.key(s);
    if ((s.keys || []).filter((x) => x === k).length >= 3) return { over: true, winner: null, why: 'триразове повторення' };
    const left = s.b.filter(Boolean).map((p) => p[1]).filter((t) => t !== 'K');
    if (!left.length || (left.length === 1 && (left[0] === 'B' || left[0] === 'N'))) return { over: true, winner: null, why: 'недостатньо матеріалу' };
    return { over: false };
  },
  eval(s, me) {
    let v = 0;
    for (let i = 0; i < 64; i++) {
      const pc = s.b[i]; if (!pc) continue;
      const side = color(pc), t = pc[1], idx = side === 0 ? i : (7 - Math.floor(i / 8)) * 8 + (i % 8);
      const w = PV[t] + PST[t][idx];
      v += side === me ? w : -w;
    }
    return v;
  },
  bot(s, level) {
    const ms = chess.moves(s);
    if (level === 'easy') {
      // a beginner: grabs a capture if it sees one, otherwise random
      const caps = ms.filter((m) => s.b[m.to]);
      return Math.random() < 0.6 && caps.length ? pick(caps) : pick(ms);
    }
    const depth = level === 'hard' ? 3 : 2, me = s.turn;
    const order = (st, list) => list.sort((a, b) => (st.b[b.to] ? PV[st.b[b.to][1]] : 0) - (st.b[a.to] ? PV[st.b[a.to][1]] : 0) + (b.promo ? 800 : 0) - (a.promo ? 800 : 0));
    // quiescence: follow captures so the bot doesn't hang pieces at the horizon
    const quies = (st, a, b, side, qd) => {
      const stand = side === me ? chess.eval(st, me) : -chess.eval(st, me);
      if (qd === 0) return stand;
      if (stand >= b) return b;
      if (stand > a) a = stand;
      const caps = order(st, chess.moves(st).filter((m) => st.b[m.to] || m.promo));
      for (const m of caps) {
        const v = -quies(chess.make(st, m), -b, -a, 1 - side, qd - 1);
        if (v >= b) return b;
        if (v > a) a = v;
      }
      return a;
    };
    const negamax = (st, d, a, b, side) => {
      const list = chess.moves(st);
      if (!list.length) return chess.inCheck(st) ? -100000 - d : 0;
      if (d === 0) return quies(st, a, b, side, level === 'hard' ? 4 : 2);
      for (const m of order(st, list)) {
        const v = -negamax(chess.make(st, m), d - 1, -b, -a, 1 - side);
        if (v >= b) return b;
        if (v > a) a = v;
      }
      return a;
    };
    // Variety comes from shuffling equal moves before ordering (sort is stable); the root
    // compares exact scores strictly — a cut-off bound must never beat a proven value.
    for (let i = ms.length - 1; i > 0; i--) { const j = rnd(i + 1); [ms[i], ms[j]] = [ms[j], ms[i]]; }
    let best = -Infinity, bestMove = null;
    for (const m of order(s, ms)) {
      const v = -negamax(chess.make(s, m), depth - 1, -Infinity, -best, 1 - me);
      if (v > best || !bestMove) { best = v; bestMove = m; }
    }
    return bestMove || pick(ms);
  },
  // perft for the unit tests
  perft(s, d) { if (!d) return 1; let n = 0; for (const m of chess.moves(s)) n += chess.perft(chess.make(s, m), d - 1); return n; },
};

// ════════════════════════════════════════ 2048 ═════
export const g2048 = {
  init() { let s = { g: Array(16).fill(0), score: 0, over: false }; s = g2048.spawn(g2048.spawn(s)); return s; },
  spawn(s) { const free = s.g.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); if (!free.length) return s; const n = clone(s); n.g[pick(free)] = Math.random() < 0.9 ? 2 : 4; return n; },
  move(s, dir) { // dir: 'left'|'right'|'up'|'down' → {s, moved}
    const n = clone(s); let moved = false;
    for (let k = 0; k < 4; k++) {
      const idx = [0, 1, 2, 3].map((j) => (dir === 'left' ? k * 4 + j : dir === 'right' ? k * 4 + 3 - j : dir === 'up' ? j * 4 + k : (3 - j) * 4 + k));
      const line = idx.map((i) => n.g[i]).filter(Boolean), out = [];
      for (let j = 0; j < line.length; j++) {
        if (line[j] === line[j + 1]) { out.push(line[j] * 2); n.score += line[j] * 2; j++; } else out.push(line[j]);
      }
      while (out.length < 4) out.push(0);
      idx.forEach((i, j) => { if (n.g[i] !== out[j]) moved = true; n.g[i] = out[j]; });
    }
    if (!moved) return { s, moved: false };
    const sp = g2048.spawn(n);
    sp.over = !['left', 'right', 'up', 'down'].some((d) => g2048.canMove(sp, d));
    return { s: sp, moved: true };
  },
  canMove(s, dir) {
    for (let k = 0; k < 4; k++) {
      const idx = [0, 1, 2, 3].map((j) => (dir === 'left' ? k * 4 + j : dir === 'right' ? k * 4 + 3 - j : dir === 'up' ? j * 4 + k : (3 - j) * 4 + k));
      for (let j = 1; j < 4; j++) { const a = s.g[idx[j - 1]], b = s.g[idx[j]]; if ((!a && b) || (a && a === b)) return true; }
    }
    return false;
  },
  best: (s) => Math.max(...s.g),
};

// ════════════════════════════════════════ Змійка ═════
export const snake = {
  W: 16, H: 16,
  init() { const s = { body: [[8, 8], [7, 8], [6, 8]], dir: [1, 0], next: [1, 0], food: null, score: 0, over: false }; s.food = snake.food(s); return s; },
  food(s) { const busy = new Set(s.body.map(([x, y]) => y * 16 + x)); const free = []; for (let i = 0; i < 256; i++) if (!busy.has(i)) free.push(i); const f = pick(free); return [f % 16, Math.floor(f / 16)]; },
  turn(s, dir) { const [dx, dy] = dir; if (dx === -s.dir[0] && dy === -s.dir[1]) return s; return { ...s, next: dir }; },
  step(s) {
    if (s.over) return s;
    const dir = s.next, [hx, hy] = s.body[0], head = [hx + dir[0], hy + dir[1]];
    const eat = head[0] === s.food[0] && head[1] === s.food[1];
    const body = [head, ...s.body.slice(0, eat ? undefined : -1)];
    const hit = head[0] < 0 || head[0] >= 16 || head[1] < 0 || head[1] >= 16 || body.slice(1).some(([x, y]) => x === head[0] && y === head[1]);
    if (hit) return { ...s, over: true };
    const n = { ...s, body, dir, score: s.score + (eat ? 10 : 0) };
    if (eat) n.food = snake.food(n);
    return n;
  },
  speed: (s) => Math.max(70, 170 - Math.floor(s.score / 30) * 10),
};

// ════════════════════════════════════════ Слово (українське Wordle) ═════
const WORDS_RAW = `абрис агент акція акула алмаз альбом аніме арена аркуш атлас афіша бабка багаж базар байка балка банан бочка бджола берег бетон білка бірка блиск бомба борщ брама брова будка буква бурак вафля вечір вежа верба весло вибір вигук видра вилка вишня вівця вітер вогонь вокал вугор гадка газон гілка глина голос гора горох гроза груша гумор дамба дата дебют двері дзвін дзеркало дошка дрова думка дятел жайвір жарти жилет жираф забор завод закон зірка злива змова зошит зуби ідеал іскра казка кабан кадри калач камін канал карта каска качка кашель квота кекс кефір кидок килим кінь кіоск класи клоун ключ книга кобра коза колір комар конус копія кошик краса кріль крило крона кубок кулак купон лава лавка лампа лапка ласка лелека лимон липа лист лісок лопух лотос лупа львів магма майка малюк манго марка маска масло мачта метро меню місто мішок мода молот монах мопед море мороз мотор мрія муха мушля м'яч ніжка нитка нірка новина ножиці носок обрій овоч огірок одяг ожина озеро окуляри олень опера орган осінь отрута павук пазл пакет палац панда папір парта паста пачка пенал перо печиво пиріг пісня плита площа побут поїзд полиця порив порох поштар праця промінь пташка пугач пульт пчола рамка ранок ребро режим рибак ринок робот рожа рокер ручка рядок садок салат сарай свято секта серце сирена сітка скеля слива слон смак сміх сокира сонце сосна спорт стіна струм сукня сфера табір танок тапки тачка театр тигр торба трава трюфель туман тюбик ураган успіх фарба фаза фасад ферма фініш флаер фонтан форма фрукт халат хвиля хижак хмара хокей хутро цибуля цирк чайка чашка чобіт чудо шабля шапка шарф шафа шахта швидко шкіра школа штора шуба щастя щітка юрба якір ящик`;
export const WORDS = [...new Set(WORDS_RAW.split(/\s+/).map((w) => w.trim()).filter((w) => /^[а-яіїєґ]{5}$/.test(w)))];
export const word = {
  KEYS: ['йцукенгшщзхї', 'фівапролджє', 'ячсмитьбюґ'],
  // The office word of the day: same for everyone, changes at midnight.
  daily(date = new Date()) { const d = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 864e5); return WORDS[(d * 7919) % WORDS.length]; },
  random: () => pick(WORDS),
  init: (answer) => ({ answer, rows: [], over: false, won: false }),
  // Per-letter marks with correct duplicate handling: 'g' green, 'y' yellow, 'x' grey.
  score(guess, answer) {
    const res = Array(5).fill('x'), left = {};
    for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) res[i] = 'g'; else left[answer[i]] = (left[answer[i]] || 0) + 1;
    for (let i = 0; i < 5; i++) if (res[i] !== 'g' && left[guess[i]]) { res[i] = 'y'; left[guess[i]]--; }
    return res;
  },
  guess(s, g) {
    g = g.toLowerCase();
    if (s.over || !/^[а-яіїєґ]{5}$/.test(g)) return s;
    const rows = [...s.rows, { g, m: word.score(g, s.answer) }];
    const won = g === s.answer;
    return { ...s, rows, won, over: won || rows.length >= 6 };
  },
  keyState(s) { // best mark seen per letter, for the on-screen keyboard
    const rank = { g: 3, y: 2, x: 1 }, out = {};
    for (const r of s.rows) r.g.split('').forEach((ch, i) => { if (!out[ch] || rank[r.m[i]] > rank[out[ch]]) out[ch] = r.m[i]; });
    return out;
  },
};
