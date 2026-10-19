// AllianceSim Telegram bot (grammy, long polling). lib/: the Bot instance, api client, enums;
// features/: one file per bot feature. Talks to the api only (ADR-0004).
import { bot, CHECKIN_HOUR, CHECKIN_TZ, WEBAPP_URL } from './lib/bot.js';
// Features register their handlers on import — keep this order (grammy runs middleware in registration order).
import './features/character.js';
import './features/checkin.js';
import { REPORT_HOUR } from './features/daily-report.js';
import './features/analytics.js';
import './features/notifications.js';

bot.catch((err) => console.error('[bot] error:', err.error?.message || err.message));

// Persistent Menu Button (next to the message input) opens the office as a Mini App.
if (WEBAPP_URL) {
  bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: '📱 Офіс', web_app: { url: WEBAPP_URL } } })
    .then(() => console.log(`[bot] menu button → ${WEBAPP_URL}`))
    .catch((e) => console.error('[bot] setChatMenuButton failed:', e.message));
}

bot.start({ onStart: (info) => console.log(`[bot] @${info.username} started (polling); check-in ${CHECKIN_HOUR}:00, HR report ${REPORT_HOUR}:00 ${CHECKIN_TZ}${WEBAPP_URL ? '; mini app on' : ''}`) });
