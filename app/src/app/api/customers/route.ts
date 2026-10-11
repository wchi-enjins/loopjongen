import { db } from "@/lib/db";

// Optional text fields next to name, in form and column order.
const FIELDS = ["email", "phone", "company", "address", "postal_code", "city", "kvk", "notes"] as const;
const COLUMNS = `id, name, ${FIELDS.join(", ")}, created_at`;

export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM customers ORDER BY created_at DESC`);
  return Response.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "Naam is verplicht" }, { status: 400 });
  const pool = await db();
  const { rows } = await pool.query(
    `INSERT INTO customers (name, ${FIELDS.join(", ")}) VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING ${COLUMNS}`,
    [name, ...FIELDS.map((f) => String(body[f] ?? "").trim().slice(0, f === "notes" ? 5000 : 200))],
  );
  return Response.json(rows[0], { status: 201 });
}
