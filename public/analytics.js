// Spec 008 — HR analytics v2, one implementation for two shells: the office site's
// «Аналітика» tab (index.html) and the HR app in the phone / Telegram Mini App (phone.js).
// The shell passes how to fetch JSON and how to export; everything else lives here.
// Colours come from the theme tokens (--ink/--muted/--line/--chip/--panel-solid/--viz),
// which the phone remaps to its own, so light/dark work in both places.
//
//   mountAnalytics(el, { get(path) → Promise<json>, exportFile(kind, query), toast, compact })
//   paths: '/v2?…' and '/person/<id>?…' — the shell maps them to its endpoints.

export const STATUS = [
  { k: 'office', n: 'В офісі', c: '#2E9E5B' },
  { k: 'remote', n: 'Віддалено', c: '#3E7BD6' },
  { k: 'absent', n: 'Немає', c: '#8A8F98' },
  { k: 'sick', n: 'Хворіє', c: '#D64545' },
  { k: 'vacation', n: 'Відпустка', c: '#E08A1E' },
];
const SC = Object.fromEntries(STATUS.map((s) => [s.k, s]));
const MOOD = [
  { k: 'great', n: 'Чудовий', c: '#2E9E5B', v: 5 }, { k: 'good', n: 'Гарний', c: '#7BC043', v: 4 },
  { k: 'ok', n: 'Нормально', c: '#E0B21E', v: 3 }, { k: 'tired', n: 'Втомлений', c: '#8E6BD6', v: 2 },
  { k: 'stressed', n: 'У стресі', c: '#D64545', v: 1 },
];
const MC = Object.fromEntries(MOOD.map((m) => [m.k, m]));
const TABS = [['overview', 'Огляд'], ['presence', 'Присутність'], ['mood', 'Настрій'], ['engagement', 'Залученість'], ['people', 'Люди']];
const WD = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MON = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wdOf = (k) => new Date(k + 'T12:00:00Z').getUTCDay();
const isWork = (k) => { const w = wdOf(k); return w >= 1 && w <= 5; };
const fD = (k) => `${+k.slice(8, 10)} ${MON[+k.slice(5, 7) - 1]}`;
const fFull = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const nf = (v, d = 1) => (v == null ? '—' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','));
const reason = (r) => (r.code === 'quiet' ? `не відмічається ${r.days} роб. дн.` : r.code === 'low' ? 'низький настрій 3 рази поспіль'
  : r.code === 'drop' ? `настрій впав ${nf(r.base)} → ${nf(r.now)}` : r.code);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// Δ badge; `good` = which direction is good (1 up, -1 down, 0 neutral).
function delta(v, p, { unit = '', good = 1, d = 1 } = {}) {
  if (v == null || p == null) return '';
  const x = Math.round((v - p) * 10 ** d) / 10 ** d;
  if (x === 0) return '<span class="an-d n">= як раніше</span>';
  const cls = !good ? 'n' : (x > 0) === (good > 0) ? 'g' : 'b';
  return `<span class="an-d ${cls}" title="Попередній період: ${nf(p, d)}${unit}">${x > 0 ? '▲' : '▼'} ${nf(Math.abs(x), d)}${unit}</span>`;
}

