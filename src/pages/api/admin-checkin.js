/**
 * POST /api/admin-checkin
 * スタッフ受付による手動チェックイン
 * - middleware により admin 認証済の前提
 * Body (form): entry_id, day (Day1 / Day2)
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return redirect('/admin/reception/?error=db');

  let form;
  try { form = await request.formData(); }
  catch { return redirect('/admin/reception/?error=form'); }

  const entryId = parseInt((form.get('entry_id') || '').toString(), 10);
  const day = (form.get('day') || '').toString().trim();
  const refQuery = (form.get('q') || '').toString().trim();

  if (!entryId || !['Day1', 'Day2'].includes(day)) {
    return redirect(`/admin/reception/?error=missing&q=${encodeURIComponent(refQuery)}`);
  }

  try {
    const entry = await env.DB.prepare(
      `SELECT id, applicant_name, attendees, status FROM entries WHERE id = ?`
    ).bind(entryId).first();
    if (!entry || entry.status !== 'confirmed') {
      return redirect(`/admin/reception/?error=notfound&q=${encodeURIComponent(refQuery)}`);
    }

    // 既にチェック済か
    const existing = await env.DB.prepare(
      `SELECT id FROM entry_checkins WHERE entry_id = ? AND day = ?`
    ).bind(entryId, day).first();
    if (existing) {
      return redirect(`/admin/reception/?error=already&q=${encodeURIComponent(refQuery)}`);
    }

    const now = new Date().toISOString();
    // entry_checkins に追加
    await env.DB.prepare(
      `INSERT OR IGNORE INTO entry_checkins (entry_id, day, checked_at) VALUES (?, ?, ?)`
    ).bind(entryId, day, now).run();

    // 初回チェックインなら entries.checked_in_at / checkin_day も更新
    await env.DB.prepare(
      `UPDATE entries SET
         checked_in_at = COALESCE(checked_in_at, ?),
         checkin_day = COALESCE(checkin_day, ?)
       WHERE id = ?`
    ).bind(now, day, entryId).run();

    // 監査ログ
    try {
      const { audit } = await import('../../lib/audit.js');
      await audit(env, request, 'staff_checkin', String(entryId), { day });
    } catch {}

    // Slack通知
    if (env.SLACK_WEBHOOK_URL) {
      try {
        const { maskName } = await import('../../lib/mask.js');
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `✅ *[スタッフ受付] チェックイン* [${day}] #${entry.id} ${maskName(entry.applicant_name)} 様（${entry.attendees}名）`,
          }),
        });
      } catch {}
    }

    const flag = day === 'Day1' ? 'day1' : 'day2';
    return redirect(`/admin/reception/?checked=${flag}&q=${encodeURIComponent(refQuery)}`);
  } catch (e) {
    console.error('admin-checkin error:', e);
    return redirect(`/admin/reception/?error=server&q=${encodeURIComponent(refQuery)}`);
  }
}
