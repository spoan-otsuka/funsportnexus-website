/**
 * POST /api/admin-email-preview
 * メール一斉送信のプレビュー（送信せず、1件目の差し込み済み内容を返す）
 * - middleware により admin 認証済の前提
 */

export const prerender = false;

function interpolate(text, vars) {
  return String(text)
    .replace(/\{id\}/g, vars.id ?? '')
    .replace(/\{name\}/g, vars.name ?? '')
    .replace(/\{count\}/g, vars.count ?? '')
    .replace(/\{url\}/g, vars.url ?? '');
}

export async function POST({ request, locals }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return new Response(JSON.stringify({ error: 'DB not bound' }), { status: 500 });

  let form;
  try { form = await request.formData(); }
  catch { return new Response(JSON.stringify({ error: 'form' }), { status: 400 }); }

  const subject = (form.get('subject') || '').toString();
  const body = (form.get('body') || '').toString();
  const filter = (form.get('filter') || 'all').toString().trim();

  if (!subject || !body) {
    return new Response(JSON.stringify({ error: 'no_subject_body' }), { status: 400 });
  }

  try {
    let sql = '';
    if (filter === 'day1') sql = `
      SELECT DISTINCT e.id, e.applicant_name, e.email, e.attendees, e.qr_token
      FROM entries e INNER JOIN entry_slots es ON es.entry_id=e.id INNER JOIN slots s ON es.slot_id=s.id
      WHERE e.status='confirmed' AND s.day='Day1' ORDER BY e.id LIMIT 3`;
    else if (filter === 'day2') sql = `
      SELECT DISTINCT e.id, e.applicant_name, e.email, e.attendees, e.qr_token
      FROM entries e INNER JOIN entry_slots es ON es.entry_id=e.id INNER JOIN slots s ON es.slot_id=s.id
      WHERE e.status='confirmed' AND s.day='Day2' ORDER BY e.id LIMIT 3`;
    else if (filter === 'both') sql = `
      SELECT e.id, e.applicant_name, e.email, e.attendees, e.qr_token FROM entries e
      WHERE e.status='confirmed'
        AND EXISTS (SELECT 1 FROM entry_slots es INNER JOIN slots s ON es.slot_id=s.id WHERE es.entry_id=e.id AND s.day='Day1')
        AND EXISTS (SELECT 1 FROM entry_slots es INNER JOIN slots s ON es.slot_id=s.id WHERE es.entry_id=e.id AND s.day='Day2')
      ORDER BY e.id LIMIT 3`;
    else sql = `SELECT id, applicant_name, email, attendees, qr_token FROM entries WHERE status='confirmed' ORDER BY id LIMIT 3`;

    const rows = (await env.DB.prepare(sql).all())?.results ?? [];

    // 対象件数を別クエリで取得
    let countSql = '';
    if (filter === 'day1') countSql = `
      SELECT COUNT(DISTINCT e.id) AS c FROM entries e
      INNER JOIN entry_slots es ON es.entry_id=e.id INNER JOIN slots s ON es.slot_id=s.id
      WHERE e.status='confirmed' AND s.day='Day1'`;
    else if (filter === 'day2') countSql = `
      SELECT COUNT(DISTINCT e.id) AS c FROM entries e
      INNER JOIN entry_slots es ON es.entry_id=e.id INNER JOIN slots s ON es.slot_id=s.id
      WHERE e.status='confirmed' AND s.day='Day2'`;
    else if (filter === 'both') countSql = `
      SELECT COUNT(*) AS c FROM entries e
      WHERE e.status='confirmed'
        AND EXISTS (SELECT 1 FROM entry_slots es INNER JOIN slots s ON es.slot_id=s.id WHERE es.entry_id=e.id AND s.day='Day1')
        AND EXISTS (SELECT 1 FROM entry_slots es INNER JOIN slots s ON es.slot_id=s.id WHERE es.entry_id=e.id AND s.day='Day2')`;
    else countSql = `SELECT COUNT(*) AS c FROM entries WHERE status='confirmed'`;
    const countRow = await env.DB.prepare(countSql).first().catch(() => null);

    const reqUrl = new URL(request.url);
    const siteUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const previews = rows.map(r => {
      const vars = {
        id: r.id,
        name: r.applicant_name,
        count: r.attendees,
        url: `${siteUrl}/202612orisen/lookup/?id=${r.id}&email=${encodeURIComponent(r.email)}&t=${r.qr_token || ''}`,
      };
      return {
        to: r.email,
        toName: r.applicant_name,
        id: r.id,
        subject: interpolate(subject, vars),
        body: interpolate(body, vars),
      };
    });

    return new Response(JSON.stringify({
      total: countRow?.c ?? rows.length,
      previews,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('email-preview error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