// ── charts: a placeholder carries the spec; mount() paints it at the container's real
// width (text stays at its CSS size) and repaints on resize ───────────────────
const spec = (kind, o) => `<div class="an-chart" data-kind="${kind}" data-spec="${esc(JSON.stringify(o))}"></div>`;
function lineChart(points, { min = 1, max = 5, step, pct = false, unit = '', label = '', moods = false } = {}) {
  if (!points.some((p) => p.v != null)) return '<p class="an-empty">Ще немає даних за цей період.</p>';
  return spec('line', { p: points.map((x) => [x.day, x.v, x.n ?? null]), min, max, step: step || (max - min) / 4, pct, unit, label, moods });
}
function stackedDays(daily) { return spec('stack', { d: daily }) + legend(STATUS); }
// which x labels fit: every k-th, always the last, never crowding it
const xLab = (n, W) => { const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 74)))); return (i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.7); };
function lineSvg(s, W) {
  const H = 190, L = 36, R = 14, T = 12, B = 24, n = Math.max(1, s.p.length - 1);
  const X = (i) => L + (i * (W - L - R)) / n, Y = (v) => T + ((s.max - v) * (H - T - B)) / (s.max - s.min);
  const ticks = []; for (let v = s.min; v <= s.max + 1e-9; v += s.step) ticks.push(v);
  let d = '', pen = false, area = '', run = [];
  const flush = () => { if (run.length > 1) area += `M${X(run[0]).toFixed(1)} ${Y(s.min)} ` + run.map((i) => `L${X(i).toFixed(1)} ${Y(s.p[i][1]).toFixed(1)}`).join(' ') + ` L${X(run[run.length - 1]).toFixed(1)} ${Y(s.min)} Z `; run = []; };
  // days without answers (weekends) are bridged; the dots show the real days
  s.p.forEach(([, v], i) => { if (v == null) return; d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `; pen = true; run.push(i); }); flush();
  const show = xLab(s.p.length, W), lastI = s.p.map((x) => x[1] != null).lastIndexOf(true), dots = (W - L - R) / Math.max(1, s.p.length) >= 7;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label)}">
    ${ticks.map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 7}" y="${Y(v) + 3.5}" text-anchor="end">${s.pct ? Math.round(v) + '%' : nf(v)}</text>`).join('')}
    ${s.p.map(([day], i) => (show(i) ? `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === s.p.length - 1 ? 'end' : 'middle'}">${fD(day)}</text>` : '')).join('')}
    <path d="${area}" fill="var(--viz)" opacity=".10"/>
    <path d="${d}" fill="none" stroke="var(--viz)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots ? s.p.map(([, v], i) => (v == null ? '' : `<circle cx="${X(i)}" cy="${Y(v)}" r="2.6" fill="var(--viz)"/>`)).join('') : ''}
    ${lastI >= 0 ? `<circle cx="${X(lastI)}" cy="${Y(s.p[lastI][1])}" r="4.5" fill="var(--viz)" stroke="var(--panel-solid)" stroke-width="2"/>` : ''}
    <line class="an-x" y1="${T}" y2="${H - B}" style="display:none"/><circle class="an-dot" r="4.5" fill="var(--viz)" stroke="var(--panel-solid)" stroke-width="2" style="display:none"/>
    <rect class="an-hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`;
}
function stackSvg(s, W) {
  const H = 200, L = 30, R = 8, T = 10, B = 24, n = s.d.length, bw = (W - L - R) / n;
  const tot = (d) => STATUS.reduce((a, x) => a + d[x.k], 0), max = Math.max(1, ...s.d.map(tot)), show = xLab(n, W);
  const gy = (f) => T + (H - T - B) * (1 - f);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Статуси по днях">
    ${[0, 0.5, 1].map((f) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${gy(f)}" y2="${gy(f)}"/><text class="ax" x="${L - 7}" y="${gy(f) + 3.5}" text-anchor="end">${Math.round(max * f)}</text>`).join('')}
    ${s.d.map((d, i) => { let y = H - B; const x = L + i * bw + bw * 0.14, w = Math.max(1, bw * 0.72);
      return `<g class="an-bar" data-i="${i}"${d.work ? '' : ' opacity=".42"'}><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>${STATUS.map((st) => { const v = d[st.k]; if (!v) return ''; const h = (v / max) * (H - T - B); y -= h; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${st.c}" rx="${Math.min(2, w / 3).toFixed(1)}"/>`; }).join('')}</g>`; }).join('')}
    ${s.d.map((d, i) => (show(i) ? `<text class="ax" x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${fD(d.day)}</text>` : '')).join('')}
  </svg>`;
}
const legend = (items) => `<div class="an-legend">${items.map((s) => `<span><i style="background:${s.c}"></i>${esc(s.n)}</span>`).join('')}</div>`;
// Horizontal bars: [{label, v, sub?, color?, id?}]
function hbars(items, { max, unit = '', d = 1, deltaOf } = {}) {
  if (!items.length) return '<p class="an-empty">Немає даних.</p>';
  const m = max || Math.max(1, ...items.map((x) => x.v || 0));
  return `<div class="an-hb">${items.map((x) => `<div class="an-hbr${x.id ? ' an-link' : ''}"${x.id ? ` data-person="${esc(x.id)}" tabindex="0" role="button"` : ''}>
    <span class="l" title="${esc(x.label)}">${esc(x.label)}</span>
    <span class="t"><i style="width:${x.v == null ? 0 : Math.max(0, Math.min(100, (x.v / m) * 100))}%;${x.color ? `background:${x.color}` : ''}"></i></span>
    <b>${x.v == null ? '—' : nf(x.v, d) + unit}</b>${deltaOf ? `<span class="dl">${deltaOf(x) || ''}</span>` : ''}${x.sub ? `<em>${esc(x.sub)}</em>` : ''}</div>`).join('')}</div>`;
}
// One 100% bar of parts [{n, c, v}]
function share(parts) {
  const tot = parts.reduce((s, p) => s + p.v, 0);
  if (!tot) return '<p class="an-empty">Немає відповідей.</p>';
  return `<div class="an-share">${parts.filter((p) => p.v).map((p) => `<i style="flex:${p.v};background:${p.c}" title="${esc(p.n)}: ${p.v} (${nf((p.v / tot) * 100)}%)"></i>`).join('')}</div>
    <div class="an-legend">${parts.map((p) => `<span><i style="background:${p.c}"></i>${esc(p.n)} · <b>${nf((p.v / tot) * 100)}%</b></span>`).join('')}</div>`;
}

// ── styles (scoped to .an; injected once) ────────────────────────────────────
const CSS = `
.an{--an-g:#2E9E5B;--an-b:#D64545;display:flex;flex-direction:column;gap:12px;color:var(--ink);font-size:13px;min-width:0}
.an *{box-sizing:border-box}
.an button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
.an-bar0{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.an-seg{display:inline-flex;background:var(--chip);border-radius:11px;padding:3px;gap:2px}
.an-seg button{padding:6px 11px;border-radius:8px;font-weight:800;font-size:12.5px;color:var(--muted);white-space:nowrap}
.an-seg button[aria-pressed=true]{background:var(--panel-solid);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.an select,.an input[type=date]{font:inherit;font-size:12.5px;font-weight:700;color:var(--ink);background:var(--chip);border:0;border-radius:10px;padding:7px 10px;min-width:0}
.an-sp{flex:1}
.an-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;background:var(--chip);font-weight:800;font-size:12.5px}
.an-btn:hover{filter:brightness(.97)}.an-btn.pri{background:var(--red);color:#fff}
.an-btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.an-range{font-size:12px;color:var(--muted);font-weight:700}
.an-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.an-tabs::-webkit-scrollbar{display:none}
.an-tabs button{padding:8px 12px;font-weight:800;color:var(--muted);border-bottom:2.5px solid transparent;margin-bottom:-1px;white-space:nowrap}
.an-tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--red)}
.an-tabs button b{margin-left:5px;font-size:10.5px;background:var(--red);color:#fff;border-radius:999px;padding:1px 6px}
.an-body{min-width:0}
.an-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.an-tile{background:var(--chip);border-radius:14px;padding:10px 13px;min-width:0}
.an-tile b{display:block;font-size:24px;font-weight:900;line-height:1.15;font-variant-numeric:tabular-nums}
.an-tile span{display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin-top:2px}
.an-d{display:inline-block;font-size:11.5px;font-weight:800;margin-top:4px}.an-d.g{color:var(--an-g)}.an-d.b{color:var(--an-b)}.an-d.n{color:var(--muted)}
.an-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;margin-top:4px}
.an-card{background:var(--panel-solid);border:1px solid var(--line);border-radius:14px;padding:12px 14px;min-width:0}
.an-card h5{margin:0 0 8px;font-size:13px;font-weight:900;color:var(--ink)}.an-card h5 small{font-weight:700;color:var(--muted)}
.an-card.wide{grid-column:1/-1}
.an-chart{width:100%;min-width:0}.an-chart svg{display:block;overflow:visible;max-width:100%}
.an .ax{font-size:10.5px;fill:var(--muted);font-weight:700}.an .gl{stroke:var(--line);stroke-width:1}
.an .an-x{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}
.an-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:11.5px;font-weight:700;color:var(--muted)}
.an-legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.an-hb{display:flex;flex-direction:column;gap:7px}
.an-hbr{display:grid;grid-template-columns:minmax(70px,32%) 1fr auto auto;align-items:center;gap:8px;font-size:12.5px}
.an-hbr .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;text-align:right}
.an-hbr .t{height:12px;background:var(--chip);border-radius:6px;overflow:hidden}.an-hbr .t i{display:block;height:100%;background:var(--viz);border-radius:6px}
.an-hbr b{font-variant-numeric:tabular-nums;font-weight:900;min-width:38px;text-align:right}
.an-hbr .dl{min-width:54px;text-align:right}.an-hbr .dl .an-d{margin:0}
.an-hbr em{grid-column:2/-1;font-style:normal;font-size:11px;color:var(--muted);margin-top:-4px}
.an-share{display:flex;height:16px;border-radius:8px;overflow:hidden;gap:2px}
.an-empty{color:var(--muted);font-weight:700;margin:6px 0}
.an-att{display:flex;flex-direction:column;gap:6px}
.an-ati{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:var(--chip);text-align:left;width:100%}
.an-ati .av{width:30px;height:30px;border-radius:50%;background:var(--red);color:#fff;display:grid;place-items:center;font-weight:900;font-size:12px;flex:none}
.an-ati .nm{flex:1;min-width:0}.an-ati .nm b{display:block;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.an-ati .nm b>span{font-size:11.5px;color:var(--muted);font-weight:700}
.an-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.an-chip{font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--an-b) 16%,transparent);color:var(--an-b);white-space:nowrap}
.an-chip.q{background:color-mix(in srgb,#8A8F98 22%,transparent);color:var(--muted)}
.an-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.an-tbl th{text-align:left;font-size:11px;color:var(--muted);font-weight:800;padding:6px;border-bottom:1px solid var(--line);white-space:nowrap}
.an-tbl td{padding:7px 6px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
.an-tbl .r{text-align:right}
.an-scroll{overflow-x:auto}
.an-link{cursor:pointer}.an-link:hover{background:color-mix(in srgb,var(--viz) 8%,transparent)}
.an-sheet{overflow:auto;max-height:62vh;border:1px solid var(--line);border-radius:12px}
.an-sheet table{border-collapse:separate;border-spacing:0;font-size:11.5px}
.an-sheet th,.an-sheet td{padding:0;height:24px;text-align:center;border-bottom:1px solid var(--line)}
.an-sheet thead th{position:sticky;top:0;background:var(--panel-solid);z-index:2;font-weight:800;color:var(--muted);min-width:22px;height:34px;line-height:1.1}
.an-sheet thead th.we{color:var(--an-b)}
.an-sheet .nm{position:sticky;left:0;background:var(--panel-solid);z-index:1;text-align:left;padding:0 10px;white-space:nowrap;font-weight:800;max-width:180px;overflow:hidden;text-overflow:ellipsis;border-right:1px solid var(--line)}
.an-sheet thead .nm{z-index:3}
.an-sheet td.c i{display:block;width:16px;height:16px;border-radius:4px;margin:0 auto}
.an-sheet td.we{background:color-mix(in srgb,var(--muted) 9%,transparent)}
.an-sheet td.tot{font-weight:800;padding:0 7px;font-variant-numeric:tabular-nums}
.an-sheet td.tot:first-of-type{border-left:1px solid var(--line)}
.an-tip{position:fixed;pointer-events:none;z-index:2147483000;background:var(--ink);color:var(--panel-solid);font-size:12px;font-weight:800;padding:6px 9px;border-radius:9px;display:none;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.2)}
.an-prog{height:8px;background:var(--chip);border-radius:4px;overflow:hidden;min-width:60px}.an-prog i{display:block;height:100%;background:var(--an-g)}
.an-ov{position:fixed;inset:0;z-index:2147482000;background:rgba(10,8,14,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.an-pc{background:var(--panel-solid);color:var(--ink);border-radius:18px;width:min(760px,100%);max-height:calc(100% - 20px);overflow:auto;padding:16px 18px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
.an-pc header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.an-pc header .av{width:44px;height:44px;font-size:16px}
.an-pc header h4{margin:0;font-size:18px;font-weight:900}.an-pc header p{margin:2px 0 0;color:var(--muted);font-weight:700;font-size:12.5px}
.an-pc .x{margin-left:auto;font-size:22px;line-height:1;padding:2px 8px;border-radius:8px;color:var(--muted)}
.an-tl{display:flex;gap:2px;flex-wrap:wrap}
.an-tl span{width:18px;display:flex;flex-direction:column;align-items:center;gap:2px}
.an-tl span i{width:18px;height:18px;border-radius:4px;background:var(--chip)}
.an-tl span u{width:7px;height:7px;border-radius:50%;background:transparent}
.an-tl span.we i{opacity:.45}
.an-load{opacity:.55;pointer-events:none;transition:opacity .2s}
.an.compact .an-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
.an.compact .an-tile b{font-size:21px}
.an.compact .an-sheet{max-height:none}
.an.compact .an-hbr{grid-template-columns:minmax(60px,34%) 1fr auto}
.an.compact .an-hbr .dl{display:none}
@media (max-width:560px){.an-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.an-hbr{grid-template-columns:minmax(60px,34%) 1fr auto}.an-hbr .dl{display:none}}
`;
function injectCss() {
  if (document.getElementById('an-css')) return;
  const s = document.createElement('style'); s.id = 'an-css'; s.textContent = CSS; document.head.appendChild(s);
}
const ICON = {
  xls: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13l4 5M13 13l-4 5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 15h6M9 18h4"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  min: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3 11l17-7-7 17-2.6-6.6L3 11Z"/></svg>',
  ref: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
};
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// ── the view ─────────────────────────────────────────────────────────────────
export function mountAnalytics(root, opt) {
  injectCss();
  const KEY = opt.storeKey || 'alliancesim.analytics.v2';
  const st = Object.assign({ tab: 'overview', period: '30', from: '', to: '', dept: 'all' }, store.get(KEY, {}));
  let data = null, seq = 0, full = false;
  const closers = new Set();
  // Tip + person card live in a themed layer (the shell's root: #app or the phone) so they
  // inherit --ink/--viz/… and the dark theme.
  const layer = () => opt.layer || root.closest('#app') || document.body;
  const tip = document.createElement('div'); tip.className = 'an-tip'; document.body.appendChild(tip);
  const showTip = (ev, html) => { const cs = getComputedStyle(root); tip.style.background = cs.getPropertyValue('--ink'); tip.style.color = cs.getPropertyValue('--panel-solid'); tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth; tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, ev.clientX + 12)) + 'px'; tip.style.top = Math.max(6, ev.clientY - 40) + 'px'; };
  const hideTip = () => { tip.style.display = 'none'; };
  root.classList.add('an'); if (opt.compact) root.classList.add('compact');

  const q = () => {
    const p = new URLSearchParams();
    if (st.period === 'custom' && st.from && st.to) { p.set('from', st.from); p.set('to', st.to); } else p.set('days', st.period === 'custom' ? '30' : st.period);
    if (st.dept && st.dept !== 'all') p.set('dept', st.dept);
    return p.toString();
  };
  const save = () => store.set(KEY, { tab: st.tab, period: st.period, from: st.from, to: st.to, dept: st.dept });

  async function load() {
    const my = ++seq; root.querySelector('.an-body')?.classList.add('an-load');
    try { const a = await opt.get('/v2?' + q()); if (my !== seq) return; data = a; if (st.dept !== 'all' && !a.depts.includes(st.dept)) { st.dept = 'all'; save(); return load(); } render(); }
    catch (e) { if (my !== seq) return; root.innerHTML = `<p class="an-empty">Не вдалося завантажити аналітику${e && e.code ? ` (${e.code})` : ''}.</p><button class="an-btn" data-retry>${ICON.ref} Спробувати ще</button>`; root.querySelector('[data-retry]').onclick = load; }
  }

  function toolbar(a) {
    const per = [['7', '7 днів'], ['30', '30 днів'], ['90', '90 днів'], ['custom', 'Період']];
    return `<div class="an-bar0">
      <div class="an-seg" role="group" aria-label="Період">${per.map(([k, n]) => `<button type="button" data-per="${k}" aria-pressed="${st.period === k}">${n}</button>`).join('')}</div>
      ${st.period === 'custom' ? `<input type="date" data-from value="${esc(st.from || a.range.from)}" max="${a.today}" aria-label="З"><input type="date" data-to value="${esc(st.to || a.range.to)}" max="${a.today}" aria-label="По">` : ''}
      <select data-dept aria-label="Відділ"><option value="all">Усі відділи</option>${a.depts.map((d) => `<option ${st.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
      <span class="an-sp"></span>
      ${opt.exportMode === 'chat' ? `<button type="button" class="an-btn" data-exp="both" title="Надіслати Excel і PDF у чат із ботом">${ICON.send} Excel + PDF у чат</button>`
        : `<button type="button" class="an-btn" data-exp="xlsx" title="Завантажити Excel">${ICON.xls} Excel</button>
      <button type="button" class="an-btn" data-exp="pdf" title="Завантажити PDF-звіт">${ICON.pdf} PDF</button>`}
      ${opt.fullscreen ? `<button type="button" class="an-btn" data-full title="${full ? 'Згорнути' : 'На весь екран'}" aria-label="${full ? 'Згорнути' : 'На весь екран'}">${full ? ICON.min : ICON.full}</button>` : ''}
    </div>
    <div class="an-range">${fFull(a.range.from)} — ${fFull(a.range.to)} · ${a.range.days} дн., робочих ${a.range.workdays} · порівняння з ${fFull(a.prev.from)} — ${fFull(a.prev.to)}${a.dept ? ' · ' + esc(a.dept) : ''}</div>
    <div class="an-tabs" role="tablist">${TABS.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${n}${k === 'overview' && a.attention.length ? `<b>${a.attention.length}</b>` : ''}</button>`).join('')}</div>`;
  }

  const tile = (v, label, dl = '') => `<div class="an-tile"><b>${v}</b><span>${label}</span>${dl}</div>`;
  const attList = (a) => (a.attention.length ? `<div class="an-att">${a.attention.map((x) => `<button type="button" class="an-ati an-link" data-person="${esc(x.id)}">
      <span class="av">${esc(initials(x.name))}</span><span class="nm"><b>${esc(x.name)} <span>· ${esc(x.dept)}</span></b>
      <span class="an-chips">${x.reasons.map((r) => `<span class="an-chip ${r.code === 'quiet' ? 'q' : ''}">${esc(reason(r))}</span>`).join('')}</span></span></button>`).join('')}</div>`
    : '<p class="an-empty">Усі в нормі — сигналів немає</p>');

  const SECTIONS = {
    overview(a) {
      const k = a.kpi, t = k.today;
      return `<div class="an-tiles">
        ${tile(k.headcount, `працівників · у Telegram ${k.linked}`)}
        ${tile(t.office, 'сьогодні в офісі')}
        ${tile(t.remote, 'сьогодні віддалено')}
        ${tile(`${t.vacation} / ${t.sick}`, 'відпустка / лікарняний')}
        ${tile(k.mood.v == null ? '—' : nf(k.mood.v, 2), 'середній настрій, 1–5', delta(k.mood.v, k.mood.prev, { d: 2 }))}
        ${tile(k.checkin.v == null ? '—' : nf(k.checkin.v) + '%', 'відповідають на check-in', delta(k.checkin.v, k.checkin.prev, { unit: ' п.п.' }))}
        ${tile(k.remoteShare.v == null ? '—' : nf(k.remoteShare.v) + '%', 'частка віддаленої роботи', delta(k.remoteShare.v, k.remoteShare.prev, { unit: ' п.п.', good: 0 }))}
        ${tile(k.pulse.v == null ? '—' : nf(k.pulse.v, 2), 'пульс тижня, 1–5 (анонімно)', delta(k.pulse.v, k.pulse.prev, { d: 2 }))}
      </div>
      <div class="an-grid">
        <div class="an-card"><h5>Потребують уваги <small>· ${a.attention.length}</small></h5>${attList(a)}
          <p class="an-empty" style="font-size:11px;font-weight:600">Сигнали: 5+ робочих днів без check-in · «втомлений/стрес» 3 рази поспіль · настрій за тиждень нижчий за звичний на 1+ бал.</p></div>
        <div class="an-card"><h5>Настрій команди <small>· середнє за день</small></h5>${lineChart(a.mood.daily.map((d) => ({ day: d.day, v: d.avg, n: d.n })), { label: 'Настрій' })}</div>
        <div class="an-card"><h5>Сьогодні</h5>${share(STATUS.map((s) => ({ n: s.n, c: s.c, v: t[s.k] })))}</div>
        <div class="an-card"><h5>Check-in по відділах <small>· частка відповідей</small></h5>${hbars(a.engagement.byDept.map((d) => ({ label: d.dept, v: d.rate, prev: d.prev })), { max: 100, unit: '%', deltaOf: (x) => delta(x.v, x.prev, { unit: '' }) })}</div>
      </div>`;
    },
    presence(a) {
      const p = a.presence;
      return `<div class="an-grid">
        <div class="an-card wide"><h5>Статуси по днях <small>· вихідні бліді</small></h5>${stackedDays(p.daily)}</div>
        <div class="an-card"><h5>Завантаженість офісу по днях тижня <small>· середня кількість людей</small></h5>${hbars(p.weekday.map((w) => ({ label: WD[w.wd], v: w.office, color: SC.office.c, sub: w.remote != null ? `віддалено в середньому ${nf(w.remote)}` : '' })))}</div>
        <div class="an-card"><h5>Віддалена робота по відділах <small>· частка робочих днів «з дому»</small></h5>${hbars(p.byDept.map((d) => ({ label: d.dept, v: d.remoteShare, color: SC.remote.c })), { max: 100, unit: '%' })}</div>
        <div class="an-card wide"><h5>По відділах <small>· людино-дні, лише робочі</small></h5><div class="an-scroll"><table class="an-tbl"><thead><tr><th>Відділ</th><th class="r">Людей</th>${STATUS.map((s) => `<th class="r">${s.n}</th>`).join('')}<th class="r">Віддалено, %</th></tr></thead>
          <tbody>${p.byDept.map((d) => `<tr><td><b>${esc(d.dept)}</b></td><td class="r">${d.people}</td>${STATUS.map((s) => `<td class="r">${d[s.k]}</td>`).join('')}<td class="r">${nf(d.remoteShare)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="an-card wide"><h5>Табель <small>· натисніть на ім’я — картка працівника; підсумки — робочі дні</small></h5>${sheet(p.sheet)}${legend(STATUS)}</div>
      </div>`;
    },
    mood(a) {
      return `<div class="an-grid">
        <div class="an-card wide"><h5>Середній настрій по днях <small>· 1 — у стресі, 5 — чудовий</small></h5>${lineChart(a.mood.daily.map((d) => ({ day: d.day, v: d.avg, n: d.n })), { label: 'Настрій' })}</div>
        <div class="an-card"><h5>Розподіл відповідей</h5>${share(MOOD.map((m) => ({ n: m.n, c: m.c, v: a.mood.dist[m.k] || 0 })))}</div>
        <div class="an-card"><h5>По відділах <small>· Δ до попереднього періоду</small></h5>${hbars(a.mood.byDept.map((d) => ({ label: d.dept, v: d.avg, prev: d.prev, sub: d.n ? `${d.n} відповідей` : 'немає відповідей' })), { max: 5, d: 2, deltaOf: (x) => delta(x.v, x.prev, { d: 2 }) })}</div>
        <div class="an-card wide"><h5>Пульс тижня <small>· анонімно: середнє лише для груп від ${a.pulse.minGroup} людей</small></h5><div class="an-scroll"><table class="an-tbl"><thead><tr><th>Тиждень</th><th>Питання</th><th class="r">Відповідей</th><th class="r">Середнє</th></tr></thead>
          <tbody>${a.pulse.weeks.map((w) => `<tr><td>${esc(w.week)}</td><td>${esc(w.question)}</td><td class="r">${w.n}</td><td class="r"><b>${w.avg == null ? (w.n ? 'мала група' : '—') : nf(w.avg, 2)}</b></td></tr>`).join('')}</tbody></table></div></div>
      </div>`;
    },
    engagement(a) {
      return `<div class="an-grid">
        <div class="an-card wide"><h5>Відповіді на ранковий check-in <small>· % від тих, хто мав працювати (без відпусток і лікарняних)</small></h5>${lineChart(a.engagement.daily.map((d) => ({ day: d.day, v: d.rate, n: d.n })), { min: 0, max: 100, pct: true, unit: '%', label: 'Check-in' })}</div>
        <div class="an-card"><h5>Check-in по відділах</h5>${hbars(a.engagement.byDept.map((d) => ({ label: d.dept, v: d.rate, prev: d.prev, sub: `у Telegram: ${d.linked}` })), { max: 100, unit: '%', deltaOf: (x) => delta(x.v, x.prev) })}</div>
        <div class="an-card"><h5>Участь у пульсі <small>· % людей у Telegram</small></h5>${hbars(a.engagement.pulse.map((w) => ({ label: w.week, v: w.rate, sub: `${w.n} відповідей` })), { max: 100, unit: '%' })}</div>
        <div class="an-card wide"><h5>Давно не відмічались</h5>${(() => { const xs = a.attention.filter((x) => x.reasons.some((r) => r.code === 'quiet')); return xs.length ? attList({ attention: xs }) : '<p class="an-empty">Усі відмічаються</p>'; })()}</div>
      </div>`;
    },
    people(a) {
      const pp = a.people;
      return `<div class="an-grid">
        <div class="an-card"><h5>Чисельність по відділах</h5>${hbars(pp.byDept.map((d) => ({ label: d.dept, v: d.n, sub: `у Telegram: ${d.linked}` })), { d: 0 })}</div>
        <div class="an-card"><h5>Стаж</h5>${hbars(pp.tenure.map((t) => ({ label: t.label, v: t.n })), { d: 0 })}</div>
        <div class="an-card"><h5>Новачки та онбординг <small>· перші 60 днів</small></h5>${pp.newcomers.length ? `<table class="an-tbl"><tbody>${pp.newcomers.map((n) => `<tr class="an-link" data-person="${esc(n.id)}"><td><b>${esc(n.name)}</b><br><small style="color:var(--muted)">${esc(n.dept)} · день ${n.day}</small></td><td style="width:40%"><div class="an-prog"><i style="width:${n.total ? (n.done / n.total) * 100 : 0}%"></i></div></td><td class="r">${n.done}/${n.total}</td></tr>`).join('')}</tbody></table>` : '<p class="an-empty">Новачків немає. Дата найму — у картці співробітника.</p>'}</div>
        <div class="an-card"><h5>Найближчі 30 днів</h5>${pp.upcoming.length ? `<table class="an-tbl"><tbody>${pp.upcoming.map((u) => `<tr class="an-link" data-person="${esc(u.id)}"><td>${u.kind === 'birthday' ? '🎂' : '🏅'} <b>${esc(u.name)}</b><br><small style="color:var(--muted)">${u.kind === 'birthday' ? 'день народження' : `${u.years} р. у компанії`}</small></td><td class="r">${fD(u.date)}<br><small style="color:var(--muted)">${u.inDays === 0 ? 'сьогодні' : u.inDays === 1 ? 'завтра' : `через ${u.inDays} дн.`}</small></td></tr>`).join('')}</tbody></table>` : '<p class="an-empty">Подій немає.</p>'}</div>
      </div>`;
    },
  };

  function sheet(s) {
    if (!s.people.length) return '<p class="an-empty">Немає людей.</p>';
    const head = s.days.map((d) => { const we = !isWork(d), first = d.endsWith('-01') || d === s.days[0]; return `<th class="${we ? 'we' : ''}" title="${fFull(d)}">${first ? `<small>${MON[+d.slice(5, 7) - 1]}</small><br>` : '<br>'}${+d.slice(8, 10)}</th>`; }).join('');
    return `<div class="an-sheet"><table><thead><tr><th class="nm">Працівник</th>${head}${STATUS.map((x) => `<th title="${x.n}" style="padding:0 6px"><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${x.c}"></i></th>`).join('')}</tr></thead>
      <tbody>${s.people.map((p, r) => `<tr><td class="nm an-link" data-person="${esc(p.id)}" tabindex="0" role="button" title="${esc(p.name)} · ${esc(p.dept)}">${esc(p.name)}</td>${p.cells.map((c, i) => `<td class="c${isWork(s.days[i]) ? '' : ' we'}" data-sc="${r}:${i}">${c ? `<i style="background:${SC[c].c}"></i>` : ''}</td>`).join('')}${STATUS.map((x) => `<td class="tot" title="${x.n}">${p.totals[x.k] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    const a = data; hideTip();
    root.innerHTML = toolbar(a) + `<div class="an-body" role="tabpanel">${SECTIONS[st.tab](a)}</div>`;
    wire();
  }

  function wire() {
    root.querySelectorAll('[data-per]').forEach((b) => b.onclick = () => { st.period = b.dataset.per; if (st.period === 'custom' && !st.from) { st.from = data.range.from; st.to = data.range.to; } save(); load(); });
    const f = root.querySelector('[data-from]'), t = root.querySelector('[data-to]');
    if (f && t) { const ch = () => { if (f.value && t.value) { st.from = f.value; st.to = t.value; save(); load(); } }; f.onchange = ch; t.onchange = ch; }
    const dsel = root.querySelector('[data-dept]'); if (dsel) dsel.onchange = () => { st.dept = dsel.value; save(); load(); };
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; save(); render(); });
    const tl = root.querySelector('.an-tabs');
    if (tl) tl.onkeydown = (e) => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const i = TABS.findIndex(([k]) => k === st.tab), n = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length; st.tab = TABS[n][0]; save(); render(); root.querySelector(`[data-tab="${st.tab}"]`)?.focus(); };
    root.querySelectorAll('[data-exp]').forEach((b) => b.onclick = async () => {
      b.disabled = true; const old = b.innerHTML; b.innerHTML = old.replace(/(Excel|PDF|у чат)$/, '…');
      try { await opt.exportFile(b.dataset.exp, q()); } catch (e) { opt.toast && opt.toast('Не вдалося сформувати файл'); }
      b.disabled = false; b.innerHTML = old;
    });
    const fb = root.querySelector('[data-full]'); if (fb) fb.onclick = () => { full = !full; opt.fullscreen(full); render(); };
    root.querySelectorAll('[data-person]').forEach((el) => { el.onclick = () => openPerson(el.dataset.person); el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPerson(el.dataset.person); } }; });
    paintAll(root);
    const sh = root.querySelector('.an-sheet');
    if (sh) { sh.onpointerover = (ev) => { const c = ev.target.closest('[data-sc]'); if (!c) return hideTip(); const [r, i] = c.dataset.sc.split(':').map(Number), sh0 = data.presence.sheet, p = sh0.people[r], d = sh0.days[i], s = p && p.cells[i]; if (!p) return; showTip(ev, `${esc(p.name)} · ${WD[wdOf(d)]}, ${fD(d)} · ${s && SC[s] ? SC[s].n : 'немає даних'}`); }; sh.onpointerleave = hideTip; }
  }

  // ── charts: paint at the real width, tooltips ──
  function paint(el) {
    const s = JSON.parse(el.dataset.spec), W = Math.max(220, Math.floor(el.clientWidth || 600));
    el.dataset.w = W;
    if (el.dataset.kind === 'stack') {
      el.innerHTML = stackSvg(s, W);
      el.querySelectorAll('.an-bar').forEach((g) => { const d = s.d[+g.dataset.i];
        g.onpointermove = (ev) => showTip(ev, `${WD[wdOf(d.day)]}, ${fD(d.day)} · ${STATUS.filter((x) => d[x.k]).map((x) => `${x.n}: ${d[x.k]}`).join(' · ') || 'немає даних'}`); g.onpointerleave = hideTip; });
      return;
    }
    el.innerHTML = lineSvg(s, W);
    const L = 36, R = 14, T = 12, B = 24, H = 190, n = Math.max(1, s.p.length - 1);
    const hit = el.querySelector('.an-hit'), xl = el.querySelector('.an-x'), dot = el.querySelector('.an-dot');
    const move = (ev) => {
      const r = el.querySelector('svg').getBoundingClientRect(), i = Math.max(0, Math.min(s.p.length - 1, Math.round(((ev.clientX - r.left - L) / (W - L - R)) * n))), [day, v, cnt] = s.p[i];
      const X = L + (i * (W - L - R)) / n; xl.setAttribute('x1', X); xl.setAttribute('x2', X); xl.style.display = '';
      if (v != null) { dot.setAttribute('cx', X); dot.setAttribute('cy', T + ((s.max - v) * (H - T - B)) / (s.max - s.min)); dot.style.display = ''; } else dot.style.display = 'none';
      const val = v == null ? (s.moods ? 'немає відповіді' : 'немає даних') : s.moods ? MOOD.find((m) => m.v === v).n : nf(v, 2) + s.unit;
      showTip(ev, `${WD[wdOf(day)]}, ${fD(day)} · ${val}${cnt != null && v != null ? ` · відповідей: ${cnt}` : ''}`);
    };
    hit.onpointermove = move; hit.onpointerdown = move; hit.onpointerleave = () => { xl.style.display = 'none'; dot.style.display = 'none'; hideTip(); };
  }
  const paintAll = (scope) => scope.querySelectorAll('.an-chart[data-kind]').forEach(paint);
  let rsT = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(rsT); rsT = setTimeout(() => {
    document.querySelectorAll('.an-chart[data-kind]').forEach((el) => { if ((root.contains(el) || el.closest('.an-ov')) && Math.abs((+el.dataset.w || 0) - el.clientWidth) > 4) paint(el); }); }, 80); }) : null;
  if (ro) ro.observe(root);

  // ── person card ──
  async function openPerson(id) {
    hideTip();
    const ov = document.createElement('div'); ov.className = 'an-ov an'; ov.innerHTML = '<div class="an-pc" role="dialog" aria-modal="true" aria-label="Картка працівника"><p class="an-empty">Завантаження…</p></div>';
    layer().appendChild(ov);
    const box = ov.querySelector('.an-pc');
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); hideTip(); closers.delete(close); if (ro) ro.unobserve(box); };
    closers.add(close);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.onclick = (e) => { if (e.target === ov) close(); };
    let p;
    try { p = await opt.get(`/person/${encodeURIComponent(id)}?` + q()); } catch (e) { box.innerHTML = '<p class="an-empty">Не вдалося завантажити картку.</p>'; return; }
    if (!ov.isConnected) return;
    box.innerHTML = `<header><span class="an-ati" style="all:unset"><span class="av" style="width:44px;height:44px;border-radius:50%;background:var(--red);color:#fff;display:grid;place-items:center;font-weight:900">${esc(initials(p.name))}</span></span>
        <div><h4>${esc(p.name)}</h4><p>${esc([p.position, p.dept].filter(Boolean).join(' · '))}${p.hiredOn ? ` · з ${fFull(p.hiredOn)}` : ''}${p.linked ? '' : ' · не підключений до Telegram'}</p></div>
        <button type="button" class="x" aria-label="Закрити">×</button></header>
      ${p.attention.length ? `<div class="an-chips" style="justify-content:flex-start;margin-bottom:10px">${p.attention.map((r) => `<span class="an-chip ${r.code === 'quiet' ? 'q' : ''}">${esc(reason(r))}</span>`).join('')}</div>` : ''}
      <div class="an-tiles">
        ${tile(esc(SC[p.status]?.n || p.status || '—'), 'статус зараз')}
        ${tile(p.moodAvg == null ? '—' : nf(p.moodAvg, 2), `середній настрій · ${p.moodN} відп.`)}
        ${tile(p.checkin == null ? '—' : nf(p.checkin) + '%', 'відповідає на check-in')}
        ${tile(p.totals.office, `днів в офісі · віддалено ${p.totals.remote}`)}
      </div>
      <div class="an-card" style="margin-top:12px"><h5>Статуси по днях <small>· ${fFull(p.range.from)} — ${fFull(p.range.to)}; крапка — настрій</small></h5>
        <div class="an-tl">${p.timeline.map((d) => `<span class="${d.work ? '' : 'we'}" data-tl="${esc(d.day)}|${esc(SC[d.status] ? d.status : '')}|${esc(MC[d.mood] ? d.mood : '')}"><i style="${SC[d.status] ? `background:${SC[d.status].c}` : ''}"></i><u style="${MC[d.mood] ? `background:${MC[d.mood].c}` : ''}"></u></span>`).join('')}</div>
        ${legend(STATUS)}${legend(MOOD)}</div>
      <div class="an-card" style="margin-top:12px"><h5>Настрій по днях <small>· особисті відповіді на check-in</small></h5>${lineChart(p.timeline.map((d) => ({ day: d.day, v: MC[d.mood] ? MC[d.mood].v : null })), { label: 'Настрій', step: 1, moods: true })}</div>
      <div class="an-card" style="margin-top:12px"><h5>Підсумки за період <small>· робочі дні</small></h5>${hbars(STATUS.map((s) => ({ label: s.n, v: p.totals[s.k], color: s.c })), { d: 0 })}</div>
      ${p.onboarding ? `<div class="an-card" style="margin-top:12px"><h5>Онбординг <small>· день ${p.onboarding.day}</small></h5><table class="an-tbl"><tbody>${p.onboarding.items.map((i) => `<tr><td>${i.done ? '✅' : '⬜️'} ${esc(i.text)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="an-empty" style="font-size:11px;font-weight:600">Відповіді на анонімний пульс тижня тут не показуються.</p>`;
    box.querySelector('.x').onclick = close; box.querySelector('.x').focus();
    box.querySelectorAll('[data-tl]').forEach((el) => { const [d, s, m] = el.dataset.tl.split('|'); el.onpointermove = (ev) => showTip(ev, `${WD[wdOf(d)]}, ${fD(d)} · ${s ? SC[s].n : 'немає даних'}${m ? ' · ' + MC[m].n : ''}`); el.onpointerleave = hideTip; });
    paintAll(box); if (ro) ro.observe(box);
  }

  root.innerHTML = '<p class="an-empty">Завантаження аналітики…</p>';
  load();
  const exitFull = () => { if (!full) return; full = false; opt.fullscreen && opt.fullscreen(false); if (data) render(); };
  const onEsc = (e) => { if (e.key === 'Escape' && full && !closers.size) exitFull(); };
  document.addEventListener('keydown', onEsc);
  return { reload: load, exitFull,
    destroy() { exitFull(); [...closers].forEach((c) => c()); document.removeEventListener('keydown', onEsc); if (ro) ro.disconnect(); tip.remove(); root.innerHTML = ''; } };
}
