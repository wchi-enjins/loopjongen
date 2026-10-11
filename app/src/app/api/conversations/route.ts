import { NEW_CHAT_TITLE, db, uniqueTitle } from "@/lib/db";
import { pickEffort, pickLawSearch, pickModel } from "@/lib/models";

export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.updated_at,
            (SELECT count(*)::int FROM conversation_documents d WHERE d.conversation_id = c.id) AS document_count
       FROM conversations c ORDER BY c.updated_at DESC LIMIT 200`,
  );
  return Response.json(rows);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; documentIds?: string[]; model?: string; effort?: string; lawSearch?: string };
  const pool = await db();
  const { rows } = await pool.query(
    `INSERT INTO conversations (title, model, effort, law_search) VALUES ($1, $2, $3, $4) RETURNING id, title, model, effort, law_search, updated_at`,
    [await uniqueTitle(pool, body.title?.slice(0, 200) || NEW_CHAT_TITLE), pickModel(body.model) ?? null, pickEffort(body.effort) ?? null, pickLawSearch(body.lawSearch) ?? null],
  );
  const conv = rows[0];
  for (const docId of body.documentIds ?? []) {
    await pool.query(`INSERT INTO conversation_documents VALUES ($1, $2) ON CONFLICT DO NOTHING`, [conv.id, docId]);
  }
  return Response.json(conv, { status: 201 });
}
