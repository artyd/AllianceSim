import { query } from './db.js';
import { TZ } from './recur.js';

// Spec 007: small HR-owned office settings (games schedule, pulse questions, onboarding
// template, quiz questions) live in one key → JSON table.
export async function kvGet(key, def) {
  const { rows: [r] } = await query('SELECT value FROM office_kv WHERE key = $1', [key]);
  return r ? r.value : def;
}
export async function kvSet(key, value) {
  await query(
    `INSERT INTO office_kv (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// Wall-clock helpers in the office time zone.
const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', ...opts });
export const hhmm = (d = new Date()) => fmt({ hour: '2-digit', minute: '2-digit' }).format(d); // "13:05"
export function ymdTz(d = new Date()) {
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// ISO week key («2026-W42») of the office-local date.
export function isoWeek(d = new Date()) {
  const [y, m, dd] = ymdTz(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t - y0) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
