/**
 * /admin/* を Cookie認証で保護
 * - 未認証なら /admin/login/ にリダイレクト
 * - Cookie admin_token が ADMIN_PASSWORD と一致すれば認可
 */

export const onRequest = async (context, next) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // 認証不要パス
  if (
    path === '/admin/login' ||
    path === '/admin/login/' ||
    path.startsWith('/api/admin-login') ||
    path.startsWith('/api/admin-logout')
  ) {
    return next();
  }

  // /admin/* と admin系 API のみ保護対象
  const isAdminApi = path.startsWith('/api/admin-') && !path.startsWith('/api/admin-login') && !path.startsWith('/api/admin-logout');
  if (!path.startsWith('/admin') && !isAdminApi) {
    return next();
  }

  const env = context.locals?.runtime?.env ?? {};
  const expected = env.ADMIN_PASSWORD;

  // パスワード未設定なら通す（開発時の救済）
  if (!expected) {
    return next();
  }

  const cookieHeader = context.request.headers.get('cookie') || '';
  const m = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : '';

  if (token !== expected) {
    // API は 401、ページは login にリダイレクト
    if (path.startsWith('/api/')) {
      return new Response('Unauthorized', { status: 401 });
    }
    return Response.redirect(`${url.origin}/admin/login/?next=${encodeURIComponent(path)}`, 302);
  }

  return next();
};
