import { Bot, session } from 'grammy';

// The one Bot instance (+ session) and the settings every feature shares.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is not set — get one from @BotFather and put it in .env');
  process.exit(1);
}
export const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 9);
export const CHECKIN_TZ = process.env.CHECKIN_TZ || 'Europe/Kyiv';
export const WEBAPP_URL = process.env.WEBAPP_URL || ''; // https URL of the site → opened as a Mini App

// TELEGRAM_API_ROOT: only for local tests against a fake Bot API server.
export const bot = new Bot(TOKEN, process.env.TELEGRAM_API_ROOT ? { client: { apiRoot: process.env.TELEGRAM_API_ROOT } } : undefined);
bot.use(session({ initial: () => ({ flow: null, stepIdx: 0, editId: null, draft: {} }) }));

export const genId = () => 'tg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Address people by name everywhere. `firstOf` takes the first token of a full name;
// `hey` picks the best name we have for the person we're talking to — their Telegram
// first_name (always present on an incoming update), falling back to a neutral vocative.
export const firstOf = (full) => (full || '').trim().split(/\s+/)[0] || '';
export const hey = (ctx) => (ctx.from && ctx.from.first_name) || 'колего';
