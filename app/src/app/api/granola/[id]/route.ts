import { db } from "@/lib/db";
import { NotConnectedError, exportMeeting, withGranola } from "@/lib/granola";

/** Import (or re-import) a Granola meeting as a Markdown document; returns the document id. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { title, markdown } = await withGranola((c) => exportMeeting(c, id));
    const buf = Buffer.from(markdown, "utf8");
    const filename = `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`;
    const { rows } = await (await db()).query(
      `INSERT INTO documents (filename, mime, size, data, text, source, external_id)
       VALUES ($1, 'text/markdown', $2, $3, $4, 'granola', $5)
       ON CONFLICT (external_id) DO UPDATE SET filename = $1, size = $2, data = $3, text = $4
       RETURNING id`,
      [filename, buf.length, buf, markdown, id],
    );
    return Response.json({ id: rows[0].id });
  } catch (err) {
    if (err instanceof NotConnectedError) return Response.json({ error: err.message }, { status: 401 });
    return Response.json({ error: err instanceof Error ? err.message : "Import mislukt" }, { status: 502 });
  }
}
