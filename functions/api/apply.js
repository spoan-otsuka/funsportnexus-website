/**
 * POST /api/apply
 * 申込受付（Phase 3 で本格実装）
 *
 * 軍神レビューの方針：
 * - D1 の db.batch() で悲観的ロック → 定員超過防止
 * - 時間重複NG / 同種目NG のバリデーション
 * - Resend で申込者向け自動返信
 * - Slack Webhook で事務局通知（メール通数削減）
 * - email_logs に送信結果を記録
 */

export async function onRequestPost(context) {
  return new Response(JSON.stringify({
    error: 'Not implemented yet',
    message: 'Phase 3 で本格実装予定',
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
