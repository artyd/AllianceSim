import express from 'express';
import { query } from './db.js';
import { emit, online } from './realtime.js';
import { queueNotif } from './notify.js';
import { requireEditToken } from './auth.js';
import { postMessage, directChatId, chatRow, msgById, memberIds } from './chats.js';
import { kvGet, kvSet, hhmm } from './kv.js';

// Mini-games (spec 007). A `games` row is a room: lobby → active → done | cancelled.
// Duels keep a client-defined state; the server guards membership, move order
// (`state.turn` = player index, null = simultaneous phase) and races (`seq`).
// The quiz is run here (timers, hidden answers, bots). Bot/solo games run on the
// device and only post their result for the records.
export const games = express.Router();

export const KINDS = {
  ttt: { n: 'Хрестики-нулики', min: 2, max: 2 },
  sea: { n: 'Морський бій', min: 2, max: 2 },
  checkers: { n: 'Шашки', min: 2, max: 2 },
  chess: { n: 'Шахи', min: 2, max: 2 },
  quiz: { n: 'Вікторина', min: 2, max: 8 },
};
export const SOLO = { 2048: '2048', snake: 'Змійка', word: 'Слово' };
const DUELS = new Set(['ttt', 'sea', 'checkers', 'chess']);
const LEVELS = ['easy', 'mid', 'hard'];
const BOT_NAMES = ['Бот Бублик', 'Бот Кекс', 'Бот Пиксель', 'Бот Чіп', 'Бот Дейл', 'Бот Ватсон', 'Бот Шерлок'];
const bad = (res, error) => res.status(400).json({ error });
const nf = (res) => res.status(404).json({ error: 'not found' });
const isId = (v) => /^\d+$/.test(String(v));

// ── HR switch: games on/off + allowed windows (office wall clock) ─────────────
const DEF_SETTINGS = { enabled: true, windows: [] }; // windows: [{from:'12:00', to:'14:00'}]; [] = any time
const okTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));
export async function gameSettings(now = new Date()) {
  const s = { ...DEF_SETTINGS, ...(await kvGet('games', {})) };
  const t = hhmm(now);
  const open = !!s.enabled && (!s.windows.length || s.windows.some((w) => w.from <= t && t < w.to));
  return { enabled: !!s.enabled, windows: s.windows, open };
}

