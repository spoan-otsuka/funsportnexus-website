/**
 * POST /api/apply
 * 申込受付 (Phase 3 本実装)
 *
 * フロー:
 *   1. application/x-www-form-urlencoded で受信
 *   2. Honeypot (website) チェック
 *   3. バリデーション（必須項目・メール形式・同意・slot_ids）
 *   4. D1 batch:
 *      - 選択スロットの現状残席を取得・検証
 *      - 残席があれば entries INSERT
 *      - entry_slots INSERT（複数スロット）
 *   5. Resend で自動返信＋事務局通知
 *   6. Slack 通知（任意）
 *   7. /dec2026/apply/?success=1&id=XXX へリダイレクト
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};

  if (!env.DB) {
    return redirect('/dec2026/apply/?error=db_unavailable');
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect('/dec2026/apply/?error=invalid_form');
  }

  // Honeypot
  if ((form.get('website') || '').toString().trim()) {
    return redirect('/dec2026/apply/?success=1&id=ok');
  }

  const data = {
    name: (form.get('name') || '').toString().trim(),
    furigana: (form.get('furigana') || '').toString().trim(),
    email: (form.get('email') || '').toString().trim(),
    tel: (form.get('tel') || '').toString().trim(),
    attendees: parseInt(form.get('attendees') || '1', 10) || 1,
    attendee_attr: (form.get('attendee_attr') || '').toString().trim(),
    remarks: (form.get('remarks') || '').toString().trim(),
    consent_photo: form.get('consent_photo') ? 1 : 0,
    consent_allergy: form.get('consent_allergy') ? 1 : 0,
    consent_rules: form.get('consent_rules') ? 1 : 0,
  };

  const slotIds = form.getAll('slot_ids').map(v => parseInt(v.toString(), 10)).filter(v => !isNaN(v) && v > 0);

  // バリデーション
  if (!data.name || !data.furigana || !data.email || !data.tel) {
    return redirect('/dec2026/apply/?error=missing_fields');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return redirect('/dec2026/apply/?error=invalid_email');
  }
  if (!data.consent_rules) {
    return redirect('/dec2026/apply/?error=no_consent');
  }
  if (data.attendees < 1 || data.attendees > 10) {
    return redirect('/dec2026/apply/?error=invalid_attendees');
  }
  if (slotIds.length === 0) {
    return redirect('/dec2026/apply/?error=no_slots');
  }
  if (slotIds.length > 10) {
    return redirect('/dec2026/apply/?error=too_many_slots');
  }

  const ipAddress = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const qrToken = crypto.randomUUID();

  // D1: 定員チェック → INSERT
  try {
    // 1. 選択スロットの現状残席を取得
    const placeholders = slotIds.map(() => '?').join(',');
    const slotResult = await env.DB.prepare(`
      SELECT
        s.id, s.code, s.program_code, s.program_name, s.day, s.time_start, s.time_end, s.venue,
        s.capacity, s.is_active,
        COALESCE(SUM(es.attendees), 0) AS reserved
      FROM slots s
      LEFT JOIN entry_slots es ON s.id = es.slot_id
      LEFT JOIN entries e ON es.entry_id = e.id AND e.status = 'confirmed'
      WHERE s.id IN (${placeholders}) AND s.is_active = 1
      GROUP BY s.id
    `).bind(...slotIds).all();

    const slots = slotResult?.results ?? [];
    if (slots.length !== slotIds.length) {
      return redirect('/dec2026/apply/?error=invalid_slot');
    }

    // 残席チェック
    for (const s of slots) {
      const remaining = s.capacity - s.reserved;
      if (remaining < data.attendees) {
        return redirect(`/dec2026/apply/?error=full&slot=${encodeURIComponent(s.program_name)}`);
      }
    }

    // 同種目重複チェック
    const programCodes = slots.map(s => s.program_code);
    const dupes = programCodes.filter((c, i) => programCodes.indexOf(c) !== i);
    if (dupes.length > 0) {
      return redirect(`/dec2026/apply/?error=duplicate_program`);
    }

    // 時間重複チェック（同日に時間が重なる）
    const byDay = {};
    for (const s of slots) {
      if (!byDay[s.day]) byDay[s.day] = [];
      byDay[s.day].push(s);
    }
    for (const day of Object.keys(byDay)) {
      const list = byDay[day].sort((a, b) => a.time_start.localeCompare(b.time_start));
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].time_end > list[i+1].time_start) {
          return redirect('/dec2026/apply/?error=time_conflict');
        }
      }
    }

    // 2. entries INSERT → entry_slots INSERT (batch)
    const insertEntry = env.DB.prepare(`
      INSERT INTO entries (
        qr_token, applicant_name, applicant_furigana, email, tel,
        attendees, attendee_attr, remarks,
        consent_photo, consent_allergy, consent_rules,
        status, ip_address, user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
    `).bind(
      qrToken, data.name, data.furigana, data.email, data.tel,
      data.attendees, data.attendee_attr, data.remarks,
      data.consent_photo, data.consent_allergy, data.consent_rules,
      ipAddress, userAgent
    );

    const entryResult = await insertEntry.run();
    const entryId = entryResult?.meta?.last_row_id;

    if (!entryId) {
      throw new Error('Failed to get entry id');
    }

    // entry_slots INSERT (BATCH)
    const slotInserts = slotIds.map(slotId =>
      env.DB.prepare('INSERT INTO entry_slots (entry_id, slot_id, attendees) VALUES (?, ?, ?)')
        .bind(entryId, slotId, data.attendees)
    );
    await env.DB.batch(slotInserts);

    // 3. メール送信＋Slack 通知
    const summary = buildSummary(data, slots);
    await sendEmailsAndSlack(env, data, slots, entryId, qrToken, summary);

    return redirect(`/dec2026/apply/?success=1&id=${entryId}`);
  } catch (err) {
    console.error('Application failed:', err);
    return redirect('/dec2026/apply/?error=server_error');
  }
}

export async function GET() {
  return redirect('/dec2026/apply/');
}

function buildSummary(data, slots) {
  const lines = [
    `▼お名前：${data.name}（${data.furigana}）`,
    `▼メール：${data.email}`,
    `▼電話：${data.tel}`,
    `▼参加人数：${data.attendees}名`,
    data.attendee_attr ? `▼参加者属性：${data.attendee_attr}` : null,
    '',
    '▼参加プログラム',
    ...slots.map(s => `  ・[${s.day} ${s.time_start}-${s.time_end}] ${s.program_name}（${s.venue}）`),
    '',
    data.remarks ? `▼ご要望：${data.remarks}` : null,
    `▼同意：写真利用${data.consent_photo ? '◯' : '×'}／アレルギー確認${data.consent_allergy ? '◯' : '×'}／規約${data.consent_rules ? '◯' : '×'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendEmailsAndSlack(env, data, slots, entryId, qrToken, summary) {
  const fromEmail = env.FROM_EMAIL || 'info@funsportnexus.org';
  const fromName = env.FROM_NAME || 'fun sport nexus 運営事務局';
  const adminEmail = env.ADMIN_EMAIL_FALLBACK || 'funsportnexus@spoan.or.jp';
  const fromHeader = `${fromName} <${fromEmail}>`;
  const siteUrl = env.SITE_URL || 'https://funsportnexus.org';

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
          const t = await res.text();
          console.error('Resend failed:', res.status, t);
        }
      } catch (e) {
        console.error('Resend error:', e);
      }
    };

    // 事務局向け
    await sendMail({
      from: fromHeader,
      to: [adminEmail],
      reply_to: data.email,
      subject: `【申込受信】fun sport nexus 2026.12 ／ ${data.name} 様（${slots.length}件）`,
      text: `申込ID: ${entryId}\nQRトークン: ${qrToken}\n\n${summary}\n\n--\n管理: ${siteUrl}/admin/`,
    });

    // 申込者向け 自動返信
    const userText = [
      `${data.name} 様`,
      '',
      'fun sport nexus 2026.12 へ、お申込みいただき、誠に、ありがとうございます。',
      '以下の内容で、ご予約を、お受けいたしました。',
      '',
      '──────────────────────',
      summary,
      '──────────────────────',
      '',
      `受付番号：${entryId}`,
      '',
      '【当日のご案内】',
      '・開催日：2026年12月19日（土）- 20日（日）',
      '・会場：国立オリンピック記念青少年総合センター（東京都渋谷区）',
      '・受付：会場 中央広場 にて、お名前を、お伝えください。',
      '・キャンセル・変更：お手数ですが、本メールに、ご返信ください。',
      '',
      'お会いできますことを、運営一同、楽しみに、しております。',
      '',
      'fun sport nexus 運営事務局',
      '公益財団法人スポーツ安全協会',
      siteUrl,
    ].join('\n');

    await sendMail({
      from: fromHeader,
      to: [data.email],
      subject: '【受付完了】fun sport nexus 2026.12 参加申込',
      text: userText,
    });
  }

  if (env.SLACK_WEBHOOK_URL) {
    try {
      const slackText = `🎟️ *申込受信* (ID: ${entryId})\n*${data.name}* 様（${data.attendees}名）\n${slots.map(s => `・[${s.day} ${s.time_start}] ${s.program_name}`).join('\n')}`;
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: slackText }),
      });
    } catch (e) {
      console.error('Slack error:', e);
    }
  }
}
