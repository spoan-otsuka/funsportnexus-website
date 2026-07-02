/**
 * 監査ログ ユーティリティ
 *
 * 用途：管理画面の操作・データダウンロード履歴を D1 に保存
 */

export async function audit(env, request, action, target, meta = null) {
  if (!env?.DB) return;
  try {
    const headers = request?.headers;
    const ip = headers?.get('cf-connecting-ip') || headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    const ua = (headers?.get('user-agent') || '').slice(0, 240);
    const country = headers?.get('cf-ipcountry') || '';
    const metaStr = meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)).slice(0, 1000) : null;

    await env.DB.prepare(
      `INSERT INTO audit_log (action, target, ip, ua, country, meta) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(action, target || null, ip, ua, country, metaStr).run();
  } catch (e) {
    console.error('audit log failed:', e);
  }
}
