import express from 'express';
import { query } from './db.js';
import { requireEditToken } from './auth.js';
import { kvGet, kvSet, isoWeek, ymdTz } from './kv.js';

// Spec 007: weekly pulse (anonymous to HR — only averages of groups ≥ PULSE_MIN) and the
// newcomer onboarding checklist (HR template, shown for ONBOARD_DAYS after hired_on).
export const people = express.Router();
const bad = (res, error) => res.status(400).json({ error });
const PULSE_MIN = Number(process.env.PULSE_MIN_GROUP || 3);
const ONBOARD_DAYS = 30;

const DEFAULT_PULSE = [
  'Як ти оцінюєш свій робочий тиждень?',
  'Наскільки комфортне в тебе навантаження?',
  'Чи вистачає тобі підтримки від команди?',
  'Наскільки зрозумілі твої цілі на найближчий час?',
  'Як тобі атмосфера в офісі цього тижня?',
  'Чи вдається тобі відпочивати після роботи?',
  'Наскільки ти задоволений(а) своїми результатами?',
  'Чи легко отримати потрібну інформацію від колег?',
];
const weekNo = (w) => Number(String(w).split('-W')[1]) || 0;
export async function pulseQuestion(week = isoWeek()) {
  const custom = await kvGet('pulse', {});
  return custom[week] || DEFAULT_PULSE[weekNo(week) % DEFAULT_PULSE.length];
}

people.get('/me/pulse', async (req, res, next) => {
  try {
    const week = isoWeek();
    const { rows: [a] } = await query('SELECT score FROM pulse_answers WHERE week = $1 AND employee_id = $2', [week, req.me.id]);
    res.json({ week, question: await pulseQuestion(week), answered: a ? a.score : null });
  } catch (err) { next(err); }
});
people.post('/me/pulse', async (req, res, next) => {
  try {
    const score = Number((req.body || {}).score);
    if (!Number.isInteger(score) || score < 1 || score > 5) return bad(res, 'score 1–5');
    const week = isoWeek();
    await query(
      `INSERT INTO pulse_answers (week, employee_id, dept, score) VALUES ($1, $2, $3, $4)
       ON CONFLICT (week, employee_id) DO UPDATE SET score = EXCLUDED.score, created_at = now()`,
      [week, req.me.id, req.me.dept || null, score]);
    res.json({ week, question: await pulseQuestion(week), answered: score });
  } catch (err) { next(err); }
});

// HR: averages per week (+ per department when the group is large enough to stay anonymous).
people.get('/pulse', requireEditToken, async (req, res, next) => {
  try {
    const weeks = Math.max(1, Math.min(26, Number(req.query.weeks) || 8));
    const { rows } = await query(
      `SELECT week, COUNT(*)::int AS n, ROUND(AVG(score)::numeric, 2)::float AS avg FROM pulse_answers
       GROUP BY week ORDER BY week DESC LIMIT $1`, [weeks]);
    const { rows: byDept } = await query(
      `SELECT week, COALESCE(dept, '—') AS dept, COUNT(*)::int AS n, ROUND(AVG(score)::numeric, 2)::float AS avg
       FROM pulse_answers WHERE week = ANY($1::text[]) GROUP BY week, dept`, [rows.map((r) => r.week)]);
    const out = [];
    for (const r of rows) {
      out.push({
        week: r.week, question: await pulseQuestion(r.week), n: r.n, avg: r.n >= PULSE_MIN ? r.avg : null,
        depts: byDept.filter((d) => d.week === r.week && d.n >= PULSE_MIN).map((d) => ({ dept: d.dept, n: d.n, avg: d.avg })),
      });
    }
    res.json({ current: { week: isoWeek(), question: await pulseQuestion() }, minGroup: PULSE_MIN, weeks: out, defaults: DEFAULT_PULSE });
  } catch (err) { next(err); }
});
people.put('/pulse/question', requireEditToken, async (req, res, next) => {
  try {
    const b = req.body || {};
    const week = /^\d{4}-W\d\d$/.test(String(b.week || '')) ? b.week : isoWeek();
    const q = String(b.question || '').trim().slice(0, 200);
    const custom = await kvGet('pulse', {});
    if (q) custom[week] = q; else delete custom[week];
    await kvSet('pulse', custom);
    res.json({ week, question: await pulseQuestion(week) });
  } catch (err) { next(err); }
});

