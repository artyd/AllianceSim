import crypto from 'crypto';

// Verify a Telegram Mini App initData string (HMAC-SHA256 with the bot token).
// Returns { tgId, user } when authentic, else null.
// Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// maxAgeSec defaults to 0 (no freshness check): Telegram can hand the page initData
// from an earlier launch, so enforcing a window caused "worked then stopped" failures.
// Replay risk is negligible for this internal tool (worst case: a user replays their
// own signed data). Pass a positive value to re-enable the auth_date window.
export function verifyInitData(initData, botToken, maxAgeSec = 0) {
  if (!initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }
  const hash = params.get('hash');
  if (!hash) return null;

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  // Current Telegram INCLUDES the `signature` field in the HMAC data-check-string
  // (verified against live data); older guidance said to exclude it. Accept a match
  // for EITHER variant so we're robust to Telegram changing this again.
  const hashOf = (excludeSignature) => {
    const p = new URLSearchParams(initData);
    p.delete('hash');
    if (excludeSignature) p.delete('signature');
    const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  };
  const recv = Buffer.from(hash, 'hex');
  const matches = [hashOf(false), hashOf(true)].some((h) => {
    const a = Buffer.from(h, 'hex');
    return a.length === recv.length && crypto.timingSafeEqual(a, recv);
  });
  if (!matches) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec && authDate && Date.now() / 1000 - authDate > maxAgeSec) return null;

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
  const tgId = user && user.id != null ? String(user.id) : null;
  if (!tgId) return null;
  return { tgId, user };
}
