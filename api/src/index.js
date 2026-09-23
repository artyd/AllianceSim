import express from 'express';
import { query, initSchema, migrateBlobEmployees } from './db.js';
import { requireEditToken, writeAuth } from './auth.js';
import { verifyInitData } from './telegram.js';

const app = express();
app.use(express.json({ limit: '25mb' })); // layout blob embeds employees (+ optional base64 photos)

const router = express.Router();

// ── Utility ────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ── Telegram Mini App: verify initData, return the caller's linked character ─────
router.post('/tg/verify', async (req, res, next) => {
  try {
    const initData = (req.body && req.body.initData) || req.get('X-Telegram-Init-Data');
    const v = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid initData' });
    const { rows } = await query(`SELECT ${EMP_COLS} FROM employees WHERE telegram_id = $1`, [v.tgId]);
    res.json({ ok: true, tgId: v.tgId, user: v.user, employee: rows[0] ? toEmp(rows[0], { includeTelegram: true }) : null });
  } catch (err) {
    next(err);
  }
});

// ── Layout (singleton, id = 1) ───────────────────────────────────────────────
router.get('/layout', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT data FROM office_layout WHERE id = 1');
    res.json({ data: rows[0] ? rows[0].data : null });
  } catch (err) {
    next(err);
  }
});

router.put('/layout', requireEditToken, async (req, res, next) => {
  try {
    const data = req.body && 'data' in req.body ? req.body.data : req.body;
    await query(
      `INSERT INTO office_layout (id, data, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(data ?? null)]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Employees ────────────────────────────────────────────────────────────────
// The web client's employee object shape is {id,name,dept,position,email,phone,ext,
// photo,color,status,mood,seat:{f,i}|null}. We serialize DB rows into exactly that
// shape so the renderer code stays untouched. telegram_id is never exposed publicly
// (only a `tg_linked` boolean); the bot reads it via /employees/by-telegram.
const EMP_COLS =
  'id, name, department, position, email, phone, ext, photo, color, status, mood, desk_id, seat_i, telegram_id, created_at, updated_at';

function toEmp(r, { includeTelegram = false } = {}) {
  if (!r) return null;
  const out = {
    id: r.id,
    name: r.name,
    dept: r.department,
    position: r.position,
    email: r.email,
    phone: r.phone,
    ext: r.ext,
    photo: r.photo,
    color: r.color,
    status: r.status,
    mood: r.mood,
    seat: r.desk_id != null ? { f: r.desk_id, i: r.seat_i } : null,
    tg_linked: r.telegram_id != null,
  };
  if (includeTelegram) out.telegram_id = r.telegram_id != null ? String(r.telegram_id) : null;
  return out;
}

// Maps client field name → DB column for scalar fields (seat/telegram handled apart).
const SCALARS = {
  name: 'name', dept: 'department', position: 'position', email: 'email',
  phone: 'phone', ext: 'ext', photo: 'photo', color: 'color',
  status: 'status', mood: 'mood',
};

router.get('/employees', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${EMP_COLS} FROM employees ORDER BY name`);
    res.json(rows.map((r) => toEmp(r)));
  } catch (err) {
    next(err);
  }
});

// Declared before any "/employees/:id" concern; own path, no conflict.
router.get('/employees/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    const { rows } = await query(
      `SELECT ${EMP_COLS} FROM employees WHERE name ILIKE $1 ORDER BY name LIMIT 50`,
      [`%${q}%`]
    );
    res.json(rows.map((r) => toEmp(r)));
  } catch (err) {
    next(err);
  }
});

// Bot lookup: find the character linked to a Telegram user (includes telegram_id).
router.get('/employees/by-telegram/:tgId', async (req, res, next) => {
  try {
    const tgId = String(req.params.tgId).replace(/[^0-9]/g, '');
    if (!tgId) return res.status(400).json({ error: 'bad telegram id' });
    const { rows } = await query(`SELECT ${EMP_COLS} FROM employees WHERE telegram_id = $1`, [tgId]);
    if (!rows[0]) return res.status(404).json({ error: 'not linked' });
    res.json(toEmp(rows[0], { includeTelegram: true }));
  } catch (err) {
    next(err);
  }
});

