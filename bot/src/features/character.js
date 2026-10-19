import { InlineKeyboard } from 'grammy';
import { bot, WEBAPP_URL, genId, firstOf, hey } from '../lib/bot.js';
import { api } from '../lib/api.js';
import { STATUS, MOODS, COLORS, COLOR_LABELS, statusName, moodName } from '../lib/config.js';

// Character wizard: /start, /cancel, inline buttons, text and photo input.
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
export function statusKeyboard(prefix) {
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
