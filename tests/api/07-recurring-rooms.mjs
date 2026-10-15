// Spec 005 C: repeating events, room bookings, "in a meeting now".
import { start, stop, call, seed, ok, eq, report } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pend = async () => (await call('GET', '/notifications/pending', { hr: true })).data;
const drain = async () => { for (const n of await pend()) await call('POST', `/notifications/${n.id}/sent`, { hr: true }); };
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();
const range = (a, b) => `from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}`;

await start();
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
  ]);
  await sleep(1000); await drain();

  // weekly series, 4 weeks
  const s = (await call('POST', '/me/events', { as: 1001, body: { title: 'Ретро', startsAt: '2026-10-02T12:00:00Z', endsAt: '2026-10-02T13:00:00Z', repeat: 'weekly', repeatUntil: '2026-10-23T00:00:00Z', attendeeIds: ['b'] } })).data;
  ok(s.repeat === 'weekly', 'series created');
  let occ = (await call('GET', '/me/events?' + range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), { as: 1001 })).data;
  eq(occ.map((e) => e.startsAt.slice(0, 10)), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'], 'weekly occurrences until (inclusive)');
  ok(occ.every((e) => e.id === s.id && e.seriesStart.startsWith('2026-10-02')), 'occurrences share id + series start');
  eq((await call('GET', '/me/events?' + range('2026-10-10T00:00:00Z', '2026-10-17T00:00:00Z'), { as: 1002 })).data.length, 1, 'guest sees occurrence in window');
  eq((await call('POST', '/me/events', { as: 1001, body: { title: 'x', startsAt: inMin(10), repeat: 'hourly' } })).status, 400, 'bad repeat');
  // stop repeating
  await call('PATCH', `/me/events/${s.id}`, { as: 1001, body: { repeat: null } });
  eq((await call('GET', '/me/events?' + range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), { as: 1001 })).data.length, 1, 'repeat off → single');

  // reminders for a series started yesterday at this time + 9 min
  await drain();
  const d0 = new Date(Date.now() - 864e5 + 9 * 60e3);
  const daily = (await call('POST', '/me/events', { as: 1002, body: { title: 'Стендап', startsAt: d0.toISOString(), endsAt: new Date(d0.getTime() + 15 * 60e3).toISOString(), repeat: 'daily', remindMin: 10 } })).data;
  await sleep(2500);
  let p = (await pend()).filter((n) => n.kind === 'event_reminder');
  ok(p.length === 1 && p[0].telegram_id === '1002' && /Стендап/.test(p[0].text), 'reminder for today\'s occurrence of a daily series');
  await sleep(2000);
  eq((await pend()).filter((n) => n.kind === 'event_reminder').length, 1, 'once per occurrence');
  // digest includes it (today)
  const dg = (await call('GET', '/bot/digests', { hr: true })).data.find((d) => d.telegram_id === '1002');
  ok(dg && dg.events.some((e) => e.title === 'Стендап'), 'digest lists repeating event today');

  // room booking
  eq((await call('POST', '/me/events', { as: 1001, body: { title: 'x', startsAt: inMin(5), room: '<script>' } })).data.room, null, 'bad room key dropped');
  const m = (await call('POST', '/me/events', { as: 1001, body: { title: 'Співбесіда', startsAt: inMin(-10), endsAt: inMin(30), place: 'Переговорна', room: 'r5', attendeeIds: ['b'] } })).data;
  eq(m.room, 'r5', 'room stored');
  let now = (await call('GET', '/office/now?fresh=1')).data;
  ok(now.rooms.r5 && new Date(now.rooms.r5.until) > new Date(), 'room busy now');
  ok(now.busy.a && now.busy.a.room === 'r5', 'organizer busy in r5');
  ok(!now.busy.b, 'pending guest not busy');
  ok(!JSON.stringify(now).includes('Співбесіда'), 'no titles in public data');
  await call('POST', `/me/events/${m.id}/respond`, { as: 1002, body: { status: 'accepted' } });
  now = (await call('GET', '/office/now?fresh=1')).data;
  ok(now.busy.b && now.busy.b.room === 'r5', 'accepted guest busy');
  const bk = (await call('GET', '/me/rooms?' + range(inMin(-60), inMin(120)), { as: 1002 })).data;
  ok(bk.some((x) => x.room === 'r5' && x.organizer === 'Анна Коваль'), 'bookings list with organizer');
  eq((await call('GET', '/me/rooms?' + range(inMin(-60), inMin(120)))).status, 401, 'bookings need auth');
  // a daily series occurring now also counts
  const ds = new Date(Date.now() - 864e5 * 3 - 5 * 60e3);
  await call('POST', '/me/events', { as: 1001, body: { title: 'Daily', startsAt: ds.toISOString(), endsAt: new Date(ds.getTime() + 20 * 60e3).toISOString(), repeat: 'daily', room: 'rz:abc' } });
  now = (await call('GET', '/office/now?fresh=1')).data;
  ok(now.rooms['rz:abc'], 'repeating occurrence books its room now');
  await call('DELETE', `/me/events/${m.id}`, { as: 1001 });
  now = (await call('GET', '/office/now?fresh=1')).data;
  ok(!now.rooms.r5 && !now.busy.b, 'cancel frees room + people');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
