/**
 * POST /api/admin-login
 * パスワード認証 → Cookie発行
 */

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  const expected = env.ADMIN_PASSWORD || '';

  let form;
  try { form = await request.formData(); }
  catch {
    return new Response(null, { status: 302, headers: { Location: '/admin/login/?error=invalid' } });
  }

  const password = (form.get('password') || '').toString();
  const next = (form.get('next') || '/admin/').toString();

  if (!expected || password !== expected) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin/login/?error=invalid' },
    });
  }

  // 認証成功 → Cookie 発行（HttpOnly, Secure, 24h）
  const cookie = `admin_token=${encodeURIComponent(expected)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
  // next 値の検証（外部URLへのリダイレクト防止）
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
