import { Bot, InlineKeyboard, InputFile, session } from 'grammy';
import cron from 'node-cron';
import { api } from './api.js';
import { renderReport, reportCaption } from './report.js';
import { STATUS, MOODS, COLORS, COLOR_LABELS, statusName, moodName } from './config.js';
import { localDay, lastWeek, lastMonth } from './periods.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('[bot] TELEGRAM_BOT_TOKEN is not set — get one from @BotFather and put it in .env');
  process.exit(1);
}
const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 9);
const CHECKIN_TZ = process.env.CHECKIN_TZ || 'Europe/Kyiv';
const WEBAPP_URL = process.env.WEBAPP_URL || ''; // https URL of the site → opened as a Mini App

// TELEGRAM_API_ROOT: only for local tests against a fake Bot API server.
const bot = new Bot(TOKEN, process.env.TELEGRAM_API_ROOT ? { client: { apiRoot: process.env.TELEGRAM_API_ROOT } } : undefined);
bot.use(session({ initial: () => ({ flow: null, stepIdx: 0, editId: null, draft: {} }) }));

const genId = () => 'tg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Address people by name everywhere. `firstOf` takes the first token of a full name;
// `hey` picks the best name we have for the person we're talking to — their Telegram
// first_name (always present on an incoming update), falling back to a neutral vocative.
const firstOf = (full) => (full || '').trim().split(/\s+/)[0] || '';
const hey = (ctx) => (ctx.from && ctx.from.first_name) || 'колего';

// ── wizard definition ────────────────────────────────────────────────────────
// Name is asked as two steps (first, then last) so we always know which is which —
// they're joined into a single `name` for the DB/renderer, and the first name alone
// drives greetings. Order here is the source of truth; no guessing on the split.
const TEXT_STEPS = [
  { k: 'firstName', q: 'Як тебе звати? (Ім’я)',            required: true },
  { k: 'lastName',  q: 'А твоє прізвище?',                 required: true },
  { k: 'dept',     q: 'У якому ти відділі?',                required: true },
  { k: 'position', q: 'Твоя посада?',                       skip: true },
  { k: 'email',    q: 'Робочий email?',                     skip: true },
  { k: 'phone',    q: 'Робочий телефон?',                   skip: true },
  { k: 'ext',      q: 'Внутрішній (робочий) номер?',        skip: true },
  { k: 'birthday', q: 'Коли твій день народження? (ДД.ММ — привітаємо в офісі 🎂)', skip: true },
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
  const fullName = [d.firstName, d.lastName].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  const emp = {
    name: fullName, dept: d.dept, position: d.position || null, email: d.email || null,
    phone: d.phone || null, ext: d.ext || null, photo: d.photo || null,
    ...(d.birthday ? { birthday: d.birthday } : {}), // api normalizes ДД.ММ, drops nonsense
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
  const nm = (d.firstName || '').trim() || firstOf(emp.name) || hey(ctx);
  return ctx.reply(
    `${wasEdit ? `✅ Профіль оновлено, ${nm}!` : `🎉 Готово, ${nm}! Ти вже в офісі.`}\n\n` +
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
    `Привіт, ${hey(ctx)}! Це офіс AllianceSim 🏢\n\nСтвори свого персонажа — він оживе в офісі на сайті. ` +
    'Обери, як почати (можна прямо в застосунку 📱 або тут у боті):',
    { reply_markup: kb }
  );
});

bot.command('cancel', async (ctx) => {
  ctx.session = { flow: null, stepIdx: 0, editId: null, draft: {} };
  return ctx.reply(`Скасовано, ${hey(ctx)}. Напиши /start, коли будеш готовий.`);
});

