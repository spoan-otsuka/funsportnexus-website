/**
 * Cloudflare Turnstile 検証
 *
 * env.TURNSTILE_SECRET_KEY が未設定なら通す（段階導入・開発用）
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

export async function verifyTurnstile(env, token, ip) {
  if (!env?.TURNSTILE_SECRET_KEY) {
    return { success: true, skip: true };
  }
  if (!token) {
    return { success: false, error: 'no_token' };
  }
  try {
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return { success: !!data.success, codes: data['error-codes'] || [] };
  } catch (e) {
    console.error('turnstile error:', e);
    return { success: false, error: e.message };
  }
}
