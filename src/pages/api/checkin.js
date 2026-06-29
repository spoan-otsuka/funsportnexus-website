/**
 * POST /api/checkin
 * Body (JSON): { token: 'qr_token' or 'entry_id(数字)' }
 *
 * 動作:
 *   - token を qr_token として検索、なければ数値として entries.id で検索
 *   - 見つかったら checked_in_at を更新（初回のみ）
 *   - エントリ情報・参加者・予約スロットを返す
 *
 * NOTE: /admin/ 配下と同様に保護したい場合は middleware で /api/checkin も含める。
 *       現状は /api/* は middleware の保護対象外なので、管理画面ログイン Cookie の有無を見て弾く。
 */

export const prerender = false;

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};

  // 簡易認証: admin_token Cookie がないと拒否
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : '';
  if (!env.ADMIN_PASSWORD || token !== env.ADMIN_PASSWORD) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.DB) return json({ error: 'db unavailable' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid body' }, 400); }

  const t = (body?.token || '').toString().trim();
  if (!t) return json({ error: 'no token' }, 400);

  try {
    // qr_token 優先で検索
    let entry = await env.DB.prepare(
      'SELECT * FROM entries WHERE qr_token = ? LIMIT 1'
    ).bind(t).first();

    // 数値なら entry_id で再検索
    if (!entry && /^\d+$/.test(t)) {
      entry = await env.DB.prepare(
        'SELECT * FROM entries WHERE id = ? LIMIT 1'
      ).bind(parseInt(t, 10)).first();
    }
    if (!entry) return json({ error: 'not found' }, 404);

    // checked_in_at を更新（初回のみ）
    if (!entry.checked_in_at) {
      const now = new Date().toISOString();
      await env.DB.prepare(
        'UPDATE entries SET checked_in_at = ? WHERE id = ?'
      ).bind(now, entry.id).run();
      entry.checked_in_at = now;
    }

    const att = await env.DB.prepare(
      'SELECT id, position, name, furigana, grade, is_representative FROM entry_attendees WHERE entry_id = ? ORDER BY position'
    ).bind(entry.id).all();

    const slots = await env.DB.prepare(`
      SELECT es.attendee_id, s.id AS slot_id, s.program_name, s.day, s.time_start, s.time_end, s.venue
      FROM entry_slots es
      INNER JOIN slots s ON es.slot_id = s.id
      WHERE es.entry_id = ?
      ORDER BY s.day, s.time_start
    `).bind(entry.id).all();

    const slotsByAttendee = {};
    for (const sl of (slots?.results ?? [])) {
      if (!slotsByAttendee[sl.attendee_id]) slotsByAttendee[sl.attendee_id] = [];
      slotsByAttendee[sl.attendee_id].push(sl);
    }

    // Slack 通知（任意）
    if (env.SLACK_WEBHOOK_URL) {
      try {
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `✅ *チェックイン* #${entry.id} ${entry.applicant_name} 様（${entry.attendees}名）`,
          }),
        });
      } catch {}
    }

    return json({
      ok: true,
      entry,
      attendees: att?.results ?? [],
      slotsByAttendee,
    });
  } catch (e) {
    console.error('checkin error:', e);
    return json({ error: e.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
