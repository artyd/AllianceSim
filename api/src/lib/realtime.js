// Server-Sent Events hub for the personal phone (spec 004). One API instance, so an
// in-process map is enough: employeeId → open SSE responses (one per device/tab).
const clients = new Map();
// What chat each person is looking at right now (POST /me/presence) — used to skip the
// Telegram notification when they are already reading that chat.
const viewing = new Map();
const VIEW_TTL = 10 * 60 * 1000;

export function attach(empId, req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  if (!clients.has(empId)) clients.set(empId, new Set());
  clients.get(empId).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = clients.get(empId);
    if (set) { set.delete(res); if (!set.size) { clients.delete(empId); viewing.delete(empId); } }
  });
}

export function emit(empIds, type, data) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set(empIds)) for (const res of clients.get(id) || []) res.write(frame);
}

export const online = (empId) => !!(clients.get(empId) && clients.get(empId).size);

export function setViewing(empId, chatId) {
  if (chatId == null) viewing.delete(empId);
  else viewing.set(empId, { chatId: String(chatId), at: Date.now() });
}
export function isViewing(empId, chatId) {
  const v = viewing.get(empId);
  return online(empId) && !!v && v.chatId === String(chatId) && Date.now() - v.at < VIEW_TTL;
}
