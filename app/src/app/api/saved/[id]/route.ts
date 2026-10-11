import { db } from "@/lib/db";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/saved/[id]">) {
  const { id } = await ctx.params;
  const pool = await db();
  await pool.query(`DELETE FROM saved_items WHERE id = $1`, [id]).catch(() => null);
  return Response.json({ ok: true });
}
