import crypto from 'crypto';
import { query } from './db.js';
import { verifyInitData } from './telegram.js';

// Personal-phone auth (spec 004). Every /me/* request resolves to ONE employee — the
// caller's own linked character — and handlers scope all data to req.me.id.
//
// Two credentials are accepted:
//  - X-Telegram-Init-Data: verified with a freshness window (ME_INITDATA_MAX_AGE, default
//    24h). Unlike the public office endpoints, private data must not be reachable forever
//    with a leaked initData string.
//  - a short-lived session token (X-Me-Token header or ?t=), minted from fresh initData by
//    POST /me/session. Needed where headers can't be set: EventSource and <img src>.
const MAX_AGE = Number(process.env.ME_INITDATA_MAX_AGE ?? 86400);
const SESSION_TTL = 12 * 3600;

const secret = () =>
  crypto.createHash('sha256').update('alliancesim-me-session:' + (process.env.TELEGRAM_BOT_TOKEN || '')).digest();

export function signSession(empId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const body = Buffer.from(JSON.stringify({ e: empId, x: exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, exp };
}

function readSession(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
  if (!p || !p.e || !p.x || p.x < Date.now() / 1000) return null;
  return p.e;
}

const ME_COLS = 'id, name, department, telegram_id';
const toMe = (r) => ({ id: r.id, name: r.name, dept: r.department, tgId: String(r.telegram_id) });

export async function requireMe(req, res, next) {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'telegram not configured' });
    let row = null;
    const token = req.get('X-Me-Token') || req.query.t;
    const empId = token ? readSession(token) : null;
    if (empId) {
      ({ rows: [row] } = await query(`SELECT ${ME_COLS} FROM employees WHERE id = $1 AND telegram_id IS NOT NULL`, [empId]));
    } else {
      const v = verifyInitData(req.get('X-Telegram-Init-Data'), process.env.TELEGRAM_BOT_TOKEN, MAX_AGE);
      if (!v) return res.status(401).json({ error: 'stale or invalid credentials' });
      ({ rows: [row] } = await query(`SELECT ${ME_COLS} FROM employees WHERE telegram_id = $1`, [v.tgId]));
    }
    if (!row) return res.status(403).json({ error: 'no linked character' });
    req.me = toMe(row);
    next();
  } catch (err) {
    next(err);
  }
}
