// Minimal write-protection: Builder-mode writes (PUT/POST/DELETE) require the
// shared X-Edit-Token header to match the EDIT_TOKEN env var. Viewer-mode reads
// (GET) are fully public. See Backend Spec §5.
export function requireEditToken(req, res, next) {
  const expected = process.env.EDIT_TOKEN;
  if (!expected) {
    // Fail closed: if the server has no token configured, refuse all writes
    // rather than silently allowing anonymous edits.
    return res.status(503).json({ error: 'EDIT_TOKEN not configured on server' });
  }
  const provided = req.get('X-Edit-Token');
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'invalid or missing edit token' });
  }
  next();
}

// Write auth that accepts EITHER the HR edit token (full access, req.auth={hr:true})
// OR a valid Telegram Mini App initData header (scoped user, req.auth={tgId}). Route
// handlers must enforce per-user scoping when req.auth.tgId is set (a Mini App user may
// only touch their own linked character). HR keeps full access.
import { verifyInitData } from './telegram.js';
export function writeAuth(req, res, next) {
  const expected = process.env.EDIT_TOKEN;
  const provided = req.get('X-Edit-Token');
  if (expected && provided && provided === expected) { req.auth = { hr: true }; return next(); }
  const initData = req.get('X-Telegram-Init-Data');
  if (initData) {
    const v = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (v) { req.auth = { tgId: v.tgId, user: v.user }; return next(); }
  }
  if (!expected) return res.status(503).json({ error: 'EDIT_TOKEN not configured on server' });
  return res.status(401).json({ error: 'invalid or missing credentials' });
}
