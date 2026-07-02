/**
 * POST /api/admin-email-blast
 * 確定済の申込者に対する メール一斉送信
 *
 * Body (form):
 *   template (任意・記録用)
 *   subject (必須)
 *   body (必須・{id}{name}{count}{url} を差し込み変数として展開)
 *   filter ('all' | 'day1' | 'day2' | 'both')
 *   confirm = 1 (必須)
 *   testmode = 1 (任意：管理者宛に1通だけ)
 *
 * - middleware により admin 認証済の前提
 * - Resend で 1件ずつ送信（最大100件/呼び出し、超えたら警告）
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

function interpolate(text, vars) {
  return String(text)
    .replace(/\{id\}/g, vars.id ?? '')
    .replace(/\{name\}/g, vars.name ?? '')
    .replace(/\{count\}/g, vars.count ?? '')
    .replace(/\{url\}/g, vars.url ?? '');
}

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return redirect('/admin/email-blast/?error=db');
  if (!env.RESEND_API_KEY) return redirect('/admin/email-blast/?error=resend_unset');

  let form;
  try { form = await request.formData(); }
  catch { return redirect('/admin/email-blast/?error=form'); }

  const template = (form.get('template') || '').toString().trim();
  const subject = (form.get('subject') || '').toString().trim();
  const body = (form.get('body') || '').toString();
  const filter = (form.get('filter') || 'all').toString().trim();
  const confirm = form.get('confirm') ? 1 : 0;
  const testmode = form.get('testmode') ? 1 : 0;

  if (!confirm) return redirect('/admin/email-blast/?error=no_confirm');
  if (!subject) return redirect('/admin/email-blast/?error=no_subject');
  if (!body) return redirect('/admin/email-blast/?error=no_body');

  try {
    // 対象抽出
    let sql = '';
    if (filter === 'day1') {
      sql = `
        SELECT DISTINCT e.id, e.applicant_name, e.email, e.attendees, e.qr_token
        FROM entries e
        INNER JOIN entry_slots es ON es.entry_id=e.id
        INNER JOIN slots s ON es.slot_id=s.id
        WHERE e.status='confirmed' AND s.day='Day1'
        ORDER BY e.id
      `;
    } else if (filter === 'day2') {
      sql = `
        SELECT DISTINCT e.id, e.applicant_name, e.email, e.attendees, e.qr_token
        FROM entries e
        INNER JOIN entry_slots es ON es.entry_id=e.id
        INNER JOIN slots s ON es.slot_id=s.id
        WHERE e.status='confirmed' AND s.day='Day2'
        ORDER BY e.id
      `;
    } else if (filter === 'both') {
      sql = `
        SELECT e.id, e.applicant_name, e.email, e.attendees, e.qr_token FROM entries e
        WHERE e.status='confirmed'
          AND EXISTS (SELECT 1 FROM entry_slots es INNER JOIN slots s ON es.slot_id=s.id WHERE es.entry_id=e.id AND s.day='Day1')
          AND EXISTS (SELECT 1 FROM entry_slots es INNER JOIN slots s ON es.slot_id=s.id WHERE es.entry_id=e.id AND s.day='Day2')
        ORDER BY e.id
      `;
    } else {
      sql = `SELECT id, applicant_name, email, attendees, qr_token FROM entries WHERE status='confirmed' ORDER BY id`;
    }
    const rows = (await env.DB.prepare(sql).all())?.results ?? [];

    if (rows.length === 0) {
      return redirect('/admin/email-blast/?error=no_target');
    }

    // 件数上限ガード（暴走防止）
    if (!testmode && rows.length > 500) {
      return redirect(`/admin/email-blast/?error=too_many&total=${rows.length}`);
    }

    const fromEmail = env.FROM_EMAIL || 'info@funsportnexus.org';
    const fromName = env.FROM_NAME || 'fun sport nexus 運営事務局';
    const adminEmail = env.ADMIN_EMAIL_FALLBACK || 'funsportnexus@spoan.or.jp';
    const fromHeader = `${fromName} <${fromEmail}>`;
    const reqUrl = new URL(request.url);
    const siteUrl = `${reqUrl.protocol}//${reqUrl.host}`;

    // テストモード：管理者宛に1件のみ
    const targets = testmode
      ? [{
          id: rows[0].id,
          applicant_name: rows[0].applicant_name + '（テストモード）',
          email: adminEmail,
          attendees: rows[0].attendees,
        }]
      : rows;

    let success = 0;
    let failed = 0;
    for (const r of targets) {
      const vars = {
        id: r.id,
        name: r.applicant_name,
        count: r.attendees,
        url: `${siteUrl}/202612orisen/lookup/?id=${r.id}&email=${encodeURIComponent(rows[0].email)}&t=${rows[0].qr_token || ''}`,
      };
      // テストモードでも変数展開はテスト対象の値で
      if (!testmode) {
        vars.url = `${siteUrl}/202612orisen/lookup/?id=${r.id}&email=${encodeURIComponent(r.email)}&t=${r.qr_token || ''}`;
      }

      const filledSubject = interpolate(subject, vars);
      const filledBody = interpolate(body, vars);

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromHeader,
            to: [r.email],
            subject: filledSubject,
            text: filledBody,
          }),
        });
        if (res.ok) success++;
        else { failed++; console.error('Resend non-2xx:', res.status, await res.text()); }
      } catch (e) {
        failed++;
        console.error('Resend error:', e);
      }
      // 軽い間隔（Resend のレート制限への配慮）
      if (!testmode && targets.length > 1) {
        await new Promise(r => setTimeout(r, 120));
      }
    }

    // 送信履歴を D1 に記録（監査用）
    try {
      await env.DB.prepare(
        `INSERT INTO email_log (template, filter, subject, body, target_count, success_count, failed_count, testmode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        template || 'custom', filter, subject, body,
        targets.length, success, failed, testmode
      ).run();
    } catch (e) { console.error('email_log insert error:', e); }

    // 監査ログ
    try {
      const { audit } = await import('../../lib/audit.js');
      await audit(env, request, 'email_blast', template || 'custom', {
        filter, subject, target: targets.length, success, failed, testmode: !!testmode,
      });
    } catch {}

    // Slack通知
    if (env.SLACK_WEBHOOK_URL) {
      try {
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `📧 *メール一斉送信* [${template || 'custom'}] ${testmode ? 'テスト送信 / ' : ''}成功 ${success}件${failed > 0 ? ` ／ 失敗 ${failed}件` : ''}（対象 ${targets.length}件）\n件名：${subject}`,
          }),
        });
      } catch {}
    }

    return redirect(`/admin/email-blast/?sent=${success}&failed=${failed}&total=${targets.length}`);
  } catch (e) {
    console.error('email-blast error:', e);
    return redirect(`/admin/email-blast/?error=server`);
  }
}
