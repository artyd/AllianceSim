import { query } from './db.js';

// Queue a Telegram notification for the bot to deliver (it drains /notifications/pending).
// `pref` names the notify_prefs switch that gates it; `payload` carries the deep-link
// (`open`) and inline buttons the bot should attach. Recipients without a Telegram link
// are skipped by the pending query itself.
export async function queueNotif(empId, kind, { text = null, fromName = null, payload = null, pref = null } = {}) {
  if (pref) {
    // Spec 007: «Фокус» status mutes the optional pings until it expires (invites/games still go).
    const { rows: [f] } = await query(`SELECT 1 FROM employees WHERE id = $1 AND status_note = 'Фокус' AND (status_until IS NULL OR status_until > now())`, [empId]);
    if (f) return false;
    const { rows } = await query(`SELECT ${pref} AS on FROM notify_prefs WHERE employee_id = $1`, [empId]);
    if (rows[0] && rows[0].on === false) return false;
  }
  await query(
    'INSERT INTO notifications (employee_id, kind, text, from_name, payload) VALUES ($1, $2, $3, $4, $5)',
    [empId, kind, text ? String(text).slice(0, 500) : null, fromName, payload ? JSON.stringify(payload) : null]
  );
  return true;
}
