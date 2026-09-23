import { Bot, InlineKeyboard, session } from 'grammy';
import cron from 'node-cron';
import { api } from './api.js';
import { STATUS, MOODS, COLORS, COLOR_LABELS, statusName, moodName } from './config.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is not set — get one from @BotFather and put it in .env');
  process.exit(1);
}
const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 9);
const CHECKIN_TZ = process.env.CHECKIN_TZ || 'Europe/Kyiv';
const WEBAPP_URL = process.env.WEBAPP_URL || ''; // https URL of the site → opened as a Mini App

const bot = new Bot(TOKEN);
bot.use(session({ initial: () => ({ flow: null, stepIdx: 0, editId: null, draft: {} }) }));

const genId = () => 'tg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── wizard definition ────────────────────────────────────────────────────────
const TEXT_STEPS = [
  { k: 'name',     q: 'Як тебе звати? (Ім’я та прізвище)', required: true },
  { k: 'dept',     q: 'У якому ти відділі?',                required: true },
  { k: 'position', q: 'Твоя посада?',                       skip: true },
  { k: 'email',    q: 'Робочий email?',                     skip: true },
  { k: 'phone',    q: 'Робочий телефон?',                   skip: true },
  { k: 'ext',      q: 'Внутрішній (робочий) номер?',        skip: true },
];
const STEPS = [...TEXT_STEPS.map((s) => s.k), 'avatar', 'status', 'mood'];

function avatarChoiceKeyboard() {
  return new InlineKeyboard()
    .text('📷 Надіслати фото', 'av:photo').row()
    .text('🎨 Обрати колір', 'av:color');
}
function colorKeyboard() {
  const kb = new InlineKeyboard();
  COLORS.forEach((c, i) => { kb.text(COLOR_LABELS[i] || 'Колір', 'col:' + i); if (i % 2 === 1) kb.row(); });
  return kb;
}
function statusKeyboard(prefix) {
  const kb = new InlineKeyboard();
  STATUS.forEach((s, i) => { kb.text(`${s.icon} ${s.n}`, `${prefix}:${s.key}`); if (i % 2 === 1) kb.row(); });
  return kb;
}
function moodKeyboard(prefix, carry) {
  const kb = new InlineKeyboard();
  MOODS.forEach((m, i) => { kb.text(`${m.e} ${m.n}`, `${prefix}:${carry ? carry + ':' : ''}${m.key}`); if (i % 2 === 1) kb.row(); });
  return kb;
}

async function sendStep(ctx) {
  const step = STEPS[ctx.session.stepIdx];
  const meta = TEXT_STEPS.find((s) => s.k === step);
  if (meta) {
    const kb = meta.skip ? new InlineKeyboard().text('Пропустити ▶', 'skip') : undefined;
    return ctx.reply(meta.q, kb ? { reply_markup: kb } : undefined);
  }
  if (step === 'avatar') return ctx.reply('Тепер аватар. Хочеш додати своє фото — чи обрати колір?', { reply_markup: avatarChoiceKeyboard() });
  if (step === 'status') return ctx.reply('Який твій статус на сьогодні?', { reply_markup: statusKeyboard('wst') });
  if (step === 'mood')   return ctx.reply('А настрій?', { reply_markup: moodKeyboard('wmd') });
}

async function advance(ctx) { ctx.session.stepIdx += 1; return sendStep(ctx); }

async function finishWizard(ctx) {
  const d = ctx.session.draft;
  const emp = {
    name: d.name, dept: d.dept, position: d.position || null, email: d.email || null,
    phone: d.phone || null, ext: d.ext || null, photo: d.photo || null,
    color: d.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    status: d.status || 'office', mood: d.mood || 'good',
    telegram_id: ctx.from.id,
  };
  try {
    if (ctx.session.editId) await api.update(ctx.session.editId, emp);
    else await api.create({ id: genId(), ...emp });
  } catch (e) {
    console.error('[bot] save failed:', e.message);
    ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
    return ctx.reply('Ой, не вдалося зберегти 😕 Спробуй ще раз: /start');
  }
  const wasEdit = !!ctx.session.editId;
  ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
  const st = statusName(emp.status), md = moodName(emp.mood);
  return ctx.reply(
    `${wasEdit ? '✅ Профіль оновлено!' : '🎉 Готово! Ти вже в офісі.'}\n\n` +
    `👤 ${emp.name}\n🏷 ${emp.dept}${emp.position ? ' · ' + emp.position : ''}\n` +
    `${st.icon} ${st.n} · ${md.e} ${md.n}\n\n` +
    `Щоранку я питатиму, як ти. Відкрий офіс, щоб побачити себе: напиши /start будь-коли, щоб змінити профіль.`
  );
}

