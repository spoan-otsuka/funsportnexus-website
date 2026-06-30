/**
 * POST /api/qr-panshoku
 * QRログインからの ぱん食い競走 参加意思登録
 *
 * Body (form): token, allergy_ok, pan_{attendee_id}
 */

export const prerender = false;

const redirect = (url) => new Response(null, { status: 303, headers: { Location: url } });

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return redirect('/202612orisen/qr/?error=db');

  let form;
  try { form = await request.formData(); }
  catch { return redirect('/202612orisen/qr/?error=form'); }

  const token = (form.get('token') || '').toString().trim();
  if (!token) return redirect('/202612orisen/qr/?error=no_token');

  // 会場経由フラグの検証（来場前のチェックイン防止）
  // フォーム送信時に hidden で from=checkin が含まれていることを必須化
  const fromCheckin = (form.get('from') || '').toString().trim();
  if (fromCheckin !== 'checkin') {
    return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&error=need_venue`);
  }

  const allergyOk = form.get('allergy_ok') ? 1 : 0;
  if (!allergyOk) return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&error=no_allergy&from=checkin`);

  // 当日同行者の収集
  const extraNames = form.getAll('extra_name').map(v => v.toString().trim());
  const extraBirths = form.getAll('extra_birth').map(v => v.toString().trim());
  const extraAttrs = form.getAll('extra_attr').map(v => v.toString().trim());
  const extras = [];
  for (let i = 0; i < extraNames.length; i++) {
    const name = extraNames[i];
    if (!name) continue;
    extras.push({
      name,
      birth: extraBirths[i] || '',
      attr: extraAttrs[i] || '',
    });
  }

  try {
    const entry = await env.DB.prepare('SELECT id FROM entries WHERE qr_token = ?').bind(token).first();
    if (!entry) return redirect('/202612orisen/qr/?error=invalid_token');

    const attendees = await env.DB.prepare(
      'SELECT id FROM entry_attendees WHERE entry_id = ?'
    ).bind(entry.id).all();

    const now = new Date().toISOString();
    const stmts = (attendees?.results ?? []).map(a => {
      const join = form.get(`pan_${a.id}`) ? 1 : 0;
      return env.DB.prepare(`
        UPDATE entry_attendees
        SET panshoku_join = ?, panshoku_allergy_ok = ?, panshoku_confirmed_at = ?
        WHERE id = ?
      `).bind(join, allergyOk, now, a.id);
    });
    if (stmts.length > 0) await env.DB.batch(stmts);

    // 当日同行者を entries.panshoku_extras に JSON で保存
    // 同時にチェックイン時刻も記録（初回のみ）
    await env.DB.prepare(
      'UPDATE entries SET panshoku_extras = ?, checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ?'
    ).bind(extras.length > 0 ? JSON.stringify(extras) : null, now, entry.id).run();

    // Slack通知（チェックイン完了）
    if (env.SLACK_WEBHOOK_URL) {
      try {
        const entryFull = await env.DB.prepare(
          'SELECT applicant_name, attendees FROM entries WHERE id = ?'
        ).bind(entry.id).first();
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `✅ *セルフチェックイン* #${entry.id} ${entryFull?.applicant_name || ''} 様（${entryFull?.attendees || 0}名）${extras.length > 0 ? `\n  当日同行者: ${extras.length}名` : ''}`,
          }),
        });
      } catch {}
    }

    // 完了後のリダイレクト先（lookup から来た場合は lookup に戻す）
    const redirectTo = (form.get('redirect_to') || '').toString().trim();
    if (redirectTo && redirectTo.startsWith('/202612orisen/')) {
      const sep = redirectTo.includes('?') ? '&' : '?';
      return redirect(`${redirectTo}${sep}checkin_done=1`);
    }
    return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&done=1`);
  } catch (e) {
    console.error('qr-panshoku error:', e);
    return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&error=server`);
  }
}
