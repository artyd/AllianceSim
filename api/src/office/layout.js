import express from 'express';
import { query } from '../lib/db.js';
import { requireEditToken } from '../lib/auth.js';

// Health check + the office plan blob (ADR-0002): public read, HR-code write.
export const layout = express.Router();

// ── Utility ────────────────────────────────────────────────────────────────
layout.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ── Layout (singleton, id = 1) ───────────────────────────────────────────────
layout.get('/layout', async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT data FROM office_layout WHERE id = 1');
    res.json({ data: rows[0] ? rows[0].data : null });
  } catch (err) {
    next(err);
  }
});

layout.put('/layout', requireEditToken, async (req, res, next) => {
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
