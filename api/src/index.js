import express from 'express';
import { query, initSchema } from './db.js';
import { requireEditToken } from './auth.js';

const app = express();
app.use(express.json({ limit: '5mb' })); // layout JSON can be sizeable

const router = express.Router();

// ── Utility ────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true });
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
router.get('/employees', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, department, desk_id, created_at, updated_at FROM employees ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Search must be declared before "/employees/:id"-style matching is a concern;
// it lives under its own path so there is no conflict.
router.get('/employees/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    const { rows } = await query(
      `SELECT id, name, department, desk_id, created_at, updated_at
       FROM employees
       WHERE name ILIKE $1
       ORDER BY name
       LIMIT 50`,
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/employees', requireEditToken, async (req, res, next) => {
  try {
    const { name, department = null, desk_id = null } = req.body || {};
    if (!name || !name.toString().trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const { rows } = await query(
      `INSERT INTO employees (name, department, desk_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, department, desk_id, created_at, updated_at`,
      [name.toString().trim(), department, desk_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/employees/:id', requireEditToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, department, desk_id } = req.body || {};
    // COALESCE keeps existing values when a field is omitted; desk_id can be
    // explicitly cleared by sending null, so it is handled distinctly.
    const deskProvided = req.body && 'desk_id' in req.body;
    const { rows } = await query(
      `UPDATE employees
       SET name = COALESCE($2, name),
           department = COALESCE($3, department),
           desk_id = CASE WHEN $4 THEN $5 ELSE desk_id END,
           updated_at = now()
       WHERE id = $1
       RETURNING id, name, department, desk_id, created_at, updated_at`,
      [id, name ?? null, department ?? null, deskProvided, desk_id ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'employee not found' });
    res.json(rows[0]);
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
  .then(() => {
    // Bind to all interfaces inside the container; docker-compose maps only
    // 127.0.0.1 on the host, so nothing is exposed publicly (Caddy fronts TLS).
    app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('[api] failed to initialize database schema:', err);
    process.exit(1);
  });
