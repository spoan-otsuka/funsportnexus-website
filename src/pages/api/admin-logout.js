/**
 * POST/GET /api/admin-logout
 * Cookie削除してログイン画面へ
 */

export const prerender = false;

const handle = () =>
  new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': 'admin_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'Location': '/admin/login/',
    },
  });

export const GET = handle;
export const POST = handle;
