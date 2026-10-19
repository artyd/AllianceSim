import { InputFile } from 'grammy';
import cron from 'node-cron';
import { bot, CHECKIN_HOUR, CHECKIN_TZ, firstOf } from '../lib/bot.js';
import { api } from '../lib/api.js';
import { nameMatches } from '../lib/names.js';
import { renderReport, reportCaption } from './report-card.js';

// Daily HR report card (image) + /report.
// ── daily HR report (weekday mornings, after the check-in) ───────────────────
// Recipient: REPORT_HR_TG (telegram id) wins, else REPORT_HR_NAME (a linked employee);
// both fall back to the coffee HR settings so one HR person is configured once.
export const REPORT_HOUR = Number(process.env.REPORT_HOUR || 10);
const REPORT_HR_TG = String(process.env.REPORT_HR_TG || process.env.COFFEE_HR_TG || '').replace(/[^0-9]/g, '');
const REPORT_HR_NAME = process.env.REPORT_HR_NAME || process.env.COFFEE_HR_NAME || '';

function reportRecipient(list) {
  if (REPORT_HR_TG) return list.find((e) => e.telegram_id === REPORT_HR_TG) || { telegram_id: REPORT_HR_TG, name: '' };
  if (REPORT_HR_NAME) return list.find((e) => e.telegram_id && nameMatches(e.name, REPORT_HR_NAME)) || null;
  return null;
}

async function sendReport(toChatId, greetName) {
  const list = (await api.report()) || [];
  const hr = reportRecipient(list);
  const chatId = toChatId || hr?.telegram_id;
  if (!chatId) { console.error('[bot] HR report: no recipient (set REPORT_HR_NAME / REPORT_HR_TG, HR must be linked)'); return; }
  const rep = renderReport(list, { tz: CHECKIN_TZ, checkinHour: CHECKIN_HOUR });
  // Week-over-week team mood (spec 005 analytics), if there is history yet.
  let trend = '';
  try {
    const a = await api.analytics(14);
    const avg = (xs) => { const v = xs.filter((d) => d.avg != null); return v.length ? v.reduce((s, d) => s + d.avg, 0) / v.length : null; };
    const now = avg(a.mood.slice(-7)), prev = avg(a.mood.slice(-14, -7));
    if (now != null) trend = `\n🙂 Настрій команди за тиждень: ${now.toFixed(1)}/5` + (prev != null ? ` (${now >= prev ? '↑' : '↓'} ${Math.abs(now - prev).toFixed(1)} до мин. тижня)` : '');
    if (a.quiet.length) trend += `\n🔕 Не відмічались 7+ днів: ${a.quiet.slice(0, 6).map((q) => q.name).join(', ')}${a.quiet.length > 6 ? '…' : ''}`;
  } catch (e) { /* analytics optional */ }
  await bot.api.sendPhoto(chatId, new InputFile(rep.png, 'office-report.png'), {
    caption: reportCaption(rep, firstOf(greetName ?? hr?.name)) + trend,
  });
  console.log(`[bot] HR report sent (${list.length} people, ${rep.pending.length} pending)`);
}
cron.schedule(`0 ${REPORT_HOUR} * * 1-5`, () => sendReport().catch((e) => console.error('[bot] HR report failed:', e.message)),
  { timezone: CHECKIN_TZ });

// /report — on-demand copy to the caller: HR, plus REPORT_VIEWERS (comma-separated names).
const REPORT_VIEWERS = String(process.env.REPORT_VIEWERS || '').split(',').map((s) => s.trim()).filter(Boolean);
bot.command('report', async (ctx) => {
  let list = [];
  try { list = (await api.report()) || []; } catch (e) {}
  const me = String(ctx.from.id);
  const hr = reportRecipient(list);
  const caller = list.find((e) => e.telegram_id === me);
  const allowed = (hr && hr.telegram_id === me) || (caller && REPORT_VIEWERS.some((v) => nameMatches(caller.name, v)));
  if (!allowed) return ctx.reply('Ця команда доступна лише HR 🔒');
  await ctx.replyWithChatAction('upload_photo').catch(() => {});
  try { await sendReport(ctx.chat.id, caller?.name || ''); } catch (e) { console.error('[bot] /report failed:', e.message); return ctx.reply('Не вдалося зібрати звіт 😕'); }
});
