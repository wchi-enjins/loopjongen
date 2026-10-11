import { NEW_CHAT_TITLE, db, uniqueTitle } from "@/lib/db";
import { pickEffort, pickLawSearch, pickModel } from "@/lib/models";

export async function GET(_req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { id } = await ctx.params;
  const pool = await db();
  const conv = await pool.query(`SELECT id, title, model, effort, law_search, customer_id, updated_at FROM conversations WHERE id = $1`, [id]).catch(() => null);
  if (!conv?.rows[0]) return Response.json({ error: "Gesprek niet gevonden" }, { status: 404 });
  const messages = await pool.query(
    `SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at`,
    [id],
  );
  const documents = await pool.query(
    `SELECT d.id, d.filename FROM conversation_documents cd JOIN documents d ON d.id = cd.document_id
      WHERE cd.conversation_id = $1 ORDER BY d.filename`,
    [id],
  );
  // Customers with messages from this chat linked to them; deleting the chat removes those links.
  const linked = await pool.query(
    `SELECT cu.name, count(*)::int AS count FROM customer_messages cm
       JOIN messages m ON m.id = cm.message_id JOIN customers cu ON cu.id = cm.customer_id
      WHERE m.conversation_id = $1 GROUP BY cu.name ORDER BY cu.name`,
    [id],
  );
  return Response.json({ ...conv.rows[0], messages: messages.rows, documents: documents.rows, linkedCustomers: linked.rows });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { title?: string; model?: string; effort?: string; lawSearch?: string; customerId?: string | null };
  const pool = await db();
  let title: string | undefined;
  if ("title" in body) {
    title = await uniqueTitle(pool, (body.title ?? "").slice(0, 200) || NEW_CHAT_TITLE, id);
    await pool.query(`UPDATE conversations SET title = $2 WHERE id = $1`, [id, title]);
  }
  if ("model" in body || "effort" in body) {
    await pool.query(`UPDATE conversations SET model = $2, effort = $3 WHERE id = $1`, [id, pickModel(body.model) ?? null, pickEffort(body.effort) ?? null]);
  }
  if ("lawSearch" in body) {
    await pool.query(`UPDATE conversations SET law_search = $2 WHERE id = $1`, [id, pickLawSearch(body.lawSearch) ?? null]);
  }
  if ("customerId" in body) {
    const ok = await pool
      .query(`UPDATE conversations SET customer_id = $2 WHERE id = $1`, [id, body.customerId || null])
      .catch(() => null);
    if (!ok) return Response.json({ error: "Klant niet gevonden" }, { status: 400 });
  }
  return Response.json({ ok: true, title });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const { id } = await ctx.params;
  const pool = await db();
  await pool.query(`DELETE FROM conversations WHERE id = $1`, [id]);
  return Response.json({ ok: true });
}