// ── /start ───────────────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
  let me = null;
  try { me = await api.byTelegram(ctx.from.id); } catch (e) { /* API down → treat as new */ }
  if (me) {
    const st = statusName(me.status), md = moodName(me.mood);
    const kb = new InlineKeyboard();
    if (WEBAPP_URL) kb.webApp('📱 Відкрити офіс', WEBAPP_URL).row();
    kb.text('🔄 Оновити статус і настрій', 'upd').row()
      .text('🖼 Змінити фото', 'setphoto').row()
      .text('✏️ Змінити профіль', 'edit');
    return ctx.reply(
      `Вітаю знову, ${me.name.split(' ')[0]}! 👋\n\n` +
      `${st.icon} ${st.n} · ${md.e} ${md.n}\n\nЩо зробимо?`,
      { reply_markup: kb }
    );
  }
  const kb = new InlineKeyboard();
  if (WEBAPP_URL) kb.webApp('📱 Відкрити офіс (створити там)', WEBAPP_URL).row();
  kb.text('🙋 Створити персонажа', 'flow:new').row()
    .text('🔗 Я вже є в офісі — прив’язатися', 'flow:claim');
  return ctx.reply(
    'Привіт! Це офіс AllianceSim 🏢\n\nСтвори свого персонажа — він оживе в офісі на сайті. ' +
    'Обери, як почати (можна прямо в застосунку 📱 або тут у боті):',
    { reply_markup: kb }
  );
});

bot.command('cancel', async (ctx) => {
  ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
  return ctx.reply('Скасовано. Напиши /start, коли будеш готовий.');
});

