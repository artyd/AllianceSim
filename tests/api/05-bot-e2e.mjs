// Bot e2e: real bot process against a fake Telegram Bot API + the real API.
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { start, stop, call, seed, ok, eq, report, BASE, BOT, HR, REPO } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = []; const updates = []; let uid = 1, mid = 100;
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const method = req.url.split('/').pop();
    let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
    const send = (result) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
    if (method === 'getUpdates') {
      for (let i = 0; i < 10 && !updates.length; i++) await sleep(100);
      const off = p.offset || 0; const out = updates.filter((u) => u.update_id >= off); updates.length = 0;
      return send(out);
    }
    const call = { method, p };
    calls.push(call);
    if (method === 'getMe') return send({ id: 999, is_bot: true, first_name: 'Bot', username: 'test_bot' });
    if (method === 'sendMessage' || method === 'editMessageText') { call.message_id = mid++; return send({ message_id: call.message_id, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text }); }
    return send(true);
  });
});
await new Promise((r) => srv.listen(18100, r));

await start();
const bot = spawn(process.execPath, [path.join(REPO, 'bot', 'src', 'index.js')], {
  env: { ...process.env, TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_API_ROOT: 'http://127.0.0.1:18100', API_URL: BASE, EDIT_TOKEN: HR, WEBAPP_URL: 'https://office.test/' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
bot.stderr.on('data', (d) => process.stdout.write('[bot!] ' + d));
const waitFor = async (pred, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = calls.find(pred); if (c) return c; await sleep(200); } return null; };
const press = (tg, data, msg) => updates.push({ update_id: uid++, callback_query: { id: 'cq' + uid, from: { id: tg, is_bot: false, first_name: 'U' }, chat_instance: 'x', data, message: { message_id: msg.message_id || 1, date: 0, chat: { id: tg, type: 'private' }, text: msg.p.text, reply_markup: msg.p.reply_markup } } });

try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
  ]);
  ok(await waitFor((c) => c.method === 'getMe'), 'bot started');
  const btns = (c) => (c.p.reply_markup?.inline_keyboard || []).flat();

  // invite → message with buttons + web app deep link
  const ev = (await call('POST', '/me/events', { as: 1001, body: { title: 'Планерка', startsAt: new Date(Date.now() + 7200e3).toISOString(), attendeeIds: ['b'] } })).data;
  const inv = await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1002 && /запрошує/.test(c.p.text));
  ok(inv, 'invite delivered: ' + (inv && inv.p.text.split('\n')[0]));
  ok(inv && btns(inv).some((b) => b.callback_data === `ev:acc:${ev.id}`), 'accept button');
  ok(inv && btns(inv).some((b) => b.web_app && b.web_app.url === `https://office.test/?open=event_${ev.id}`), 'open button deep link');
  // press accept
  press(1002, `ev:acc:${ev.id}`, inv);
  const edit = await waitFor((c) => c.method === 'editMessageText' && /прийняв/.test(c.p.text));
  ok(edit, 'message edited with outcome');
  ok(edit && btns(edit).length === 1 && btns(edit)[0].web_app, 'action buttons removed, open kept');
  eq((await call('GET', `/me/events/${ev.id}`, { as: 1002 })).data.myStatus, 'accepted', 'API status accepted');
  ok(await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1001 && /прийняв\(ла\) ✅/.test(c.p.text)), 'organizer notified');
  // someone else pressing → refused
  press(1001, `ev:dec:${ev.id}`, inv);
  ok(await waitFor((c) => c.method === 'answerCallbackQuery' && /недоступно|Не вдалося/.test(c.p.text || '')), 'organizer cannot press guest button');

  // task assigned → done button
  const t = (await call('POST', '/me/tasks', { as: 1001, body: { text: 'Звіт', assigneeId: 'b' } })).data;
  const tm = await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1002 && /поставив/.test(c.p.text));
  ok(tm && btns(tm).some((b) => b.callback_data === `tk:done:${t.id}`), 'task message with done button');
  press(1002, `tk:done:${t.id}`, tm);
  ok(await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1001 && /виконав/.test(c.p.text)), 'author told task done');
  ok((await call('GET', '/me/tasks', { as: 1002 })).data.find((x) => x.id === t.id).done, 'task done in API');

  // chat message → open chat button
  const d = (await call('POST', '/me/chats/direct', { as: 1002, body: { employeeId: 'a' } })).data;
  await call('POST', `/me/chats/${d.id}/messages`, { as: 1002, body: { text: 'Дякую!' } });
  const cm = await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1001 && /Дякую!/.test(c.p.text));
  ok(cm && /нове повідомлення від Богдан Лис/.test(cm.p.text), 'chat ping text');
  ok(cm && btns(cm).some((b) => b.web_app && /open=chat_/.test(b.web_app.url)), 'chat ping opens chat');

  // spec 005: replying to the ping in Telegram posts into the chat
  ok(cm && /Відповідай на це повідомлення/.test(cm.p.text), 'ping invites a reply');
  await sleep(500); // markSent(tgMessageId) lands right after sendMessage
  updates.push({ update_id: uid++, message: { message_id: 9001, date: 0, chat: { id: 1001, type: 'private' }, from: { id: 1001, is_bot: false, first_name: 'Анна' }, text: 'Будь ласка 🙂',
    reply_to_message: { message_id: cm.message_id, date: 0, chat: { id: 1001, type: 'private' }, from: { id: 999, is_bot: true, first_name: 'Bot' }, text: cm.p.text } } });
  ok(await waitFor((c) => c.method === 'setMessageReaction' && c.p.message_id === 9001), 'bot reacts 👍 to the reply');
  const lastMsg = (await call('GET', `/me/chats/${d.id}/messages`, { as: 1002 })).data.messages.pop();
  ok(lastMsg && lastMsg.text === 'Будь ласка 🙂' && lastMsg.senderId === 'a', 'reply landed in the chat as Anna');
  // reply to a non-chat message (e.g. the task ping) → explained
  updates.push({ update_id: uid++, message: { message_id: 9002, date: 0, chat: { id: 1002, type: 'private' }, from: { id: 1002, is_bot: false, first_name: 'B' }, text: 'ок',
    reply_to_message: { message_id: tm.message_id, date: 0, chat: { id: 1002, type: 'private' }, from: { id: 999, is_bot: true, first_name: 'Bot' }, text: tm.p.text } } });
  ok(await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1002 && /Відповісти можна лише/.test(c.p.text)), 'reply to non-chat ping explained');

  // HR announcement → 📢 template
  await call('POST', '/announce', { hr: true, body: { target: 'office', text: 'Свято в пʼятницю' } });
  const an = await waitFor((c) => c.method === 'sendMessage' && /📢 Оголошення/.test(c.p.text));
  ok(an && /від HR/.test(an.p.text) && /Свято/.test(an.p.text), 'announcement text');

  // ── spec 007: game invite → Прийняти in Telegram; poll vote buttons ──
  const g = (await call('POST', '/me/games', { as: 1001, body: { kind: 'chess', invite: ['b'] } })).data;
  const gi = await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1002 && /запрошує тебе зіграти: Шахи/.test(c.p.text));
  ok(gi && btns(gi).some((b) => b.callback_data === `gm:acc:${g.id}`) && btns(gi).some((b) => b.web_app && /open=game_/.test(b.web_app.url)), 'game invite with buttons + open link');
  press(1002, `gm:acc:${g.id}`, gi);
  ok(await waitFor((c) => c.method === 'editMessageText' && /Виклик прийнято/.test(c.p.text)), 'invite message edited: accepted');
  eq((await call('GET', `/me/games/${g.id}`, { as: 1001 })).data.status, 'active', 'game active after the Telegram press');
  await call('POST', '/announce', { hr: true, body: { target: 'office', text: 'Коли корпоратив?', poll: ['Пʼятниця', 'Субота'] } });
  const pa = await waitFor((c) => c.method === 'sendMessage' && c.p.chat_id == 1002 && /Коли корпоратив/.test(c.p.text));
  ok(pa && btns(pa).filter((b) => /^pv:/.test(b.callback_data || '')).length === 2, 'announcement carries poll buttons');
  press(1002, btns(pa).find((b) => /^pv:/.test(b.callback_data)).callback_data, pa);
  const pe = await waitFor((c) => c.method === 'editMessageReplyMarkup' && JSON.stringify(c.p).includes('100%'));
  ok(pe, 'poll buttons show live results after the vote');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
bot.kill(); srv.close();
await stop();
process.exit(f ? 1 : 0);