// ── shapes / storage ─────────────────────────────────────────────────────────
async function load(id) {
  if (!isId(id)) return null;
  const { rows: [g] } = await query('SELECT * FROM games WHERE id = $1', [id]);
  return g || null;
}
const humans = (g) => g.players.filter((p) => p.id).map((p) => p.id);
function pub(g, meId) {
  return {
    id: String(g.id), kind: g.kind, title: KINDS[g.kind].n, hostId: g.host_id, status: g.status,
    players: g.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot || null, state: p.state })),
    state: g.kind === 'quiz' ? quizView(g) : g.state, seq: g.seq, winner: g.winner,
    me: g.players.findIndex((p) => p.id && p.id === meId), createdAt: g.created_at, updatedAt: g.updated_at,
  };
}
async function save(g, fields) {
  const sets = [], vals = [g.id];
  for (const [k, v] of Object.entries(fields)) {
    vals.push(k === 'players' || k === 'state' ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
    g[k] = v;
  }
  sets.push('updated_at = now()');
  await query(`UPDATE games SET ${sets.join(', ')} WHERE id = $1`, vals);
}
async function push(g) {
  const fresh = await load(g.id);
  for (const id of humans(fresh)) emit([id], 'game', pub(fresh, id));
  return fresh;
}
// Per-room lock: moves, answers and timers touch one row → serialise them.
const locks = new Map();
function locked(id, fn) {
  const prev = locks.get(String(id)) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(String(id), next.catch(() => {}));
  return next;
}

// ── invites: a card in the 1:1 chat + Telegram with buttons + in-app banner ─
async function sendInvite(g, host, p) {
  const chat = await chatRow(await directChatId(host.id, p.id));
  const msg = await postMessage(chat, host, {
    text: `запрошує зіграти: ${KINDS[g.kind].n}`, kind: 'game',
    meta: { gameId: String(g.id), kind: g.kind, state: 'invited' },
  });
  await queueNotif(p.id, 'game_invite', {
    text: KINDS[g.kind].n, fromName: host.name,
    payload: {
      open: `game_${g.id}`, openText: '🎮 Відкрити гру',
      buttons: [{ text: '✅ Прийняти', data: `gm:acc:${g.id}` }, { text: '❌ Відхилити', data: `gm:dec:${g.id}` }],
    },
  });
  emit([p.id], 'game_invite', { gameId: String(g.id), kind: g.kind, title: KINDS[g.kind].n, from: host.name, fromId: host.id });
  return msg.id;
}
async function inviteCard(p, state) {
  if (!p.msgId) return;
  await query(`UPDATE messages SET meta = jsonb_set(meta, '{state}', to_jsonb($2::text)) WHERE id = $1`, [p.msgId, state]);
  const msg = await msgById(p.msgId);
  emit(await memberIds(msg.chatId), 'message_update', msg);
}

// ── routes ───────────────────────────────────────────────────────────────────
games.get('/me/games/config', async (_req, res, next) => {
  try { res.json({ ...(await gameSettings()), kinds: KINDS, solo: SOLO, levels: LEVELS }); } catch (err) { next(err); }
});

// Colleagues online right now (phone open with the live stream), with "in a game" flag.
games.get('/me/online', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, department FROM employees WHERE telegram_id IS NOT NULL AND id <> $1 ORDER BY name', [req.me.id]);
    const live = rows.filter((r) => online(r.id));
    const { rows: busy } = await query(`SELECT players FROM games WHERE status = 'active'`);
    const playing = new Set(busy.flatMap((b) => b.players.filter((p) => p.id && p.state !== 'left').map((p) => p.id)));
    res.json(live.map((r) => ({ id: r.id, name: r.name, dept: r.department, inGame: playing.has(r.id) })));
  } catch (err) { next(err); }
});