// ── callbacks ────────────────────────────────────────────────────────────────
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery().catch(() => {});

  // start create
  if (data === 'flow:new') {
    ctx.session = { flow: 'new', stepIdx: 0, editId: null, draft: {} };
    return sendStep(ctx);
  }
  // start claim
  if (data === 'flow:claim') {
    ctx.session = { flow: 'claim', stepIdx: 0, editId: null, draft: {} };
    return ctx.reply('Введи своє ім’я, щоб я знайшов твою картку в офісі:');
  }
  // edit existing profile
  if (data === 'edit') {
    let me = null; try { me = await api.byTelegram(ctx.from.id); } catch (e) {}
    ctx.session = { flow: 'new', stepIdx: 0, editId: me ? me.id : null, draft: {} };
    return sendStep(ctx);
  }
  // update status+mood only
  if (data === 'upd') return ctx.reply('Який у тебе статус зараз?', { reply_markup: statusKeyboard('cst') });

  // skip an optional text step
  if (data === 'skip') { if (ctx.session.flow === 'new') return advance(ctx); return; }

  // change photo only (from the linked-user menu)
  if (data === 'setphoto') {
    ctx.session = { flow: 'photo', stepIdx: 0, editId: null, draft: {} };
    return ctx.reply('Онови аватар — надішли фото чи обери колір:', { reply_markup: avatarChoiceKeyboard() });
  }
  // avatar step: chose to send a photo (create wizard or photo-only change)
  if (data === 'av:photo') {
    if (ctx.session.flow !== 'new' && ctx.session.flow !== 'photo') return;
    return ctx.reply('Добре! Надішли своє фото звичайним зображенням 📷');
  }
  // avatar step: chose to pick a colour
  if (data === 'av:color') {
    if (ctx.session.flow !== 'new' && ctx.session.flow !== 'photo') return;
    return ctx.reply('Обери колір аватара:', { reply_markup: colorKeyboard() });
  }
  // colour picked
  if (data.startsWith('col:')) {
    const color = COLORS[Number(data.slice(4))] || COLORS[0];
    if (ctx.session.flow === 'photo') {         // photo-only change → save immediately
      let me = null; try { me = await api.byTelegram(ctx.from.id); } catch (e) {}
      if (me) { try { await api.update(me.id, { color, photo: null }); } catch (e) {} }
      ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
      return ctx.reply('✅ Аватар оновлено — тепер колір.');
    }
    if (ctx.session.flow !== 'new') return;
    ctx.session.draft.color = color;
    ctx.session.draft.photo = null;
    ctx.session.stepIdx = STEPS.indexOf('status');
    return sendStep(ctx);
  }
  // wizard status
  if (data.startsWith('wst:')) {
    if (ctx.session.flow !== 'new') return;
    ctx.session.draft.status = data.slice(4);
    ctx.session.stepIdx = STEPS.indexOf('mood');
    return sendStep(ctx);
  }
  // wizard mood → save
  if (data.startsWith('wmd:')) {
    if (ctx.session.flow !== 'new') return;
    ctx.session.draft.mood = data.slice(4);
    return finishWizard(ctx);
  }
  // claim: pick a card (atomic — can't steal a character already linked to someone else)
  if (data.startsWith('claim:')) {
    const id = data.slice(6);
    let r; try { r = await api.claim(id, ctx.from.id); } catch (e) { return ctx.reply('Не вдалося прив’язати 😕 Спробуй /start ще раз.'); }
    if (r.status === 409) return ctx.reply('Цю картку вже прив’язав інший користувач 🔒 Обери іншу або створи нового персонажа: /start');
    if (r.status !== 200) return ctx.reply('Не вдалося прив’язати 😕 Спробуй /start ще раз.');
    ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
    return ctx.reply('✅ Прив’язано! Тепер це твій персонаж. Щоранку питатиму, як ти. /start — щоб змінити профіль.');
  }

  // stateless check-in / update: status chosen → ask mood (carry status in callback)
  if (data.startsWith('cst:')) {
    const status = data.slice(4);
    return ctx.editMessageText('Дякую! А який настрій?', { reply_markup: moodKeyboard('cfin', status) }).catch(() =>
      ctx.reply('А який настрій?', { reply_markup: moodKeyboard('cfin', status) }));
  }
  // stateless check-in / update: mood chosen → persist
  if (data.startsWith('cfin:')) {
    const [, status, mood] = data.split(':');
    let me = null; try { me = await api.byTelegram(ctx.from.id); } catch (e) {}
    if (!me) return ctx.reply('Спочатку створи персонажа: /start');
    try { await api.update(me.id, { status, mood }); } catch (e) { return ctx.reply('Не вдалося оновити 😕'); }
    const st = statusName(status), md = moodName(mood);
    return ctx.editMessageText(`✅ Записав: ${st.icon} ${st.n} · ${md.e} ${md.n}. Гарного дня!`).catch(() =>
      ctx.reply(`✅ Записав: ${st.icon} ${st.n} · ${md.e} ${md.n}. Гарного дня!`));
  }
});

// ── text input (wizard steps + claim search) ─────────────────────────────────
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // commands handled elsewhere

  if (ctx.session.flow === 'claim') {
    let matches = [];
    try { matches = (await api.search(text)) || []; } catch (e) {}
    const free = matches.filter((m) => !m.tg_linked);
    if (!free.length) {
      return ctx.reply('Не знайшов вільної картки з таким ім’ям. Спробуй інакше, або створи нового персонажа: /start');
    }
    const kb = new InlineKeyboard();
    free.slice(0, 8).forEach((m) => kb.text(`${m.name}${m.dept ? ' · ' + m.dept : ''}`, 'claim:' + m.id).row());
    return ctx.reply('Ось що знайшов — обери себе:', { reply_markup: kb });
  }

  if (ctx.session.flow === 'new') {
    const step = STEPS[ctx.session.stepIdx];
    const meta = TEXT_STEPS.find((s) => s.k === step);
    if (!meta) return; // waiting on a button, not text
    if (meta.required && !text) return ctx.reply('Це поле обов’язкове 🙂 Введи, будь ласка:');
    ctx.session.draft[meta.k] = text;
    return advance(ctx);
  }
});

