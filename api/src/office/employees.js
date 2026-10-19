import express from 'express';
import { query } from '../lib/db.js';
import { requireEditToken, writeAuth } from '../lib/auth.js';
import { verifyInitData } from '../lib/telegram.js';
import { scheduleSync } from '../phone/chats.js';
import { canOrderCoffee } from './notifications.js';

// Employees (people on the plan) + Mini App identity check. Source of truth for people (ADR-0002).
export const employees = express.Router();

// Any successful employee write may change who is linked / in which department →
// re-sync the office and department chats (debounced).
employees.use('/employees', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 300) scheduleSync(); });
  next();
});

// ── Telegram Mini App: verify initData, return the caller's linked character ─────
employees.post('/tg/verify', async (req, res, next) => {
  try {
    const initData = (req.body && req.body.initData) || req.get('X-Telegram-Init-Data');
    const v = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid initData' });
    // Remember the @username so colleagues' "Подзвонити" can open this person in Telegram.
    const { rows } = await query(
      `UPDATE employees SET telegram_username = $2 WHERE telegram_id = $1 RETURNING ${EMP_COLS}`,
      [v.tgId, (v.user && v.user.username) || null]
    );
    const employee = rows[0] ? toEmp(rows[0], { includeTelegram: true }) : null;
    res.json({ ok: true, tgId: v.tgId, user: v.user, employee, canCoffee: canOrderCoffee(employee && employee.name) });
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
  'id, name, department, position, email, phone, ext, photo, color, status, mood, desk_id, seat_i, telegram_id, birthday, hired_on, status_note, status_until, created_at, updated_at';

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
    // Spec 007: status note with a timer («На обіді · до 14:00»); expired notes read as none.
    statusNote: r.status_note && (!r.status_until || new Date(r.status_until) > new Date()) ? r.status_note : null,
    statusUntil: r.status_note && r.status_until && new Date(r.status_until) > new Date() ? r.status_until : null,
  };
  if (includeTelegram) {
    out.telegram_id = r.telegram_id != null ? String(r.telegram_id) : null;
    // Private dates: only for the person themselves / the bot / HR, never on the public list.
    out.birthday = r.birthday || null;
    out.hired_on = ymd(r.hired_on);
  }
  return out;
}

// photo/colour end up in other people's style attributes → accept only safe shapes.
const SAFE_PHOTO = /^(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+|https:\/\/[^\s"'()\\]+)$/i;
function sanitizeEmp(b) {
  if ('photo' in b && b.photo != null && !SAFE_PHOTO.test(String(b.photo))) b.photo = null;
  if ('color' in b && b.color != null && !/^#[0-9a-f]{3,8}$/i.test(String(b.color))) b.color = null;
  // birthday: 'MM-DD' (also accepts 'DD.MM' / 'YYYY-MM-DD'); hired_on: 'YYYY-MM-DD'
  if ('birthday' in b) b.birthday = normBirthday(b.birthday);
  if ('statusNote' in b) b.statusNote = b.statusNote == null ? null : String(b.statusNote).trim().slice(0, 40) || null;
  if ('statusUntil' in b) { const t = b.statusUntil ? new Date(b.statusUntil) : null; b.statusUntil = t && !Number.isNaN(t.getTime()) ? t.toISOString() : null; }
  if ('hired_on' in b) b.hired_on = /^\d{4}-\d\d-\d\d$/.test(String(b.hired_on || '')) && !Number.isNaN(Date.parse(b.hired_on)) ? b.hired_on : null;
  return b;
}

// pg parses DATE as local midnight → format from local parts (toISOString would shift the day).
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d || null);
function normBirthday(v) {
  const s = String(v || '').trim();
  let m = /^(\d{1,2})\.(\d{1,2})(?:\.\d{2,4})?$/.exec(s), mm, dd;
  if (m) { dd = +m[1]; mm = +m[2]; }
  else if ((m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(s))) { mm = +m[1]; dd = +m[2]; }
  else return null;
  const t = new Date(Date.UTC(2000, mm - 1, dd)); // 2000 is a leap year → 02-29 allowed
  return t.getUTCMonth() === mm - 1 && t.getUTCDate() === dd ? `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` : null;
}

// Maps client field name → DB column for scalar fields (seat/telegram handled apart).
const SCALARS = {
  name: 'name', dept: 'department', position: 'position', email: 'email',
  phone: 'phone', ext: 'ext', photo: 'photo', color: 'color',
  status: 'status', mood: 'mood', birthday: 'birthday', hired_on: 'hired_on',
  statusNote: 'status_note', statusUntil: 'status_until',
};

employees.get('/employees', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${EMP_COLS} FROM employees ORDER BY name`);
    res.json(rows.map((r) => toEmp(r)));
  } catch (err) {
    next(err);
  }
});

// Declared before any "/employees/:id" concern; own path, no conflict.
employees.get('/employees/search', async (req, res, next) => {
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
employees.get('/employees/by-telegram/:tgId', async (req, res, next) => {
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
employees.get('/employees/linked', requireEditToken, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, telegram_id, status, mood FROM employees WHERE telegram_id IS NOT NULL ORDER BY name`
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, telegram_id: String(r.telegram_id), status: r.status, mood: r.mood })));
  } catch (err) {
    next(err);
  }
});

