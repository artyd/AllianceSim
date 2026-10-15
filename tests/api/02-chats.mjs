// Phase 2: direct chats, messages, edit/delete, read receipts, typing, SSE, notifications.
import { start, stop, call, seed, ok, eq, report, BASE } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sse(token) {
  const ctl = new AbortController();
  const r = await fetch(`${BASE}/me/stream?t=${encodeURIComponent(token)}`, { signal: ctl.signal });
  const out = { events: [], status: r.status, close: () => ctl.abort() };
  if (r.status !== 200) return out;
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(frame), da = /^data: (.*)$/m.exec(frame);
          if (ev && da) out.events.push({ type: ev[1], data: JSON.parse(da[1]) });
        }
      }
    } catch (e) {}
  })();
  return out;
}
const tok = async (tg) => (await call('POST', '/me/session', { as: tg })).data.token;
const pending = async () => (await call('GET', '/notifications/pending', { hr: true })).data;

await start();
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
    { id: 'n', name: 'Ніхто Неприв', dept: 'IT' },
  ]);
  const [ta, tb, tc] = [await tok(1001), await tok(1002), await tok(1003)];
  eq((await sse('garbage')).status, 401, 'stream needs token');
  const sa = await sse(ta), sb = await sse(tb), sc = await sse(tc);
  await sleep(200);

  eq((await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'n' } })).status, 404, 'cannot chat unlinked');
  eq((await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'a' } })).status, 400, 'cannot chat self');
  const ch = (await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'b' } })).data;
  ok(ch && ch.kind === 'direct' && ch.members.length === 2, 'direct chat created');
  eq((await call('POST', '/me/chats/direct', { as: 1002, body: { employeeId: 'a' } })).data.id, ch.id, 'same chat from other side');
  eq((await call('GET', '/me/chats', { as: 1001 })).data.filter((c) => c.kind === 'direct').length, 0, 'empty direct hidden from list');

  // B is viewing → no notification for first message
  await call('POST', '/me/presence', { token: tb, body: { chatId: ch.id } });
  const m1 = await call('POST', `/me/chats/${ch.id}/messages`, { as: 1001, body: { text: 'Привіт, Богдане!' } });
  eq(m1.status, 201, 'send');
  await sleep(300);
  ok(sb.events.some((e) => e.type === 'message' && e.data.text === 'Привіт, Богдане!'), 'B got message over SSE');
  ok(sa.events.some((e) => e.type === 'message'), 'A (sender) also got echo');
  ok(!sc.events.some((e) => e.type === 'message' && e.data.chatId === ch.id), 'C got nothing from the A–B chat');
  eq((await pending()).filter((n) => n.kind === 'chat').length, 0, 'no ping while viewing');

  // B leaves chat → notification queued once (throttle)
  await call('POST', '/me/presence', { token: tb, body: { chatId: null } });
  await call('POST', `/me/chats/${ch.id}/messages`, { as: 1001, body: { text: 'Ти тут?' } });
  await call('POST', `/me/chats/${ch.id}/messages`, { as: 1001, body: { text: 'Ще одне' } });
  await sleep(300);
  const p = (await pending()).filter((n) => n.kind === 'chat');
  eq(p.length, 1, 'one throttled ping');
  ok(p[0] && p[0].from_name === 'Анна Коваль' && p[0].payload.open === 'chat_' + ch.id && p[0].telegram_id === '1002', 'ping payload/deeplink');

  // list / unread
  const directs = async (tg) => (await call('GET', '/me/chats', { as: tg })).data.filter((c) => c.kind === 'direct');
  let lb = await directs(1002);
  eq(lb.length, 1, 'B list has chat'); eq(lb[0].unread, 3, 'B unread 3');
  eq((await directs(1001))[0].unread, 0, 'A unread 0 (own)');
  eq((await call('GET', `/me/chats/${ch.id}/messages`, { as: 1003 })).status, 404, 'C cannot read');
  eq((await call('POST', `/me/chats/${ch.id}/messages`, { as: 1003, body: { text: 'x' } })).status, 404, 'C cannot write');
  eq((await call('GET', `/me/chats/${ch.id}/messages`, { hr: true })).status, 401, 'HR cannot read');

  const hist = (await call('GET', `/me/chats/${ch.id}/messages`, { as: 1002 })).data;
  eq(hist.messages.map((m) => m.text), ['Привіт, Богдане!', 'Ти тут?', 'Ще одне'], 'history order');
  const lastId = hist.messages[2].id;
  await call('POST', `/me/chats/${ch.id}/read`, { as: 1002, body: { upTo: lastId } });
  await sleep(200);
  ok(sa.events.some((e) => e.type === 'read' && e.data.employeeId === 'b' && e.data.lastRead === lastId), 'A sees read receipt');
  eq((await directs(1002))[0].unread, 0, 'B unread 0 after read');
  eq((await call('POST', `/me/chats/${ch.id}/read`, { as: 1002, body: { upTo: '999999' } })).data.lastRead, lastId, 'read clamps to max id');

  // typing
  await call('POST', `/me/chats/${ch.id}/typing`, { as: 1002 });
  await sleep(200);
  ok(sa.events.some((e) => e.type === 'typing' && e.data.employeeId === 'b'), 'typing reaches A');
  ok(!sb.events.some((e) => e.type === 'typing'), 'typing not echoed to self');

  // edit / delete
  const mid = m1.data.id;
  eq((await call('PATCH', `/me/messages/${mid}`, { as: 1002, body: { text: 'hack' } })).status, 404, 'B cannot edit A msg');
  const ed = await call('PATCH', `/me/messages/${mid}`, { as: 1001, body: { text: 'Привіт!' } });
  ok(ed.data.text === 'Привіт!' && ed.data.editedAt, 'edit');
  await call('DELETE', `/me/messages/${mid}`, { as: 1001 });
  await sleep(200);
  ok(sb.events.some((e) => e.type === 'message_update' && e.data.id === mid && e.data.deleted && e.data.text === null), 'delete broadcast');
  eq((await call('PATCH', `/me/messages/${mid}`, { as: 1001, body: { text: 'again' } })).status, 404, 'cannot edit deleted');
  const after = (await call('GET', `/me/chats/${ch.id}/messages?after=${mid}`, { as: 1002 })).data.messages.length;
  eq(after, 2, 'after= paging');
  // paging
  for (let i = 0; i < 55; i++) await call('POST', `/me/chats/${ch.id}/messages`, { as: 1002, body: { text: 'm' + i } });
  const pg1 = (await call('GET', `/me/chats/${ch.id}/messages`, { as: 1001 })).data;
  ok(pg1.messages.length === 50 && pg1.hasMore, 'page 1');
  const pg2 = (await call('GET', `/me/chats/${ch.id}/messages?before=${pg1.messages[0].id}`, { as: 1001 })).data;
  eq(pg2.messages.length, 8, 'page 2 rest');
  eq((await call('POST', `/me/chats/${ch.id}/messages`, { as: 1001, body: { text: '   ' } })).status, 400, 'blank rejected');
  // muted prefs: messages pref off → no ping
  await call('PUT', '/me/prefs', { as: 1003, body: { messages: false } });
  const ch2 = (await call('POST', '/me/chats/direct', { as: 1001, body: { employeeId: 'c' } })).data;
  await call('POST', `/me/chats/${ch2.id}/messages`, { as: 1001, body: { text: 'Віро?' } });
  await sleep(300);
  ok(!(await pending()).some((n) => n.telegram_id === '1003'), 'prefs.messages=false respected');
  sa.close(); sb.close(); sc.close();
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