// ── photo (avatar step) — accepts a compressed photo OR an image sent as a file ──
async function captureAvatar(ctx, fileId, mime) {
  const flow = ctx.session.flow;
  const onAvatarStep = flow === 'new' && STEPS[ctx.session.stepIdx] === 'avatar';
  if (!onAvatarStep && flow !== 'photo') return;
  let dataUrl;
  try {
    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    dataUrl = `data:${mime || 'image/jpeg'};base64,${buf.toString('base64')}`;
    console.log(`[bot] avatar photo captured for tg ${ctx.from.id}: ${buf.length} bytes`);
  } catch (e) {
    console.error('[bot] photo failed:', e.message);
    await ctx.reply('Не вдалося обробити фото — обери колір замість нього:', { reply_markup: colorKeyboard() });
    return; // stay in the current flow so the colour choice can complete it
  }
  if (flow === 'photo') {                         // photo-only change → save immediately
    let me = null; try { me = await api.byTelegram(ctx.from.id); } catch (e) {}
    if (me) { try { await api.update(me.id, { photo: dataUrl }); } catch (e) { console.error('[bot] photo update failed:', e.message); } }
    ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
    return ctx.reply('✅ Фото оновлено! Побачиш його в офісі за кілька секунд.');
  }
  ctx.session.draft.photo = dataUrl;              // create wizard → continue to status
  await ctx.reply('Гарне фото! 📸');
  ctx.session.stepIdx = STEPS.indexOf('status');
  return sendStep(ctx);
}
bot.on('message:photo', (ctx) => {
  const photos = ctx.message.photo;
  const size = photos[Math.min(1, photos.length - 1)]; // a small-ish size keeps the data URL light
  return captureAvatar(ctx, size.file_id, 'image/jpeg');
});
bot.on('message:document', (ctx) => {
  const d = ctx.message.document;
  if (!d || !(d.mime_type || '').startsWith('image/')) return; // ignore non-image files
  return captureAvatar(ctx, d.file_id, d.mime_type);
});

// ── daily check-in (weekday mornings, Kyiv) ──────────────────────────────────
async function sendCheckins() {
  let linked = [];
  try { linked = (await api.linked()) || []; } catch (e) { console.error('[bot] check-in list failed:', e.message); return; }
  for (const e of linked) {
    try {
      await bot.api.sendMessage(e.telegram_id, `Доброго ранку, ${e.name.split(' ')[0]}! ☀️\nЯк ти сьогодні? Обери статус:`, {
        reply_markup: statusKeyboard('cst'),
      });
    } catch (err) { /* user may have blocked the bot; skip */ }
  }
  console.log(`[bot] check-in sent to ${linked.length} people`);
}
// Mon–Fri at CHECKIN_HOUR:00, Europe/Kyiv.
cron.schedule(`0 ${CHECKIN_HOUR} * * 1-5`, sendCheckins, { timezone: CHECKIN_TZ });

// ── deliver phone → Telegram notifications ───────────────────────────────────
const NOTIF_TEXT = {
  message: (t, who) => `💬 ${who} написав тобі з офісу:\n«${t || '…'}»`,
  call: (_t, who) => `📞 ${who} телефонує тобі з офісу!`,
  mark: (_t, who) => `📍 ${who} шукає тебе в офісі — відкрив твою картку.`,
};
async function drainNotifications() {
  let pending = [];
  try { pending = (await api.pending()) || []; } catch (e) { return; }
  for (const n of pending) {
    const make = NOTIF_TEXT[n.kind]; if (!make) { await api.markSent(n.id).catch(() => {}); continue; }
    const who = n.from_name || 'Хтось';
    try { await bot.api.sendMessage(n.telegram_id, make(n.text, who)); } catch (e) { /* blocked → still mark sent to avoid a stuck queue */ }
    await api.markSent(n.id).catch(() => {});
  }
}
setInterval(drainNotifications, 8000);

bot.catch((err) => console.error('[bot] error:', err.error?.message || err.message));

// Persistent Menu Button (next to the message input) opens the office as a Mini App.
if (WEBAPP_URL) {
  bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: '📱 Офіс', web_app: { url: WEBAPP_URL } } })
    .then(() => console.log(`[bot] menu button → ${WEBAPP_URL}`))
    .catch((e) => console.error('[bot] setChatMenuButton failed:', e.message));
}

bot.start({ onStart: (info) => console.log(`[bot] @${info.username} started (polling); check-in ${CHECKIN_HOUR}:00 ${CHECKIN_TZ}${WEBAPP_URL ? '; mini app on' : ''}`) });