// ── onboarding ───────────────────────────────────────────────────────────────
const DEFAULT_ONBOARDING = [
  { id: 'pass', text: 'Отримати перепустку та ключі' },
  { id: 'desk', text: 'Облаштувати робоче місце й техніку' },
  { id: 'accounts', text: 'Отримати доступи: пошта, месенджери, сервіси' },
  { id: 'buddy', text: 'Познайомитися з бадді та командою' },
  { id: 'safety', text: 'Пройти інструктаж з охорони праці' },
  { id: 'rules', text: 'Прочитати правила офісу та політики компанії' },
  { id: 'goals', text: 'Обговорити цілі на випробувальний термін' },
  { id: 'profile', text: 'Заповнити анкету та фото в профілі' },
];
export const onboardingTemplate = async () => kvGet('onboarding', DEFAULT_ONBOARDING);
// Days since hire (office date) — null when not a newcomer.
async function newcomerDay(empId) {
  const { rows: [e] } = await query('SELECT hired_on FROM employees WHERE id = $1', [empId]);
  if (!e || !e.hired_on) return null;
  const h = e.hired_on instanceof Date ? e.hired_on : new Date(e.hired_on);
  const start = Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
  const [y, m, d] = ymdTz().split('-').map(Number);
  const day = Math.floor((Date.UTC(y, m - 1, d) - start) / 864e5) + 1;
  return day >= 1 && day <= ONBOARD_DAYS ? day : null;
}
people.get('/me/onboarding', async (req, res, next) => {
  try {
    const day = await newcomerDay(req.me.id);
    if (!day) return res.json({ active: false });
    const items = await onboardingTemplate();
    const { rows } = await query('SELECT item_id FROM onboarding_done WHERE employee_id = $1', [req.me.id]);
    const done = new Set(rows.map((r) => r.item_id));
    res.json({ active: true, day, days: ONBOARD_DAYS, items: items.map((i) => ({ ...i, done: done.has(i.id) })) });
  } catch (err) { next(err); }
});
people.post('/me/onboarding/:item', async (req, res, next) => {
  try {
    const items = await onboardingTemplate();
    if (!items.some((i) => i.id === req.params.item)) return res.status(404).json({ error: 'not found' });
    if ((req.body || {}).done === false) await query('DELETE FROM onboarding_done WHERE employee_id = $1 AND item_id = $2', [req.me.id, req.params.item]);
    else await query('INSERT INTO onboarding_done (employee_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.me.id, req.params.item]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
// HR: the template + every newcomer's progress.
people.get('/onboarding', requireEditToken, async (_req, res, next) => {
  try {
    const items = await onboardingTemplate();
    const { rows } = await query(
      `SELECT e.id, e.name, e.department, e.hired_on, COALESCE(array_agg(o.item_id) FILTER (WHERE o.item_id IS NOT NULL), '{}') AS done
       FROM employees e LEFT JOIN onboarding_done o ON o.employee_id = e.id
       WHERE e.hired_on IS NOT NULL AND e.hired_on > (now() - interval '${ONBOARD_DAYS + 1} days')::date
       GROUP BY e.id ORDER BY e.hired_on DESC`);
    const ids = new Set(items.map((i) => i.id));
    res.json({ items, days: ONBOARD_DAYS, people: rows.map((r) => ({ id: r.id, name: r.name, dept: r.department,
      hiredOn: r.hired_on, done: r.done.filter((d) => ids.has(d)).length, total: items.length })) });
  } catch (err) { next(err); }
});
people.put('/onboarding/template', requireEditToken, async (req, res, next) => {
  try {
    const list = (Array.isArray((req.body || {}).items) ? req.body.items : []).map((i, k) => ({
      id: String(i.id || '').replace(/[^\w-]/g, '').slice(0, 40) || `i${Date.now().toString(36)}${k}`,
      text: String(i.text || '').trim().slice(0, 160),
    })).filter((i) => i.text).slice(0, 30);
    if (!list.length) return bad(res, 'at least one item');
    await kvSet('onboarding', list);
    res.json({ items: list });
  } catch (err) { next(err); }
});
