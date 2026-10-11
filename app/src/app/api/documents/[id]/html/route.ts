import { db } from "@/lib/db";
import { docxToHtml } from "@/lib/extract";

/** HTML rendering of a .docx document for the preview pane. */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/html">) {
  const { id } = await ctx.params;
  const pool = await db();
  const { rows } = await pool.query(`SELECT data FROM documents WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  if (!rows[0]) return Response.json({ error: "Niet gevonden" }, { status: 404 });
  return Response.json({ html: await docxToHtml(rows[0].data) });
}
