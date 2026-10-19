import fs from 'fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';


// Spec 008: Excel + PDF exports of buildAnalytics() output (same filters as the screen).
// Labels/colours match the bot report and the web charts.
const STATUSES = ['office', 'remote', 'absent', 'sick', 'vacation'];
export const STATUS_UA = { office: 'В офісі', remote: 'Віддалено', absent: 'Немає', sick: 'Хворіє', vacation: 'Відпустка' };
const STATUS_CODE = { office: 'О', remote: 'Д', absent: 'Н', sick: 'Х', vacation: 'В' };
export const STATUS_COLOR = { office: '#2E9E5B', remote: '#3E7BD6', absent: '#8A8F98', sick: '#D64545', vacation: '#E08A1E' };
const MOOD_UA = { great: 'Чудовий', good: 'Гарний', ok: 'Нормально', tired: 'Втомлений', stressed: 'У стресі' };
const MOOD_COLOR = { great: '#2E9E5B', good: '#7BC043', ok: '#E0B21E', tired: '#8E6BD6', stressed: '#D64545' };
const REASON_UA = (r) => (r.code === 'quiet' ? `не відмічається ${r.days} роб. дн.${r.last ? ' (востаннє ' + fmtD(r.last) + ')' : ''}`
  : r.code === 'low' ? 'низький настрій 3 відповіді поспіль'
  : r.code === 'drop' ? `настрій впав: ${r.base} → ${r.now}` : r.code);
const fmtD = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}`;
const fmtFull = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const delta = (v, p, unit = '') => { if (v == null || p == null) return ''; const d = Math.round((v - p) * 10) / 10; return d === 0 ? `= без змін` : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit}`; };
const num = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);
export const fileBase = (a) => `analytics_${a.range.from}_${a.range.to}${a.dept ? '_' + a.dept.replace(/[^\p{L}\p{N}]+/gu, '-') : ''}`;
const title = (a) => `Аналітика HR · ${fmtFull(a.range.from)} — ${fmtFull(a.range.to)}${a.dept ? ' · ' + a.dept : ' · усі відділи'}`;

export function kpiRows(a) {
  const k = a.kpi;
  return [
    ['Працівників', k.headcount, '', `із них у Telegram: ${k.linked}`],
    ['Сьогодні в офісі', k.today.office, '', ''],
    ['Сьогодні віддалено', k.today.remote, '', ''],
    ['Відпустка / лікарняний сьогодні', `${k.today.vacation} / ${k.today.sick}`, '', ''],
    ['Середній настрій (1–5)', num(k.mood.v), num(k.mood.prev), delta(k.mood.v, k.mood.prev)],
    ['Відповіді на check-in', num(k.checkin.v, '%'), num(k.checkin.prev, '%'), delta(k.checkin.v, k.checkin.prev, ' п.п.')],
    ['Частка віддаленої роботи', num(k.remoteShare.v, '%'), num(k.remoteShare.prev, '%'), delta(k.remoteShare.v, k.remoteShare.prev, ' п.п.')],
    ['Пульс тижня (1–5, анонімно)', num(k.pulse.v), num(k.pulse.prev), delta(k.pulse.v, k.pulse.prev)],
    ['Потребують уваги', k.attention, '', ''],
  ];
}

// ── Excel ────────────────────────────────────────────────────────────────────
const argb = (hex) => 'FF' + hex.replace('#', '').toUpperCase();
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8001A' } } };
function table(ws, header, rows, widths) {
  const h = ws.addRow(header);
  h.eachCell((c) => { c.font = HEAD.font; c.fill = HEAD.fill; c.alignment = { vertical: 'middle', wrapText: true }; });
  for (const r of rows) ws.addRow(r);
  if (widths) widths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, w); });
  ws.addRow([]);
}
const caption = (ws, text) => { const r = ws.addRow([text]); r.font = { bold: true, size: 13 }; };