// Bot's daily HR report: everyone (photos stripped), plus updated_at so the bot can tell
// who hasn't answered today's check-in. Token-gated — includes telegram ids.
employees.get('/employees/report', requireEditToken, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, department, status, mood, telegram_id, updated_at FROM employees ORDER BY department, name`
    );
    res.json(rows.map((r) => ({
      id: r.id, name: r.name, dept: r.department, status: r.status, mood: r.mood,
      telegram_id: r.telegram_id != null ? String(r.telegram_id) : null, updated_at: r.updated_at,
    })));
  } catch (err) {
    next(err);
  }
});

// Atomic claim: link a Telegram user to an employee ONLY if it is not already linked
// to someone. Prevents one user hijacking another's character (and claim races).
// Idempotent: re-claiming your own returns 200; someone else's → 409.
employees.post('/employees/:id/claim', writeAuth, async (req, res, next) => {
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

employees.post('/employees', writeAuth, async (req, res, next) => {
  try {
    const b = sanitizeEmp(req.body || {});
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
         (id, name, department, position, email, phone, ext, photo, color, status, mood, desk_id, seat_i, telegram_id, birthday, hired_on)
       VALUES (COALESCE($1, gen_random_uuid()::text),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, department=EXCLUDED.department, position=EXCLUDED.position,
         email=EXCLUDED.email, phone=EXCLUDED.phone, ext=EXCLUDED.ext, photo=EXCLUDED.photo,
         color=EXCLUDED.color, status=EXCLUDED.status, mood=EXCLUDED.mood,
         desk_id=EXCLUDED.desk_id, seat_i=EXCLUDED.seat_i,
         telegram_id=COALESCE(EXCLUDED.telegram_id, employees.telegram_id),
         -- private dates are absent from the public object the web re-sends → keep them
         birthday=COALESCE(EXCLUDED.birthday, employees.birthday),
         hired_on=COALESCE(EXCLUDED.hired_on, employees.hired_on),
         updated_at=now()
       RETURNING ${EMP_COLS}`,
      [
        b.id || null, b.name.toString().trim(), b.dept ?? null, b.position ?? null,
        b.email ?? null, b.phone ?? null, b.ext ?? null, b.photo ?? null, b.color ?? null,
        b.status ?? null, b.mood ?? null, seat ? seat.f : null, seat ? seat.i : null,
        telegramId, b.birthday ?? null, b.hired_on ?? null,
      ]
    );
    res.status(201).json(toEmp(rows[0], { includeTelegram: true }));
  } catch (err) {
    next(err);
  }
});

employees.put('/employees/:id', writeAuth, async (req, res, next) => {
  try {
    const b = sanitizeEmp(req.body || {});
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

employees.delete('/employees/:id', requireEditToken, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'employee not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
