import { db } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Ongeldig id" }, { status: 400 });
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT id, title, template_id, customer_id, field_values AS values, override, updated_at FROM drafts WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return Response.json({ error: "Concept niet gevonden" }, { status: 404 });
  return Response.json(rows[0]);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Ongeldig id" }, { status: 400 });
  const pool = await db();
  await pool.query(`DELETE FROM drafts WHERE id = $1`, [id]);
  return new Response(null, { status: 204 });
}