// ── callbacks ────────────────────────────────────────────────────────────────
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Personal phone buttons on notifications: accept/decline an invite, finish a task.
  // The API checks the presser actually is the invitee / assignee.
  // Spec 007: game invite (Прийняти/Відхилити) and poll votes from an announcement.
  const gm = /^gm:(acc|dec):(\d+)$/.exec(data), pv = /^pv:(\d+):(\d+)$/.exec(data);
  if (gm) {
    let r; try { r = await api.gameRespond(gm[2], ctx.from.id, gm[1] === 'acc'); } catch (e) { r = { status: 0 }; }
    if (r.status !== 200) return ctx.answerCallbackQuery({ text: r.status === 409 ? 'Запрошення вже неактуальне' : r.status === 404 ? 'Гру не знайдено' : 'Не вдалося 😕' }).catch(() => {});
    const note = gm[1] === 'acc' ? '✅ Виклик прийнято — відкривай гру!' : '❌ Ти відхилив(ла) запрошення';
    await ctx.answerCallbackQuery({ text: note }).catch(() => {});
    const msg = ctx.callbackQuery.message;
    const keep = (msg?.reply_markup?.inline_keyboard || []).map((row) => row.filter((b) => b.web_app)).filter((row) => row.length);
    return ctx.editMessageText(`${msg?.text || ''}\n\n${note}`, { reply_markup: { inline_keyboard: gm[1] === 'acc' ? keep : [] } }).catch(() => {});
  }
  if (pv) {
    let r; try { r = await api.vote(pv[1], ctx.from.id, Number(pv[2])); } catch (e) { r = { status: 0 }; }
    if (r.status !== 200 || !r.data) return ctx.answerCallbackQuery({ text: 'Опитування недоступне' }).catch(() => {});
    const total = r.data.counts.reduce((a, b) => a + b, 0);
    await ctx.answerCallbackQuery({ text: `🗳 Голос враховано · ${r.data.options[Number(pv[2])]}` }).catch(() => {});
    // Live results right on the buttons.
    const msg = ctx.callbackQuery.message;
    const rows = (msg?.reply_markup?.inline_keyboard || []).map((row) => row.map((b) => {
      const m = /^pv:\d+:(\d+)$/.exec(b.callback_data || '');
      return m ? { text: `${r.data.options[+m[1]].slice(0, 30)} · ${total ? Math.round(r.data.counts[+m[1]] * 100 / total) : 0}%`, callback_data: b.callback_data } : b;
    }));
    return ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: rows } }).catch(() => {});
  }
  const ev = /^ev:(acc|dec):(\d+)$/.exec(data), tk = /^tk:done:(\d+)$/.exec(data);
  if (ev || tk) {
    let r;
    try { r = ev ? await api.respondEvent(ev[2], ctx.from.id, ev[1] === 'acc' ? 'accepted' : 'declined') : await api.taskDone(tk[1], ctx.from.id); }
    catch (e) { r = { status: 0 }; }
    if (r.status !== 200) return ctx.answerCallbackQuery({ text: r.status === 404 ? 'Вже недоступно' : 'Не вдалося 😕', show_alert: false }).catch(() => {});
    const note = ev ? (ev[1] === 'acc' ? '✅ Ти прийняв(ла) запрошення' : '❌ Ти відхилив(ла) запрошення') : '✅ Позначено виконаною';
    await ctx.answerCallbackQuery({ text: note }).catch(() => {});
    // Keep the "open" button, drop the action buttons, append the outcome.
    const msg = ctx.callbackQuery.message;
    const keep = (msg?.reply_markup?.inline_keyboard || []).map((row) => row.filter((b) => b.web_app)).filter((row) => row.length);
    return ctx.editMessageText(`${msg?.text || ''}\n\n${note}`, { reply_markup: { inline_keyboard: keep } }).catch(() => {});
  }

  await ctx.answerCallbackQuery().catch(() => {});

  // start create
  if (data === 'flow:new') {
    ctx.session = { flow: 'new', stepIdx: 0, editId: null, draft: {} };
    return sendStep(ctx);
  }
  // start claim
  if (data === 'flow:claim') {
    ctx.session = { flow: 'claim', stepIdx: 0, editId: null, draft: {} };
    return ctx.reply(`Введи своє ім’я, ${hey(ctx)}, щоб я знайшов твою картку в офісі:`);
  }
  // edit existing profile
  if (data === 'edit') {
    let me = null; try { me = await api.byTelegram(ctx.from.id); } catch (e) {}
    ctx.session = { flow: 'new', stepIdx: 0, editId: me ? me.id : null, draft: {} };
    return sendStep(ctx);
  }
  // update status+mood only
  if (data === 'upd') return ctx.reply(`Який у тебе статус зараз, ${hey(ctx)}?`, { reply_markup: statusKeyboard('cst') });

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
    return ctx.reply(`✅ Прив’язано, ${hey(ctx)}! Тепер це твій персонаж. Щоранку питатиму, як ти. /start — щоб змінити профіль.`);
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
    const done = `✅ Записав, ${hey(ctx)}: ${st.icon} ${st.n} · ${md.e} ${md.n}. Гарного дня!`;
    return ctx.editMessageText(done).catch(() => ctx.reply(done));
  }
});

// ── text input (wizard steps + claim search) ─────────────────────────────────
bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return next(); // pass on to commands registered further down (/report)

  // Reply to one of my "💬 нове повідомлення" pings → post it into that chat (spec 005).
  const replied = ctx.message.reply_to_message;
  if (replied && replied.from && replied.from.is_bot && !ctx.session.flow) {
    let r; try { r = await api.reply(ctx.from.id, replied.message_id, text); } catch (e) { r = { status: 0 }; }
    if (r.status === 200) return ctx.react('👍').catch(() => ctx.reply('✅ Надіслано в чат'));
    return ctx.reply(r.status === 404 ? 'Відповісти можна лише на сповіщення про нове повідомлення 💬' : 'Не вдалося надіслати 😕');
  }

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

// ── daily HR report (weekday mornings, after the check-in) ───────────────────
// Recipient: REPORT_HR_TG (telegram id) wins, else REPORT_HR_NAME (a linked employee);
// both fall back to the coffee HR settings so one HR person is configured once.
const REPORT_HOUR = Number(process.env.REPORT_HOUR || 10);
const REPORT_HR_TG = String(process.env.REPORT_HR_TG || process.env.COFFEE_HR_TG || '').replace(/[^0-9]/g, '');
const REPORT_HR_NAME = process.env.REPORT_HR_NAME || process.env.COFFEE_HR_NAME || '';

// Same rule as the api: every word of the configured name present, in any order.
const words = (s) => String(s || '').toLocaleLowerCase('uk').replace(/[’'ʼ`]/g, '').split(/[\s,]+/).filter(Boolean);
const nameMatches = (name, entry) => { const have = new Set(words(name)), need = words(entry); return need.length > 0 && need.every((w) => have.has(w)); };

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
async function sendAnalytics(chatId, { from, to, dept = null, title = 'Аналітика HR' }) {
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

bot.catch((err) => console.error('[bot] error:', err.error?.message || err.message));

// Persistent Menu Button (next to the message input) opens the office as a Mini App.
if (WEBAPP_URL) {
  bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: '📱 Офіс', web_app: { url: WEBAPP_URL } } })
    .then(() => console.log(`[bot] menu button → ${WEBAPP_URL}`))
    .catch((e) => console.error('[bot] setChatMenuButton failed:', e.message));
}

bot.start({ onStart: (info) => console.log(`[bot] @${info.username} started (polling); check-in ${CHECKIN_HOUR}:00, HR report ${REPORT_HOUR}:00 ${CHECKIN_TZ}${WEBAPP_URL ? '; mini app on' : ''}`) });
