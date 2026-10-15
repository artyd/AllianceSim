// Test harness: embedded Postgres + the real API process, plus signed initData helpers.
// Two stacks: the default test stack (fresh DB per test file) and STACK=dev (persistent DB,
// used by the browser tests through devstack.mjs). Everything lives in tests/.tmp/.
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// Postgres' initdb can't cope with non-ASCII data paths on Windows (repo lives under
// "C:\Projects\Артем\…") → keep DB data in an ASCII temp dir then. Override: TEST_TMP.
const TMP = process.env.TEST_TMP || (/^[\x00-\x7f]*$/.test(REPO) ? path.join(REPO, 'tests', '.tmp') : path.join(os.tmpdir(), 'alliancesim-tests'));
export const BOT = '123456:TEST_TOKEN';   // fake bot token — only signs test initData
export const HR = 'hr-token';             // fake EDIT_TOKEN for the test API
const DEV = process.env.STACK === 'dev';
export const PORT = DEV ? 18011 : 18012;
const PGPORT = DEV ? 54329 : 54330;
export const PG_URL = `postgres://postgres:pw@127.0.0.1:${PGPORT}/t`;
export const BASE = `http://127.0.0.1:${PORT}/api`;

// Windows: an orphaned postgres child can pin shared memory → the next initdb fails.
const reap = () => {
  if (process.platform !== 'win32') return;
  try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'tests', 'reap.ps1')]); } catch (e) {}
};

export function initData(tgId, { username = 'user' + tgId, ageSec = 0 } = {}) {
  const p = new URLSearchParams();
  p.set('auth_date', String(Math.floor(Date.now() / 1000) - ageSec));
  p.set('query_id', 'AAH' + tgId);
  p.set('user', JSON.stringify({ id: Number(tgId), first_name: 'U' + tgId, username }));
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

// Same non-ASCII problem for the Postgres binaries themselves (they live in node_modules
// under the repo) → mirror node_modules into the ASCII temp dir once and load from there.
async function loadEmbeddedPostgres() {
  if (/^[\x00-\x7f]*$/.test(REPO)) return (await import('embedded-postgres')).default;
  const src = path.join(REPO, 'tests', 'node_modules'), mirror = path.join(TMP, 'node_modules');
  const stamp = path.join(mirror, '.stamp');
  const want = String(fs.statSync(path.join(src, 'embedded-postgres', 'package.json')).mtimeMs);
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.cpSync(src, mirror, { recursive: true });
    fs.writeFileSync(stamp, want);
  }
  return (await import(pathToFileURL(path.join(mirror, 'embedded-postgres', 'dist', 'index.js')).href)).default;
}

let pg, api;
export async function start(extraEnv = {}) {
  reap();
  const dir = path.join(TMP, DEV ? 'data-dev' : 'data-test');
  fs.mkdirSync(TMP, { recursive: true });
  const reuse = DEV && fs.existsSync(path.join(dir, 'PG_VERSION'));
  if (!reuse) fs.rmSync(dir, { recursive: true, force: true });
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PGPORT, persistent: /* we wipe the dir on start; auto-delete races Windows file locks */ true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  if (!reuse) await pg.initialise();
  await pg.start();
  if (!reuse) await pg.createDatabase('t');
  api = spawn(process.execPath, [path.join(REPO, 'api', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: PG_URL,
      TELEGRAM_BOT_TOKEN: BOT, EDIT_TOKEN: HR, UPLOAD_DIR: path.join(TMP, DEV ? 'uploads-dev' : 'uploads-test'), JOBS_INTERVAL_MS: '1000', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write('[api] ' + d));
  api.stderr.on('data', (d) => process.stdout.write('[api!] ' + d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('api did not start');
}
export async function stop() {
  api && api.kill();
  await new Promise((r) => setTimeout(r, 300));
  await pg.stop();
  await new Promise((r) => setTimeout(r, 2000));
  reap();
}

export async function call(method, p, { as, body, hr, token, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  if (as) h['X-Telegram-Init-Data'] = typeof as === 'string' ? as : initData(as);
  if (hr) h['X-Edit-Token'] = HR;
  if (token) h['X-Me-Token'] = token;
  const r = await fetch(BASE + p, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; const txt = await r.text(); try { data = JSON.parse(txt); } catch (e) { data = txt; }
  return { status: r.status, data };
}

export async function seed(people) {
  for (const p of people) {
    const r = await call('POST', '/employees', { hr: true, body: { id: p.id, name: p.name, dept: p.dept, telegram_id: p.tg ?? null, ...(p.extra || {}) } });
    if (r.status !== 201) throw new Error('seed ' + JSON.stringify(r));
  }
}

let fails = 0, passes = 0;
export function ok(cond, msg) { if (cond) { passes++; } else { fails++; console.log('  ✗ ' + msg); } }
export function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }
export function report() { console.log(`\n${passes} passed, ${fails} failed`); return fails; }
