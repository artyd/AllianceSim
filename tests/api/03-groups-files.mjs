// Phase 3: office/dept chats sync, groups (create/rename/add/remove/mute/leave), attachments.
import { start, stop, call, seed, ok, eq, report, BASE, initData } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async (tg) => (await call('GET', '/me/chats', { as: tg })).data;
const kinds = (l) => l.map((c) => c.kind + ':' + (c.dept || c.title || '')).sort();
async function upload(tg, chatId, buf, name, mime) {
  const r = await fetch(`${BASE}/me/attachments?chatId=${chatId}&name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`, {
    method: 'POST', headers: { 'X-Telegram-Init-Data': initData(tg), 'content-type': 'application/octet-stream' }, body: buf });
  return { status: r.status, data: await r.json().catch(() => null) };
}

await start();
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
    { id: 'c', name: 'Віра Мак', dept: 'IT ', tg: 1003 },
    { id: 'n', name: 'Ніхто Неприв', dept: 'IT' },
  ]);
  await sleep(1200); // debounced sync after employee writes

  // system chats
  eq(kinds(await list(1001)), ['dept:HR', 'office:Весь офіс'], 'A: office + HR');
  eq(kinds(await list(1002)), ['dept:IT', 'office:Весь офіс'], 'B: office + IT');
  const itB = (await list(1002)).find((c) => c.kind === 'dept');
  eq(itB.members.map((m) => m.id).sort(), ['b', 'c'], 'IT chat = linked IT people (trimmed dept), not n');
  // move C to HR → leaves IT chat, joins HR
  await call('PUT', '/employees/c', { hr: true, body: { dept: 'HR' } });
  await sleep(1200);
  eq(kinds(await list(1003)), ['dept:HR', 'office:Весь офіс'], 'C moved to HR chat');
  eq((await list(1002)).find((c) => c.kind === 'dept').members.length, 1, 'IT chat lost C');
  // link N → joins office + IT
  await call('PUT', '/employees/n', { hr: true, body: { telegram_id: 1004 } });
  await sleep(1200);
  eq(kinds(await list(1004)), ['dept:IT', 'office:Весь офіс'], 'newly linked N gets system chats');
  const office = (await list(1001)).find((c) => c.kind === 'office');
  eq(office.members.length, 4, 'office has all 4 linked');
  eq((await call('PATCH', `/me/chats/${office.id}`, { as: 1001, body: { title: 'x' } })).status, 403, 'office not editable');
  eq((await call('POST', `/me/chats/${office.id}/leave`, { as: 1001 })).status, 403, 'cannot leave office');
  await call('POST', `/me/chats/${office.id}/messages`, { as: 1001, body: { text: 'Всім привіт!' } });
  await sleep(300);
  const pend = (await call('GET', '/notifications/pending', { hr: true })).data.filter((n) => n.kind === 'chat');
  eq(pend.length, 3, 'office message pings 3 others');
  eq(pend[0].payload.chatTitle, 'Весь офіс', 'ping has chat title');

  // groups
  eq((await call('POST', '/me/chats', { as: 1001, body: { title: '', memberIds: ['b'] } })).status, 400, 'group needs title');
  eq((await call('POST', '/me/chats', { as: 1001, body: { title: 'X', memberIds: ['zzz'] } })).status, 400, 'group needs real members');
  const g = (await call('POST', '/me/chats', { as: 1001, body: { title: 'Корпоратив', memberIds: ['b', 'c', 'zzz'] } })).data;
  ok(g && g.kind === 'group' && g.members.length === 3 && g.createdBy === 'a', 'group created with valid members');
  ok((await list(1002)).some((c) => c.id === g.id), 'B sees group');
  eq((await call('PATCH', `/me/chats/${g.id}`, { as: 1002, body: { title: 'Хак' } })).status, 403, 'non-creator cannot rename');
  eq((await call('PATCH', `/me/chats/${g.id}`, { as: 1001, body: { title: 'Корпоратив 2026' } })).data.title, 'Корпоратив 2026', 'rename');
  const add = (await call('PATCH', `/me/chats/${g.id}`, { as: 1001, body: { add: ['n'] } })).data;
  eq(add.members.length, 4, 'add member');
  const rm = (await call('PATCH', `/me/chats/${g.id}`, { as: 1001, body: { remove: ['c', 'a'] } })).data;
  eq(rm.members.map((m) => m.id).sort(), ['a', 'b', 'n'], 'remove C (creator cannot be removed)');
  eq((await call('GET', `/me/chats/${g.id}/messages`, { as: 1003 })).status, 404, 'removed C has no access');
  eq((await call('PATCH', `/me/chats/${g.id}`, { as: 1002, body: { muted: true } })).data.muted, true, 'member mutes');
  await call('POST', `/me/chats/${g.id}/messages`, { as: 1001, body: { text: 'Хто йде?' } });
  await sleep(300);
  const p2 = (await call('GET', '/notifications/pending', { hr: true })).data.filter((n) => n.kind === 'chat' && n.payload.open === 'chat_' + g.id);
  eq(p2.map((n) => n.telegram_id).sort(), ['1004'], 'muted B not pinged, N pinged');
  // creator leaves → ownership passes; last leaves → deleted
  eq((await call('POST', `/me/chats/${g.id}/leave`, { as: 1001 })).status, 200, 'creator leaves');
  const g2 = (await call('GET', `/me/chats/${g.id}`, { as: 1002 })).data;
  ok(g2.createdBy === 'b' && g2.members.length === 2, 'ownership → longest member');
  await call('POST', `/me/chats/${g.id}/leave`, { as: 1002 });
  await call('POST', `/me/chats/${g.id}/leave`, { as: 1004 });
  eq((await call('GET', `/me/chats/${g.id}`, { as: 1004 })).status, 404, 'empty group gone');

  // attachments
  const d = (await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'b' } })).data;
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await upload(1001, d.id, png, 'фото.png', 'image/png');
  eq(up.status, 201, 'upload');
  eq((await upload(1003, d.id, png, 'x.png', 'image/png')).status, 404, 'non-member cannot upload');
  const big = await upload(1001, d.id, Buffer.alloc(21 * 1024 * 1024), 'big.bin', 'application/octet-stream');
  eq(big.status, 413, '>20MB rejected with 413');
  eq((await call('POST', `/me/chats/${d.id}/messages`, { as: 1002, body: { attachmentId: up.data.id } })).status, 400, 'B cannot send A upload');
  const msg = await call('POST', `/me/chats/${d.id}/messages`, { as: 1001, body: { attachmentId: up.data.id } });
  ok(msg.status === 201 && msg.data.attachment && msg.data.attachment.name === 'фото.png', 'message with attachment');
  eq((await call('POST', `/me/chats/${d.id}/messages`, { as: 1001, body: { attachmentId: up.data.id } })).status, 400, 'attachment single-use');
  const tokB = (await call('POST', '/me/session', { as: 1002 })).data.token;
  let r = await fetch(`${BASE}/me/attachments/${up.data.id}?t=${tokB}`);
  ok(r.status === 200 && r.headers.get('content-type') === 'image/png' && /inline/.test(r.headers.get('content-disposition')), 'B downloads inline png');
  ok(Buffer.from(await r.arrayBuffer()).equals(png), 'bytes intact');
  const tokC = (await call('POST', '/me/session', { as: 1003 })).data.token;
  eq((await fetch(`${BASE}/me/attachments/${up.data.id}?t=${tokC}`)).status, 404, 'C cannot download');
  eq((await fetch(`${BASE}/me/attachments/${up.data.id}`)).status, 401, 'no token → 401');
  // html is never served inline
  const h = await upload(1001, d.id, Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html');
  await call('POST', `/me/chats/${d.id}/messages`, { as: 1001, body: { attachmentId: h.data.id, text: 'html' } });
  r = await fetch(`${BASE}/me/attachments/${h.data.id}?t=${tokB}`);
  ok(r.headers.get('content-type') === 'application/octet-stream' && /attachment/.test(r.headers.get('content-disposition')) && /sandbox/.test(r.headers.get('content-security-policy')), 'html forced download + sandbox');
  // json body doesn't trip express.json
  const j = await upload(1001, d.id, Buffer.from('{"a":1}'), 'data.json', 'application/json');
  eq(j.status, 201, 'json file upload ok');
  // delete message removes file
  await call('DELETE', `/me/messages/${msg.data.id}`, { as: 1001 });
  eq((await fetch(`${BASE}/me/attachments/${up.data.id}?t=${tokB}`)).status, 410, 'deleted msg → file gone (410)');
  const hist = (await call('GET', `/me/chats/${d.id}/messages`, { as: 1002 })).data.messages;
  ok(hist.find((m) => m.id === msg.data.id).attachment === null, 'deleted msg has no attachment');
  ok(hist.find((m) => m.text === 'html').attachment.name === 'x.html', 'history includes attachment meta');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
