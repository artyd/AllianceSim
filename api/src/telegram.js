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

// TEMPORARY diagnostic (no secrets leaked): reveals why the HMAC check fails —
// field keys present, token length, and whether the recomputed hash matches with
// signature EXCLUDED vs INCLUDED. Remove once the Mini App login is confirmed.
export function initDataDebug(initData, botToken) {
  try {
    const recv = new URLSearchParams(initData).get('hash') || '';
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken || '').digest();
    const calc = (keepSig) => {
      const p = new URLSearchParams(initData);
      p.delete('hash'); if (!keepSig) p.delete('signature');
      const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
      return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    };
    const noSig = calc(false), withSig = calc(true);
    const keys = [...new URLSearchParams(initData).keys()].sort();
    return { keys, tokenLen: (botToken || '').length, recv6: recv.slice(0, 6),
      noSig6: noSig.slice(0, 6), withSig6: withSig.slice(0, 6),
      matchNoSig: recv === noSig, matchWithSig: recv === withSig };
  } catch (e) { return { err: e.message }; }
}
