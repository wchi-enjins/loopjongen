import { db } from "@/lib/db";
import { CHAT_MODEL } from "@/lib/ai";
import { DEFAULT_EFFORT } from "@/lib/models";
import { serverLogs } from "@/lib/server_log";
import pkg from "../../../../package.json";

/** List without snapshots; the full data only comes out via /api/feedback/export with the PIN. */
export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(`SELECT id, message, page, created_at FROM feedback ORDER BY created_at DESC`);
  return Response.json(rows);
}

export async function POST(req: Request) {
  const { message, snapshot } = (await req.json().catch(() => ({}))) as { message?: string; snapshot?: Record<string, unknown> };
  if (!message?.trim()) return Response.json({ error: "Feedback is vereist" }, { status: 400 });
  const pool = await db();

  // Add the data behind the page: the open chat (?c=) or document (?d=).
  let url: URL | null = null;
  try {
    url = new URL(String(snapshot?.url ?? ""));
  } catch {}
  const data: Record<string, unknown> = {};
  const c = url?.searchParams.get("c");
  if (c) {
    const conv = await pool.query(`SELECT id, title, model, effort, created_at, updated_at FROM conversations WHERE id = $1`, [c]).catch(() => null);
    if (conv?.rows[0]) {
      const msgs = await pool.query(`SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [c]);
      const docs = await pool.query(
        `SELECT d.id, d.filename, d.source FROM documents d JOIN conversation_documents cd ON cd.document_id = d.id WHERE cd.conversation_id = $1`,
        [c],
      );
      data.conversation = { ...conv.rows[0], messages: msgs.rows, documents: docs.rows };
    }
  }
  const d = url?.searchParams.get("d");
  if (d) {
    const doc = await pool.query(`SELECT id, filename, mime, size, source, text, created_at FROM documents WHERE id = $1`, [d]).catch(() => null);
    if (doc?.rows[0]) data.document = doc.rows[0];
  }

  const server = {
    appVersion: pkg.version,
    nextVersion: pkg.dependencies.next,
    nodeEnv: process.env.NODE_ENV,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    // Server defaults; the model/effort per AI call is in snapshot.network (x-ai-model / x-ai-effort).
    defaultModel: CHAT_MODEL,
    defaultEffort: DEFAULT_EFFORT,
  };
  // Server log of the last 30 minutes (console + request errors).
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const logs = serverLogs.filter((l) => l.at >= since);

  const { rows } = await pool.query(
    `INSERT INTO feedback (message, page, snapshot) VALUES ($1, $2, $3) RETURNING id, created_at`,
    [message.trim().slice(0, 10_000), url?.pathname ?? "", { ...snapshot, data, server, serverLogs: logs }],
  );
  return Response.json(rows[0], { status: 201 });
}
