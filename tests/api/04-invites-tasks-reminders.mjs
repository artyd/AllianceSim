// Phase 4: invites/responses, task assignment, bot endpoints, reminders job, digests.
import { start, stop, call, seed, ok, eq, report } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pend = async () => (await call('GET', '/notifications/pending', { hr: true })).data;
const drain = async () => { for (const n of await pend()) await call('POST', `/notifications/${n.id}/sent`, { hr: true }); };
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();

await start();
try {
  await seed([
    { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
    { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
    { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
    { id: 'n', name: 'Ніхто Неприв', dept: 'IT' },
  ]);
  await sleep(1000); await drain();

  // invites
  const ev = (await call('POST', '/me/events', { as: 1001, body: { title: 'Планерка', startsAt: inMin(120), endsAt: inMin(150), place: 'Переговорна', attendeeIds: ['b', 'c', 'n', 'a'] } })).data;
  eq(ev.attendees.map((x) => x.id + ':' + x.status).sort(), ['a:accepted', 'b:pending', 'c:pending'], 'invited linked only, organizer accepted');
  let p = (await pend()).filter((n) => n.kind === 'event_invite');
  eq(p.map((n) => n.telegram_id).sort(), ['1002', '1003'], 'invite pings');
  ok(p[0].payload.buttons.length === 2 && p[0].payload.buttons[0].data === `ev:acc:${ev.id}` && p[0].payload.open === `event_${ev.id}`, 'invite buttons + deeplink');
  ok(/Планерка/.test(p[0].text) && p[0].from_name === 'Анна Коваль', 'invite text');
  eq((await call('GET', '/me/invites', { as: 1002 })).data.length, 1, 'B has 1 pending invite');
  eq((await call('GET', `/me/events/${ev.id}`, { as: 1002 })).data.myStatus, 'pending', 'B sees event pending');
  eq((await call('PATCH', `/me/events/${ev.id}`, { as: 1002, body: { title: 'x' } })).status, 403, 'guest cannot edit');
  eq((await call('PATCH', `/me/events/${ev.id}`, { as: 1002, body: { remindMin: 10 } })).data.remindMin, 10, 'guest sets own reminder');
  await drain();
  // respond via app
  eq((await call('POST', `/me/events/${ev.id}/respond`, { as: 1002, body: { status: 'accepted' } })).data.myStatus, 'accepted', 'B accepts');
  eq((await call('POST', `/me/events/${ev.id}/respond`, { as: 1001, body: { status: 'declined' } })).status, 403, 'organizer cannot respond');
  p = (await pend()).filter((n) => n.kind === 'event_response');
  ok(p.length === 1 && p[0].telegram_id === '1001' && p[0].payload.status === 'accepted', 'organizer told');
  // respond via bot endpoint
  eq((await call('POST', `/bot/events/${ev.id}/respond`, { body: { tgId: 1003, status: 'declined' } })).status, 401, 'bot endpoint needs token');
  eq((await call('POST', `/bot/events/${ev.id}/respond`, { hr: true, body: { tgId: 1004, status: 'declined' } })).status, 404, 'unknown tg → 404');
  const br = await call('POST', `/bot/events/${ev.id}/respond`, { hr: true, body: { tgId: 1003, status: 'declined' } });
  ok(br.status === 200 && br.data.status === 'declined', 'C declines via bot');
  eq((await call('GET', '/me/invites', { as: 1003 })).data.length, 0, 'C no pending');
  await drain();
  // edit: note only → no "changed" ping; time → ping guests; remove C
  await call('PATCH', `/me/events/${ev.id}`, { as: 1001, body: { note: 'Візьміть ноутбуки', startsAt: ev.startsAt } });
  eq((await pend()).filter((n) => n.kind === 'event_changed').length, 0, 'note-only edit: no ping');
  await call('PATCH', `/me/events/${ev.id}`, { as: 1001, body: { startsAt: inMin(180) } });
  eq((await pend()).filter((n) => n.kind === 'event_changed').map((n) => n.telegram_id).sort(), ['1002', '1003'], 'time change pings guests');
  await drain();
  const ed = (await call('PATCH', `/me/events/${ev.id}`, { as: 1001, body: { attendeeIds: ['b'] } })).data;
  eq(ed.attendees.length, 2, 'C removed');
  eq((await call('GET', `/me/events/${ev.id}`, { as: 1003 })).status, 404, 'C lost access');
  eq((await pend()).filter((n) => n.kind === 'event_cancelled').map((n) => n.telegram_id), ['1003'], 'C told');
  await drain();
  // cancel → B told
  await call('DELETE', `/me/events/${ev.id}`, { as: 1001 });
  eq((await pend()).filter((n) => n.kind === 'event_cancelled').map((n) => n.telegram_id), ['1002'], 'cancel tells B');
  await drain();

  // reminders (job runs every 1s in tests)
  const soon = (await call('POST', '/me/events', { as: 1001, body: { title: 'Дзвінок', startsAt: inMin(9), remindMin: 10, attendeeIds: ['b'] } })).data;
  await call('PATCH', `/me/events/${soon.id}`, { as: 1002, body: { remindMin: 10 } });
  await call('POST', `/me/events/${soon.id}/respond`, { as: 1002, body: { status: 'accepted' } });
  await drain();
  await sleep(2500);
  p = (await pend()).filter((n) => n.kind === 'event_reminder');
  eq(p.map((n) => n.telegram_id).sort(), ['1001', '1002'], 'reminder to both');
  ok(/Дзвінок/.test(p[0].text) && /через 10 хв/.test(p[0].text), 'reminder text');
  await sleep(2000);
  eq((await pend()).filter((n) => n.kind === 'event_reminder').length, 2, 'reminder sent once');
  await drain();
  const far = (await call('POST', '/me/events', { as: 1001, body: { title: 'Пізніше', startsAt: inMin(45), remindMin: 30 } })).data;
  await sleep(2000);
  eq((await pend()).filter((n) => n.kind === 'event_reminder').length, 0, 'not yet for 45-min event');

  // tasks: assign
  eq((await call('POST', '/me/tasks', { as: 1001, body: { text: 'x', assigneeId: 'n' } })).status, 400, 'cannot assign unlinked');
  const t = (await call('POST', '/me/tasks', { as: 1001, body: { text: 'Підготувати звіт', assigneeId: 'b', dueAt: inMin(60 * 30) } })).data;
  eq(t.assigneeId, 'b', 'assigned');
  p = (await pend()).filter((n) => n.kind === 'task_assigned');
  ok(p.length === 1 && p[0].telegram_id === '1002' && p[0].payload.buttons[0].data === `tk:done:${t.id}`, 'assign ping with button');
  ok((await call('GET', '/me/tasks', { as: 1002 })).data.some((x) => x.id === t.id), 'B sees task');
  eq((await call('PATCH', `/me/tasks/${t.id}`, { as: 1002, body: { text: 'hack' } })).status, 403, 'assignee cannot edit text');
  eq((await call('DELETE', `/me/tasks/${t.id}`, { as: 1002 })).status, 403, 'assignee cannot delete');
  await drain();
  const bd = await call('POST', `/bot/tasks/${t.id}/done`, { hr: true, body: { tgId: 1002 } });
  ok(bd.status === 200 && bd.data.text === 'Підготувати звіт', 'B done via bot');
  p = (await pend()).filter((n) => n.kind === 'task_done');
  ok(p.length === 1 && p[0].telegram_id === '1001' && p[0].from_name === 'Богдан Лис', 'author told');
  eq((await call('POST', `/bot/tasks/${t.id}/done`, { hr: true, body: { tgId: 1003 } })).status, 404, 'C cannot complete B task via bot');
  await drain();
  // overdue
  const od = (await call('POST', '/me/tasks', { as: 1002, body: { text: 'Прострочена', dueAt: inMin(-5) } })).data;
  await sleep(2500);
  p = (await pend()).filter((n) => n.kind === 'task_overdue');
  ok(p.length === 1 && p[0].telegram_id === '1002' && /Прострочена/.test(p[0].text), 'overdue ping once');
  await sleep(1500);
  eq((await pend()).filter((n) => n.kind === 'task_overdue').length, 1, 'overdue not repeated');
  // prefs off → nothing
  await call('PUT', '/me/prefs', { as: 1003, body: { tasks: false } });
  await call('POST', '/me/tasks', { as: 1001, body: { text: 'Для Віри', assigneeId: 'c' } });
  ok(!(await pend()).some((n) => n.telegram_id === '1003'), 'tasks pref off respected');

  // digests
  await call('POST', '/me/events', { as: 1002, body: { title: 'Обід', startsAt: inMin(1), allDay: false } });
  const dg = (await call('GET', '/bot/digests', { hr: true })).data;
  const db = dg.find((d) => d.telegram_id === '1002');
  ok(db && db.events.some((e) => e.title === 'Обід') && db.due.some((x) => x.overdue) && db.open >= 1, 'B digest: event + overdue task');
  eq((await call('GET', '/bot/digests')).status, 401, 'digests need token');
  await call('PUT', '/me/prefs', { as: 1002, body: { digest: false } });
  ok(!(await call('GET', '/bot/digests', { hr: true })).data.some((d) => d.telegram_id === '1002'), 'digest pref off');
} catch (e) { console.error(e); ok(false, 'exception ' + e.message); }
const f = report();
await stop();
process.exit(f ? 1 : 0);
