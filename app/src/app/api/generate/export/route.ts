import { db } from "@/lib/db";
import { markupToDocx } from "@/lib/docx";

/** Build a .docx from document markup. `save: true` also stores it on the documents page. */
export async function POST(req: Request) {
  const { markup, filename, save } = (await req.json()) as { markup: string; filename: string; save?: boolean };
  if (!markup?.trim()) return Response.json({ error: "Geen inhoud" }, { status: 400 });
  const name = `${(filename || "document").replace(/[^\w\- ]+/g, "").trim() || "document"}.docx`;
  const buf = await markupToDocx(markup);
  const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (save) {
    const pool = await db();
    const text = markup.replace(/^#{1,2} /gm, "").replace(/^SIGN:/gm, "");
    const { rows } = await pool.query(
      `INSERT INTO documents (filename, mime, size, data, text, source) VALUES ($1, $2, $3, $4, $5, 'generated') RETURNING id`,
      [name, mime, buf.length, buf, text],
    );
    return Response.json({ id: rows[0].id, filename: name }, { status: 201 });
  }
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
}
