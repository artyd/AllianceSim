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

export const api = {
  byTelegram: (tgId) => req('GET', `/employees/by-telegram/${tgId}`),
  search: (q) => req('GET', `/employees/search?q=${encodeURIComponent(q)}`),
  linked: () => req('GET', '/employees/linked'),
  create: (emp) => req('POST', '/employees', emp),
  update: (id, patch) => req('PUT', `/employees/${encodeURIComponent(id)}`, patch),
  pending: () => req('GET', '/notifications/pending'),
  markSent: (id) => req('POST', `/notifications/${id}/sent`),
};
