/**
 * お問い合わせフォーム POST 受信
 * - フォームを application/x-www-form-urlencoded で受信
 * - Honeypot (`website`) チェックでBot弾く
 * - Resend で 事務局＋自動返信メール送信
 * - Slack Webhook で 通知
 * - 完了したら /contact?success=1 へリダイレクト
 *
 * 環境変数:
 *   RESEND_API_KEY
 *   FROM_EMAIL          (例: info@funsportnexus.org)
 *   FROM_NAME           (例: fun sport nexus 運営事務局)
 *   ADMIN_EMAIL_FALLBACK (事務局宛, 例: funsportnexus@spoan.or.jp)
 *   SLACK_WEBHOOK_URL
 */

export const prerender = false;

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect('/contact/?error=invalid_form');
  }

  // Honeypot
  const honey = (form.get('website') || '').toString().trim();
  if (honey) {
    // Bot 扱い: 成功画面に進める（無視）
    return redirect('/contact/?success=1');
  }

  const data = {
    category: (form.get('category') || '').toString().trim(),
    name: (form.get('name') || '').toString().trim(),
    company: (form.get('company') || '').toString().trim(),
    email: (form.get('email') || '').toString().trim(),
    phone: (form.get('phone') || '').toString().trim(),
    subject: (form.get('subject') || '').toString().trim(),
    message: (form.get('message') || '').toString().trim(),
    consent: (form.get('consent') || '').toString().trim(),
  };

  // Validation
  if (!data.category || !data.name || !data.email || !data.subject || !data.message) {
    return redirect('/contact/?error=missing_fields');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return redirect('/contact/?error=invalid_email');
  }
  if (!data.consent) {
    return redirect('/contact/?error=no_consent');
  }

  const fromEmail = env.FROM_EMAIL || 'info@funsportnexus.org';
  const fromName = env.FROM_NAME || 'fun sport nexus 運営事務局';
  const adminEmail = env.ADMIN_EMAIL_FALLBACK || 'funsportnexus@spoan.or.jp';
  const fromHeader = `${fromName} <${fromEmail}>`;

  const summary = [
    `▼種別：${data.category}`,
    `▼お名前：${data.name}${data.company ? `（${data.company}）` : ''}`,
    `▼メール：${data.email}`,
    `▼電話：${data.phone || '（未入力）'}`,
    `▼件名：${data.subject}`,
    '',
    '▼本文',
    data.message,
  ].join('\n');

  // 1. Resend で事務局宛 + 自動返信
  if (env.RESEND_API_KEY) {
    const sendMail = async (payload) => {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.error('Resend failed:', res.status, txt);
        }
      } catch (e) {
        console.error('Resend error:', e);
      }
    };

    // 事務局宛
    await sendMail({
      from: fromHeader,
      to: [adminEmail],
      reply_to: data.email,
      subject: `【お問い合わせ】${data.subject}`,
      text: summary + '\n\n---\nfun sport nexus 公式サイトのお問い合わせフォームから送信されました。',
    });

    // 自動返信
    const autoText = [
      `${data.name} 様`,
      '',
      'fun sport nexus へお問い合わせをいただき、ありがとうございます。',
      '以下の内容で承りました。',
      '内容を確認のうえ、3営業日以内にご返信いたします。',
      '',
      '──────────────────────',
      summary,
      '──────────────────────',
      '',
      'fun sport nexus 運営事務局',
      '公益財団法人スポーツ安全協会',
      `${env.SITE_URL || 'https://funsportnexus.org'}`,
    ].join('\n');

    await sendMail({
      from: fromHeader,
      to: [data.email],
      subject: '【自動返信】お問い合わせ受付完了 ｜ fun sport nexus',
      text: autoText,
    });
  }

  // 2. Slack 通知
  if (env.SLACK_WEBHOOK_URL) {
    const slackPayload = {
      text: `📨 *お問い合わせ受信*\n*種別：* ${data.category}\n*お名前：* ${data.name}${data.company ? `（${data.company}）` : ''}\n*メール：* ${data.email}\n*件名：* ${data.subject}\n\n\`\`\`${data.message.slice(0, 800)}\`\`\``,
    };
    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });
    } catch (e) {
      console.error('Slack error:', e);
    }
  }

  return redirect('/contact/?success=1');
}

export async function GET() {
  return redirect('/contact/');
}
