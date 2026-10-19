import { InlineKeyboard } from 'grammy';
import { sendAnalytics } from './analytics.js';
import { bot, WEBAPP_URL, firstOf } from '../lib/bot.js';
import { api } from '../lib/api.js';

// Drain the api notification queue → Telegram messages with buttons (ADR-0004).
// ── deliver phone → Telegram notifications ───────────────────────────────────
// `me` is the recipient's first name so every alert opens by addressing them.
const NOTIF_TEXT = {
  message: (t, who, me) => `💬 ${me}, ${who} написав тобі з офісу:\n«${t || '…'}»`,
  call: (_t, who, me) => `📞 ${me}, ${who} телефонує тобі з офісу!`,
  mark: (_t, who, me) => `📍 ${me}, ${who} шукає тебе в офісі — відкрив твою картку.`,
  coffee: (t, who, me) => `☕ ${me}, нове замовлення кави\nВід: ${who}\nЗамовлення: ${t}`,
  // Personal phone (spec 004) — `p` is the payload the api queued alongside.
  chat: (t, who, me, p) => (p && p.chatTitle
    ? `💬 ${who} у «${p.chatTitle}»:\n${t || '…'}`
    : `💬 ${me}, нове повідомлення від ${who}:\n${t || '…'}`) + '\n\n↩️ Відповідай на це повідомлення — відповідь піде в чат.',
  announce: (t, who, _me, p) => `📢 Оголошення${p && p.chatTitle ? ' · ' + p.chatTitle : ''}\nвід ${who}:\n\n${t}${p && p.buttons && p.buttons.length ? '\n\n🗳 Голосуй кнопками нижче' : ''}`,
  // Spec 007: mini-games
  game_invite: (t, who, me) => `🎮 ${me}, ${who} запрошує тебе зіграти: ${t}!\nПрийняти виклик?`,
  game_declined: (t, who, me) => `🎮 ${me}, ${who} не зможе зіграти в «${t}» зараз.`,
  event_invite: (t, who, me) => `📅 ${me}, ${who} запрошує тебе:\n${t}`,
  event_changed: (t, who) => `📅 ${who} змінив(ла) подію:\n${t}`,
  event_cancelled: (t, who) => `🚫 ${who} скасував(ла) подію:\n${t}`,
  event_response: (t, who, _me, p) => `📅 ${who} ${p && p.status === 'accepted' ? 'прийняв(ла) ✅' : 'відхилив(ла) ❌'} запрошення:\n${t}`,
  event_reminder: (t, _who, me) => `⏰ ${me}, нагадування:\n${t}`,
  task_assigned: (t, who, me) => `📌 ${me}, ${who} поставив(ла) тобі задачу:\n${t}`,
  task_done: (t, who) => `✅ ${who} виконав(ла) задачу:\n${t}`,
  task_due: (t, _who, me) => `⏰ ${me}, дедлайн сьогодні:\n${t}`,
  task_overdue: (t, _who, me) => `⚠️ ${me}, задача прострочена:\n${t}`,
  birthday: (_t, _who, me) => `🎂 ${me}, з днем народження! 🎉\nУся команда AllianceSim вітає тебе — гарного дня!`,
};

// Mini App deep link: WEBAPP_URL?open=chat_12 → the phone opens straight on that screen.
function openUrl(open) {
  try { const u = new URL(WEBAPP_URL); u.searchParams.set('open', open); return u.toString(); } catch (e) { return null; }
}
// Inline keyboard for a queued notification: action buttons (callback data) + "open" button.
function notifKeyboard(p) {
  if (!p) return undefined;
  const kb = new InlineKeyboard();
  let any = false;
  for (const b of p.buttons || []) { kb.text(b.text, b.data); any = true; }
  const url = p.open && WEBAPP_URL ? openUrl(p.open) : null;
  if (url) { if (any) kb.row(); kb.webApp(p.openText || '📱 Відкрити', url); any = true; }
  return any ? kb : undefined;
}
async function drainNotifications() {
  let pending = [];
  try { pending = (await api.pending()) || []; } catch (e) { return; }
  for (const n of pending) {
    if (n.kind === 'hr_export') { // spec 008: Mini App «Excel + PDF у чат»
      const p = n.payload || {};
      await api.markSent(n.id).catch(() => {}); // first: building the files can outlast the 8 s drain tick
      try { await sendAnalytics(n.telegram_id, { from: p.from, to: p.to, dept: p.dept || null }); }
      catch (e) { console.error('[bot] hr_export failed:', e.message); await bot.api.sendMessage(n.telegram_id, 'Не вдалося сформувати звіт 😕').catch(() => {}); }
      continue;
    }
    const make = NOTIF_TEXT[n.kind]; if (!make) { await api.markSent(n.id).catch(() => {}); continue; }
    const who = n.from_name || 'Хтось';
    const me = firstOf(n.name) || 'колего';
    const kb = notifKeyboard(n.payload);
    let sent = null;
    try { sent = await bot.api.sendMessage(n.telegram_id, make(n.text, who, me, n.payload), kb ? { reply_markup: kb } : undefined); } catch (e) { /* blocked → still mark sent to avoid a stuck queue */ }
    // message_id lets a Telegram reply to this ping be routed back into the chat.
    await api.markSent(n.id, sent && sent.message_id).catch(() => {});
  }
}
setInterval(drainNotifications, 8000);
