/**
 * POST /api/admin-login
 * パスワード認証 → Cookie発行
 */

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  const expected = env.ADMIN_PASSWORD || '';

  // fail-closed：ADMIN_PASSWORD 未設定は、ログインAPIごと停止する（誤って空パスワードで通す事故を防ぐ）
  if (!expected) {
    return new Response('Service Unavailable: admin auth not configured', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  let form;
  try { form = await request.formData(); }
  catch {
    return new Response(null, { status: 302, headers: { Location: '/admin/login/?error=invalid' } });
  }

  const password = (form.get('password') || '').toString();
  const next = (form.get('next') || '/admin/').toString();

  if (password !== expected) {
    // 失敗ログインも Slack 通知（不正アクセス検出）
    if (env.SLACK_WEBHOOK_URL) {
      const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
      const ua = request.headers.get('user-agent') || 'unknown';
      const country = request.headers.get('cf-ipcountry') || '';
      try {
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `⚠️ *管理画面ログイン失敗*\n*IP*: ${ip}${country ? ` (${country})` : ''}\n*UA*: \`${ua.slice(0, 120)}\``,
          }),
        });
      } catch (e) {
        console.error('Slack notify (login fail) failed:', e);
      }
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin/login/?error=invalid' },
    });
  }

  // Slack通知（成功ログイン）
  if (env.SLACK_WEBHOOK_URL) {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';
    const country = request.headers.get('cf-ipcountry') || '';
    const ts = new Date().toISOString();
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🔐 *管理画面ログイン*\n*時刻*: ${ts}\n*IP*: ${ip}${country ? ` (${country})` : ''}\n*UA*: \`${ua.slice(0, 120)}\`\n*次の遷移先*: ${next}`,
        }),
      });
    } catch (e) {
      console.error('Slack notify (login) failed:', e);
    }
  }

  // 認証成功 → Cookie 発行（HttpOnly, Secure, 24h）
  const cookie = `admin_token=${encodeURIComponent(expected)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
  const safeNext = next.startsWith('/admin') ? next : '/admin/';

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookie,
      'Location': safeNext,
    },
  });
}

export async function GET() {
  return new Response(null, { status: 302, headers: { Location: '/admin/login/' } });
}
