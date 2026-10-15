// Dev stack for browser checks: embedded PG + API + static server (public/) proxying /api.
// Writes tests/.tmp/urls.json with Mini App URLs (initData in #tgWebAppData) for the seeded
// users. GET /__reset wipes all personal data (keeps employees + layout) between scenarios.
//   STACK=dev node tests/devstack.mjs      (tests/run.mjs starts it for you)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { start, stop, seed, initData, PORT, PG_URL, REPO, HR } from './harness.mjs';

const pgmod = createRequire(path.join(REPO, 'api', 'package.json'))('pg');
const db = new pgmod.Pool({ connectionString: PG_URL });
const ROOT = path.join(REPO, 'public');
const TMP = path.join(REPO, 'tests', '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const WEB = Number(process.env.WEB_PORT || 5055);
export const PEOPLE = [
  { id: 'a', name: 'Анна Коваль', dept: 'HR', tg: 1001 },
  { id: 'b', name: 'Богдан Лис', dept: 'IT', tg: 1002 },
  { id: 'c', name: 'Віра Мак', dept: 'IT', tg: 1003 },
  { id: 'n', name: 'Ніхто Неприв', dept: 'IT' },
];
const LAYOUT = path.join(REPO, 'tests', 'fixtures', 'layout.json');

const api = (method, p, body) => fetch(`http://127.0.0.1:${PORT}/api${p}`, {
  method, headers: { 'content-type': 'application/json', 'X-Edit-Token': HR }, body: body ? JSON.stringify(body) : undefined,
});

async function reset() {
  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('office_layout', 'employees')`);
  if (rows.length) await db.query(`TRUNCATE ${rows.map((r) => '"' + r.tablename + '"').join(', ')} RESTART IDENTITY CASCADE`);
  // back to the seeded people (fields features may have changed), links included
  await db.query(`DELETE FROM employees WHERE id <> ALL($1::text[])`, [PEOPLE.map((p) => p.id)]);
  await db.query(`UPDATE employees SET telegram_id = NULL`);
  await seed(PEOPLE.map((p) => ({ ...p, extra: { status: 'office', mood: 'good', seat: null, photo: null, color: '#5B76E6' } })));
  if (fs.existsSync(LAYOUT)) await api('PUT', '/layout', { data: JSON.parse(fs.readFileSync(LAYOUT, 'utf8')) });
  await new Promise((r) => setTimeout(r, 1200)); // debounced office/dept chat sync after employee writes
}

await start();
await reset();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.glb': 'model/gltf-binary', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url === '/__shutdown') { res.end('bye'); db.end().catch(() => {}).then(() => stop()).then(() => process.exit(0)); return; }
  if (req.url === '/__reset') {
    reset().then(() => res.end('ok'), (e) => { res.writeHead(500); res.end(e.message); });
    return;
  }
  if (req.url.startsWith('/api/')) {
    const p = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    p.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(p);
    return;
  }
  let f = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (f === '/') f = '/index.html';
  const fp = path.join(ROOT, path.normalize(f));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(WEB, () => {
  const url = (tg) => `http://localhost:${WEB}/#tgWebAppData=${encodeURIComponent(initData(tg, { username: 'user' + tg }))}&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop`;
  fs.writeFileSync(path.join(TMP, 'urls.json'), JSON.stringify({ a: url(1001), b: url(1002), c: url(1003), stranger: url(9999), web: `http://localhost:${WEB}/`, hr: `http://localhost:${WEB}/` }, null, 1));
  console.log('devstack ready on', WEB);
});
