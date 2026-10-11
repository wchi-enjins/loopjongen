import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const pool = await db();
  const { rows } = await pool
    .query(`SELECT id, filename, mime, size, source, text, created_at FROM documents WHERE id = $1`, [id])
    .catch(() => ({ rows: [] }));
  if (!rows[0]) return Response.json({ error: "Document niet gevonden" }, { status: 404 });
  return Response.json(rows[0]);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const pool = await db();
  await pool.query(`DELETE FROM documents WHERE id = $1`, [id]);
  return Response.json({ ok: true });
}
