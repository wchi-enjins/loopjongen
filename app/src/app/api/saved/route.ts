import { db } from "@/lib/db";

export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(`SELECT id, external_id, title, text, source, created_at FROM saved_items ORDER BY created_at DESC`);
  return Response.json(rows);
}

/** Save a law article or ruling; the same externalId updates the existing row. */
export async function POST(req: Request) {
  const { filename, text, externalId, source } = (await req.json()) as { filename?: string; text?: string; externalId?: string; source?: string };
  if (!filename?.trim() || !text?.trim() || !externalId?.trim()) return Response.json({ error: "Titel, tekst en id zijn vereist" }, { status: 400 });
  const pool = await db();
  const { rows } = await pool.query(
    `INSERT INTO saved_items (external_id, title, text, source) VALUES ($1, $2, $3, $4)
     ON CONFLICT (external_id) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text
     RETURNING id, external_id, title, text, source, created_at`,
    [externalId, filename.trim().slice(0, 200), text, source === "rechtspraak" ? "rechtspraak" : "wetgeving"],
  );
  return Response.json(rows[0], { status: 201 });
}
