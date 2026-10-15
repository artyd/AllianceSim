// Spec 005 D/E (api): birthdays + anniversaries, daily posts, newcomer welcome, hot desks, snapshots.
import fs from 'fs';
import path from 'path';
import { start, stop, call, seed, ok, eq, report, REPO } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pend = async () => (await call('GET', '/notifications/pending', { hr: true })).data;
const kyiv = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };

await start({ CHECKIN_HOUR: '0' }); // daily posts may run at any hour in tests
try {
  const today = kyiv(), md = today.slice(5);
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002, extra: { seat: { f: 'd2', i: 0 } } },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
  ]);
  await call('PUT', '/layout', { hr: true, body: { data: JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'layout.json'), 'utf8')) } });

  // private dates: own edit, normalized, hidden from the public list
  eq((await call('PUT', '/employees/a', { as: 1001, body: { birthday: `${md.slice(3)}.${md.slice(0, 2)}` } })).data.birthday, md, 'birthday ДД.ММ → MM-DD');
  eq((await call('PUT', '/employees/a', { as: 1002, body: { birthday: '01.01' } })).status, 403, 'cannot set someone else\'s birthday');
  eq((await call('PUT', '/employees/c', { hr: true, body: { hired_on: `${+today.slice(0, 4) - 3}-${md}`, birthday: '31.02' } })).data.birthday, null, 'impossible date dropped');
  ok(!JSON.stringify((await call('GET', '/employees')).data).includes(md), 'dates not on the public list');
  // web re-sends the public object → birthday survives
  const pubA = (await call('GET', '/employees')).data.find((e) => e.id === 'a');
  await call('POST', '/employees', { hr: true, body: pubA });
  eq((await call('POST', '/tg/verify', { body: { initData: (await import('../harness.mjs')).initData(1001) } })).data.employee.birthday, md, 'upsert keeps birthday');

  let now = (await call('GET', '/office/now?fresh=1')).data;
  eq(now.birthdays, ['a'], 'birthday today');
  eq(now.anniversaries, [{ id: 'c', years: 3 }], 'work anniversary today');

  // daily posts (job every second, CHECKIN_HOUR=0): one greeting each, in the office chat
  await sleep(2500);
  const office = (await call('GET', '/me/chats', { as: 1002 })).data.find((c) => c.kind === 'office');
  let msgs = (await call('GET', `/me/chats/${office.id}/messages`, { as: 1002 })).data.messages.filter((m) => m.kind === 'system');
  ok(msgs.some((m) => /🎂.*Анна Коваль/.test(m.text)) && msgs.some((m) => /🏅 Віра Мак з нами вже 3 роки/.test(m.text)), 'birthday + anniversary posts');
  await sleep(2000);
  eq((await call('GET', `/me/chats/${office.id}/messages`, { as: 1002 })).data.messages.filter((m) => m.kind === 'system').length, msgs.length, 'posted once');
  eq((await pend()).filter((n) => n.kind === 'birthday').map((n) => n.telegram_id), ['1001'], 'birthday person gets a personal ping');
  eq((await call('GET', '/me/chats', { as: 1002 })).data.find((c) => c.kind === 'office').unread, 0, 'system posts do not count as unread');

  // newcomer welcome in the department chat
  await seed([{ id: 'n', name: 'Новенька Оля', dept: 'IT', tg: 1004, extra: { position: 'Дизайнерка' } }]);
  await sleep(1500);
  const it = (await call('GET', '/me/chats', { as: 1002 })).data.find((c) => c.kind === 'dept');
  msgs = (await call('GET', `/me/chats/${it.id}/messages`, { as: 1002 })).data.messages;
  ok(msgs.some((m) => m.kind === 'system' && /👋 Вітаємо в команді: Новенька Оля — Дизайнерка/.test(m.text)), 'welcome post in dept chat');
  await call('PUT', '/employees/n', { hr: true, body: { dept: 'HR' } }); await sleep(1300);
  await call('PUT', '/employees/n', { hr: true, body: { dept: 'IT' } }); await sleep(1300);
  eq((await call('GET', `/me/chats/${it.id}/messages`, { as: 1002 })).data.messages.filter((m) => /Новенька/.test(m.text || '')).length, 1, 'welcomed once');

  // hot desks
  let dk = (await call('GET', '/me/desks', { as: 1003 })).data;
  eq(dk.desks.length, 4, 'four bookable desk seats from the plan');
  ok(dk.desks.find((d) => d.f === 'd2').owner.permanent, 'd2 is Bohdan\'s permanent seat');
  eq((await call('POST', '/me/desk', { as: 1003, body: { f: 'd2', i: 0 } })).status, 409, 'cannot book a permanent seat');
  eq((await call('POST', '/me/desk', { as: 1003, body: { f: 'm1', i: 0 } })).status, 400, 'meeting table is not a desk');
  eq((await call('POST', '/me/desk', { as: 1002, body: { f: 'd1', i: 0 } })).status, 409, 'people with a seat do not book');
  eq((await call('POST', '/me/desk', { as: 1003, body: { f: 'd1', i: 0 } })).status, 201, 'Vira books d1');
  eq((await call('POST', '/me/desk', { as: 1001, body: { f: 'd1', i: 0 } })).status, 409, 'd1 taken today');
  eq((await call('POST', '/me/desk', { as: 1003, body: { f: 'd3', i: 0 } })).status, 201, 'rebook moves');
  dk = (await call('GET', '/me/desks', { as: 1003 })).data;
  ok(dk.mine.f === 'd3' && !dk.desks.find((d) => d.f === 'd1').owner, 'one desk per person per day');
  now = (await call('GET', '/office/now?fresh=1')).data;
  eq(now.desks, { c: { f: 'd3', i: 0 } }, 'desk in /office/now');
  await call('DELETE', '/me/desk', { as: 1003 });
  eq((await call('GET', '/office/now?fresh=1')).data.desks, {}, 'released');

  // snapshots (job writes today's rows)
  await sleep(1500);
  const { createRequire } = await import('module');
  const pg = createRequire(path.join(REPO, 'api', 'package.json'))('pg');
  const db = new pg.Client({ connectionString: (await import('../harness.mjs')).PG_URL }); await db.connect();
  const { rows } = await db.query('SELECT employee_id, status, department FROM daily_snapshots WHERE day = $1 ORDER BY employee_id', [today]);
  await db.end();
  ok(rows.length === 4 && rows.find((r) => r.employee_id === 'n').department === 'IT', 'snapshot rows for today');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
