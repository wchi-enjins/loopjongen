import { db } from "@/lib/db";

export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const { id } = await ctx.params;
  const pool = await db();
  const { rows } = await pool
    .query(`SELECT filename, mime, data FROM documents WHERE id = $1`, [id])
    .catch(() => ({ rows: [] }));
  if (!rows[0]) return new Response("Niet gevonden", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const name = encodeURIComponent(rows[0].filename);
  return new Response(new Uint8Array(rows[0].data), {
    headers: {
      "Content-Type": rows[0].mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
    },
  });
}
