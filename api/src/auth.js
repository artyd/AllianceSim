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
