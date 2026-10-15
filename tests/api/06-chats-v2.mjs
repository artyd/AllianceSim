// Spec 005 B: replies, reactions, search, announcements (Mini App + HR), reply-from-Telegram, audio.
import { start, stop, call, seed, ok, eq, report, BASE, initData } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pend = async () => (await call('GET', '/notifications/pending', { hr: true })).data;
const drain = async () => { for (const n of await pend()) await call('POST', `/notifications/${n.id}/sent`, { hr: true }); };

await start({ ANNOUNCE_ALLOWED: 'Анна Коваль' });
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
  ]);
  await sleep(1200); await drain();
  const d = (await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'b' } })).data;
  const d2 = (await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'c' } })).data;
  const m1 = (await call('POST', `/me/chats/${d.id}/messages`, { as: 1001, body: { text: 'Зустріч о 15:00 у переговорній 100%' } })).data;
  const other = (await call('POST', `/me/chats/${d2.id}/messages`, { as: 1001, body: { text: 'Віро, привіт' } })).data;

  // replies
  const r1 = await call('POST', `/me/chats/${d.id}/messages`, { as: 1002, body: { text: 'Буду!', replyTo: m1.id } });
  ok(r1.status === 201 && r1.data.replyTo === m1.id && r1.data.quote.text.startsWith('Зустріч') && r1.data.quote.senderId === 'a', 'reply with quote');
  eq((await call('POST', `/me/chats/${d.id}/messages`, { as: 1002, body: { text: 'x', replyTo: other.id } })).status, 400, 'cannot quote another chat');
  eq((await call('POST', `/me/chats/${d.id}/messages`, { as: 1002, body: { text: 'x', replyTo: 'abc' } })).status, 400, 'bad replyTo');
  await call('DELETE', `/me/messages/${m1.id}`, { as: 1001 });
  const hist = (await call('GET', `/me/chats/${d.id}/messages`, { as: 1002 })).data.messages;
  const rr = hist.find((m) => m.id === r1.data.id);
  ok(rr.quote.deleted && rr.quote.text === null, 'quote of deleted message hides text');

  // reactions
  let x = (await call('POST', `/me/messages/${r1.data.id}/react`, { as: 1001, body: { emoji: '👍' } })).data;
  eq(x.reactions, [{ emoji: '👍', ids: ['a'] }], 'react');
  x = (await call('POST', `/me/messages/${r1.data.id}/react`, { as: 1002, body: { emoji: '👍' } })).data;
  eq(x.reactions[0].ids, ['a', 'b'], 'second person');
  x = (await call('POST', `/me/messages/${r1.data.id}/react`, { as: 1001, body: { emoji: '👍' } })).data;
  eq(x.reactions[0].ids, ['b'], 'toggle off');
  eq((await call('POST', `/me/messages/${r1.data.id}/react`, { as: 1001, body: { emoji: '💩' } })).status, 400, 'unknown emoji');
  eq((await call('POST', `/me/messages/${r1.data.id}/react`, { as: 1003, body: { emoji: '👍' } })).status, 404, 'non-member cannot react');
  eq((await call('GET', `/me/chats/${d.id}/messages`, { as: 1001 })).data.messages.find((m) => m.id === r1.data.id).reactions[0].emoji, '👍', 'reactions in history');

  // search
  await call('POST', `/me/chats/${d.id}/messages`, { as: 1001, body: { text: 'Звіт по закупівлях готовий' } });
  let sr = (await call('GET', '/me/search?q=звіт', { as: 1002 })).data;
  ok(sr.length === 1 && /закупівлях/.test(sr[0].text), 'search finds (case-insensitive)');
  eq((await call('GET', '/me/search?q=привіт', { as: 1002 })).data.length, 0, 'search only my chats');
  eq((await call('GET', '/me/search?q=%25', { as: 1001 })).data.length, 0, '% is literal (deleted msg not found)');
  eq((await call('GET', '/me/search?q=з', { as: 1001 })).data.length, 0, 'min 2 chars');

  // announcements (Mini App)
  await drain();
  const office = (await call('GET', '/me/chats', { as: 1001 })).data.find((c) => c.kind === 'office');
  await call('PATCH', `/me/chats/${office.id}`, { as: 1003, body: { muted: true } });
  eq((await call('POST', '/me/announce', { as: 1002, body: { target: 'office', text: 'x' } })).status, 403, 'not in ANNOUNCE_ALLOWED');
  const an = await call('POST', '/me/announce', { as: 1001, body: { target: 'office', text: 'Завтра суботник 🌳' } });
  ok(an.status === 201 && an.data.kind === 'announce', 'announce posted');
  await sleep(300);
  const pa = (await pend()).filter((n) => n.kind === 'announce');
  eq(pa.map((n) => n.telegram_id).sort(), ['1002', '1003'], 'announce pings everyone incl. muted');
  await call('POST', '/me/announce', { as: 1001, body: { target: 'office', text: 'Ще одне' } });
  await sleep(300);
  eq((await pend()).filter((n) => n.kind === 'announce').length, 4, 'announce not throttled');
  await drain();
  // HR web announcement
  eq((await call('POST', '/announce', { body: { target: 'office', text: 'x' } })).status, 401, 'HR announce needs token');
  const ha = await call('POST', '/announce', { hr: true, body: { target: 'IT', text: 'IT: оновлення серверів у пʼятницю' } });
  ok(ha.status === 201 && ha.data.senderId === null && ha.data.kind === 'announce', 'HR announce to dept, no sender');
  await sleep(300);
  const ph = (await pend()).filter((n) => n.kind === 'announce');
  ok(ph.length === 2 && ph.every((n) => n.from_name === 'HR') && ph.map((n) => n.telegram_id).sort().join() === '1002,1003', 'HR announce → IT people, from HR');
  eq((await call('POST', '/announce', { hr: true, body: { target: 'Нема такого', text: 'x' } })).status, 404, 'unknown dept → 404');
  await drain();

  // reply from Telegram: a chat ping that the bot delivered as Telegram message 555
  await call('POST', `/me/chats/${d2.id}/messages`, { as: 1003, body: { text: 'Анно, глянь звіт' } });
  await sleep(300);
  const ping = (await pend()).find((n) => n.kind === 'chat' && n.telegram_id === '1001');
  ok(ping && ping.payload.reply === true, 'chat ping offers reply');
  await call('POST', `/notifications/${ping.id}/sent`, { hr: true, body: { tgMessageId: 555 } });
  eq((await call('POST', '/bot/reply', { body: { tgId: 1001, replyTo: 555, text: 'x' } })).status, 401, 'bot reply needs token');
  eq((await call('POST', '/bot/reply', { hr: true, body: { tgId: 1003, replyTo: 555, text: 'hack' } })).status, 404, 'someone else replying → 404');
  eq((await call('POST', '/bot/reply', { hr: true, body: { tgId: 1001, replyTo: 999, text: 'x' } })).status, 404, 'unknown message → 404');
  const br = await call('POST', '/bot/reply', { hr: true, body: { tgId: 1001, replyTo: 555, text: 'Вже дивлюсь 👀' } });
  ok(br.status === 200 && br.data.chatId === d2.id, 'reply routed');
  const last = (await call('GET', `/me/chats/${d2.id}/messages`, { as: 1003 })).data.messages.pop();
  ok(last.text === 'Вже дивлюсь 👀' && last.senderId === 'a', 'reply posted as Anna');

  // voice/audio: inline + Range
  const up = await fetch(`${BASE}/me/attachments?chatId=${d.id}&name=v.webm&mime=audio/webm`, {
    method: 'POST', headers: { 'X-Telegram-Init-Data': initData(1001), 'content-type': 'application/octet-stream' }, body: Buffer.alloc(5000, 7) });
  const upj = await up.json();
  const vm = await call('POST', `/me/chats/${d.id}/messages`, { as: 1001, body: { attachmentId: upj.id } });
  eq(vm.data.attachment.mime, 'audio/webm', 'voice message');
  const tok = (await call('POST', '/me/session', { as: 1002 })).data.token;
  let r = await fetch(`${BASE}/me/attachments/${upj.id}?t=${tok}`);
  ok(r.status === 200 && r.headers.get('content-type') === 'audio/webm' && /inline/.test(r.headers.get('content-disposition')) && r.headers.get('accept-ranges') === 'bytes', 'audio inline + ranges');
  r = await fetch(`${BASE}/me/attachments/${upj.id}?t=${tok}`, { headers: { Range: 'bytes=0-99' } });
  ok(r.status === 206 && (await r.arrayBuffer()).byteLength === 100, 'range request → 206');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
