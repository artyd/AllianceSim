// Daily HR report: who is where and in what mood, rendered as a PNG card.
// SVG is built by hand and rasterised with resvg (no headless browser). Emoji don't
// render reliably without a colour-emoji font, so status/mood are coloured pills/dots.
import { Resvg } from '@resvg/resvg-js';
import { STATUS, statusName, moodName } from './config.js';

const FONT = "DejaVu Sans, Segoe UI, Arial, sans-serif";
const STATUS_COLOR = { office: '#2E9E5B', remote: '#3E7BD6', absent: '#8A8F98', sick: '#D64545', vacation: '#E08A1E' };
const MOOD_COLOR = { great: '#2E9E5B', good: '#7BC043', ok: '#E0B21E', tired: '#8E6BD6', stressed: '#D64545' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Parts of a Date as seen in `tz` (day key + hour) — for "answered after today's check-in".
function tzParts(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// Linked people who haven't touched their card since this morning's check-in went out.
export function answeredToday(e, now, tz, checkinHour) {
  if (!e.updated_at) return false;
  const u = tzParts(new Date(e.updated_at), tz), n = tzParts(now, tz);
  return u.day === n.day && u.hour >= checkinHour;
}

// Group by department, case/space-insensitive ("Продажі" == "продажі "), first spelling wins.
function groupByDept(list) {
  const groups = new Map();
  for (const e of list) {
    const raw = (e.dept || '').trim() || 'Без відділу';
    const key = raw.toLocaleLowerCase('uk');
    if (!groups.has(key)) groups.set(key, { name: raw[0].toLocaleUpperCase('uk') + raw.slice(1), people: [] });
    groups.get(key).people.push(e);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

function pill(x, y, text, color, w) {
  return `<rect x="${x}" y="${y - 17}" width="${w}" height="24" rx="12" fill="${color}" fill-opacity="0.14"/>` +
    `<circle cx="${x + 13}" cy="${y - 5}" r="5" fill="${color}"/>` +
    `<text x="${x + 25}" y="${y}" font-size="15" fill="${color}" font-weight="bold">${esc(text)}</text>`;
}

export function renderReport(list, { now = new Date(), tz = 'Europe/Kyiv', checkinHour = 9 } = {}) {
  const W = 900, PAD = 36, ROW = 34;
  const counts = Object.fromEntries(STATUS.map((s) => [s.key, 0]));
  for (const e of list) if (e.status in counts) counts[e.status]++;
  const pending = list.filter((e) => e.telegram_id && !answeredToday(e, now, tz, checkinHour));
  const pendingIds = new Set(pending.map((e) => e.id));
  const groups = groupByDept(list);

  const dateStr = new Intl.DateTimeFormat('uk-UA', { timeZone: tz, day: '2-digit', month: '2-digit', weekday: 'long' }).format(now);
  const timeStr = new Intl.DateTimeFormat('uk-UA', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now);

  const out = [];
  let y = PAD + 30;
  out.push(`<text x="${PAD}" y="${y}" font-size="30" font-weight="bold" fill="#1D2330">Офіс сьогодні</text>`);
  out.push(`<text x="${W - PAD}" y="${y}" font-size="17" fill="#6B7280" text-anchor="end">${esc(dateStr)} · ${esc(timeStr)}</text>`);

  // Summary pills: one per status that has anyone in it.
  y += 46;
  let x = PAD;
  for (const s of STATUS) {
    if (!counts[s.key]) continue;
    const label = `${s.n}: ${counts[s.key]}`;
    const w = 40 + label.length * 9;
    out.push(pill(x, y, label, STATUS_COLOR[s.key], w));
    x += w + 10;
  }

  // Column headers.
  y += 40;
  const C_NAME = PAD, C_STATUS = 430, C_MOOD = 650;
  out.push(`<line x1="${PAD}" y1="${y - 22}" x2="${W - PAD}" y2="${y - 22}" stroke="#E5E7EB"/>`);

  for (const g of groups) {
    y += 14;
    out.push(`<text x="${PAD}" y="${y}" font-size="15" font-weight="bold" fill="#6B7280" letter-spacing="0.5">${esc(g.name.toUpperCase())}</text>`);
    y += ROW - 4;
    for (const e of g.people) {
      const st = statusName(e.status), md = moodName(e.mood);
      const stale = pendingIds.has(e.id) || !e.telegram_id;
      out.push(`<text x="${C_NAME + 8}" y="${y}" font-size="18" fill="#1D2330">${esc(e.name)}</text>`);
      out.push(pill(C_STATUS, y, st.n, STATUS_COLOR[st.key] || '#8A8F98', 40 + st.n.length * 9));
      out.push(`<circle cx="${C_MOOD + 8}" cy="${y - 6}" r="7" fill="${MOOD_COLOR[md.key] || '#8A8F98'}"/>`);
      out.push(`<text x="${C_MOOD + 22}" y="${y}" font-size="16" fill="#374151">${esc(md.n)}</text>`);
      if (stale) {
        const why = e.telegram_id ? 'не відповів(ла)' : 'без Telegram';
        out.push(`<text x="${W - PAD}" y="${y}" font-size="13" fill="#B45309" text-anchor="end">${why}</text>`);
      }
      y += ROW;
    }
  }

  y += 6;
  out.push(`<line x1="${PAD}" y1="${y - 20}" x2="${W - PAD}" y2="${y - 20}" stroke="#E5E7EB"/>`);
  const foot = pending.length
    ? `Ще не відповіли на ранкове опитування: ${pending.length} з ${list.filter((e) => e.telegram_id).length} — статус може бути вчорашнім`
    : 'Усі, хто має Telegram, відповіли на ранкове опитування';
  out.push(`<text x="${PAD}" y="${y + 4}" font-size="14" fill="#6B7280">${esc(foot)}</text>`);
  const H = y + PAD;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
    `<rect width="${W}" height="${H}" fill="#FFFFFF"/>` +
    `<rect x="0" y="0" width="${W}" height="6" fill="#E2001A"/>` +
    out.join('') + `</svg>`;

  const png = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 }, // crisp on phones
    font: { loadSystemFonts: true, fontDirs: ['/usr/share/fonts'], defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng();

  return { png, pending, counts };
}

// Short text caption that goes under the photo (also readable in notifications).
export function reportCaption({ pending, counts }, hrFirst) {
  const parts = STATUS.filter((s) => counts[s.key]).map((s) => `${s.icon} ${counts[s.key]}`);
  let t = `📊 ${hrFirst ? hrFirst + ', ' : ''}ранковий звіт по офісу\n${parts.join('   ')}`;
  if (pending.length) t += `\n⚠️ Не відповіли: ${pending.map((e) => e.name).join(', ')}`;
  return t;
}
