import { db } from "@/lib/db";
import { extractText } from "@/lib/extract";

const MAX_BYTES = 25 * 1024 * 1024;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
const guessMime = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT id, filename, mime, size, source, length(text)::int AS text_length, created_at FROM documents ORDER BY created_at DESC`,
  );
  return Response.json(rows);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "Geen bestanden ontvangen" }, { status: 400 });
  const pool = await db();
  const created = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) return Response.json({ error: `${file.name} is groter dan 25 MB` }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type && file.type !== "application/octet-stream" ? file.type : guessMime(file.name);
    const text = await extractText(buf, mime, file.name);
    const { rows } = await pool.query(
      `INSERT INTO documents (filename, mime, size, data, text) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, filename, mime, size, source, length(text)::int AS text_length, created_at`,
      [file.name, mime, buf.length, buf, text],
    );
    created.push(rows[0]);
  }
  return Response.json(created, { status: 201 });
}