games.get('/me/games', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM games WHERE players @> $1::jsonb AND (status IN ('lobby','active') OR updated_at > now() - interval '1 day')
       ORDER BY updated_at DESC LIMIT 20`, [JSON.stringify([{ id: req.me.id }])]);
    res.json(rows.map((g) => pub(g, req.me.id)));
  } catch (err) { next(err); }
});

games.get('/me/games/:id', async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next(); // /me/games/leaderboard etc.
    const g = await load(req.params.id);
    if (!g || !g.players.some((p) => p.id === req.me.id)) return nf(res);
    res.json(pub(g, req.me.id));
  } catch (err) { next(err); }
});

games.post('/me/games', async (req, res, next) => {
  try {
    const b = req.body || {};
    const kind = String(b.kind || ''), K = KINDS[kind];
    if (!K) return bad(res, 'unknown game');
    const st = await gameSettings();
    if (!st.open) return res.status(403).json({ error: 'games are closed now', settings: st });
    const invite = [...new Set((Array.isArray(b.invite) ? b.invite : []).map(String))].filter((id) => id !== req.me.id);
    const bots = kind === 'quiz' ? Math.max(0, Math.min(K.max - 1, Number(b.bots) || 0)) : 0;
    const level = LEVELS.includes(b.level) ? b.level : 'mid';
    if (1 + invite.length + bots > K.max) return bad(res, 'too many players');
    if (!invite.length && !bots) return bad(res, 'invite a colleague (bot duels run on the device)');
    const { rows: people } = invite.length
      ? await query('SELECT id, name FROM employees WHERE id = ANY($1::text[]) AND telegram_id IS NOT NULL', [invite])
      : { rows: [] };
    if (people.length !== invite.length) return res.status(404).json({ error: 'colleague is not in the bot yet' });
    const players = [
      { id: req.me.id, name: req.me.name, state: 'host' },
      ...people.map((p) => ({ id: p.id, name: p.name, state: 'invited' })),
      ...Array.from({ length: bots }, (_, i) => ({ id: null, name: BOT_NAMES[i % BOT_NAMES.length], bot: level, state: 'accepted' })),
    ];
    const { rows: [g] } = await query('INSERT INTO games (kind, host_id, players) VALUES ($1, $2, $3) RETURNING *',
      [kind, req.me.id, JSON.stringify(players)]);
    for (const p of g.players) if (p.state === 'invited') p.msgId = String(await sendInvite(g, req.me, p));
    await save(g, { players: g.players });
    if (!invite.length) await start(g.id); // a quiz with bots only starts right away
    res.status(201).json(pub(await push(g), req.me.id));
  } catch (err) { next(err); }
});

// Accept / decline an invite (app, chat card or Telegram button).
export async function respond(meId, id, accept) {
  return locked(id, async () => {
    const g = await load(id);
    if (!g) return null;
    const i = g.players.findIndex((p) => p.id === meId && p.state === 'invited');
    if (i < 0) return g.players.some((p) => p.id === meId) ? 'gone' : null;
    if (g.status !== 'lobby') return 'gone';
    g.players[i].state = accept ? 'accepted' : 'declined';
    await save(g, { players: g.players });
    await inviteCard(g.players[i], g.players[i].state);
    const host = g.players[0];
    if (!accept) {
      await queueNotif(host.id, 'game_declined', { text: KINDS[g.kind].n, fromName: g.players[i].name, payload: { open: 'games' } });
      if (DUELS.has(g.kind)) await save(g, { status: 'cancelled' });
    } else if (DUELS.has(g.kind)) {
      await startNow(g);
    }
    return push(g);
  });
}
games.post('/me/games/:id/respond', async (req, res, next) => {
  try {
    const g = await respond(req.me.id, req.params.id, !!(req.body || {}).accept);
    if (g === null) return nf(res);
    if (g === 'gone') return res.status(409).json({ error: 'invite is no longer active' });
    res.json(pub(g, req.me.id));
  } catch (err) { next(err); }
});
games.post('/bot/games/:id/respond', requireEditToken, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: [e] } = await query('SELECT id FROM employees WHERE telegram_id = $1', [String(b.tgId || '')]);
    const g = e ? await respond(e.id, req.params.id, !!b.accept) : null;
    if (g === null) return nf(res);
    if (g === 'gone') return res.status(409).json({ error: 'invite is no longer active' });
    res.json({ ok: true, status: g.status, kind: g.kind, title: KINDS[g.kind].n });
  } catch (err) { next(err); }
});

// Host starts a quiz lobby once at least two seats are filled (people who haven't
// answered the invite are dropped).
games.post('/me/games/:id/start', async (req, res, next) => {
  try {
    const out = await locked(req.params.id, async () => {
      const g = await load(req.params.id);
      if (!g || g.host_id !== req.me.id) return null;
      if (g.status !== 'lobby') return 'gone';
      const seated = g.players.filter((p) => ['host', 'accepted'].includes(p.state));
      if (seated.length < KINDS[g.kind].min) return 'few';
      await startNow(g);
      return push(g);
    });
    if (out === null) return nf(res);
    if (out === 'gone') return res.status(409).json({ error: 'already started' });
    if (out === 'few') return bad(res, 'need at least 2 players');
    res.json(pub(out, req.me.id));
  } catch (err) { next(err); }
});
async function start(id) { return locked(id, async () => { const g = await load(id); if (g && g.status === 'lobby') { await startNow(g); await push(g); } }); }
async function startNow(g) {
  for (const p of g.players) if (p.state === 'invited') await inviteCard(p, 'expired');
  const players = g.players.filter((p) => ['host', 'accepted'].includes(p.state)).map((p) => ({ ...p, state: 'playing' }));
  if (g.kind === 'quiz') {
    const qs = await buildQuestions();
    await save(g, { status: 'active', players, state: { phase: 'q', i: 0, qs, deadline: Date.now() + QUIZ_Q, picks: {}, scores: players.map(() => 0) } });
    scheduleQuiz(g);
  } else {
    // Duels: the clients build the opening position; host (index 0) moves first.
    await save(g, { status: 'active', players, state: null });
  }
}

// A move in a duel: whole new state (client rules), checked for turn + staleness.
games.post('/me/games/:id/move', async (req, res, next) => {
  try {
    const b = req.body || {};
    const out = await locked(req.params.id, async () => {
      const g = await load(req.params.id);
      if (!g) return { code: 404 };
      const idx = g.players.findIndex((p) => p.id === req.me.id);
      if (idx < 0) return { code: 404 };
      if (g.status !== 'active' || !DUELS.has(g.kind)) return { code: 409, error: 'game is not active', g };
      if (Number(b.seq) !== g.seq) return { code: 409, error: 'stale', g };
      const turn = g.state && g.state.turn;
      if (turn != null && turn !== idx) return { code: 409, error: 'not your turn', g };
      if (!b.state || typeof b.state !== 'object' || JSON.stringify(b.state).length > 60000) return { code: 400, error: 'state required' };
      const fields = { state: b.state, seq: g.seq + 1 };
      if (b.result) { fields.status = 'done'; fields.winner = Number.isInteger(b.result.winner) && b.result.winner < g.players.length ? b.result.winner : null; }
      await save(g, fields);
      if (b.result) await recordDuel(g);
      return { g: await push(g) };
    });
    if (out.code === 404) return nf(res);
    if (out.code) return res.status(out.code).json({ error: out.error, game: out.g ? pub(out.g, req.me.id) : undefined });
    res.json(pub(out.g, req.me.id));
  } catch (err) { next(err); }
});

// Leave: host cancels a lobby, a guest declines it; leaving a running duel = resign.
games.post('/me/games/:id/leave', async (req, res, next) => {
  try {
    const out = await locked(req.params.id, async () => {
      const g = await load(req.params.id);
      if (!g) return null;
      const idx = g.players.findIndex((p) => p.id === req.me.id);
      if (idx < 0) return null;
      if (g.status === 'lobby') {
        if (g.host_id === req.me.id) {
          for (const p of g.players) if (p.state === 'invited') await inviteCard(p, 'cancelled');
          await save(g, { status: 'cancelled' });
        } else {
          g.players[idx].state = 'declined';
          await inviteCard(g.players[idx], 'declined');
          await save(g, { players: g.players, ...(DUELS.has(g.kind) ? { status: 'cancelled' } : {}) });
        }
      } else if (g.status === 'active') {
        g.players[idx].state = 'left';
        if (DUELS.has(g.kind)) {
          await save(g, { players: g.players, status: 'done', winner: idx === 0 ? 1 : 0 });
          await recordDuel(g);
        } else {
          await save(g, { players: g.players });
          if (!g.players.some((p) => p.id && p.state === 'playing')) { clearTimeout(timers.get(String(g.id))); await save(g, { status: 'cancelled' }); }
        }
      }
      return push(g);
    });
    if (!out) return nf(res);
    res.json(pub(out, req.me.id));
  } catch (err) { next(err); }
});

// ── records & leaderboard ────────────────────────────────────────────────────
async function recordDuel(g) {
  for (const [i, p] of g.players.entries()) {
    if (!p.id) continue;
    const outcome = g.winner == null ? 'draw' : g.winner === i ? 'win' : 'loss';
    await query('INSERT INTO game_scores (employee_id, kind, outcome, vs, score, game_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [p.id, g.kind, outcome, 'human', 0, g.id]);
  }
}
// Bot duels and solo games run on the device and post their outcome here.
games.post('/me/games/result', async (req, res, next) => {
  try {
    const b = req.body || {};
    const kind = String(b.kind || '');
    const solo = kind in SOLO;
    if (!solo && !DUELS.has(kind)) return bad(res, 'unknown game');
    const outcome = solo ? 'score' : ['win', 'loss', 'draw'].includes(b.outcome) ? b.outcome : null;
    if (!outcome) return bad(res, 'outcome required');
    const score = Math.max(0, Math.min(1e7, Math.round(Number(b.score) || 0)));
    await query('INSERT INTO game_scores (employee_id, kind, outcome, vs, score) VALUES ($1, $2, $3, $4, $5)',
      [req.me.id, kind, outcome, solo ? 'solo' : 'bot', score]);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});
games.get('/me/games/leaderboard', async (req, res, next) => {
  try {
    const since = req.query.period === 'all' ? new Date(0) : new Date(Date.now() - 7 * 864e5);
    const names = new Map((await query('SELECT id, name FROM employees')).rows.map((r) => [r.id, r.name]));
    const named = (rows) => rows.map((r) => ({ ...r, name: names.get(r.employee_id) || 'Колега' }));
    const { rows: pvp } = await query(
      `SELECT employee_id, SUM(CASE outcome WHEN 'win' THEN 3 WHEN 'draw' THEN 1 ELSE 0 END)::int AS points,
              COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins, COUNT(*)::int AS games
       FROM game_scores WHERE vs = 'human' AND kind <> 'quiz' AND created_at >= $1
       GROUP BY employee_id ORDER BY points DESC, wins DESC LIMIT 10`, [since]);
    const { rows: quiz } = await query(
      `SELECT employee_id, SUM(score)::int AS points, COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins
       FROM game_scores WHERE kind = 'quiz' AND created_at >= $1 GROUP BY employee_id ORDER BY points DESC LIMIT 10`, [since]);
    const solo = {};
    for (const k of Object.keys(SOLO)) {
      const { rows } = await query(
        `SELECT employee_id, MAX(score)::int AS best FROM game_scores WHERE kind = $1 AND vs = 'solo' AND created_at >= $2
         GROUP BY employee_id ORDER BY best ${k === 'word' ? 'ASC' : 'DESC'} LIMIT 5`, [k, since]);
      solo[k] = named(rows);
    }
    const { rows: [mine] } = await query(
      `SELECT COUNT(*) FILTER (WHERE vs = 'human' AND outcome = 'win')::int AS pvp_wins,
              COUNT(*) FILTER (WHERE vs = 'bot' AND outcome = 'win')::int AS bot_wins,
              COUNT(*) FILTER (WHERE vs IN ('human','bot'))::int AS games,
              COALESCE(SUM(score) FILTER (WHERE kind = 'quiz'), 0)::int AS quiz_points
       FROM game_scores WHERE employee_id = $1`, [req.me.id]);
    const { rows: bests } = await query(
      `SELECT kind, MAX(score)::int AS best, MIN(score)::int AS least FROM game_scores WHERE employee_id = $1 AND vs = 'solo' GROUP BY kind`, [req.me.id]);
    res.json({ period: req.query.period === 'all' ? 'all' : 'week', pvp: named(pvp), quiz: named(quiz), solo,
      me: { ...mine, best: Object.fromEntries(bests.map((b) => [b.kind, b.kind === 'word' ? b.least : b.best])) } });
  } catch (err) { next(err); }
});

// ── HR: schedule + quiz questions ────────────────────────────────────────────
games.get('/games/settings', requireEditToken, async (_req, res, next) => {
  try { res.json({ ...(await gameSettings()), quiz: await kvGet('quiz', []) }); } catch (err) { next(err); }
});
games.put('/games/settings', requireEditToken, async (req, res, next) => {
  try {
    const b = req.body || {};
    const windows = (Array.isArray(b.windows) ? b.windows : []).filter((w) => w && okTime(w.from) && okTime(w.to) && w.from < w.to).slice(0, 6)
      .map((w) => ({ from: w.from, to: w.to }));
    await kvSet('games', { enabled: b.enabled !== false, windows });
    if (Array.isArray(b.quiz)) {
      const quiz = b.quiz.map((q) => ({ q: String(q.q || '').trim().slice(0, 200), options: (q.options || []).map((o) => String(o || '').trim().slice(0, 80)).filter(Boolean).slice(0, 4), answer: Number(q.answer) || 0 }))
        .filter((q) => q.q && q.options.length >= 2 && q.answer < q.options.length).slice(0, 200);
      await kvSet('quiz', quiz);
    }
    res.json({ ...(await gameSettings()), quiz: await kvGet('quiz', []) });
  } catch (err) { next(err); }
});

// ── quiz engine ──────────────────────────────────────────────────────────────
const QUIZ_Q = Number(process.env.QUIZ_Q_MS || 15000);
const QUIZ_REVEAL = Number(process.env.QUIZ_REVEAL_MS || 3500);
const QUIZ_N = Number(process.env.QUIZ_N || 7);
const BOT_ACC = { easy: 0.4, mid: 0.65, hard: 0.85 };
const timers = new Map();
const GENERAL = [
  ['Столиця України?', ['Київ', 'Львів', 'Харків', 'Одеса']],
  ['Скільки хвилин у годині?', ['60', '100', '30', '90']],
  ['Яка найдовша річка України?', ['Дніпро', 'Дністер', 'Південний Буг', 'Десна']],
  ['Скільки гравців у футбольній команді на полі?', ['11', '9', '10', '12']],
  ['Що з цього — мова програмування?', ['Python', 'Photoshop', 'Excel', 'Figma']],
  ['Скільки днів у високосному році?', ['366', '365', '364', '360']],
  ['Найвища гора України?', ['Говерла', 'Петрос', 'Піп Іван', 'Бребенескул']],
  ['Скільки байтів у кілобайті (KiB)?', ['1024', '1000', '512', '2048']],
  ['Хто автор «Кобзаря»?', ['Тарас Шевченко', 'Іван Франко', 'Леся Українка', 'Панас Мирний']],
  ['Яка планета найближча до Сонця?', ['Меркурій', 'Венера', 'Марс', 'Земля']],
  ['Що означає «ASAP»?', ['Якнайшвидше', 'Після обіду', 'На наступному тижні', 'Ніколи']],
  ['Скільки кольорів у веселці?', ['7', '6', '8', '5']],
  ['Який напій готують з еспресо і молочної піни?', ['Капучино', 'Американо', 'Ристрето', 'Лунго']],
  ['Скільки секунд у хвилині?', ['60', '100', '30', '120']],
  ['Яке море омиває Одесу?', ['Чорне', 'Азовське', 'Балтійське', 'Середземне']],
  ['Комбінація для копіювання тексту на Windows?', ['Ctrl+C', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+X']],
  ['Найбільший океан Землі?', ['Тихий', 'Атлантичний', 'Індійський', 'Північний Льодовитий']],
  ['Скільки областей в Україні?', ['24', '25', '23', '27']],
  ['Що з цього — не браузер?', ['Word', 'Chrome', 'Firefox', 'Safari']],
  ['Скільки тижнів у році (приблизно)?', ['52', '48', '50', '54']],
];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function mk(q, opts) { const right = opts[0]; const options = shuffle(opts.slice()); return { q, options, answer: options.indexOf(right) }; }
async function buildQuestions() {
  const { rows: emps } = await query(`SELECT name, department FROM employees WHERE department IS NOT NULL AND department <> ''`);
  const depts = [...new Set(emps.map((e) => e.department))];
  const office = [];
  if (depts.length >= 2) {
    for (const e of shuffle(emps.slice()).slice(0, 4)) {
      const wrong = shuffle(depts.filter((d) => d !== e.department)).slice(0, 3);
      office.push(mk(`У якому відділі працює ${e.name}?`, [e.department, ...wrong]));
    }
    for (const d of shuffle(depts.slice()).slice(0, 2)) {
      const inD = emps.filter((e) => e.department === d), outD = emps.filter((e) => e.department !== d);
      if (inD.length && outD.length >= 3) office.push(mk(`Хто з колег працює у відділі «${d}»?`, [shuffle(inD)[0].name, ...shuffle(outD.map((e) => e.name)).slice(0, 3)]));
    }
  }
  const custom = (await kvGet('quiz', [])).map((q) => { const opts = q.options.slice(); const right = opts.splice(q.answer, 1)[0]; return mk(q.q, [right, ...opts]); });
  const general = GENERAL.map(([q, o]) => mk(q, o));
  const pool = shuffle([...custom, ...custom, ...office, ...general]); // HR questions twice as likely
  const seen = new Set(), out = [];
  for (const q of pool) { if (seen.has(q.q)) continue; seen.add(q.q); out.push(q); if (out.length >= QUIZ_N) break; }
  return out;
}
// What players see: the current question without its answer until the reveal.
function quizView(g) {
  const s = g.state;
  if (!s) return null;
  const q = s.qs[s.i];
  const reveal = s.phase !== 'q';
  return {
    phase: s.phase, i: s.i, n: s.qs.length, deadline: s.deadline, scores: s.scores,
    q: q ? { q: q.q, options: q.options } : null,
    answer: reveal && q ? q.answer : null,
    answered: Object.keys(s.picks).map(Number),
    picks: reveal ? s.picks : null,
  };
}
function scheduleQuiz(g) {
  clearTimeout(timers.get(String(g.id)));
  const s = g.state;
  if (s.phase === 'q') {
    // bots think, then answer with level-based accuracy
    g.players.forEach((p, i) => {
      if (!p.bot) return;
      const delay = QUIZ_Q * (0.25 + Math.random() * 0.5);
      setTimeout(() => answer(g.id, i, Math.random() < (BOT_ACC[p.bot] || 0.6) ? s.qs[s.i].answer : (s.qs[s.i].answer + 1 + Math.floor(Math.random() * 3)) % s.qs[s.i].options.length, s.i).catch(() => {}), delay);
    });
  }
  timers.set(String(g.id), setTimeout(() => advance(g.id).catch((e) => console.error('[quiz]', e.message)), Math.max(0, s.deadline - Date.now())));
}
async function advance(id, onlyIfQuestion = null) {
  return locked(id, async () => {
    const g = await load(id);
    if (!g || g.status !== 'active' || g.kind !== 'quiz') return;
    const s = g.state;
    if (onlyIfQuestion != null && (s.phase !== 'q' || s.i !== onlyIfQuestion)) return;
    if (s.phase === 'q') {
      const q = s.qs[s.i];
      for (const [k, pk] of Object.entries(s.picks)) if (pk.o === q.answer) s.scores[k] += 100 + Math.round(50 * Math.max(0, pk.left) / QUIZ_Q);
      s.phase = 'reveal'; s.deadline = Date.now() + QUIZ_REVEAL;
      await save(g, { state: s, seq: g.seq + 1 });
    } else if (s.i + 1 < s.qs.length) {
      s.i += 1; s.phase = 'q'; s.picks = {}; s.deadline = Date.now() + QUIZ_Q;
      await save(g, { state: s, seq: g.seq + 1 });
    } else {
      s.phase = 'end';
      const best = Math.max(...s.scores), winners = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
      await save(g, { state: s, seq: g.seq + 1, status: 'done', winner: winners.length === 1 ? winners[0] : null });
      for (const [i, p] of g.players.entries()) {
        if (!p.id) continue;
        await query('INSERT INTO game_scores (employee_id, kind, outcome, vs, score, game_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [p.id, 'quiz', g.winner === i ? 'win' : 'loss', 'human', s.scores[i], g.id]);
      }
      timers.delete(String(g.id));
      await push(g);
      return;
    }
    scheduleQuiz(g);
    await push(g);
  });
}
async function answer(id, idx, option, qi) {
  const allIn = await locked(id, async () => {
    const g = await load(id);
    if (!g || g.status !== 'active' || g.kind !== 'quiz') return 'gone';
    const s = g.state;
    if (s.phase !== 'q' || (qi != null && qi !== s.i) || s.picks[idx]) return 'late';
    const o = Number(option);
    if (!Number.isInteger(o) || o < 0 || o >= s.qs[s.i].options.length) return 'bad';
    s.picks[idx] = { o, left: s.deadline - Date.now() };
    await save(g, { state: s, seq: g.seq + 1 });
    await push(g);
    const seated = g.players.map((p, i) => (p.state === 'playing' ? i : -1)).filter((i) => i >= 0);
    return seated.every((i) => s.picks[i]) ? s.i : false;
  });
  if (typeof allIn === 'number') await advance(id, allIn); // everyone answered → reveal now
  return allIn;
}
games.post('/me/games/:id/answer', async (req, res, next) => {
  try {
    const g = await load(req.params.id);
    const idx = g ? g.players.findIndex((p) => p.id === req.me.id) : -1;
    if (idx < 0) return nf(res);
    const r = await answer(g.id, idx, (req.body || {}).option, null);
    if (r === 'bad') return bad(res, 'option invalid');
    if (r === 'gone' || r === 'late') return res.status(409).json({ error: 'too late' });
    res.json(pub(await load(g.id), req.me.id));
  } catch (err) { next(err); }
});

// Quiz timers live in memory — a restart abandons the running ones.
export async function initGames() {
  await query(`UPDATE games SET status = 'cancelled', updated_at = now() WHERE kind = 'quiz' AND status = 'active'`);
}
