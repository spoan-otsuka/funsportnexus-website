/**
 * POST /api/admin-cancel
 * 管理者による 強制キャンセル処理
 * - middleware により admin 認証済の前提
 * Body (form): id, reason
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return redirect('/admin/entries/?error=db');

  let form;
  try { form = await request.formData(); }
  catch { return redirect('/admin/entries/?error=form'); }

  const id = parseInt((form.get('id') || '').toString(), 10);
  const reason = (form.get('reason') || '').toString().trim().slice(0, 500);
  if (!id) return redirect('/admin/entries/?error=missing');

  try {
    const entry = await env.DB.prepare(`SELECT * FROM entries WHERE id = ?`).bind(id).first();
    if (!entry) return redirect(`/admin/entries/?error=notfound`);
    if (entry.status === 'cancelled') {
      return redirect(`/admin/entries/${id}/?cancelled=already`);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE entries SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?`
    ).bind(now, reason ? `[管理者] ${reason}` : '[管理者] 管理者操作によるキャンセル', entry.id).run();

    // 監査ログ
    try {
      const { audit } = await import('../../lib/audit.js');
      await audit(env, request, 'admin_cancel', String(entry.id), { reason: reason || null });
    } catch {}

    // メール（ユーザー宛のみ。管理者通知は不要）
    const fromEmail = env.FROM_EMAIL || 'info@funsportnexus.org';
    const fromName = env.FROM_NAME || 'fun sport nexus 運営事務局';
    const fromHeader = `${fromName} <${fromEmail}>`;

    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromHeader,
            to: [entry.email],
            subject: `【お申込みキャンセルのお知らせ】fun sport nexus 2026.12 ／ 管理ID #${entry.id}`,
            text: [
              `${entry.applicant_name} 様`,
              '',
              'お申込みのキャンセル処理を、当方にて、行わせていただきました。',
              '',
              `■ 管理ID：${entry.id}`,
              `■ キャンセル受付：${now}`,
              reason ? `■ 理由：${reason}` : '',
              '',
              'ご不明な点は、本メールに、ご返信ください。',
              '',
              'fun sport nexus 運営事務局',
              '公益財団法人スポーツ安全協会',
            ].filter(Boolean).join('\n'),
          }),
        });
      } catch (e) { console.error('Resend error:', e); }
    }

    if (env.SLACK_WEBHOOK_URL) {
      try {
        const { maskName } = await import('../../lib/mask.js');
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `❌ *[管理者] 申込キャンセル* #${entry.id} ${maskName(entry.applicant_name)} 様${reason ? `\n  理由: ${reason}` : ''}`,
          }),
        });
      } catch {}
    }

    return redirect(`/admin/entries/${id}/?cancelled=1`);
  } catch (e) {
    console.error('admin-cancel error:', e);
    return redirect(`/admin/entries/${id}/?error=server`);
  }
}
