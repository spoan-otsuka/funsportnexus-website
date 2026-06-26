/**
 * POST /api/apply
 * 申込受付 (Phase 3 本実装・参加者情報対応)
 *
 * フロー:
 *   1. application/x-www-form-urlencoded で受信
 *   2. Honeypot (website) チェック
 *   3. バリデーション
 *   4. D1: 残席・同種目重複・時間重複・1日3件制限チェック
 *   5. entries + entry_slots + entry_attendees INSERT
 *   6. Resend / Slack 通知
 *   7. リダイレクト
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

/**
 * 日本式 学年判定
 * baseDate: イベント開催年度の4/1（2026年度=2026-04-01）
 * 4/1基準で 6歳ちょうど = 小1（ただし 4/1生まれは前年度の早生まれ扱い）
 */
function calcGrade(birthIso, baseDate = new Date('2026-04-01')) {
  if (!birthIso) return '';
  const b = new Date(birthIso);
  if (isNaN(b.getTime())) return '';
  // 4/2基準 年齢計算
  const base = new Date(baseDate.getFullYear(), 3, 2); // 4/2
  let age = base.getFullYear() - b.getFullYear();
  const m = base.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && base.getDate() <= b.getDate())) age--;
  if (age < 0) return '';
  if (age < 6) return `未就学（${age}歳）`;
  if (age <= 12) return `小学${age - 5}年生`;
  if (age <= 15) return `中学${age - 12}年生`;
  if (age <= 18) return `高校${age - 15}年生`;
  if (age <= 22) return `大学生（${age}歳）`;
  if (age <= 64) return `成人（${age}歳）`;
  return `${age}歳`;
}

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return redirect('/202612orisen/apply/?error=db_unavailable');

  let form;
  try { form = await request.formData(); }
  catch { return redirect('/202612orisen/apply/?error=invalid_form'); }

  if ((form.get('website') || '').toString().trim()) {
    return redirect('/202612orisen/apply/?success=1&id=ok');
  }

  const data = {
    name: (form.get('name') || '').toString().trim(),
    furigana: (form.get('furigana') || '').toString().trim(),
    email: (form.get('email') || '').toString().trim(),
    tel: (form.get('tel') || '').toString().trim(),
    attendees: parseInt(form.get('attendees') || '1', 10) || 1,
    remarks: (form.get('remarks') || '').toString().trim(),
    consent_photo: form.get('consent_photo') ? 1 : 0,
    consent_allergy: form.get('consent_allergy') ? 1 : 0,
    consent_rules: form.get('consent_rules') ? 1 : 0,
  };

  const slotIds = form.getAll('slot_ids').map(v => parseInt(v.toString(), 10)).filter(v => !isNaN(v) && v > 0);

  // 参加者情報を収集
  const attendeesInfo = [];
  for (let i = 1; i <= data.attendees; i++) {
    const name = (form.get(`attendee_${i}_name`) || '').toString().trim();
    const furi = (form.get(`attendee_${i}_furigana`) || '').toString().trim();
    const birth = (form.get(`attendee_${i}_birth`) || '').toString().trim();
    if (name) {
      attendeesInfo.push({
        position: i,
        name,
        furigana: furi,
        birth_date: birth || null,
        grade: birth ? calcGrade(birth) : '',
        is_representative: i === 1 ? 1 : 0,
      });
    }
  }

  // バリデーション
  if (!data.name || !data.furigana || !data.email || !data.tel) {
    return redirect('/202612orisen/apply/?error=missing_fields');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return redirect('/202612orisen/apply/?error=invalid_email');
  }
  if (!data.consent_rules) {
    return redirect('/202612orisen/apply/?error=no_consent');
  }
  if (data.attendees < 1 || data.attendees > 10) {
    return redirect('/202612orisen/apply/?error=invalid_attendees');
  }
  if (attendeesInfo.length !== data.attendees) {
    return redirect('/202612orisen/apply/?error=missing_attendee_info');
  }
  if (slotIds.length === 0) {
    return redirect('/202612orisen/apply/?error=no_slots');
  }

  const ipAddress = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const qrToken = crypto.randomUUID();

  try {
    // 選択スロットの現状取得
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
      return redirect('/202612orisen/apply/?error=invalid_slot');
    }

    // 残席チェック
    for (const s of slots) {
      const remaining = s.capacity - s.reserved;
      if (remaining < data.attendees) {
        return redirect(`/202612orisen/apply/?error=full&slot=${encodeURIComponent(s.program_name)}`);
      }
    }

    // 同種目重複チェック
    const programCodes = slots.map(s => s.program_code);
    if (programCodes.length !== new Set(programCodes).size) {
      return redirect('/202612orisen/apply/?error=duplicate_program');
    }

    // 1日あたり3件まで
    const dayCounts = {};
    for (const s of slots) { dayCounts[s.day] = (dayCounts[s.day] || 0) + 1; }
    for (const day of Object.keys(dayCounts)) {
      if (dayCounts[day] > 3) {
        return redirect('/202612orisen/apply/?error=daily_limit');
      }
    }

    // 時間重複チェック（同日内）
    const byDay = {};
    for (const s of slots) {
      if (!byDay[s.day]) byDay[s.day] = [];
      byDay[s.day].push(s);
    }
    for (const day of Object.keys(byDay)) {
      const list = byDay[day].sort((a, b) => a.time_start.localeCompare(b.time_start));
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].time_end > list[i+1].time_start) {
          return redirect('/202612orisen/apply/?error=time_conflict');
        }
      }
    }

    // entries INSERT
    const insertEntry = await env.DB.prepare(`
      INSERT INTO entries (
        qr_token, applicant_name, applicant_furigana, email, tel,
        attendees, attendee_attr, remarks,
        consent_photo, consent_allergy, consent_rules,
        status, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
    `).bind(
      qrToken, data.name, data.furigana, data.email, data.tel,
      data.attendees, '', data.remarks,
      data.consent_photo, data.consent_allergy, data.consent_rules,
      ipAddress, userAgent
    ).run();

    const entryId = insertEntry?.meta?.last_row_id;
    if (!entryId) throw new Error('Failed to get entry id');

    // entry_slots + entry_attendees BATCH INSERT
    const batchStmts = [
      ...slotIds.map(slotId =>
        env.DB.prepare('INSERT INTO entry_slots (entry_id, slot_id, attendees) VALUES (?, ?, ?)')
          .bind(entryId, slotId, data.attendees)
      ),
      ...attendeesInfo.map(a =>
        env.DB.prepare(`
          INSERT INTO entry_attendees
            (entry_id, position, name, furigana, birth_date, grade, is_representative)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(entryId, a.position, a.name, a.furigana, a.birth_date, a.grade, a.is_representative)
      ),
    ];
    await env.DB.batch(batchStmts);

    // 通知
    const summary = buildSummary(data, slots, attendeesInfo);
    await sendEmailsAndSlack(env, data, slots, attendeesInfo, entryId, qrToken, summary);

    return redirect(`/202612orisen/apply/?success=1&id=${entryId}`);
  } catch (err) {
    console.error('Application failed:', err);
    return redirect('/202612orisen/apply/?error=server_error');
  }
}

export async function GET() {
  return redirect('/202612orisen/apply/');
}

function buildSummary(data, slots, attendees) {
  const lines = [
    '▼お申込み者（代表者）',
    `  ${data.name}（${data.furigana}）`,
    `  メール：${data.email}`,
    `  電話：${data.tel}`,
    '',
    `▼ご参加者（${data.attendees}名）`,
    ...attendees.map(a =>
      `  ${a.position}. ${a.name}（${a.furigana}）${a.birth_date ? ` ／ ${a.birth_date}` : ''}${a.grade ? `（${a.grade}）` : ''}`
    ),
    '',
    '▼参加プログラム',
    ...slots.map(s => `  ・[${s.day} ${s.time_start}-${s.time_end}] ${s.program_name}（${s.venue}）`),
    '',
    data.remarks ? `▼ご要望・特記事項\n  ${data.remarks}` : null,
    `▼同意：プライバシーポリシー${data.consent_rules ? '◯' : '×'}／写真利用${data.consent_photo ? '◯' : '×'}／アレルギー確認${data.consent_allergy ? '◯' : '×'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendEmailsAndSlack(env, data, slots, attendees, entryId, qrToken, summary) {
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
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) console.error('Resend failed:', res.status, await res.text());
      } catch (e) { console.error('Resend error:', e); }
    };

    await sendMail({
      from: fromHeader,
      to: [adminEmail],
      reply_to: data.email,
      subject: `【申込受信 #${entryId}】fun sport nexus 2026.12 ／ ${data.name} 様（${data.attendees}名）`,
      text: `申込ID: ${entryId}\nQRトークン: ${qrToken}\n\n${summary}`,
    });

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
    } catch (e) { console.error('Slack error:', e); }
  }
}
