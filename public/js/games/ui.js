// AllianceOS «Ігри» (spec 007): catalogue, bot/colleague setup, lobby, boards, leaderboard,
// invites (island banner + chat card). Rules/bots live in games-engines.js; the phone
// (phone.js) wires this in through initGamesUI(ctx) and forwards live events.
import { ttt, sea, checkers, chess, g2048, snake, word, LEVEL_N } from './engines.js';

export function initGamesUI(X) {
  const { meApi, toast, haptic, hapticOk, wire, go, back, pop, popIf, scr, body, esc, personal, TG, emp, avHTML, IC, islandTemp, islandEnd, segHTML, CHEV, empty, stackTop, load, save } = X;
  for (const id of ['games', 'gsetup', 'lobby', 'game', 'gtop']) if (!scr(id)) body.insertAdjacentHTML('beforeend', `<div class="pscreen" data-scr="${id}"></div>`);

  const KIND = {
    ttt: { n: 'Хрестики-нулики', who: '2 гравці', g1: '#FF6B78', g2: '#C8001A', ic: '<svg viewBox="0 0 24 24"><path d="M4 4l6 6M10 4l-6 6"/><circle cx="17" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><path d="M14 14l6 6M20 14l-6 6"/></svg>' },
    sea: { n: 'Морський бій', who: '2 гравці', g1: '#5CC8F0', g2: '#1F6FD6', ic: '<svg viewBox="0 0 24 24"><path d="M3 15h18l-2.5 4h-13Z"/><path d="M6 15V9h7l3 6M9 9V5l4 2-4 2"/></svg>' },
    checkers: { n: 'Шашки', who: '2 гравці', g1: '#B98CF0', g2: '#6E3BC9', ic: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9" rx="7" ry="3"/><path d="M5 9v4c0 1.7 3.1 3 7 3s7-1.3 7-3V9"/><path d="M5 15v2c0 1.7 3.1 3 7 3s7-1.3 7-3v-2"/></svg>' },
    chess: { n: 'Шахи', who: '2 гравці', g1: '#6B7280', g2: '#1F2937', ic: '<svg viewBox="0 0 24 24"><path d="M9 21h6M8 18h8l-1-6h-6Z"/><path d="M9 12 7 6h10l-2 6M10 6V3h4v3"/></svg>' },
    quiz: { n: 'Вікторина', who: '2–8 гравців', g1: '#FFC163', g2: '#F27B1A', ic: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>' },
    2048: { n: '2048', who: 'Соло', g1: '#F5C26B', g2: '#D9822B', ic: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>' },
    snake: { n: 'Змійка', who: 'Соло', g1: '#6FE08E', g2: '#16917A', ic: '<svg viewBox="0 0 24 24"><path d="M4 18h9a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h9"/><circle cx="19" cy="6" r="1.2"/></svg>' },
    word: { n: 'Слово', who: 'Соло · слово дня', g1: '#4FE0BC', g2: '#1A8F7A', ic: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="6" height="10" rx="1.5"/><rect x="9" y="7" width="6" height="10" rx="1.5"/><rect x="16" y="7" width="6" height="10" rx="1.5"/></svg>' },
  };
  const DUEL = new Set(['ttt', 'sea', 'checkers', 'chess']);
  const SOLO = new Set(['2048', 'snake', 'word']);
  const icHTML = (k, cls = '') => `<span class="gic ${cls}" style="--g1:${KIND[k].g1};--g2:${KIND[k].g2}">${KIND[k].ic}</span>`;
  const trophy = '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/></svg>';
  const gHead = (t, act = '') => `<div class="phead"><button class="bk" data-back aria-label="Назад">${IC.back}<span class="bl">Ігри</span></button><div class="ti">${esc(t)}</div><div class="sp"></div>${act}</div>`;
  let CFG = null;
  const config = async () => { if (personal()) { try { CFG = await meApi('GET', '/me/games/config'); } catch (e) {} } return CFG; };
  const winText = (c) => (c && c.windows && c.windows.length ? c.windows.map((w) => `${w.from}–${w.to}`).join(', ') : '');
  const postResult = (kind, body) => { if (personal()) meApi('POST', '/me/games/result', { kind, ...body }).catch(() => {}); };
  const bestKey = (k) => `alliancesim.games.best.${k}`;

  // ════════ catalogue ════════
  async function games(s) {
    const p = personal();
    s.innerHTML = gHead('Ігри', `<button class="tbtn gtrophy" data-top aria-label="Таблиця лідерів">${trophy}</button>`) + `<h1 class="plt">Ігри</h1><div class="pscroll" data-list></div>`;
    s.querySelector('.phead .bl').textContent = 'Додому';
    const box = s.querySelector('[data-list]');
    const card = (k) => `<button type="button" class="gcard" data-k="${k}">${icHTML(k)}<b>${KIND[k].n}</b><span>${SOLO.has(k) ? (k === 'word' ? (load(bestKey(k), 0) ? 'Рекорд: ' + load(bestKey(k), 0) + ' спроб' : KIND[k].who) : (load(bestKey(k), 0) ? 'Рекорд: ' + load(bestKey(k), 0) : KIND[k].who)) : KIND[k].who}</span></button>`;
    const draw = (mine, cfg) => {
      const closed = cfg && !cfg.open;
      box.innerHTML = (closed ? `<div class="gban"><b>${cfg.enabled ? 'Ігри зараз на паузі' : 'Ігри вимкнені HR'}</b><span>${cfg.enabled ? 'Доступні: ' + esc(winText(cfg)) : 'Соло-ігри працюють, змагання з колегами — ні.'}</span></div>` : '')
        + (mine && mine.length ? `<div class="pgt">Мої партії</div><div class="pgrp">${mine.map((g) => {
          const opp = g.players.filter((x, i) => i !== g.me).map((x) => x.name).join(', ');
          const st = g.status === 'lobby' ? (g.players[g.me] && g.players[g.me].state === 'invited' ? 'Вас запрошено' : 'Очікує гравців') : g.status === 'active' ? (g.kind === 'quiz' ? 'Іде гра' : (g.state && g.state.turn === g.me) || (!g.state && g.me === 0) ? 'Ваш хід' : 'Хід суперника') : g.winner == null ? 'Нічия' : g.winner === g.me ? 'Перемога' : 'Поразка';
          return `<button type="button" class="pfrow grow" data-g="${g.id}">${icHTML(g.kind, 'sm')}<span class="t"><b>${esc(g.title)}</b><span>${esc(opp || '—')}</span></span><span class="v ${st === 'Ваш хід' || st === 'Вас запрошено' ? 'hot' : ''}">${st}</span>${CHEV}</button>`;
        }).join('')}</div>` : '')
        + `<div class="pgt">Разом</div><div class="ggrid">${['ttt', 'sea', 'checkers', 'chess', 'quiz'].map(card).join('')}</div>`
        + `<div class="pgt">Соло</div><div class="ggrid">${['2048', 'snake', 'word'].map(card).join('')}</div>`
        + (p ? '' : '<div class="pnote">Гра з колегами та таблиця лідерів — у Telegram-боті. Тут можна грати з ботом і соло.</div>');
      box.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { haptic(); const k = b.dataset.k; if (SOLO.has(k)) go('game', (x) => openLocal(x, k)); else go('gsetup', (x) => gsetup(x, k)); });
      box.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => openRoom(b.dataset.g));
    };
    draw(null, CFG);
    s.querySelector('[data-top]').onclick = () => go('gtop', gtop);
    s._redraw = async () => { const [mine, cfg] = await Promise.all([p ? meApi('GET', '/me/games').catch(() => []) : [], config()]); if (stackTop() === 'games' || stackTop() === undefined || true) draw(mine.filter((g) => g.status === 'lobby' || g.status === 'active' || Date.now() - new Date(g.updatedAt) < 3600e3), cfg); };
    s._redraw();
    wire(s);
  }

  // ════════ setup: bot or colleagues ════════
  async function gsetup(s, k) {
    const duel = DUEL.has(k), p = personal();
    let mode = p ? 'people' : 'bot', level = load('alliancesim.games.level', 'mid'), picked = new Set(), bots = k === 'quiz' ? 2 : 0, online = null;
    const draw = () => {
      s.innerHTML = gHead(KIND[k].n) + `<div class="pscroll"><div class="gsetup">
        <div class="gshero">${icHTML(k, 'lg')}<b>${KIND[k].n}</b><span>${KIND[k].who}</span></div>
        ${duel ? segHTML('data-mode', [['bot', 'З ботом'], ['people', 'З колегою']], mode) : ''}
        ${(duel && mode === 'bot') || k === 'quiz' ? `<div class="pgt">Рівень бота</div>${segHTML('data-level', Object.entries(LEVEL_N), level)}` : ''}
        ${k === 'quiz' ? `<div class="pgt">Боти</div><div class="pgrp"><div class="pset gstep"><span class="t"><span class="l">Ботів у лобі</span><button type="button" class="gsb" data-bm aria-label="Менше ботів">−</button><b data-bn>${bots}</b><button type="button" class="gsb" data-bp aria-label="Більше ботів">+</button></span></div></div>` : ''}
        ${(!duel || mode === 'people') ? `<div class="pgt">Колеги в мережі${online ? ' · ' + online.length : ''}</div><div class="pgrp" data-on>${!p ? '<div class="gempty">Доступно в Telegram-боті</div>' : online == null ? '<div class="gempty">Завантаження…</div>' : online.length ? online.map((o) => {
          const e = emp(o.id) || { id: o.id, name: o.name, color: '#5B76E6' };
          return `<button type="button" class="prow gpick" data-id="${o.id}" aria-pressed="${picked.has(o.id)}" ${o.inGame ? 'disabled' : ''}>${avHTML(e)}<div class="tx"><div class="nm">${esc(o.name)}</div><div class="sub">${o.inGame ? 'Зараз у грі' : esc(o.dept || 'онлайн')}</div></div><span class="chk"></span></button>`;
        }).join('') : '<div class="gempty">Зараз ніхто з колег не в мережі.<br>Запросіть, коли хтось відкриє телефон, або зіграйте з ботом.</div>'}</div>` : ''}
      </div></div><div class="pfoot"><button class="pbtn" data-go-play>${duel && mode === 'bot' ? 'Грати з ботом' : k === 'quiz' ? 'Створити лобі' : 'Запросити'}</button></div>`;
      const ms = s.querySelector('[data-mode]'); if (ms) ms.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { mode = b.dataset.v; draw(); });
      const ls = s.querySelector('[data-level]'); if (ls) ls.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { level = b.dataset.v; save('alliancesim.games.level', level); haptic(); draw(); });
      const bm = s.querySelector('[data-bm]'); if (bm) { bm.onclick = () => { bots = Math.max(0, bots - 1); draw(); }; s.querySelector('[data-bp]').onclick = () => { bots = Math.min(7 - picked.size, bots + 1); draw(); }; }
      s.querySelectorAll('.gpick').forEach((b) => b.onclick = () => {
        haptic(); const id = b.dataset.id;
        if (picked.has(id)) picked.delete(id); else { if (duel) picked.clear(); if (k === 'quiz' && picked.size + bots >= 7) { toast('Максимум 8 гравців'); return; } picked.add(id); }
        draw();
      });
      s.querySelector('[data-go-play]').onclick = async () => {
        if (duel && mode === 'bot') { pop(); go('game', (x) => openLocal(x, k, level)); return; }
        if (!p) { toast('Доступно в Telegram-боті'); return; }
        if (!picked.size && !(k === 'quiz' && bots)) { toast(duel ? 'Оберіть колегу' : 'Додайте колег або ботів'); return; }
        try {
          const g = await meApi('POST', '/me/games', { kind: k, invite: [...picked], bots, level });
          hapticOk(); pop();
          if (g.status === 'active') openRoom(g.id, g); else go('lobby', (x) => lobby(x, g));
          if (picked.size) toast('Запрошення надіслано');
        } catch (e) { toast(e.code === 403 ? 'Ігри зараз недоступні' : 'Не вдалося створити гру'); }
      };
      wire(s);
    };
    draw();
    if (p && (mode === 'people' || !duel)) { try { online = await meApi('GET', '/me/online'); } catch (e) { online = []; } if (stackTop() === 'gsetup') draw(); }
    s._redraw = async () => { if (!p) return; try { online = await meApi('GET', '/me/online'); } catch (e) {} draw(); };
  }

  // ════════ lobby ════════
  const ST = { host: 'Організатор', invited: 'Запрошено…', accepted: 'Готовий', declined: 'Відхилив(ла)', left: 'Вийшов', playing: 'У грі' };
  function lobby(s, g) {
    s._gid = g.id;
    const draw = (g) => {
      s._g = g;
      const host = g.hostId === (TG.me && TG.me.id), seated = g.players.filter((p) => p.state === 'host' || p.state === 'accepted').length;
      s.innerHTML = gHead('Лобі') + `<div class="pscroll"><div class="gsetup"><div class="gshero">${icHTML(g.kind, 'lg')}<b>${esc(g.title)}</b><span>${g.status === 'lobby' ? 'Чекаємо гравців' : g.status === 'cancelled' ? 'Гру скасовано' : ''}</span></div>
        <div class="pgt">Гравці · ${seated}/${g.players.length}</div><div class="pgrp">${g.players.map((p) => {
          const e = p.id ? emp(p.id) : null;
          const av = p.bot ? `<span class="av gbot">${botFace}</span>` : e ? avHTML(e) : `<span class="av" style="background:#5B76E6">${esc(p.name.slice(0, 2))}</span>`;
          return `<div class="prow"><span class="pavw">${av}</span><div class="tx"><div class="nm">${esc(p.name)}${p.bot ? ` <span class="gtag">${LEVEL_N[p.bot] || 'Бот'}</span>` : ''}</div><div class="sub st-${p.state}">${ST[p.state] || ''}</div></div></div>`;
        }).join('')}</div>
        ${g.kind === 'quiz' && host ? `<div class="phint pad">Почніть, коли зберуться всі. Хто не відповів на запрошення — не потрапить у гру.</div>` : ''}
      </div></div><div class="pfoot gfoot">${g.kind === 'quiz' && host && g.status === 'lobby' ? `<button class="pbtn" data-start ${seated < 2 ? 'disabled' : ''}>Почати гру</button>` : ''}<button class="pbtn ghost" data-leave>${host ? 'Скасувати' : 'Вийти'}</button></div>`;
      const st = s.querySelector('[data-start]'); if (st) st.onclick = async () => { try { const n = await meApi('POST', `/me/games/${g.id}/start`); onGame(n); } catch (e) { toast('Потрібно щонайменше 2 гравці'); } };
      s.querySelector('[data-leave]').onclick = async () => { try { await meApi('POST', `/me/games/${g.id}/leave`); } catch (e) {} popIf('lobby'); };
      wire(s);
    };
    draw(g);
    s._onGame = (n) => { if (n.status === 'active') { popIf('lobby'); openRoom(n.id, n); } else if (n.status === 'cancelled') { toast('Гру скасовано'); popIf('lobby'); } else draw(n); };
  }
  const botFace = '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/></svg>';

  // ════════ live events ════════
  function onGame(g) {
    const top = stackTop();
    const L = scr('lobby'), G = scr('game');
    if (L._gid === g.id && L._onGame) L._onGame(g);
    if (G._gid === g.id && G._onGame) G._onGame(g);
    if (top === 'games') scr('games')._redraw && scr('games')._redraw();
    if (g.status === 'active' && G._gid !== g.id && L._gid !== g.id && g.players[g.me] && ['playing'].includes(g.players[g.me].state) && !g.seq && g.kind !== 'quiz' && g.hostId === (TG.me && TG.me.id)) {
      // my invite was accepted while I'm elsewhere → nudge via the island
      islandTemp('ginfo', { text: `${g.players[1].name} прийняв(ла) виклик`, gameId: g.id }, 6000);
    }
  }
  function onInvite(d) {
    haptic('medium');
    islandTemp('invite', d, 20000);
  }
  async function respond(id, accept) {
    try {
      const g = await meApi('POST', `/me/games/${id}/respond`, { accept });
      islandEnd('invite');
      if (accept) { hapticOk(); if (g.status === 'active') openRoom(g.id, g); else go('lobby', (x) => lobby(x, g)); }
      return g;
    } catch (e) { toast(e.code === 409 ? 'Запрошення вже неактуальне' : 'Не вдалося'); islandEnd('invite'); return null; }
  }
  async function openRoom(id, g) {
    try { g = g || await meApi('GET', `/me/games/${id}`); } catch (e) { toast('Гру не знайдено'); return; }
    if (g.status === 'lobby') { if (g.players[g.me] && g.players[g.me].state === 'invited') { respond(g.id, true); return; } go('lobby', (x) => lobby(x, g)); return; }
    while (stackTop() === 'game' || stackTop() === 'lobby') pop();
    go('game', (x) => (g.kind === 'quiz' ? quizScreen(x, g) : duelScreen(x, g)));
  }

  // chat card for kind 'game' messages
  function cardHTML(m, mine) {
    const meta = m.meta || {}, k = meta.kind;
    if (!KIND[k]) return '';
    const st = meta.state || 'invited';
    const label = { invited: mine ? 'Очікує відповіді…' : '', accepted: 'Виклик прийнято', declined: 'Відхилено', cancelled: 'Скасовано', expired: 'Запрошення застаріло' }[st] || '';
    return `<div class="gchat ${mine ? 'me' : 'them'}" data-m="${m.id}">${icHTML(k, 'sm')}<div class="t"><b>${esc(KIND[k].n)}</b><span>${mine ? 'Ви запросили зіграти' : esc(m.text || 'запрошує зіграти')}</span>
      ${st === 'invited' && !mine ? `<div class="gbtns"><button type="button" class="ok" data-gm="acc" data-gid="${meta.gameId}">Прийняти</button><button type="button" data-gm="dec" data-gid="${meta.gameId}">Відхилити</button></div>` : `<em class="st-${st}">${label}</em>`}
      ${st === 'accepted' ? `<button type="button" class="gopen" data-gm="open" data-gid="${meta.gameId}">Відкрити гру</button>` : ''}</div></div>`;
  }
  function cardAction(btn) {
    const id = btn.dataset.gid, a = btn.dataset.gm;
    if (a === 'open') openRoom(id); else respond(id, a === 'acc');
  }

  // ════════ duel screen (network room or local vs bot) ════════
  const meIdx = (g) => (g ? g.me : 0);
  function openLocal(s, k, level) {
    if (k === '2048') return play2048(s);
    if (k === 'snake') return playSnake(s);
    if (k === 'word') return playWord(s);
    return duelScreen(s, null, k, level);
  }
  function duelScreen(s, room, kLocal, level) {
    const k = room ? room.kind : kLocal, E = { ttt, sea, checkers, chess }[k];
    s._gid = room ? room.id : null;
    let g = room, me = room ? room.me : 0, state = room ? room.state : null, seq = room ? room.seq : 0, busy = false, sel = null, done = null;
    const names = room ? room.players.map((p) => p.name) : [TG.me && TG.me.name ? TG.me.name.split(' ')[0] : 'Ви', `Бот · ${LEVEL_N[level] || ''}`];
    if (!state) state = k === 'sea' ? sea.init(room ? null : [null, sea.randomFleet()]) : E.init();
    let myFleet = k === 'sea' ? (state.fleets && state.fleets[me]) || sea.randomFleet() : null;
    const flip = (k === 'chess' || k === 'checkers') && me === 1;
    const turnOf = (st) => (k === 'sea' ? st.turn : st.turn);
    const result = () => (k === 'sea' ? sea.result(state) : E.result(state));
    const myTurn = () => !busy && !result().over && (k === 'sea' ? state.phase === 'play' && state.turn === me : turnOf(state) === me);

    async function commit(next, res) {
      state = next; sel = null; render();
      if (!room) { if (res.over) finish(res); else if (turnOf(state) !== me || (k === 'sea' && state.turn === 1)) botTurn(); return; }
      busy = true;
      try {
        const body = { seq, state };
        if (res.over) body.result = { winner: res.winner };
        const n = await meApi('POST', `/me/games/${room.id}/move`, body);
        g = n; seq = n.seq; state = n.state;
      } catch (e) {
        if (e.code === 409) { toast('Хід не прийнято — оновлюю'); await refetch(); } else toast('Немає зв’язку — хід не надіслано');
      }
      busy = false; render();
      if (res.over) finish(res);
    }
    async function refetch() { try { const n = await meApi('GET', `/me/games/${room.id}`); g = n; seq = n.seq; state = n.state || state; } catch (e) {} }
    function botTurn() {
      busy = true; render();
      setTimeout(() => {
        let next;
        if (k === 'sea') next = sea.apply(state, 1, sea.bot(state, 1, level));
        else if (k === 'ttt') next = ttt.apply(state, ttt.bot(state, level));
        else if (k === 'checkers') next = checkers.apply(state, checkers.bot(state, level));
        else next = chess.apply(state, chess.bot(state, level));
        state = next; busy = false; haptic('light');
        const res = result(); render();
        if (res.over) finish(res);
        else if (k === 'sea' && state.turn === 1) botTurn();
      }, k === 'chess' && level === 'hard' ? 120 : 450);
    }
    function finish(res) {
      if (done) return; done = res;
      const won = res.winner === me, draw = res.winner == null;
      if (won) hapticOk(); else haptic('heavy');
      if (!room) postResult(k, { outcome: draw ? 'draw' : won ? 'win' : 'loss', level });
      render();
    }
    // network updates
    s._onGame = (n) => {
      g = n; if (n.seq < seq) return; seq = n.seq;
      if (n.state) state = n.state;
      if (n.status === 'done') { const res = n.winner == null ? { over: true, winner: null } : { over: true, winner: n.winner }; if (!result().over && n.players.some((p) => p.state === 'left')) res.why = 'суперник здався'; finish(res); }
      haptic('light'); render();
    };

    // ── renderers ──
    function statusText() {
      const res = done || result();
      if (res.over) return res.winner == null ? `Нічия${res.why ? ' · ' + res.why : ''}` : res.winner === me ? `Перемога!${res.why && res.why !== 'мат' ? ' · ' + res.why : ''}` : `Поразка${res.why ? ' · ' + res.why : ''}`;
      if (k === 'sea' && state.phase !== 'play') return state.fleets && state.fleets[me] ? 'Чекаємо, поки суперник розставить флот…' : 'Розставте кораблі';
      if (busy && !room) return 'Бот думає…';
      if (k === 'chess' && chess.inCheck(state) && turnOf(state) === me) return 'Шах! Ваш хід';
      return myTurn() ? 'Ваш хід' : room ? `Хід: ${names[1 - me]}` : 'Хід бота';
    }
    function render() {
      const res = done || result();
      const turn = k === 'sea' ? state.turn : turnOf(state);
      s.innerHTML = gHead(KIND[k].n, room ? '' : `<button class="tbtn" data-new>Нова гра</button>`) + `<div class="gwrap">
        <div class="gplayers">${[me, 1 - me].map((i) => `<div class="gpl ${turn === i && !res.over ? 'on' : ''} ${res.over && res.winner === i ? 'win' : ''}"><span class="mk mk${i}">${k === 'ttt' ? ttt.mark(i) : k === 'chess' ? (i === 0 ? '♔' : '♚') : k === 'checkers' ? '' : ''}</span><b>${esc(names[i] || '')}</b></div>`).join('<span class="gvs">vs</span>')}</div>
        <div class="gstatus ${res.over ? (res.winner === me ? 'win' : res.winner == null ? 'draw' : 'lose') : myTurn() ? 'mine' : ''}" role="status">${statusText()}</div>
        <div class="gboard gb-${k}" data-board></div>
        ${k === 'chess' && state.san ? `<div class="gsan">Останній хід: ${esc(state.san)}</div>` : ''}
        <div class="gacts">${res.over ? (room ? `<button class="pbtn" data-again>Реванш</button><button class="pbtn ghost" data-close>До ігор</button>` : `<button class="pbtn" data-again>Ще раз</button>`) : room ? `<button class="pbtn ghost" data-resign>Здатися</button>` : ''}
          ${k === 'sea' && state.phase !== 'play' && !(state.fleets && state.fleets[me]) ? `<button class="pbtn ghost" data-shuffle>Перемішати</button><button class="pbtn" data-ready>Готово</button>` : ''}</div>
      </div>`;
      const board = s.querySelector('[data-board]');
      ({ ttt: drawTtt, sea: drawSea, checkers: drawCheckers, chess: drawChess })[k](board);
      const nb = s.querySelector('[data-new]'); if (nb) nb.onclick = () => duelScreen(s, null, k, level);
      const ag = s.querySelector('[data-again]'); if (ag) ag.onclick = async () => {
        if (!room) return duelScreen(s, null, k, level);
        const opp = g.players[1 - me]; if (!opp || !opp.id) return;
        try { const n = await meApi('POST', '/me/games', { kind: k, invite: [opp.id] }); toast('Реванш: запрошення надіслано'); pop(); go('lobby', (x) => lobby(x, n)); } catch (e) { toast('Не вдалося'); }
      };
      const cl = s.querySelector('[data-close]'); if (cl) cl.onclick = () => back();
      const rs = s.querySelector('[data-resign]'); if (rs) { let armed = false; rs.onclick = async () => { if (!armed) { armed = true; rs.textContent = 'Точно здатися?'; setTimeout(() => { armed = false; rs.textContent = 'Здатися'; }, 3000); return; } try { const n = await meApi('POST', `/me/games/${room.id}/leave`); s._onGame(n); } catch (e) {} }; }
      const sh = s.querySelector('[data-shuffle]'); if (sh) sh.onclick = () => { myFleet = sea.randomFleet(); haptic(); render(); };
      const rd = s.querySelector('[data-ready]'); if (rd) rd.onclick = () => placeFleet();
      wire(s);
    }
    async function placeFleet() {
      hapticOk();
      if (!room) { state = sea.init([myFleet, state.fleets[1]]); render(); return; }
      busy = true;
      for (let attempt = 0; attempt < 3; attempt++) {
        const fleets = [...((state && state.fleets) || [null, null])]; fleets[me] = myFleet;
        const both = fleets[0] && fleets[1];
        const next = { phase: both ? 'play' : 'place', fleets, shots: (state && state.shots) || [[], []], turn: both ? 0 : null };
        try { const n = await meApi('POST', `/me/games/${room.id}/move`, { seq, state: next }); g = n; seq = n.seq; state = n.state; break; }
        catch (e) { if (e.code !== 409) { toast('Немає зв’язку'); break; } await refetch(); }
      }
      busy = false; render();
    }
    // ── TTT ──
    function drawTtt(el) {
      const res = result();
      el.innerHTML = state.b.map((v, i) => `<button type="button" class="tc ${v ? 'm' + v : ''} ${res.line && res.line.includes(i) ? 'wl' : ''}" data-i="${i}" aria-label="Клітинка ${i + 1}${v ? ': ' + v : ''}">${v === 'X' ? '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>' : v === 'O' ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>' : ''}</button>`).join('');
      el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { const i = +b.dataset.i; if (!myTurn() || !ttt.legal(state, i)) return; haptic(); const n = ttt.apply(state, i); commit(n, ttt.result(n)); });
    }
    // ── Sea ──
    function drawSea(el) {
      const placing = state.phase !== 'play';
      const mineGrid = (big) => {
        const fleet = placing ? (state.fleets && state.fleets[me]) || myFleet : state.fleets[me];
        const shipCells = new Set((fleet || []).flatMap((x) => x.cells)), hits = new Set(state.shots[1 - me] || []);
        return `<div class="sgrid ${big ? 'big' : 'small'}" aria-label="Ваше поле">${Array.from({ length: 100 }, (_, i) => `<span class="sc ${shipCells.has(i) ? 'ship' : ''} ${hits.has(i) ? (shipCells.has(i) ? 'hit' : 'miss') : ''}"></span>`).join('')}</div>`;
      };
      if (placing) { el.innerHTML = `<div class="slabel">Ваш флот</div>${mineGrid(true)}`; return; }
      el.innerHTML = `<div class="slabel">Поле суперника</div><div class="sgrid big enemy">${Array.from({ length: 100 }, (_, i) => { const v = sea.cellAt(state, me, i); return `<button type="button" class="sc ${v}" data-i="${i}" aria-label="${'АБВГДЕЖЗИК'[i % 10]}${Math.floor(i / 10) + 1}${v ? ': ' + v : ''}"></button>`; }).join('')}</div><div class="slabel">Ваше поле</div>${mineGrid(false)}`;
      el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { const i = +b.dataset.i; if (!myTurn() || !sea.legal(state, me, i)) return; haptic(); const n = sea.apply(state, me, i); commit(n, sea.result(n)); });
    }
    // ── Checkers ──
    function drawCheckers(el) {
      const legal = myTurn() ? checkers.moves(state) : [];
      const from = sel != null ? legal.filter((m) => m.path[0] === sel) : [];
      const targets = new Set(from.map((m) => m.path[m.path.length - 1]));
      const movable = new Set(legal.map((m) => m.path[0]));
      const last = new Set(state.last || []);
      let h = '';
      for (let v = 0; v < 64; v++) {
        const i = flip ? 63 - v : v, r = Math.floor(i / 8), c = i % 8, dark = (r + c) % 2 === 1, pc = state.b[i];
        h += `<button type="button" class="cq ${dark ? 'd' : 'l'} ${sel === i ? 'sel' : ''} ${targets.has(i) ? 'tg' : ''} ${last.has(i) ? 'last' : ''} ${movable.has(i) ? 'can' : ''}" data-i="${i}" ${dark ? '' : 'tabindex="-1"'} aria-label="${'abcdefgh'[c]}${8 - r}${pc ? ' ' + (pc.toLowerCase() === 'w' ? 'біла' : 'чорна') + (checkers.isKing(pc) ? ' дамка' : '') : ''}">${pc ? `<span class="pc ${pc.toLowerCase() === 'w' ? 'w' : 'b'} ${checkers.isKing(pc) ? 'k' : ''}"></span>` : ''}</button>`;
      }
      el.innerHTML = h;
      el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.i;
        if (!myTurn()) return;
        if (targets.has(i)) {
          const m = from.filter((x) => x.path[x.path.length - 1] === i).sort((a, b) => b.caps.length - a.caps.length)[0];
          haptic(); const n = checkers.apply(state, m); commit(n, checkers.result(n)); return;
        }
        if (movable.has(i)) { sel = sel === i ? null : i; haptic('light'); render(); }
        else if (legal.length && legal[0].caps.length) toast('Бити обовʼязково');
      });
    }
    // ── Chess ──
    const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
    function drawChess(el) {
      const legal = myTurn() ? chess.moves(state) : [];
      const from = sel != null ? legal.filter((m) => m.from === sel) : [];
      const targets = new Set(from.map((m) => m.to));
      const last = new Set(state.last || []);
      const checkSq = chess.inCheck(state) ? chess.kingSq(state.b, state.turn) : -1;
      let h = '';
      for (let v = 0; v < 64; v++) {
        const i = flip ? 63 - v : v, r = Math.floor(i / 8), c = i % 8, pc = state.b[i];
        const lab = (flip ? c === 7 : c === 0) ? `<i class="rk">${8 - r}</i>` : '', fl = (flip ? r === 0 : r === 7) ? `<i class="fl">${'abcdefgh'[c]}</i>` : '';
        h += `<button type="button" class="cq ${(r + c) % 2 ? 'd' : 'l'} ${sel === i ? 'sel' : ''} ${targets.has(i) ? (pc ? 'tgx' : 'tg') : ''} ${last.has(i) ? 'last' : ''} ${i === checkSq ? 'chk' : ''}" data-i="${i}" aria-label="${'abcdefgh'[c]}${8 - r}${pc ? ' ' + pc : ''}">${pc ? `<span class="cp ${pc[0]}">${GLYPH[pc[1]]}</span>` : ''}${lab}${fl}</button>`;
      }
      el.innerHTML = h;
      el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.i;
        if (!myTurn()) return;
        if (targets.has(i)) {
          const opts = from.filter((m) => m.to === i);
          const doMove = (m) => { haptic(); const n = chess.apply(state, m); commit(n, chess.result(n)); };
          if (opts.length > 1) promoPick(opts[0].from, i, (p) => doMove(opts.find((m) => m.promo === p)));
          else doMove(opts[0]);
          return;
        }
        if (state.b[i] && state.b[i][0] === (me === 0 ? 'w' : 'b')) { sel = sel === i ? null : i; haptic('light'); render(); }
      });
    }
    function promoPick(_from, _to, done) {
      const ov = document.createElement('div'); ov.className = 'pwov on';
      const c = me === 0 ? 'w' : 'b';
      ov.innerHTML = `<div class="pwsheet" role="dialog" aria-label="Перетворення пішака"><div class="pwhead"><span></span><b>Перетворити пішака на</b><span></span></div><div class="gpromo">${['Q', 'R', 'B', 'N'].map((p) => `<button type="button" data-p="${p}" aria-label="${{ Q: 'Ферзь', R: 'Тура', B: 'Слон', N: 'Кінь' }[p]}"><span class="cp ${c}">${GLYPH[p]}</span><em>${{ Q: 'Ферзь', R: 'Тура', B: 'Слон', N: 'Кінь' }[p]}</em></button>`).join('')}</div></div>`;
      s.closest('.pscreenwrap').appendChild(ov);
      ov.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { ov.remove(); done(b.dataset.p); });
    }
    render();
    // a local game where the bot starts (never: the player is always first) — network: nothing to do
    s._stop = () => { s._gid = null; };
  }

  // ════════ quiz (server-run) ════════
  function quizScreen(s, g) {
    s._gid = g.id;
    let tick = null, picked = null, lastI = -1;
    const draw = (g) => {
      s._g = g;
      const st = g.state || {}, me = g.me;
      if (st.i !== lastI) { picked = null; lastI = st.i; }
      const rank = g.players.map((p, i) => ({ p, i, v: (st.scores || [])[i] || 0 })).sort((a, b) => b.v - a.v);
      const board = `<div class="pgrp qboard">${rank.map((r, k) => `<div class="prow"><b class="qrank">${k + 1}</b><div class="tx"><div class="nm">${esc(r.p.name)}${r.i === me ? ' · ви' : ''}${r.p.bot ? ' 🤖' : ''}</div></div><b class="qpts">${r.v}</b>${st.phase === 'q' ? `<span class="qdot ${(st.answered || []).includes(r.i) ? 'on' : ''}"></span>` : ''}</div>`).join('')}</div>`;
      if (g.status === 'done' || st.phase === 'end') {
        const win = g.winner === me;
        s.innerHTML = gHead('Вікторина') + `<div class="pscroll"><div class="gsetup"><div class="gshero">${icHTML('quiz', 'lg')}<b>${win ? 'Ви перемогли!' : g.winner == null ? 'Нічия' : 'Гру завершено'}</b><span>Переможець: ${g.winner == null ? '—' : esc(g.players[g.winner].name)}</span></div>${board}</div></div><div class="pfoot"><button class="pbtn" data-again>Ще раз</button></div>`;
        s.querySelector('[data-again]').onclick = () => { pop(); go('gsetup', (x) => gsetup(x, 'quiz')); };
        if (win) hapticOk();
        clearInterval(tick); wire(s); return;
      }
      if (g.status === 'cancelled') { s.innerHTML = gHead('Вікторина') + empty('Гру скасовано', ''); wire(s); return; }
      const q = st.q || { q: '', options: [] }, reveal = st.phase === 'reveal';
      s.innerHTML = gHead(`Питання ${st.i + 1} з ${st.n}`) + `<div class="pscroll"><div class="gquiz">
        <div class="qbar"><b data-bar></b></div>
        <div class="qq">${esc(q.q)}</div>
        <div class="qopts">${q.options.map((o, i) => {
          const cls = reveal ? (i === st.answer ? 'right' : picked === i || (st.picks && st.picks[me] && st.picks[me].o === i) ? 'wrong' : '') : picked === i ? 'sel' : '';
          return `<button type="button" class="qo ${cls}" data-o="${i}" ${picked != null || reveal ? 'disabled' : ''}><span class="ql">${'АБВГ'[i]}</span>${esc(o)}</button>`;
        }).join('')}</div>
        ${board}</div></div>`;
      s.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => {
        if (picked != null) return; picked = +b.dataset.o; haptic(); draw(s._g);
        try { await meApi('POST', `/me/games/${g.id}/answer`, { option: picked }); } catch (e) {}
      });
      const bar = s.querySelector('[data-bar]');
      clearInterval(tick);
      const total = reveal ? 3500 : 15000;
      const upd = () => { const left = Math.max(0, st.deadline - Date.now()); bar.style.width = Math.min(100, (left / total) * 100) + '%'; };
      upd(); tick = setInterval(upd, 200);
      if (reveal) { const okA = st.picks && st.picks[me] && st.picks[me].o === st.answer; haptic(okA ? 'light' : 'heavy'); }
      wire(s);
    };
    draw(g);
    s._onGame = (n) => draw(n);
    s._stop = () => { clearInterval(tick); s._gid = null; };
  }

  // ════════ solo: 2048 ════════
  function play2048(s) {
    s._gid = null;
    let st = load('alliancesim.games.2048', null) || g2048.init(), best = load(bestKey('2048'), 0), posted = false;
    const draw = () => {
      s.innerHTML = gHead('2048', '<button class="tbtn" data-new>Нова гра</button>') + `<div class="gwrap">
        <div class="g2s"><div><span>Рахунок</span><b>${st.score}</b></div><div><span>Рекорд</span><b>${Math.max(best, st.score)}</b></div></div>
        <div class="g2048" data-board tabindex="0" aria-label="Поле 2048: проводьте пальцем або стрілками">${st.g.map((v) => `<span class="t2 v${Math.min(v, 4096)}">${v || ''}</span>`).join('')}</div>
        <div class="gstatus ${st.over ? 'lose' : ''}">${st.over ? 'Ходів більше немає' : 'Проводьте пальцем, щоб зсунути плитки'}</div></div>`;
      const bd = s.querySelector('[data-board]');
      swipe(bd, move);
      s.querySelector('[data-new]').onclick = () => { st = g2048.init(); posted = false; save('alliancesim.games.2048', st); draw(); };
      wire(s);
    };
    function move(dir) {
      if (st.over) return;
      const r = g2048.move(st, dir); if (!r.moved) return;
      st = r.s; haptic('light'); save('alliancesim.games.2048', st);
      if (st.score > best) { best = st.score; save(bestKey('2048'), best); }
      if (st.over && !posted) { posted = true; postResult('2048', { score: st.score }); haptic('heavy'); }
      draw();
    }
    const key = (e) => { const d = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]; if (d && stackTop() === 'game') { e.preventDefault(); move(d); } };
    document.addEventListener('keydown', key);
    s._stop = () => document.removeEventListener('keydown', key);
    draw();
  }
  function swipe(el, fn) {
    let x0 = null, y0 = null;
    el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; el.setPointerCapture && el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', (e) => {
      if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      fn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    });
    el.style.touchAction = 'none';
  }

  // ════════ solo: snake ════════
  function playSnake(s) {
    s._gid = null;
    let st = snake.init(), timer = null, best = load(bestKey('snake'), 0), started = false;
    const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    s.innerHTML = gHead('Змійка') + `<div class="gwrap"><div class="g2s"><div><span>Рахунок</span><b data-sc>0</b></div><div><span>Рекорд</span><b data-best>${best}</b></div></div>
      <canvas class="gsnake" width="320" height="320" data-board aria-label="Поле змійки: проводьте пальцем або стрілками"></canvas>
      <div class="gstatus" data-msg>Торкніться поля або стрілки, щоб почати</div>
      <div class="gpad">${['up', 'left', 'down', 'right'].map((d) => `<button type="button" data-d="${d}" class="gp-${d}" aria-label="${{ up: 'Вгору', left: 'Ліворуч', down: 'Вниз', right: 'Праворуч' }[d]}"><svg viewBox="0 0 24 24"><path d="${{ up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6' }[d]}"/></svg></button>`).join('')}</div></div>`;
    const cv = s.querySelector('canvas'), cx = cv.getContext('2d');
    const css = getComputedStyle(cv);
    const paint = () => {
      const cell = 20;
      cx.fillStyle = css.getPropertyValue('--sn-bg') || '#EFF3EA'; cx.fillRect(0, 0, 320, 320);
      cx.fillStyle = '#E2001A'; cx.beginPath(); cx.arc(st.food[0] * cell + 10, st.food[1] * cell + 10, 7, 0, 7); cx.fill();
      st.body.forEach(([x, y], i) => { cx.fillStyle = i ? '#25A24E' : '#16733A'; cx.beginPath(); cx.roundRect ? cx.roundRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2, 5) : cx.rect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); cx.fill(); });
      s.querySelector('[data-sc]').textContent = st.score;
    };
    const loop = () => {
      clearTimeout(timer);
      st = snake.step(st); paint();
      if (st.over) {
        haptic('heavy'); started = false;
        if (st.score > best) { best = st.score; save(bestKey('snake'), best); s.querySelector('[data-best]').textContent = best; }
        if (st.score) postResult('snake', { score: st.score });
        s.querySelector('[data-msg]').textContent = `Гру закінчено · ${st.score} очок. Торкніться, щоб почати знову`;
        return;
      }
      timer = setTimeout(loop, snake.speed(st));
    };
    const turn = (d) => {
      if (!started) { if (st.over) st = snake.init(); started = true; s.querySelector('[data-msg]').textContent = 'Збирайте червоні яблука'; timer = setTimeout(loop, 200); }
      st = snake.turn(st, DIR[d]);
    };
    swipe(cv, turn);
    cv.addEventListener('click', () => { if (!started) turn('right'); });
    s.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { haptic('light'); turn(b.dataset.d); });
    const key = (e) => { const d = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]; if (d && stackTop() === 'game') { e.preventDefault(); turn(d); } };
    document.addEventListener('keydown', key);
    s._stop = () => { clearTimeout(timer); document.removeEventListener('keydown', key); };
    paint(); wire(s);
  }

  // ════════ solo: Слово ════════
  function playWord(s) {
    s._gid = null;
    const day = new Date().toDateString();
    let saved = load('alliancesim.games.word', null);
    let st = saved && saved.day === day ? saved.st : word.init(word.daily());
    let daily = !saved || saved.day !== day || saved.daily !== false, cur = '';
    const persist = () => save('alliancesim.games.word', { day, st, daily });
    const draw = () => {
      const ks = word.keyState(st);
      const rows = Array.from({ length: 6 }, (_, r) => {
        const row = st.rows[r], g = row ? row.g : r === st.rows.length ? cur : '';
        return `<div class="wrow">${Array.from({ length: 5 }, (_, i) => `<span class="wc ${row ? 'm' + row.m[i] : g[i] ? 'f' : ''}">${(g[i] || '').toUpperCase()}</span>`).join('')}</div>`;
      }).join('');
      s.innerHTML = gHead(daily ? 'Слово дня' : 'Слово', `<button class="tbtn" data-new>Інше слово</button>`) + `<div class="gwrap gword">
        <div class="wgrid" aria-label="Спроби">${rows}</div>
        <div class="gstatus ${st.over ? (st.won ? 'win' : 'lose') : ''}" role="status">${st.over ? (st.won ? `Вгадано з ${st.rows.length} спроби!` : `Слово: «${st.answer.toUpperCase()}»`) : 'Вгадайте слово з 5 літер за 6 спроб'}</div>
        <div class="wkb">${word.KEYS.map((row, ri) => `<div class="wkr">${ri === 2 ? '<button type="button" class="wk wide" data-key="enter">Ввід</button>' : ''}${[...row].map((ch) => `<button type="button" class="wk ${ks[ch] ? 'm' + ks[ch] : ''}" data-key="${ch}">${ch.toUpperCase()}</button>`).join('')}${ri === 2 ? '<button type="button" class="wk wide" data-key="back" aria-label="Стерти">⌫</button>' : ''}</div>`).join('')}</div></div>`;
      s.querySelectorAll('[data-key]').forEach((b) => b.onclick = () => press(b.dataset.key));
      s.querySelector('[data-new]').onclick = () => { st = word.init(word.random()); daily = false; cur = ''; persist(); draw(); };
      wire(s);
    };
    function press(k) {
      if (st.over) return;
      if (k === 'back') cur = cur.slice(0, -1);
      else if (k === 'enter') {
        if (cur.length < 5) { toast('Потрібно 5 літер'); return; }
        st = word.guess(st, cur); cur = ''; persist(); haptic();
        if (st.over) { if (st.won) { hapticOk(); const b = load(bestKey('word'), 0); if (!b || st.rows.length < b) save(bestKey('word'), st.rows.length); postResult('word', { score: st.rows.length }); } else haptic('heavy'); }
      } else if (cur.length < 5) { cur += k; haptic('light'); }
      draw();
    }
    const key = (e) => {
      if (stackTop() !== 'game') return;
      if (e.key === 'Enter') press('enter'); else if (e.key === 'Backspace') press('back');
      else if (/^[а-яіїєґ]$/i.test(e.key)) press(e.key.toLowerCase());
    };
    document.addEventListener('keydown', key);
    s._stop = () => document.removeEventListener('keydown', key);
    draw();
  }

  // ════════ leaderboard ════════
  async function gtop(s) {
    let period = 'week', data = null;
    const draw = () => {
      const rowsOf = (list, val, unit) => (list && list.length ? list.map((r, i) => `<div class="prow"><b class="qrank r${i + 1}">${i + 1}</b><div class="tx"><div class="nm">${esc(r.name)}</div></div><b class="qpts">${val(r)}${unit ? ' ' + unit : ''}</b></div>`).join('') : '<div class="gempty">Поки порожньо — зіграйте першим!</div>');
      s.innerHTML = gHead('Лідери') + `<h1 class="plt">Лідери</h1><div class="pscroll">${segHTML('data-per', [['week', 'Тиждень'], ['all', 'Весь час']], period).replace('class="pseg"', 'class="pseg wide"')}
        ${!personal() ? '<div class="pnote">Таблиця лідерів — у Telegram-боті.</div>' : !data ? '<div class="gempty">Завантаження…</div>' : `
        <div class="pgt">Мої досягнення</div><div class="pgrp gme"><div><b>${data.me.pvp_wins}</b><span>перемог над колегами</span></div><div><b>${data.me.bot_wins}</b><span>над ботами</span></div><div><b>${data.me.quiz_points}</b><span>очок вікторини</span></div></div>
        <div class="pgt">Дуелі · очки</div><div class="pgrp">${rowsOf(data.pvp, (r) => r.points, 'оч.')}</div>
        <div class="pgt">Вікторина</div><div class="pgrp">${rowsOf(data.quiz, (r) => r.points, 'оч.')}</div>
        <div class="pgt">2048 · рекорди</div><div class="pgrp">${rowsOf(data.solo['2048'], (r) => r.best)}</div>
        <div class="pgt">Змійка · рекорди</div><div class="pgrp">${rowsOf(data.solo.snake, (r) => r.best)}</div>
        <div class="pgt">Слово · найменше спроб</div><div class="pgrp">${rowsOf(data.solo.word, (r) => r.best, 'спр.')}</div>`}
      </div>`;
      s.querySelectorAll('[data-per] [data-v]').forEach((b) => b.onclick = () => { period = b.dataset.v; data = null; draw(); fetchTop(); });
      wire(s);
    };
    const fetchTop = async () => { if (!personal()) return; try { data = await meApi('GET', `/me/games/leaderboard?period=${period}`); } catch (e) { data = null; } if (stackTop() === 'gtop') draw(); };
    draw(); fetchTop();
  }

  return { screens: { games, gtop }, onGame, onInvite, respond, openRoom, cardHTML, cardAction, KIND, icHTML };
}