export async function buildXlsx(a) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AllianceSim'; wb.created = new Date();

  const ov = wb.addWorksheet('Огляд');
  const t = ov.addRow([title(a)]); t.font = { bold: true, size: 15 };
  ov.addRow([`Попередній період для порівняння: ${fmtFull(a.prev.from)} — ${fmtFull(a.prev.to)}`]).font = { italic: true, color: { argb: 'FF6B7280' } };
  ov.addRow([]);
  table(ov, ['Показник', 'Значення', 'Попередній період', 'Зміна'], kpiRows(a), [36, 14, 18, 26]);
  caption(ov, 'Потребують уваги');
  table(ov, ['Працівник', 'Відділ', 'Причина'], a.attention.length ? a.attention.map((x) => [x.name, x.dept, x.reasons.map(REASON_UA).join('; ')]) : [['Усі в нормі', '', '']], [36, 14, 60]);

  // timesheet: people × days, coloured cells, totals by status (workdays)
  const sh = wb.addWorksheet('Табель', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const days = a.presence.sheet.days;
  sh.addRow(['Працівник', 'Відділ', ...days.map(fmtD), ...STATUSES.map((s) => STATUS_UA[s])]).eachCell((c) => { c.font = HEAD.font; c.fill = HEAD.fill; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  sh.getRow(1).height = 32;
  for (const p of a.presence.sheet.people) {
    const row = sh.addRow([p.name, p.dept, ...p.cells.map((c) => (c ? STATUS_CODE[c] : '')), ...STATUSES.map((s) => p.totals[s])]);
    p.cells.forEach((c, i) => {
      const cell = row.getCell(3 + i), wk = new Date(days[i] + 'T12:00:00Z').getUTCDay();
      cell.alignment = { horizontal: 'center' };
      if (c) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(STATUS_COLOR[c]) } }; cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }; }
      else if (wk === 0 || wk === 6) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });
  }
  sh.getColumn(1).width = 30; sh.getColumn(2).width = 14;
  for (let i = 0; i < days.length; i++) sh.getColumn(3 + i).width = 6;
  for (let i = 0; i < STATUSES.length; i++) sh.getColumn(3 + days.length + i).width = 11;
  sh.addRow([]);
  sh.addRow(['Позначки: ' + STATUSES.map((s) => `${STATUS_CODE[s]} — ${STATUS_UA[s]}`).join(', ') + '. Підсумки — лише робочі дні.']).font = { italic: true };

  const pr = wb.addWorksheet('Присутність');
  caption(pr, 'По днях');
  table(pr, ['Дата', ...STATUSES.map((s) => STATUS_UA[s])], a.presence.daily.map((d) => [fmtFull(d.day), ...STATUSES.map((s) => d[s])]), [14, 12, 12, 12, 12, 12]);
  caption(pr, 'Середнє по днях тижня');
  table(pr, ['День', 'В офісі', 'Віддалено'], a.presence.weekday.map((w) => [['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт'][w.wd], num(w.office), num(w.remote)]));
  caption(pr, 'По відділах (людино-дні, робочі дні)');
  table(pr, ['Відділ', 'Людей', ...STATUSES.map((s) => STATUS_UA[s]), 'Частка віддаленої'], a.presence.byDept.map((d) => [d.dept, d.people, ...STATUSES.map((s) => d[s]), num(d.remoteShare, '%')]));

  const md = wb.addWorksheet('Настрій');
  caption(md, 'Середній настрій по днях (1–5)');
  table(md, ['Дата', 'Середнє', 'Відповідей'], a.mood.daily.map((d) => [fmtFull(d.day), d.avg ?? '—', d.n]), [14, 12, 12]);
  caption(md, 'Розподіл відповідей');
  table(md, ['Настрій', 'Відповідей'], Object.entries(a.mood.dist).map(([k, n]) => [MOOD_UA[k], n]), [16, 12]);
  caption(md, 'По відділах');
  table(md, ['Відділ', 'Середнє', 'Попередній період', 'Відповідей'], a.mood.byDept.map((d) => [d.dept, num(d.avg), num(d.prev), d.n]), [16, 12, 18, 12]);
  caption(md, `Пульс тижня (анонімно; середнє лише для груп від ${a.pulse.minGroup} людей)`);
  table(md, ['Тиждень', 'Питання', 'Відповідей', 'Середнє'], a.pulse.weeks.map((w) => [w.week, w.question, w.n, num(w.avg)]), [12, 50, 12, 12]);

  const en = wb.addWorksheet('Залученість');
  caption(en, 'Відповіді на ранковий check-in (робочі дні, без відпусток/лікарняних)');
  table(en, ['Дата', 'Відповіли', 'Очікувалось', 'Частка'], a.engagement.daily.map((d) => [fmtFull(d.day), d.n, d.of, num(d.rate, '%')]), [14, 12, 14, 12]);
  caption(en, 'По відділах');
  table(en, ['Відділ', 'У Telegram', 'Частка', 'Попередній період'], a.engagement.byDept.map((d) => [d.dept, d.linked, num(d.rate, '%'), num(d.prev, '%')]));
  caption(en, 'Пульс: участь');
  table(en, ['Тиждень', 'Відповідей', 'Частка'], a.engagement.pulse.map((w) => [w.week, w.n, num(w.rate, '%')]));

  const pp = wb.addWorksheet('Люди');
  caption(pp, 'Чисельність по відділах');
  table(pp, ['Відділ', 'Людей', 'У Telegram'], a.people.byDept.map((d) => [d.dept, d.n, d.linked]), [30, 12, 12]);
  caption(pp, 'Новачки та онбординг');
  table(pp, ['Працівник', 'Відділ', 'Вийшов(ла)', 'День', 'Чек-лист'], a.people.newcomers.length ? a.people.newcomers.map((n) => [n.name, n.dept, fmtFull(n.hiredOn), n.day, `${n.done}/${n.total}`]) : [['Немає новачків', '', '', '', '']], [30, 14, 14, 8, 10]);
  caption(pp, 'Стаж');
  table(pp, ['Стаж', 'Людей'], a.people.tenure.map((x) => [x.label, x.n]));
  caption(pp, 'Найближчі 30 днів');
  table(pp, ['Дата', 'Працівник', 'Відділ', 'Подія'], a.people.upcoming.length ? a.people.upcoming.map((u) => [fmtFull(u.date), u.name, u.dept, u.kind === 'birthday' ? 'День народження' : `${u.years} р. у компанії`]) : [['—', '', '', '']]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const FONT_CANDIDATES = [
  process.env.PDF_FONT,
  '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', // alpine / debian
  'C:/Windows/Fonts/arial.ttf', '/Library/Fonts/Arial.ttf',
].filter(Boolean);
const BOLD_CANDIDATES = [
  process.env.PDF_FONT_BOLD,
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf', '/Library/Fonts/Arial Bold.ttf',
].filter(Boolean);
const firstFile = (xs) => xs.find((f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });

const INK = '#1D2330', MUTED = '#6B7280', GRID = '#E5E7EB', RED = '#C8001A', VIZ = '#4F6BDB';

export function buildPdf(a) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: title(a), Author: 'AllianceSim' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const reg = firstFile(FONT_CANDIDATES), bold = firstFile(BOLD_CANDIDATES);
    if (reg) doc.registerFont('R', reg); if (bold || reg) doc.registerFont('B', bold || reg);
    const R = reg ? 'R' : 'Helvetica', B = reg ? 'B' : 'Helvetica-Bold';
    const L = 40, W = doc.page.width - 80;
    const h1 = (s) => { doc.font(B).fontSize(18).fillColor(INK).text(s, L, doc.y); doc.moveDown(0.3); };
    const h2 = (s) => { if (doc.y > doc.page.height - 160) doc.addPage(); doc.moveDown(0.6); doc.font(B).fontSize(13).fillColor(INK).text(s, L, doc.y); doc.moveDown(0.3); };
    const note = (s) => { doc.font(R).fontSize(9).fillColor(MUTED).text(s, L, doc.y, { width: W }); doc.moveDown(0.3); };
    const ensure = (h) => { if (doc.y + h > doc.page.height - 50) doc.addPage(); };

    function tableP(cols, rows) {
      const rh = 18;
      const head = () => { ensure(rh * 2); let x = L; const y = doc.y; doc.rect(L, y, W, rh).fill(RED);
        cols.forEach((c) => { doc.font(B).fontSize(8.5).fillColor('#fff').text(c.t, x + 4, y + 5, { width: c.w - 8, lineBreak: false, ellipsis: true }); x += c.w; }); doc.y = y + rh; };
      head();
      rows.forEach((r, i) => {
        if (doc.y + rh > doc.page.height - 50) { doc.addPage(); head(); }
        const y = doc.y; if (i % 2) doc.rect(L, y, W, rh).fill('#F6F7F9');
        let x = L; r.forEach((v, j) => { doc.font(R).fontSize(8.5).fillColor(INK).text(String(v ?? ''), x + 4, y + 5, { width: cols[j].w - 8, lineBreak: false, ellipsis: true }); x += cols[j].w; });
        doc.y = y + rh;
      });
      doc.x = L; doc.moveDown(0.5);
    }
    const cw = (...fr) => { const s = fr.reduce((x, y) => x + y, 0); return fr.map((f) => (W * f) / s); };

    // stacked daily presence bars
    function stacked(daily, h = 150) {
      ensure(h + 40); const top = doc.y + 4, n = daily.length, bw = W / n, max = Math.max(1, ...daily.map((d) => STATUSES.reduce((s, k) => s + d[k], 0)));
      doc.lineWidth(0.5).strokeColor(GRID).moveTo(L, top + h).lineTo(L + W, top + h).stroke();
      daily.forEach((d, i) => {
        let y = top + h;
        for (const k of STATUSES) { const v = d[k]; if (!v) continue; const hh = (v / max) * h; y -= hh; doc.rect(L + i * bw + bw * 0.15, y, bw * 0.7, hh).fill(STATUS_COLOR[k]); }
        if (i % Math.max(1, Math.ceil(n / 15)) === 0) doc.font(R).fontSize(6.5).fillColor(MUTED).text(fmtD(d.day), L + i * bw - 4, top + h + 3, { width: bw + 8, align: 'center', lineBreak: false });
      });
      doc.y = top + h + 16; legend(STATUSES.map((k) => [STATUS_UA[k], STATUS_COLOR[k]]));
    }
    function legend(items) {
      let x = L; const y = doc.y;
      for (const [t, c] of items) { doc.rect(x, y + 1, 8, 8).fill(c); doc.font(R).fontSize(8).fillColor(INK).text(t, x + 11, y, { lineBreak: false }); x += 18 + doc.widthOfString(t); }
      doc.x = L; doc.y = y + 16;
    }
    function line(points, { min = 1, max = 5, h = 130, fmt = (v) => String(v) } = {}) {
      ensure(h + 30); const top = doc.y + 4, n = Math.max(1, points.length - 1), X = (i) => L + 24 + (i * (W - 34)) / n, Y = (v) => top + ((max - v) * h) / (max - min);
      for (let v = min; v <= max; v += (max - min) / 4) { doc.lineWidth(0.5).strokeColor(GRID).moveTo(L + 24, Y(v)).lineTo(L + W, Y(v)).stroke(); doc.font(R).fontSize(7).fillColor(MUTED).text(fmt(Math.round(v * 10) / 10), L, Y(v) - 4, { width: 20, align: 'right' }); }
      let pen = false; doc.lineWidth(1.8).strokeColor(VIZ);
      points.forEach((p, i) => { if (p.v == null) { if (pen) doc.stroke(); pen = false; return; } if (pen) doc.lineTo(X(i), Y(p.v)); else { doc.moveTo(X(i), Y(p.v)); pen = true; } });
      if (pen) doc.stroke();
      points.forEach((p, i) => { if (p.v != null && points.length <= 45) doc.circle(X(i), Y(p.v), 1.8).fill(VIZ); });
      if (points.length) { doc.font(R).fontSize(7).fillColor(MUTED).text(fmtD(points[0].day), X(0) - 10, top + h + 4, { lineBreak: false }); doc.text(fmtD(points[points.length - 1].day), X(points.length - 1) - 14, top + h + 4, { lineBreak: false }); }
      doc.x = L; doc.y = top + h + 18;
    }
    function hbars(items, { max = 100, unit = '%', color = VIZ } = {}) {
      const rh = 16; ensure(items.length * rh + 10);
      for (const it of items) {
        const y = doc.y, LW = 110, bw = it.v == null ? 0 : ((W - LW - 50) * it.v) / max;
        doc.font(R).fontSize(8.5).fillColor(INK).text(it.label, L, y + 3, { width: LW - 8, align: 'right', lineBreak: false, ellipsis: true });
        if (bw > 0) doc.roundedRect(L + LW, y + 2, bw, rh - 5, 2).fill(it.color || color);
        doc.font(B).fontSize(8.5).fillColor(INK).text(it.v == null ? '—' : `${it.v}${unit}`, L + LW + bw + 5, y + 3, { lineBreak: false });
        doc.y = y + rh;
      }
      doc.x = L; doc.moveDown(0.4);
    }

    // page 1 — overview
    doc.rect(0, 0, doc.page.width, 6).fill(RED);
    doc.y = 34; h1(title(a));
    note(`Сформовано ${fmtFull(a.today)} · порівняння з ${fmtFull(a.prev.from)} — ${fmtFull(a.prev.to)} · робочих днів у періоді: ${a.range.workdays}`);
    const tiles = kpiRows(a).filter((r) => r[0] !== 'Відпустка / лікарняний сьогодні');
    const tw = (W - 3 * 8) / 4, th = 54; let ty = doc.y + 4;
    tiles.forEach((r, i) => {
      if (i && i % 4 === 0) ty += th + 8;
      const x = L + (i % 4) * (tw + 8);
      doc.roundedRect(x, ty, tw, th, 6).fill('#F3F4F6');
      doc.font(B).fontSize(16).fillColor(INK).text(String(r[1]), x + 8, ty + 7, { width: tw - 16, lineBreak: false });
      doc.font(R).fontSize(7.5).fillColor(MUTED).text(r[0], x + 8, ty + 28, { width: tw - 16, lineBreak: false, ellipsis: true });
      if (r[3]) doc.font(B).fontSize(7.5).fillColor(r[3].startsWith('=') || r[0] === 'Частка віддаленої роботи' ? MUTED : r[3].startsWith('▲') ? '#2E9E5B' : RED).text(r[3], x + 8, ty + 39, { width: tw - 16, lineBreak: false });
    });
    doc.x = L; doc.y = ty + th + 10;
    h2('Потребують уваги');
    if (a.attention.length) tableP(cw(3, 2, 6).map((w, i) => ({ w, t: ['Працівник', 'Відділ', 'Причина'][i] })), a.attention.map((x) => [x.name, x.dept, x.reasons.map(REASON_UA).join('; ')]));
    else note('Усі в нормі.');

    // presence
    doc.addPage(); h1('Присутність');
    h2('Статуси по днях'); stacked(a.presence.daily);
    h2('Середнє по днях тижня');
    hbars(a.presence.weekday.map((w) => ({ label: ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт'][w.wd] + ' · в офісі', v: w.office, color: STATUS_COLOR.office })), { max: Math.max(1, ...a.presence.weekday.map((w) => w.office || 0)), unit: '' });
    h2('Частка віддаленої роботи по відділах');
    hbars(a.presence.byDept.map((d) => ({ label: d.dept, v: d.remoteShare, color: STATUS_COLOR.remote })));
    h2('Підсумки по людях (робочі дні)');
    tableP(cw(3, 1.6, 1.1, 1.2, 0.9, 1, 1.2).map((w, i) => ({ w, t: ['Працівник', 'Відділ', ...STATUSES.map((s) => STATUS_UA[s])][i] })), a.presence.sheet.people.map((p) => [p.name, p.dept, ...STATUSES.map((s) => p.totals[s])]));

    // mood
    doc.addPage(); h1('Настрій і пульс');
    h2('Середній настрій по днях (1–5)'); line(a.mood.daily.map((d) => ({ day: d.day, v: d.avg })));
    h2('Розподіл відповідей');
    const tot = Object.values(a.mood.dist).reduce((s, x) => s + x, 0) || 1;
    hbars(Object.entries(a.mood.dist).map(([k, n]) => ({ label: MOOD_UA[k], v: Math.round((n / tot) * 1000) / 10, color: MOOD_COLOR[k] })));
    h2('Настрій по відділах');
    hbars(a.mood.byDept.map((d) => ({ label: d.dept, v: d.avg })), { max: 5, unit: '' });
    h2('Пульс тижня');
    note(`Анонімно: середнє показується лише для груп від ${a.pulse.minGroup} людей.`);
    tableP(cw(2, 7, 2, 2).map((w, i) => ({ w, t: ['Тиждень', 'Питання', 'Відповідей', 'Середнє'][i] })), a.pulse.weeks.map((w) => [w.week, w.question, w.n, num(w.avg)]));

    // engagement + people
    doc.addPage(); h1('Залученість');
    h2('Відповіді на check-in по днях, %'); line(a.engagement.daily.map((d) => ({ day: d.day, v: d.rate })), { min: 0, max: 100 });
    h2('Check-in по відділах'); hbars(a.engagement.byDept.map((d) => ({ label: d.dept, v: d.rate })));
    h2('Участь у пульсі'); hbars(a.engagement.pulse.map((w) => ({ label: w.week, v: w.rate })));
    doc.addPage(); h1('Люди');
    h2('Чисельність по відділах'); hbars(a.people.byDept.map((d) => ({ label: d.dept, v: d.n })), { max: Math.max(1, ...a.people.byDept.map((d) => d.n)), unit: '' });
    h2('Стаж'); hbars(a.people.tenure.map((x) => ({ label: x.label, v: x.n })), { max: Math.max(1, ...a.people.tenure.map((x) => x.n)), unit: '' });
    h2('Новачки та онбординг');
    if (a.people.newcomers.length) tableP(cw(4, 2, 2, 1, 1).map((w, i) => ({ w, t: ['Працівник', 'Відділ', 'Вийшов(ла)', 'День', 'Чек-лист'][i] })), a.people.newcomers.map((n) => [n.name, n.dept, fmtFull(n.hiredOn), n.day, `${n.done}/${n.total}`]));
    else note('Немає новачків за останні 60 днів.');
    h2('Найближчі 30 днів');
    if (a.people.upcoming.length) tableP(cw(2, 4, 2, 3).map((w, i) => ({ w, t: ['Дата', 'Працівник', 'Відділ', 'Подія'][i] })), a.people.upcoming.map((u) => [fmtFull(u.date), u.name, u.dept, u.kind === 'birthday' ? 'День народження' : `${u.years} р. у компанії`]));
    else note('Немає подій.');

    // footer: page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // writing below the margin would add a page
      doc.font(R).fontSize(8).fillColor(MUTED).text(`AllianceSim · ${title(a)} · ${i + 1}/${range.count}`, L, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
