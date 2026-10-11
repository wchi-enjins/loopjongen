import { db } from "@/lib/db";

/** Documents linked to this customer. */
export async function GET(_req: Request, ctx: RouteContext<"/api/customers/[id]/documents">) {
  const { id } = await ctx.params;
  const pool = await db();
  const { rows } = await pool
    .query(
      `SELECT d.id, d.filename, d.mime, d.size, d.created_at
         FROM customer_documents cd JOIN documents d ON d.id = cd.document_id
        WHERE cd.customer_id = $1
        ORDER BY cd.created_at DESC`,
      [id],
    )
    .catch(() => ({ rows: [] }));
  return Response.json(rows);
}

/** Link existing documents to this customer. */
export async function POST(req: Request, ctx: RouteContext<"/api/customers/[id]/documents">) {
  const { id } = await ctx.params;
  const { documentIds } = (await req.json().catch(() => ({}))) as { documentIds?: unknown };
  if (!Array.isArray(documentIds) || !documentIds.length) return Response.json({ error: "Geen documenten geselecteerd" }, { status: 400 });
  const pool = await db();
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO customer_documents (customer_id, document_id)
       SELECT $1, id FROM documents WHERE id = ANY($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [id, documentIds.map(String)],
    );
    return Response.json({ added: rowCount }, { status: 201 });
  } catch {
    return Response.json({ error: "Klant of documenten niet gevonden" }, { status: 404 });
  }
}
