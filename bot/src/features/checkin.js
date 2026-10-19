import cron from 'node-cron';
import { statusKeyboard } from './character.js';
import { bot, CHECKIN_HOUR, CHECKIN_TZ } from '../lib/bot.js';
import { api } from '../lib/api.js';

// Weekday-morning check-in (status + mood) to every linked employee.
// ── daily check-in (weekday mornings, Kyiv) ──────────────────────────────────
// "Сьогодні: …" block for the check-in; empty when there is nothing or digest is off.
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
function digestText(d) {
  if (!d) return '';
  const lines = [];
  for (const ev of d.events.slice(0, 6)) lines.push(`• ${ev.time || 'весь день'} — ${ev.title}${ev.place ? ' (' + ev.place + ')' : ''}`);
  if (d.events.length > 6) lines.push(`• …ще ${d.events.length - 6}`);
  const late = d.due.filter((t) => t.overdue).length, today = d.due.length - late;
  const tasks = [today && `${today} з дедлайном сьогодні`, late && `${late} прострочено`].filter(Boolean).join(', ');
  if (!lines.length && !d.open && !d.invites) return '';
  return '\n📅 Сьогодні: ' + (d.events.length ? `${d.events.length} ${plural(d.events.length, 'подія', 'події', 'подій')}\n${lines.join('\n')}` : 'подій немає') +
    (d.open ? `\n📌 Задачі: ${d.open} відкритих${tasks ? ' (' + tasks + ')' : ''}` : '') +
    (d.invites ? `\n✉️ Запрошень без відповіді: ${d.invites}` : '') + '\n\n';
}
async function sendCheckins() {
  let linked = [];
  try { linked = (await api.linked()) || []; } catch (e) { console.error('[bot] check-in list failed:', e.message); return; }
  // Morning digest from the personal phone, folded into the same message (spec 004).
  let digests = new Map();
  try { digests = new Map(((await api.digests()) || []).map((d) => [d.telegram_id, d])); } catch (e) { /* api down → plain check-in */ }
  for (const e of linked) {
    try {
      await bot.api.sendMessage(e.telegram_id, `Доброго ранку, ${e.name.split(' ')[0]}! ☀️\n${digestText(digests.get(e.telegram_id))}Як ти сьогодні? Обери статус:`, {
        reply_markup: statusKeyboard('cst'),
      });
    } catch (err) { /* user may have blocked the bot; skip */ }
  }
  console.log(`[bot] check-in sent to ${linked.length} people`);
}
// Mon–Fri at CHECKIN_HOUR:00, Europe/Kyiv.
cron.schedule(`0 ${CHECKIN_HOUR} * * 1-5`, sendCheckins, { timezone: CHECKIN_TZ });
