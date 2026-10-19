// Thin client for the AllianceSim API. The bot never touches Postgres directly — it
// goes through the same token-gated endpoints the website uses, so validation and the
// employee JSON shape live in one place.
const BASE = process.env.API_URL || 'http://api:8011/api';
const TOKEN = process.env.EDIT_TOKEN || '';

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'X-Edit-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  if (r.status === 204) return null;
  return r.json().catch(() => null);
}

// Atomic claim returns a status so the bot can tell "already linked" (409) apart from
// success — unlike req(), which throws on any non-OK.
async function claim(id, tgId) {
  const r = await fetch(`${BASE}/employees/${encodeURIComponent(id)}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Edit-Token': TOKEN },
    body: JSON.stringify({ telegram_id: tgId }),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// Like claim(): returns {status, data} so the bot can tell "not yours / gone" apart.
async function act(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Edit-Token': TOKEN },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// Binary download (xlsx/pdf exports) → Buffer.
async function file(path) {
  const r = await fetch(BASE + path, { headers: { 'X-Edit-Token': TOKEN } });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export const api = {
  byTelegram: (tgId) => req('GET', `/employees/by-telegram/${tgId}`),
  search: (q) => req('GET', `/employees/search?q=${encodeURIComponent(q)}`),
  linked: () => req('GET', '/employees/linked'),
  report: () => req('GET', '/employees/report'),
  create: (emp) => req('POST', '/employees', emp),
  update: (id, patch) => req('PUT', `/employees/${encodeURIComponent(id)}`, patch),
  claim,
  pending: () => req('GET', '/notifications/pending'),
  markSent: (id, tgMessageId) => req('POST', `/notifications/${id}/sent`, tgMessageId ? { tgMessageId } : undefined),
  reply: (tgId, replyTo, text) => act('/bot/reply', { tgId, replyTo, text }),
  // Personal phone (spec 004): inline-button actions on behalf of the presser + morning agenda.
  respondEvent: (id, tgId, status) => act(`/bot/events/${encodeURIComponent(id)}/respond`, { tgId, status }),
  taskDone: (id, tgId) => act(`/bot/tasks/${encodeURIComponent(id)}/done`, { tgId }),
  digests: () => req('GET', '/bot/digests'),
  // Spec 007: game invites and poll votes pressed in Telegram.
  gameRespond: (id, tgId, accept) => act(`/bot/games/${encodeURIComponent(id)}/respond`, { tgId, accept }),
  vote: (msgId, tgId, option) => act(`/bot/messages/${encodeURIComponent(msgId)}/vote`, { tgId, option }),
  analytics: (days) => req('GET', `/analytics?days=${days}`),
  // Spec 008: analytics v2 + exports for the weekly/monthly HR reports.
  analyticsV2: (qs) => req('GET', `/analytics/v2?${qs}`),
  hrRecipients: () => req('GET', '/analytics/hr-recipients'),
  file,
};
