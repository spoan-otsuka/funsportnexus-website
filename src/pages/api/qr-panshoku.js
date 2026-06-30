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

  const allergyOk = form.get('allergy_ok') ? 1 : 0;
  if (!allergyOk) return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&error=no_allergy`);

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
    await env.DB.prepare(
      'UPDATE entries SET panshoku_extras = ? WHERE id = ?'
    ).bind(extras.length > 0 ? JSON.stringify(extras) : null, entry.id).run();

    return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&done=1`);
  } catch (e) {
    console.error('qr-panshoku error:', e);
    return redirect(`/202612orisen/qr/?t=${encodeURIComponent(token)}&error=server`);
  }
}
