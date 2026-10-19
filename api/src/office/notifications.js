import express from 'express';
import { query } from '../lib/db.js';
import { requireEditToken } from '../lib/auth.js';
import { verifyInitData } from '../lib/telegram.js';
import { nameMatches } from '../lib/names.js';

// Site → Telegram notifications, coffee orders, and the bot's drain of the queue (ADR-0004).
export const notifications = express.Router();

// Who may order coffee: COFFEE_ALLOWED = comma-separated names. Empty or `*` → everyone.
const COFFEE_ALLOWED = String(process.env.COFFEE_ALLOWED || '').split(',').map((s) => s.trim()).filter(Boolean);
export const canOrderCoffee = (name) => !COFFEE_ALLOWED.length || COFFEE_ALLOWED.includes('*') || (!!name && COFFEE_ALLOWED.some((e) => nameMatches(name, e)));

// ── Notifications (site → Telegram, one-way) ─────────────────────────────────
// The public site queues a notification when someone messages/calls/finds a
// colleague; the bot drains the queue and delivers. Open endpoint (no login on the
// site) so it is rate-limited per IP and only accepts a linked employee id.
const NOTIF_KINDS = new Set(['message', 'call', 'mark']);
const rlHits = new Map(); // ip → [timestamps]
function rateLimited(ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const arr = (rlHits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rlHits.set(ip, arr);
  return arr.length > limit;
}

notifications.post('/notifications', async (req, res, next) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    if (rateLimited(ip)) return res.status(429).json({ error: 'rate limited' });
    const { employeeId, kind, text = null } = req.body || {};
    if (!employeeId || !NOTIF_KINDS.has(kind)) {
      return res.status(400).json({ error: 'employeeId and valid kind required' });
    }
    // Only queue if the target has a linked Telegram; otherwise silently succeed.
    const { rows } = await query('SELECT telegram_id FROM employees WHERE id = $1', [employeeId]);
    if (!rows[0] || rows[0].telegram_id == null) return res.json({ ok: true, queued: false });
    // If the sender is an authenticated Mini App user, record their name so the
    // notification reads "від <name>" instead of anonymous.
    let fromName = null;
    const initData = req.get('X-Telegram-Init-Data');
    if (initData) {
      const v = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (v) { const { rows: s } = await query('SELECT name FROM employees WHERE telegram_id = $1', [v.tgId]); if (s[0]) fromName = s[0].name; }
    }
    await query(
      'INSERT INTO notifications (employee_id, kind, text, from_name) VALUES ($1, $2, $3, $4)',
      [employeeId, kind, text ? String(text).slice(0, 500) : null, fromName]
    );
    res.json({ ok: true, queued: true });
  } catch (err) {
    next(err);
  }
});

// Coffee order → delivered as a Telegram notification to the designated HR.
// Recipient is configured by env: COFFEE_HR_TG (telegram id) wins, else COFFEE_HR_NAME
// (matched to a linked employee by name). Sender name comes from verified initData.
notifications.post('/coffee', async (req, res, next) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    if (rateLimited(ip)) return res.status(429).json({ error: 'rate limited' });
    const { drink, size } = req.body || {};
    if (!drink) return res.status(400).json({ error: 'drink required' });
    let fromName = null;
    const initData = req.get('X-Telegram-Init-Data');
    if (initData) {
      const v = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (v) { const { rows: s } = await query('SELECT name FROM employees WHERE telegram_id = $1', [v.tgId]); if (s[0]) fromName = s[0].name; }
    }
    // Allow-listed people only (COFFEE_ALLOWED); anonymous browser orders are refused then.
    if (!canOrderCoffee(fromName)) return res.status(403).json({ error: 'coffee not allowed' });
    // Resolve the HR recipient (must be a linked employee to receive Telegram).
    let rec = null;
    if (process.env.COFFEE_HR_TG) {
      const { rows } = await query('SELECT id FROM employees WHERE telegram_id = $1', [String(process.env.COFFEE_HR_TG).replace(/[^0-9]/g, '')]);
      rec = rows[0];
    } else if (process.env.COFFEE_HR_NAME) {
      // Order-insensitive, so renaming "Тахтаулова Аліна" → "Аліна Тахтаулова" keeps working.
      const { rows } = await query('SELECT id, name FROM employees WHERE telegram_id IS NOT NULL ORDER BY name');
      rec = rows.find((r) => nameMatches(r.name, process.env.COFFEE_HR_NAME));
    }
    if (!rec) return res.json({ ok: true, delivered: false }); // no HR configured / not linked
    const text = `${drink}${size ? ' (' + size + ')' : ''}`;
    await query('INSERT INTO notifications (employee_id, kind, text, from_name) VALUES ($1, $2, $3, $4)', [rec.id, 'coffee', text, fromName]);
    res.json({ ok: true, delivered: true });
  } catch (err) {
    next(err);
  }
});

// Bot drains pending notifications (token-gated) and marks them delivered.
notifications.get('/notifications/pending', requireEditToken, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT n.id, n.kind, n.text, n.from_name, n.payload, e.telegram_id, e.name
       FROM notifications n JOIN employees e ON e.id = n.employee_id
       WHERE n.sent_at IS NULL AND e.telegram_id IS NOT NULL
       ORDER BY n.id LIMIT 100`
    );
    res.json(rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, from_name: r.from_name, payload: r.payload, name: r.name, telegram_id: String(r.telegram_id) })));
  } catch (err) {
    next(err);
  }
});

notifications.post('/notifications/:id/sent', requireEditToken, async (req, res, next) => {
  try {
    // tgMessageId: the bot's Telegram message, so a reply to it can be routed back (spec 005).
    const tgMsg = Number((req.body || {}).tgMessageId) || null;
    await query('UPDATE notifications SET sent_at = now(), tg_message_id = COALESCE($2, tg_message_id) WHERE id = $1', [req.params.id, tgMsg]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
