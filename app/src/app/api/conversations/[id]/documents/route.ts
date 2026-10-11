import { db } from "@/lib/db";

/** Replace the set of documents attached to a conversation. */
export async function PUT(req: Request, ctx: RouteContext<"/api/conversations/[id]/documents">) {
  const { id } = await ctx.params;
  const { documentIds } = (await req.json()) as { documentIds: string[] };
  const pool = await db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM conversation_documents WHERE conversation_id = $1`, [id]);
    for (const docId of documentIds ?? []) {
      await client.query(`INSERT INTO conversation_documents VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, docId]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return Response.json({ ok: true });
}

/** Save a law article or ruling as a text document (reused per externalId) and attach it to the conversation. */
export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[id]/documents">) {
  const { id } = await ctx.params;
  const { filename, text, externalId, source } = (await req.json()) as { filename?: string; text?: string; externalId?: string; source?: string };
  if (!filename?.trim() || !text?.trim()) return Response.json({ error: "Titel en tekst zijn vereist" }, { status: 400 });
  const pool = await db();
  const conv = await pool.query(`SELECT 1 FROM conversations WHERE id = $1`, [id]).catch(() => null);
  if (!conv?.rows[0]) return Response.json({ error: "Gesprek niet gevonden" }, { status: 404 });

  const buf = Buffer.from(text, "utf8");
  const { rows } = await pool.query(
    `INSERT INTO documents (filename, mime, size, data, text, source, external_id) VALUES ($1, 'text/plain', $2, $3, $4, $5, $6)
     ON CONFLICT (external_id) DO UPDATE SET filename = EXCLUDED.filename, size = EXCLUDED.size, data = EXCLUDED.data, text = EXCLUDED.text
     RETURNING id, filename`,
    [filename.trim().slice(0, 200), buf.length, buf, text, source === "rechtspraak" ? "rechtspraak" : "wetgeving", externalId || null],
  );
  await pool.query(`INSERT INTO conversation_documents VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, rows[0].id]);
  return Response.json(rows[0], { status: 201 });
}
