/**
 * POST /api/attendance
 * 各プログラムの出欠（attended）を更新
 * Body (form): id, email, att_{entry_slot_id}=1 が立っているもののみ「参加」
 *
 * 認証: id + email で entries を検索、一致した場合のみ更新可
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
  if (!id || !email) {
    return redirect('/202612orisen/lookup/?error=missing');
  }
  if (!token) {
    return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&error=no_token`);
  }

  try {
    const entry = await env.DB.prepare(
      `SELECT id FROM entries WHERE id = ? AND LOWER(email) = LOWER(?) AND qr_token = ?`
    ).bind(id, email, token).first();
    if (!entry) return redirect('/202612orisen/lookup/?error=unauthorized');

    // この申込の全 entry_slots を取得
    const slots = await env.DB.prepare(
      `SELECT id FROM entry_slots WHERE entry_id = ?`
    ).bind(entry.id).all();

    const stmts = [];
    for (const s of (slots?.results ?? [])) {
      const checked = form.get(`att_${s.id}`) ? 1 : 0;
      stmts.push(
        env.DB.prepare('UPDATE entry_slots SET attended = ? WHERE id = ?').bind(checked, s.id)
      );
    }
    if (stmts.length > 0) await env.DB.batch(stmts);

    // Slack通知（欠席があれば通知）
    const absentCount = (slots?.results ?? []).filter(s => !form.get(`att_${s.id}`)).length;
    if (absentCount > 0 && env.SLACK_WEBHOOK_URL) {
      try {
        const eFull = await env.DB.prepare(
          'SELECT applicant_name FROM entries WHERE id = ?'
        ).bind(entry.id).first();
        const { maskName } = await import('../../lib/mask.js');
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `⚠️ *出欠変更* #${entry.id} ${maskName(eFull?.applicant_name)} 様 ／ 欠席に変更: ${absentCount}件`,
          }),
        });
      } catch {}
    }

    return redirect(`/202612orisen/lookup/?id=${entry.id}&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&saved=1`);
  } catch (e) {
    console.error('attendance error:', e);
    return redirect(`/202612orisen/lookup/?id=${id}&email=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&error=server`);
  }
}
