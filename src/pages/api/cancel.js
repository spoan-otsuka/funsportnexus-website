/**
 * POST /api/cancel
 * 申込者本人による キャンセル処理
 * Body (form): id, email, reason (任意), confirm=1 (必須)
 *
 * - id + email で認証
 * - entries.status = 'cancelled', cancelled_at = now を更新
 * - ユーザー / 管理者 にメール送信
 * - Slack通知
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return redirect('/202612orisen/lookup/?error=db');

  let form;
  try { form = await request.formData(); }
  catch { return redirect('/202612orisen/lookup/?error=form'); }

  const id = parseInt((form.get('id') || '').toString(), 10);
  const email = (form.get('email') || '').toString().trim();
  const token = (form.get('t') || '').toString().trim();
  const reason = (form.get('reason') || '').toString().trim().slice(0, 500);
  const confirm = form.get('confirm') ? 1 : 0;

  if (!id || !email) return redirect('/202612orisen/lookup/?error=missing');
  if (!token) {
    // トークン必須（メール経由でのみキャンセル可）
    return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&cancel_error=no_token`);
  }
  if (!confirm) {
    return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&cancel_error=no_confirm`);
  }

  try {
    const entry = await env.DB.prepare(
      `SELECT * FROM entries WHERE id = ? AND LOWER(email) = LOWER(?) AND qr_token = ?`
    ).bind(id, email, token).first();
    if (!entry) {
      return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&cancel_error=unauthorized`);
    }
    if (entry.status === 'cancelled') {
      return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&cancel_done=1`);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE entries SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?`
    ).bind(now, reason || null, entry.id).run();

    // メール送信
    const reqUrl = new URL(request.url);
    const siteUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const fromEmail = env.FROM_EMAIL || 'info@funsportnexus.org';
    const fromName = env.FROM_NAME || 'fun sport nexus 運営事務局';
    const adminEmail = env.ADMIN_EMAIL_FALLBACK || 'funsportnexus@spoan.or.jp';
    const fromHeader = `${fromName} <${fromEmail}>`;

    if (env.RESEND_API_KEY) {
      const sendMail = async (payload) => {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch (e) { console.error('Resend error:', e); }
      };

      const userText = [
        `${entry.applicant_name} 様`,
        '',
        'fun sport nexus 2026.12 への、お申込みのキャンセル処理を、完了いたしました。',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `■ 管理ID：${entry.id}`,
        `■ キャンセル受付日時：${now}`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        reason ? `【キャンセル理由】\n${reason}\n\n` : '',
        '・本メールが、キャンセル完了のお知らせとなります。',
        '・再度、お申込みいただく場合は、特設サイトより、お手続きください。',
        `・特設サイト：${siteUrl}/202612orisen/`,
        '',
        '・ご質問、お問い合わせは、本メールに、ご返信ください。',
        '',
        'またのご機会、お会いできますことを、楽しみに、しております。',
        '',
        'fun sport nexus 運営事務局',
        '公益財団法人スポーツ安全協会',
      ].join('\n');

      await sendMail({
        from: fromHeader,
        to: [entry.email],
        subject: `【キャンセル完了】fun sport nexus 2026.12 ／ 管理ID #${entry.id}`,
        text: userText,
      });

      await sendMail({
        from: fromHeader,
        to: [adminEmail],
        reply_to: entry.email,
        subject: `【申込キャンセル #${entry.id}】fun sport nexus 2026.12 ／ ${entry.applicant_name} 様`,
        text:
          `管理ID: ${entry.id}\n` +
          `お名前: ${entry.applicant_name}（${entry.applicant_furigana}）\n` +
          `メール: ${entry.email}\n` +
          `お電話: ${entry.tel}\n` +
          `参加人数: ${entry.attendees}名\n` +
          `キャンセル受付: ${now}\n` +
          `キャンセル理由: ${reason || '（記載なし）'}`,
      });
    }

    // Slack通知（氏名はマスク、ID で追跡可能）
    if (env.SLACK_WEBHOOK_URL) {
      try {
        const { maskName } = await import('../../lib/mask.js');
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `❌ *申込キャンセル* #${entry.id} ${maskName(entry.applicant_name)} 様（${entry.attendees}名）${reason ? `\n  理由: ${reason}` : ''}`,
          }),
        });
      } catch {}
    }

    return redirect(`/202612orisen/lookup/?id=${entry.id}&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&cancel_done=1`);
  } catch (e) {
    console.error('cancel error:', e);
    return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&cancel_error=server`);
  }
}
