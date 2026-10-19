import { InlineKeyboard, InputFile } from 'grammy';
import cron from 'node-cron';
import { REPORT_HOUR } from './daily-report.js';
import { bot, CHECKIN_TZ, WEBAPP_URL } from '../lib/bot.js';
import { api } from '../lib/api.js';
import { localDay, lastWeek, lastMonth } from '../lib/periods.js';

// Weekly/monthly HR analytics reports (summary + Excel + PDF) + /analytics (spec 008).
// ── spec 008: HR analytics reports (summary + Excel + PDF) ───────────────────
// Weekly (Mon, previous Mon–Sun) and monthly (1st, previous month) to every HR in
// HR_NAMES / HR_TG_IDS; also on demand: /analytics and the Mini App «у чат» button.
const ANALYTICS_HOUR = Number(process.env.ANALYTICS_REPORT_HOUR || REPORT_HOUR);
const ddmm = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const dlt = (v, p, unit = '', d = 1) => (v == null || p == null ? '' : (() => { const x = Math.round((v - p) * 10 ** d) / 10 ** d; return x === 0 ? ' (без змін)' : ` (${x > 0 ? '↑' : '↓'} ${Math.abs(x)}${unit})`; })());
const REASON = (r) => (r.code === 'quiet' ? `не відмічається ${r.days} роб. дн.` : r.code === 'low' ? 'низький настрій 3 рази поспіль' : r.code === 'drop' ? `настрій впав ${r.base} → ${r.now}` : r.code);
function analyticsText(a, title) {
  const k = a.kpi, n = (v, u = '') => (v == null ? '—' : `${v}${u}`);
  const lines = [
    `📊 ${title}`, `${ddmm(a.range.from)} — ${ddmm(a.range.to)}${a.dept ? ' · ' + a.dept : ''}`, '',
    `👥 Працівників: ${k.headcount} (у Telegram ${k.linked})`,
    `🙂 Середній настрій: ${n(k.mood.v)}/5${dlt(k.mood.v, k.mood.prev, '', 2)}`,
    `✅ Відповідають на check-in: ${n(k.checkin.v, '%')}${dlt(k.checkin.v, k.checkin.prev, ' п.п.')}`,
    `🏠 Віддалена робота: ${n(k.remoteShare.v, '%')}${dlt(k.remoteShare.v, k.remoteShare.prev, ' п.п.')}`,
    `📈 Пульс тижня: ${n(k.pulse.v)}/5`,
  ];
  if (a.attention.length) {
    lines.push('', `⚠️ Потребують уваги (${a.attention.length}):`);
    for (const x of a.attention.slice(0, 8)) lines.push(`• ${x.name} — ${x.reasons.map(REASON).join('; ')}`);
    if (a.attention.length > 8) lines.push(`…і ще ${a.attention.length - 8}`);
  } else lines.push('', '✨ Сигналів, що потребують уваги, немає.');
  lines.push('', 'Деталі — у файлах нижче та в застосунку «Аналітика».');
  return lines.join('\n');
}
export async function sendAnalytics(chatId, { from, to, dept = null, title = 'Аналітика HR' }) {
  const qs = new URLSearchParams({ from, to }); if (dept) qs.set('dept', dept);
  const [a, xlsx, pdf] = await Promise.all([api.analyticsV2(qs), api.file(`/analytics/export.xlsx?${qs}`), api.file(`/analytics/export.pdf?${qs}`)]);
  const kb = WEBAPP_URL ? new InlineKeyboard().webApp('📊 Відкрити аналітику', `${WEBAPP_URL}${WEBAPP_URL.includes('?') ? '&' : '?'}open=analytics`) : undefined;
  await bot.api.sendMessage(chatId, analyticsText(a, title), kb ? { reply_markup: kb } : undefined);
  const base = `analytics_${a.range.from}_${a.range.to}${a.dept ? '_' + a.dept.replace(/[^\p{L}\p{N}]+/gu, '-') : ''}`;
  await bot.api.sendDocument(chatId, new InputFile(xlsx, base + '.xlsx'));
  await bot.api.sendDocument(chatId, new InputFile(pdf, base + '.pdf'));
}
async function sendScheduled(kind) {
  const today = localDay(CHECKIN_TZ), range = kind === 'month' ? lastMonth(today) : lastWeek(today);
  const title = kind === 'month' ? 'Щомісячний звіт HR' : 'Щотижневий звіт HR';
  let list = [];
  try { list = (await api.hrRecipients()) || []; } catch (e) { console.error('[bot] analytics recipients:', e.message); return; }
  if (!list.length) { console.error('[bot] analytics report: no HR recipients (set HR_NAMES / HR_TG_IDS, HR must be linked)'); return; }
  for (const hr of list) {
    try { await sendAnalytics(hr.telegram_id, { ...range, title }); } catch (e) { console.error(`[bot] ${kind} analytics → ${hr.name} failed:`, e.message); }
  }
  console.log(`[bot] ${kind} analytics report sent to ${list.length} HR (${range.from} — ${range.to})`);
}
cron.schedule(`0 ${ANALYTICS_HOUR} * * 1`, () => sendScheduled('week'), { timezone: CHECKIN_TZ });
cron.schedule(`0 ${ANALYTICS_HOUR} 1 * *`, () => sendScheduled('month'), { timezone: CHECKIN_TZ });
// /analytics [month] — on demand for HR: last 7 days (or the previous month).
bot.command('analytics', async (ctx) => {
  let list = [];
  try { list = (await api.hrRecipients()) || []; } catch (e) {}
  if (!list.some((h) => h.telegram_id === String(ctx.from.id))) return ctx.reply('Ця команда доступна лише HR 🔒');
  const today = localDay(CHECKIN_TZ), month = /month|міс/i.test(ctx.match || '');
  const range = month ? lastMonth(today) : { from: (() => { const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - 6 * 864e5); return d.toISOString().slice(0, 10); })(), to: today };
  await ctx.replyWithChatAction('upload_document').catch(() => {});
  try { await sendAnalytics(ctx.chat.id, { ...range, title: month ? 'Звіт HR за минулий місяць' : 'Звіт HR за 7 днів' }); }
  catch (e) { console.error('[bot] /analytics failed:', e.message); return ctx.reply('Не вдалося сформувати звіт 😕'); }
});
