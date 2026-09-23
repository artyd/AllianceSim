import crypto from 'crypto';

// Verify a Telegram Mini App initData string (HMAC-SHA256 with the bot token).
// Returns { tgId, user } when authentic and fresh, else null.
// Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  params.delete('signature'); // Telegram's optional Ed25519 field is not part of the HMAC check

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec && authDate && Date.now() / 1000 - authDate > maxAgeSec) return null;

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
  const tgId = user && user.id != null ? String(user.id) : null;
  if (!tgId) return null;
  return { tgId, user };
}
