import { db } from "@/lib/db";

// ponytail: one shared PIN, no rate limit; move to real auth when the app gets accounts.
const PIN = process.env.FEEDBACK_PIN || "0000";

/** Selected feedback (ids) including snapshots as a JSON download. POST so the PIN stays out of URLs and logs. */
export async function POST(req: Request) {
  const { pin, ids } = (await req.json().catch(() => ({}))) as { pin?: string; ids?: unknown };
  if (pin !== PIN) return Response.json({ error: "Onjuiste pincode" }, { status: 403 });
  if (!Array.isArray(ids) || !ids.length) return Response.json({ error: "Geen feedback geselecteerd" }, { status: 400 });
  const pool = await db();
  const { rows } = await pool
    .query(`SELECT id, message, page, snapshot, created_at FROM feedback WHERE id = ANY($1::uuid[]) ORDER BY created_at DESC`, [ids.map(String)])
    .catch(() => ({ rows: null }));
  if (!rows) return Response.json({ error: "Ongeldige selectie" }, { status: 400 });
  return new Response(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="feedback-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
