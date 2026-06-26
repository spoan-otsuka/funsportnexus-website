/**
 * POST /api/apply
 * 申込受付 (Phase 3 本実装・参加者ごとプログラム選択対応)
 *
 * 受信形式 (application/x-www-form-urlencoded):
 *   name, furigana, email, tel, attendees, remarks
 *   consent_rules, consent_photo, consent_allergy
 *   attendee_${i}_name, attendee_${i}_furigana, attendee_${i}_birth
 *   attendee_${i}_slot_ids[]  ← 参加者iが選んだスロットID
 *
 * 処理:
 *   1. Honeypot / バリデーション
 *   2. D1 で各スロットの残席を取得
 *   3. per attendee：
 *      - 同種目重複NG
 *      - 1日3つまで
 *      - 時間重複NG
 *   4. 全スロットの reserved 増分を集計して、capacity 超過なら拒否
 *   5. entries INSERT → entry_attendees INSERT → entry_slots INSERT(attendee_id付き)
 *   6. Resend / Slack 通知
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

function calcGrade(iso, baseDate = new Date('2026-04-01')) {
  if (!iso) return '';
  const b = new Date(iso);
  if (isNaN(b.getTime())) return '';
  const base = new Date(baseDate.getFullYear(), 3, 2);
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
    participation_days: form.getAll('participation_days').map(v => v.toString()),
  };

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
  if (data.participation_days.length === 0) {
    return redirect('/202612orisen/apply/?error=no_days');
  }

  // 参加者情報・スロット選択を収集
  const attendees = [];
  for (let i = 1; i <= data.attendees; i++) {
    const name = (form.get(`attendee_${i}_name`) || '').toString().trim();
    const furi = (form.get(`attendee_${i}_furigana`) || '').toString().trim();
    const birth = (form.get(`attendee_${i}_birth`) || '').toString().trim();
    if (!name || !furi) {
      return redirect('/202612orisen/apply/?error=missing_attendee_info');
    }
    const slotIds = form.getAll(`attendee_${i}_slot_ids`)
      .map(v => parseInt(v.toString(), 10)).filter(v => !isNaN(v) && v > 0);
    attendees.push({
      position: i,
      name,
      furigana: furi,
      birth_date: birth || null,
      grade: birth ? calcGrade(birth) : '',
      is_representative: i === 1 ? 1 : 0,
      slot_ids: slotIds,
    });
  }

  const totalSlots = attendees.reduce((s, a) => s + a.slot_ids.length, 0);
  if (totalSlots === 0) {
    return redirect('/202612orisen/apply/?error=no_slots');
  }

  // 全ユニークスロットIDを取得
  const allSlotIds = Array.from(new Set(attendees.flatMap(a => a.slot_ids)));
  const ipAddress = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const qrToken = crypto.randomUUID();

  try {
    // スロット情報取得（残席含む）
    const placeholders = allSlotIds.map(() => '?').join(',');
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
    `).bind(...allSlotIds).all();

    const slotMap = new Map();
    for (const s of (slotResult?.results ?? [])) slotMap.set(s.id, s);
    if (slotMap.size !== allSlotIds.length) {
      return redirect('/202612orisen/apply/?error=invalid_slot');
    }

    // per attendee バリデーション
    for (const a of attendees) {
      const slots = a.slot_ids.map(id => slotMap.get(id));
      const codes = slots.map(s => s.program_code);
      if (codes.length !== new Set(codes).size) {
        return redirect('/202612orisen/apply/?error=duplicate_program');
      }
      const dayCounts = {};
      for (const s of slots) {
        if (s.program_code === 'seminar-special') continue; // 特別セミナーは別枠
        dayCounts[s.day] = (dayCounts[s.day] || 0) + 1;
      }
      for (const day of Object.keys(dayCounts)) {
        if (dayCounts[day] > 3) {
          return redirect('/202612orisen/apply/?error=daily_limit');
        }
      }
      // 時間重複
      const byDay = {};
      for (const s of slots) {
        if (!byDay[s.day]) byDay[s.day] = [];
        byDay[s.day].push(s);
      }
      for (const day of Object.keys(byDay)) {
        const list = byDay[day].sort((x, y) => x.time_start.localeCompare(y.time_start));
        for (let i = 0; i < list.length - 1; i++) {
          if (list[i].time_end > list[i+1].time_start) {
            const conflictInfo = `${list[i].program_name}(${list[i].time_start}-${list[i].time_end}) と ${list[i+1].program_name}(${list[i+1].time_start}-${list[i+1].time_end})`;
            return redirect(`/202612orisen/apply/?error=time_conflict&conflict=${encodeURIComponent(conflictInfo)}`);
          }
        }
      }
    }

    // 残席チェック（スロットごとの増分）
    const slotIncrement = {};
    for (const a of attendees) {
      for (const sid of a.slot_ids) {
        slotIncrement[sid] = (slotIncrement[sid] || 0) + 1;
      }
    }
    for (const sid of Object.keys(slotIncrement)) {
      const s = slotMap.get(parseInt(sid, 10));
      if (s.capacity - s.reserved < slotIncrement[sid]) {
        return redirect(`/202612orisen/apply/?error=full&slot=${encodeURIComponent(s.program_name)}`);
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

    // entry_attendees INSERT（1人ずつ）→ attendee_id 取得
    for (const a of attendees) {
      const res = await env.DB.prepare(`
        INSERT INTO entry_attendees
          (entry_id, position, name, furigana, birth_date, grade, is_representative)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(entryId, a.position, a.name, a.furigana, a.birth_date, a.grade, a.is_representative).run();
      a.id = res?.meta?.last_row_id;
    }

    // entry_slots INSERT（attendee_id付き）
    const slotInserts = [];
    for (const a of attendees) {
      for (const sid of a.slot_ids) {
        slotInserts.push(
          env.DB.prepare('INSERT INTO entry_slots (entry_id, slot_id, attendees, attendee_id) VALUES (?, ?, 1, ?)')
            .bind(entryId, sid, a.id)
        );
      }
    }
    if (slotInserts.length > 0) {
      await env.DB.batch(slotInserts);
    }

    // 通知
    const summary = buildSummary(data, slotMap, attendees);
    await sendEmailsAndSlack(env, data, attendees, slotMap, entryId, qrToken, summary);

    return redirect(`/202612orisen/apply/?success=1&id=${entryId}&qr=${qrToken}`);
  } catch (err) {
    console.error('Application failed:', err);
    return redirect('/202612orisen/apply/?error=server_error');
  }
}

export async function GET() {
  return redirect('/202612orisen/apply/');
}

function buildSummary(data, slotMap, attendees) {
  const lines = [
    '▼お申込み者（代表者）',
    `  ${data.name}（${data.furigana}）`,
    `  メール：${data.email}`,
    `  電話：${data.tel}`,
    '',
    `▼ご参加者（${data.attendees}名）`,
  ];
  for (const a of attendees) {
    lines.push(`  ${a.position}. ${a.name}（${a.furigana}）${a.birth_date ? ` ／ ${a.birth_date}` : ''}${a.grade ? `（${a.grade}）` : ''}`);
    if (a.slot_ids.length === 0) {
      lines.push('     （参加プログラムの選択なし）');
    } else {
      for (const sid of a.slot_ids) {
        const s = slotMap.get(sid);
        lines.push(`     ・[${s.day} ${s.time_start}-${s.time_end}] ${s.program_name}（${s.venue}）`);
      }
    }
  }
  if (data.remarks) {
    lines.push('', `▼ご要望・特記事項\n  ${data.remarks}`);
  }
  lines.push(`▼同意：プライバシーポリシー${data.consent_rules ? '◯' : '×'}／写真利用${data.consent_photo ? '◯' : '×'}／アレルギー${data.consent_allergy ? '◯' : '×'}`);
  return lines.join('\n');
}

async function sendEmailsAndSlack(env, data, attendees, slotMap, entryId, qrToken, summary) {
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
      '・キャンセル・変更：本メールに、ご返信ください。',
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
      const slackText = `🎟️ *申込受信* (ID: ${entryId})\n*${data.name}* 様（${data.attendees}名）`;
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: slackText }),
      });
    } catch (e) { console.error('Slack error:', e); }
  }
}
