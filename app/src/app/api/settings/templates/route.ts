import { db } from "@/lib/db";
import { TEMPLATES, type ClauseTexts, type ExtraClause, type TemplateSettings, type Values } from "@/lib/templates";

// One settings row per part: template_clauses, field_defaults, extra_clauses.
const KEYS = { clauses: "template_clauses", defaults: "field_defaults", extras: "extra_clauses" } as const;

/** Template settings from /instellingen: custom clause texts, firm default values and own standard clauses. */
export async function GET() {
  const pool = await db();
  const { rows } = await pool.query(`SELECT key, value FROM settings WHERE key = ANY($1)`, [Object.values(KEYS)]);
  const get = (key: string) => rows.find((r) => r.key === key)?.value ?? {};
  return Response.json({ clauses: get(KEYS.clauses), defaults: get(KEYS.defaults), extras: get(KEYS.extras) } satisfies TemplateSettings);
}

/** Replace all template settings. Unknown templates, clauses and fields, empty values and values equal to the default are dropped. */
export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<TemplateSettings>;
  const value: TemplateSettings = { clauses: {}, defaults: {}, extras: {} };
  for (const t of TEMPLATES) {
    for (const [key, def] of Object.entries(t.clauses ?? {})) {
      const text = body.clauses?.[t.id]?.[key];
      if (typeof text === "string" && text.trim() && text !== def.text) ((value.clauses[t.id] ??= {}) as ClauseTexts)[key] = text;
    }
    for (const f of t.groups.flatMap((g) => g.fields)) {
      const v = body.defaults?.[t.id]?.[f.name];
      if (typeof v !== "string" || !v.trim() || v === (f.default ?? "")) continue;
      if (f.type === "select" && !f.options?.some((o) => o.value === v)) continue;
      ((value.defaults[t.id] ??= {}) as Values)[f.name] = v;
    }
    const extras = Array.isArray(body.extras?.[t.id]) ? (body.extras[t.id] as ExtraClause[]) : [];
    const clean = extras
      .filter((e) => typeof e?.title === "string" && typeof e?.text === "string" && e.title.trim() && e.text.trim())
      .slice(0, 20)
      .map((e) => ({ title: e.title.trim().slice(0, 200), text: e.text.trim() }));
    if (clean.length) value.extras[t.id] = clean;
  }
  const pool = await db();
  for (const [part, key] of Object.entries(KEYS))
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value[part as keyof TemplateSettings])],
    );
  return Response.json(value);
}
