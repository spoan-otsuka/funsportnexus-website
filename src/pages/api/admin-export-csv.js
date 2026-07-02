/**
 * GET /api/admin-export-csv?type=entries|attendees|program&q=&status=
 * CSV ダウンロード
 * - middleware により admin 認証済の前提
 *
 * BOM 付き UTF-8 で Excel 互換
 */

export const prerender = false;

const csvEscape = (v) => {
  if (v == null) return '';
  const s = String(v).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return /[",]/.test(s) ? `"${s}"` : s;
};

const toCsv = (header, rows) => {
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return '﻿' + lines.join('\r\n');
};

const respond = (csv, filename) => new Response(csv, {
  status: 200,
  headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  },
});

export async function GET({ url, locals, request }) {
  const env = locals?.runtime?.env ?? {};
  if (!env.DB) return new Response('DB not bound', { status: 500 });

  const type = url.searchParams.get('type') || 'entries';
  const q = (url.searchParams.get('q') || '').trim();
  const statusFilter = url.searchParams.get('status') || 'all';

  // 監査ログ
  try {
    const { audit } = await import('../../lib/audit.js');
    await audit(env, request, 'csv_export', type, { q, statusFilter });
  } catch {}

  // ファイル名にJST日付
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const stamp = jst.toISOString().slice(0, 10).replace(/-/g, '');

  try {
    if (type === 'entries') {
      let sql = `
        SELECT id, status, applicant_name, applicant_furigana, email, tel,
               attendees, remarks, created_at,
               checked_in_at, checkin_day, cancelled_at, cancel_reason,
               panshoku_extras
        FROM entries WHERE 1=1
      `;
      const params = [];
      if (statusFilter === 'confirmed') sql += ` AND status = 'confirmed'`;
      else if (statusFilter === 'cancelled') sql += ` AND status = 'cancelled'`;
      if (q) {
        sql += ` AND (applicant_name LIKE ? OR applicant_furigana LIKE ? OR email LIKE ? OR tel LIKE ? OR CAST(id AS TEXT) = ?)`;
        const like = `%${q}%`;
        params.push(like, like, like, like, q);
      }
      sql += ` ORDER BY id`;
      const r = await env.DB.prepare(sql).bind(...params).all();
      const rows = (r?.results ?? []).map(e => [
        e.id, e.status, e.applicant_name, e.applicant_furigana, e.email, e.tel,
        e.attendees, e.remarks, e.created_at,
        e.checked_in_at, e.checkin_day, e.cancelled_at, e.cancel_reason,
        e.panshoku_extras ? '有' : '',
      ]);
      const csv = toCsv(
        ['管理ID','状態','お名前','ふりがな','メール','電話','人数','備考','申込日時','初回チェックイン','初回Day','キャンセル日時','キャンセル理由','当日同行者'],
        rows
      );
      return respond(csv, `fsn_entries_${stamp}.csv`);
    }

    if (type === 'attendees') {
      const r = await env.DB.prepare(`
        SELECT e.id AS entry_id, e.applicant_name, e.email, e.tel, e.status,
               a.position, a.name, a.furigana, a.grade, a.birth_date,
               a.is_representative, a.panshoku_join
        FROM entry_attendees a
        INNER JOIN entries e ON a.entry_id = e.id
        WHERE e.status = 'confirmed'
        ORDER BY e.id, a.position
      `).all();
      const rows = (r?.results ?? []).map(a => [
        a.entry_id, a.applicant_name, a.email, a.tel,
        a.position, a.name, a.furigana, a.grade, a.birth_date,
        a.is_representative ? '代表' : '',
        a.panshoku_join ? '○' : '',
      ]);
      const csv = toCsv(
        ['管理ID','申込者','メール','電話','番','参加者氏名','ふりがな','学年','生年月日','代表','ぱん食い参加'],
        rows
      );
      return respond(csv, `fsn_attendees_${stamp}.csv`);
    }

    if (type === 'program') {
      // 各プログラム枠ごとの参加者
      const r = await env.DB.prepare(`
        SELECT
          s.day, s.time_start, s.time_end, s.program_name, s.venue, s.capacity,
          a.position, a.name, a.furigana, a.grade, a.birth_date,
          es.attended,
          e.id AS entry_id, e.applicant_name, e.email, e.tel, e.status
        FROM entry_slots es
        INNER JOIN slots s ON es.slot_id = s.id
        INNER JOIN entries e ON es.entry_id = e.id AND e.status = 'confirmed'
        LEFT JOIN entry_attendees a ON es.attendee_id = a.id
        ORDER BY s.day, s.time_start, s.program_name, e.id, a.position
      `).all();
      const rows = (r?.results ?? []).map(p => [
        p.day, p.time_start, p.time_end, p.program_name, p.venue,
        p.entry_id, p.applicant_name, p.email, p.tel,
        p.name, p.furigana, p.grade, p.birth_date,
        p.attended === 0 ? '欠席' : '参加予定',
      ]);
      const csv = toCsv(
        ['Day','開始','終了','プログラム','会場','管理ID','申込者','メール','電話','参加者氏名','ふりがな','学年','生年月日','出欠'],
        rows
      );
      return respond(csv, `fsn_program_${stamp}.csv`);
    }

    return new Response('Unknown type', { status: 400 });
  } catch (e) {
    console.error('csv export error:', e);
    return new Response('Error: ' + e.message, { status: 500 });
  }
}
