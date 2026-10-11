import { db } from "@/lib/db";
import { GOVERNANCE, TEMPLATES } from "@/lib/templates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Saved drafts, newest first, without their contents. */
export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.template_id, d.customer_id, c.name AS customer_name, d.updated_at
     FROM drafts d LEFT JOIN customers c ON c.id = d.customer_id ORDER BY d.updated_at DESC LIMIT 200`,
  );
  return Response.json(rows);
}

/** Create a draft, or update it when an existing id is given. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const templateId = String(body.templateId ?? "");
  const template = [...TEMPLATES, ...GOVERNANCE].find((t) => t.id === templateId);
  if (!template) return Response.json({ error: "Onbekend sjabloon" }, { status: 400 });
  const title = String(body.title ?? "").trim().slice(0, 200);
  if (!title) return Response.json({ error: "Titel is verplicht" }, { status: 400 });
  // Keep only the template's own fields, as strings.
  const names = new Set(template.groups.flatMap((g) => g.fields.map((f) => f.name)));
  const values = Object.fromEntries(
    Object.entries(typeof body.values === "object" && body.values ? body.values : {})
      .filter(([k, v]) => names.has(k) && typeof v === "string")
      .map(([k, v]) => [k, (v as string).slice(0, 10_000)]),
  );
  const override = typeof body.override === "string" ? body.override.slice(0, 500_000) : null;
  const customerId = typeof body.customerId === "string" && UUID.test(body.customerId) ? body.customerId : null;
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;

  const pool = await db();
  const { rows } = id
    ? await pool.query(
        `UPDATE drafts SET title = $2, template_id = $3, field_values = $4, override = $5, customer_id = $6, updated_at = now()
         WHERE id = $1 RETURNING id, title, updated_at`,
        [id, title, templateId, JSON.stringify(values), override, customerId],
      )
    : await pool.query(
        `INSERT INTO drafts (title, template_id, field_values, override, customer_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, updated_at`,
        [title, templateId, JSON.stringify(values), override, customerId],
      );
  if (!rows[0]) return Response.json({ error: "Concept niet gevonden" }, { status: 404 });
  return Response.json(rows[0], { status: id ? 200 : 201 });
}
