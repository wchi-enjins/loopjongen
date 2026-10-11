import { db } from "@/lib/db";

/** Chat messages linked to this customer, with the conversation they belong to. */
export async function GET(_req: Request, ctx: RouteContext<"/api/customers/[id]/messages">) {
  const { id } = await ctx.params;
  const pool = await db();
  const { rows } = await pool
    .query(
      `SELECT m.id, m.role, m.content, m.created_at, c.id AS conversation_id, c.title AS conversation_title
         FROM customer_messages cm
         JOIN messages m ON m.id = cm.message_id
         JOIN conversations c ON c.id = m.conversation_id
        WHERE cm.customer_id = $1
        ORDER BY c.updated_at DESC, m.created_at`,
      [id],
    )
    .catch(() => ({ rows: [] }));
  return Response.json(rows);
}

/** Link existing chat messages to this customer (no copy of the content). */
export async function POST(req: Request, ctx: RouteContext<"/api/customers/[id]/messages">) {
  const { id } = await ctx.params;
  const { messageIds } = (await req.json().catch(() => ({}))) as { messageIds?: unknown };
  if (!Array.isArray(messageIds) || !messageIds.length) return Response.json({ error: "Geen berichten geselecteerd" }, { status: 400 });
  const pool = await db();
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO customer_messages (customer_id, message_id)
       SELECT $1, id FROM messages WHERE id = ANY($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [id, messageIds.map(String)],
    );
    // The chats these messages come from get this customer as context, unless they already have one.
    await pool.query(
      `UPDATE conversations SET customer_id = $1
        WHERE customer_id IS NULL AND id IN (SELECT conversation_id FROM messages WHERE id = ANY($2::uuid[]))`,
      [id, messageIds.map(String)],
    );
    return Response.json({ added: rowCount }, { status: 201 });
  } catch {
    return Response.json({ error: "Klant of berichten niet gevonden" }, { status: 404 });
  }
}
