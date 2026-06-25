/**
 * GET /api/slots
 * プログラム枠一覧と残席数を返す
 *
 * Cloudflare Pages Functions
 * env.DB ─ D1 データベース (fsn-apply-db)
 */

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(`
      SELECT
        s.id, s.code, s.program_code, s.program_name,
        s.day, s.date, s.time_start, s.time_end, s.venue,
        s.capacity, s.description, s.is_active, s.sort_order,
        COALESCE(SUM(es.attendees), 0) AS reserved,
        (s.capacity - COALESCE(SUM(es.attendees), 0)) AS remaining
      FROM slots s
      LEFT JOIN entry_slots es ON s.id = es.slot_id
      LEFT JOIN entries e ON es.entry_id = e.id AND e.status = 'confirmed'
      WHERE s.is_active = 1
      GROUP BY s.id
      ORDER BY s.sort_order, s.id
    `).all();

    return json({ slots: result.results });
  } catch (err) {
    console.error('Error fetching slots:', err);
    return json({ error: 'Failed to fetch slots', message: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
