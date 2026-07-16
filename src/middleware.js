/**
 * ミドルウェア:
 *   1. www.funsportnexus.org → funsportnexus.org に 301 リダイレクト
 *   2. /admin/* を Cookie認証で保護
 *      - 未認証なら /admin/login/ にリダイレクト
 *      - Cookie admin_token が ADMIN_PASSWORD と一致すれば認可
 */

export const onRequest = async (context, next) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // www → apex 恒久リダイレクト
  if (url.hostname === 'www.funsportnexus.org') {
    url.hostname = 'funsportnexus.org';
    return Response.redirect(url.toString(), 301);
  }

  // 認証不要パス
  if (
    path === '/admin/login' ||
    path === '/admin/login/' ||
    path.startsWith('/api/admin-login') ||
    path.startsWith('/api/admin-logout')
  ) {
    return next();
  }

  // /admin/* のみ保護対象
  if (!path.startsWith('/admin')) {
    return next();
  }

  const env = context.locals?.runtime?.env ?? {};
  const expected = env.ADMIN_PASSWORD;

  // fail-closed：ADMIN_PASSWORD 未設定は、全リクエストを拒否する（環境変数消失や設定ミス時の情報漏洩を防ぐ）
  if (!expected) {
    return new Response('Service Unavailable: admin auth not configured', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const cookieHeader = context.request.headers.get('cookie') || '';
  const m = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : '';

  if (token !== expected) {
    return Response.redirect(`${url.origin}/admin/login/?next=${encodeURIComponent(path)}`, 302);
  }

  return next();
};