// Bot broadcast list: all characters linked to a Telegram user (token-gated).
router.get('/employees/linked', requireEditToken, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, telegram_id, status, mood FROM employees WHERE telegram_id IS NOT NULL ORDER BY name`
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, telegram_id: String(r.telegram_id), status: r.status, mood: r.mood })));
  } catch (err) {
    next(err);
  }
});

// Atomic claim: link a Telegram user to an employee ONLY if it is not already linked
// to someone. Prevents one user hijacking another's character (and claim races).
// Idempotent: re-claiming your own returns 200; someone else's → 409.
router.post('/employees/:id/claim', writeAuth, async (req, res, next) => {
  try {
    // A Mini App user can only claim to their own Telegram id; HR may pass one in the body.
    const tgId = req.auth.tgId || String((req.body || {}).telegram_id || '').replace(/[^0-9]/g, '');
    if (!tgId) return res.status(400).json({ error: 'telegram_id required' });
    const { rows } = await query(
      `UPDATE employees SET telegram_id = $1, updated_at = now()
       WHERE id = $2 AND telegram_id IS NULL
       RETURNING ${EMP_COLS}`,
      [tgId, req.params.id]
    );
    if (rows[0]) return res.json(toEmp(rows[0], { includeTelegram: true }));
    // Nothing updated: either missing, or already linked (to you or someone else).
    const { rows: ex } = await query(`SELECT ${EMP_COLS} FROM employees WHERE id = $1`, [req.params.id]);
    if (!ex[0]) return res.status(404).json({ error: 'employee not found' });
    if (String(ex[0].telegram_id) === tgId) return res.json(toEmp(ex[0], { includeTelegram: true }));
    return res.status(409).json({ error: 'already linked to another user' });
  } catch (err) {
    next(err);
  }
});

router.post('/employees', writeAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.name.toString().trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    // A Mini App user always creates their OWN character (forced link to their tg id);
    // they can't set an arbitrary telegram_id. HR (hr:true) may pass telegram_id freely.
    const telegramId = req.auth.tgId ? req.auth.tgId : (b.telegram_id ?? null);
    const seat = b.seat && typeof b.seat === 'object' ? b.seat : null;
    // Upsert by id so the web client can safely re-send the full object on retry
    // (its optimistic-write queue re-flushes until the server confirms). Telegram
    // link is only ever set through claim/create, never cleared by a plain upsert.
    const { rows } = await query(
      `INSERT INTO employees
         (id, name, department, position, email, phone, ext, photo, color, status, mood, desk_id, seat_i, telegram_id)
       VALUES (COALESCE($1, gen_random_uuid()::text),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, department=EXCLUDED.department, position=EXCLUDED.position,
         email=EXCLUDED.email, phone=EXCLUDED.phone, ext=EXCLUDED.ext, photo=EXCLUDED.photo,
         color=EXCLUDED.color, status=EXCLUDED.status, mood=EXCLUDED.mood,
         desk_id=EXCLUDED.desk_id, seat_i=EXCLUDED.seat_i,
         telegram_id=COALESCE(EXCLUDED.telegram_id, employees.telegram_id),
         updated_at=now()
       RETURNING ${EMP_COLS}`,
      [
        b.id || null, b.name.toString().trim(), b.dept ?? null, b.position ?? null,
        b.email ?? null, b.phone ?? null, b.ext ?? null, b.photo ?? null, b.color ?? null,
        b.status ?? null, b.mood ?? null, seat ? seat.f : null, seat ? seat.i : null,
        telegramId,
      ]
    );
    res.status(201).json(toEmp(rows[0], { includeTelegram: true }));
  } catch (err) {
    next(err);
  }
});

router.put('/employees/:id', writeAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    // Mini App users may edit ONLY their own linked character, and never reassign the tg link.
    if (req.auth.tgId) {
      const { rows: own } = await query('SELECT telegram_id FROM employees WHERE id = $1', [req.params.id]);
      if (!own[0]) return res.status(404).json({ error: 'employee not found' });
      if (String(own[0].telegram_id) !== req.auth.tgId) return res.status(403).json({ error: 'not your character' });
      delete b.telegram_id;
    }
    const sets = [];
    const vals = [req.params.id];
    for (const [k, col] of Object.entries(SCALARS)) {
      if (k in b) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`); }
    }
    if ('seat' in b) {
      const seat = b.seat && typeof b.seat === 'object' ? b.seat : null;
      vals.push(seat ? seat.f : null); sets.push(`desk_id = $${vals.length}`);
      vals.push(seat ? seat.i : null); sets.push(`seat_i = $${vals.length}`);
    }
    if ('telegram_id' in b) { vals.push(b.telegram_id ?? null); sets.push(`telegram_id = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push('updated_at = now()');
    const { rows } = await query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $1 RETURNING ${EMP_COLS}`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'employee not found' });
    res.json(toEmp(rows[0], { includeTelegram: true }));
  } catch (err) {
    next(err);
  }
});

router.delete('/employees/:id', requireEditToken, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'employee not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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

router.post('/notifications', async (req, res, next) => {
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

// Bot drains pending notifications (token-gated) and marks them delivered.
router.get('/notifications/pending', requireEditToken, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT n.id, n.kind, n.text, n.from_name, e.telegram_id, e.name
       FROM notifications n JOIN employees e ON e.id = n.employee_id
       WHERE n.sent_at IS NULL AND e.telegram_id IS NOT NULL
       ORDER BY n.id LIMIT 100`
    );
    res.json(rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, from_name: r.from_name, name: r.name, telegram_id: String(r.telegram_id) })));
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/:id/sent', requireEditToken, async (req, res, next) => {
  try {
    await query('UPDATE notifications SET sent_at = now() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Mount at both root and /api so every curl example in the spec works:
//  - Caddy `handle_path /api/*` strips the prefix  → hits /layout, /health, ...
//  - Direct smoke tests against 127.0.0.1:8011/api/* and /health both resolve.
app.use(router);
app.use('/api', router);

// Central error handler
app.use((err, _req, res, _next) => {
  console.error('[api] error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = Number(process.env.PORT || 8011);

initSchema()
  .then(() => migrateBlobEmployees())
  .then(() => {
    // Bind to all interfaces inside the container; docker-compose maps only
    // 127.0.0.1 on the host, so nothing is exposed publicly (Caddy fronts TLS).
    app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('[api] failed to initialize database schema:', err);
    process.exit(1);
  });
