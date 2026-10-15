// Phase 1: auth/session, personal events & tasks, prefs, privacy.
import { start, stop, call, seed, ok, eq, report, initData } from '../harness.mjs';

await start();
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
    { id: 'n', name: 'Ніхто Неприв', dept: 'IT' },
  ]);

  // auth
  eq((await call('GET', '/me/tasks')).status, 401, 'no creds → 401');
  eq((await call('GET', '/me/tasks', { hr: true })).status, 401, 'HR token gives no access');
  eq((await call('GET', '/me/tasks', { as: initData(1001, { ageSec: 90000 }) })).status, 401, 'stale initData → 401');
  eq((await call('GET', '/me/tasks', { as: 9999 })).status, 403, 'unlinked tg → 403');
  const v = await call('POST', '/tg/verify', { body: { initData: initData(1001, { username: 'anna_k' }) } });
  eq(v.data.employee && v.data.employee.id, 'a', 'tg/verify finds employee');
  const s = await call('POST', '/me/session', { as: 1001 });
  ok(s.status === 200 && s.data.token, 'session minted');
  eq((await call('GET', '/me/tasks', { token: s.data.token })).status, 200, 'session token works');
  eq((await call('GET', '/me/tasks', { token: s.data.token + 'x' })).status, 401, 'tampered token rejected');
  const ct = await call('GET', '/me/contacts', { as: 1002 });
  eq(ct.data.find((x) => x.id === 'a').username, 'anna_k', 'contacts expose username to authed users');
  ok(!ct.data.find((x) => x.id === 'n'), 'contacts list only linked');
  const pub = await call('GET', '/employees');
  ok(!JSON.stringify(pub.data).includes('anna_k'), 'username not in public /employees');

  // tasks
  const t1 = await call('POST', '/me/tasks', { as: 1001, body: { text: 'Купити воду', dueAt: '2026-10-20T10:00:00Z' } });
  eq(t1.status, 201, 'create task');
  eq(t1.data.assigneeId, 'a', 'personal task assigned to self');
  eq((await call('POST', '/me/tasks', { as: 1001, body: { text: '  ' } })).status, 400, 'empty task rejected');
  eq((await call('GET', '/me/tasks', { as: 1002 })).data.length, 0, 'B sees no A tasks');
  eq((await call('PATCH', '/me/tasks/' + t1.data.id, { as: 1002, body: { done: true } })).status, 404, 'B cannot touch A task');
  const d = await call('PATCH', '/me/tasks/' + t1.data.id, { as: 1001, body: { done: true } });
  eq(d.data.done, true, 'done toggled');
  eq((await call('PATCH', '/me/tasks/' + t1.data.id, { as: 1001, body: { text: 'Купити 2 води' } })).data.text, 'Купити 2 води', 'edit text');
  eq((await call('DELETE', '/me/tasks/' + t1.data.id, { as: 1002 })).status, 404, 'B cannot delete');
  eq((await call('DELETE', '/me/tasks/' + t1.data.id, { as: 1001 })).status, 200, 'A deletes');
  eq((await call('GET', '/me/tasks', { as: 1001 })).data.length, 0, 'deleted');

  // events
  const e1 = await call('POST', '/me/events', { as: 1001, body: { title: 'Стендап', startsAt: '2026-10-16T07:30:00Z', endsAt: '2026-10-16T08:00:00Z', place: 'Переговорна', color: '#5B76E6', remindMin: 10 } });
  eq(e1.status, 201, 'create event');
  eq(e1.data.myStatus, 'accepted', 'organizer accepted');
  eq(e1.data.remindMin, 10, 'remind stored');
  eq((await call('POST', '/me/events', { as: 1001, body: { title: 'x', startsAt: 'nope' } })).status, 400, 'bad date');
  eq((await call('POST', '/me/events', { as: 1001, body: { title: 'x', startsAt: '2026-10-16T07:30:00Z', remindMin: 7 } })).status, 400, 'bad remind');
  const note = await call('POST', '/me/events', { as: 1001, body: { title: 'Нотатка', startsAt: '2026-10-15T21:00:00Z', allDay: true } });
  eq(note.data.allDay, true, 'all-day note');
  const range = await call('GET', '/me/events?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z', { as: 1001 });
  eq(range.data.length, 2, 'range returns both');
  eq((await call('GET', '/me/events?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z', { as: 1002 })).data.length, 0, 'B sees none');
  eq((await call('GET', '/me/events/' + e1.data.id, { as: 1002 })).status, 404, 'B cannot read A event');
  eq((await call('PATCH', '/me/events/' + e1.data.id, { as: 1001, body: { title: 'Стендап IT', remindMin: 30 } })).data.title, 'Стендап IT', 'edit event');
  eq((await call('DELETE', '/me/events/' + e1.data.id, { as: 1002 })).status, 404, 'B cannot delete');
  eq((await call('DELETE', '/me/events/' + e1.data.id, { as: 1001 })).status, 200, 'A cancels');
  eq((await call('GET', '/me/events?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z', { as: 1001 })).data.length, 1, 'cancelled hidden');

  // photo/colour sanitizing (they land in other users' style attributes)
  const ev1 = await call('PUT', '/employees/a', { as: 1001, body: { photo: 'x") ; background:url(http://evil', color: 'red;}' } });
  ok(ev1.data.photo === null && ev1.data.color === null, 'bad photo/colour dropped');
  const ev2 = await call('PUT', '/employees/a', { as: 1001, body: { photo: 'data:image/png;base64,iVBORw0KGgo=', color: '#E2001A' } });
  ok(ev2.data.photo === 'data:image/png;base64,iVBORw0KGgo=' && ev2.data.color === '#E2001A', 'good photo/colour kept');

  // prefs
  eq((await call('GET', '/me/prefs', { as: 1001 })).data, { messages: true, events: true, tasks: true, digest: true }, 'default prefs');
  eq((await call('PUT', '/me/prefs', { as: 1001, body: { digest: false } })).data.digest, false, 'pref saved');
  eq((await call('GET', '/me/prefs', { as: 1001 })).data.digest, false, 'pref persisted');
  eq((await call('GET', '/me/prefs', { as: 1002 })).data.digest, true, 'B prefs independent');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
