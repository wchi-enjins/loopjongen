/**
 * Benchmark for /genereren: template + form values -> AI edit (the app's own
 * /api/generate/refine, so the real prompt, rules and law texts are tested) ->
 * regex checks + an LLM judge per rubric item.
 *
 *   node benchmarks/document_generation/run.ts --dry          validate cases, no API calls
 *   node benchmarks/document_generation/run.ts [--case <id>]  full run (costs API credit)
 *
 * Needs the app running (BASE_URL, default http://localhost:3000) and ANTHROPIC_API_KEY
 * for the judge (loaded by direnv from .env). JUDGE_MODEL overrides the judge model.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

type Case = {
  id: string;
  template: string;
  kind: string;
  values: Record<string, string>;
  instructions: string;
  must_include: string[];
  must_not_include: string[];
  rubric: string[];
};

const dir = new URL(".", import.meta.url);
const { TEMPLATES, defaults } = await import(new URL("../../app/src/lib/templates.ts", dir).href);
const { cases } = JSON.parse(readFileSync(new URL("cases.json", dir), "utf8")) as { cases: Case[] };

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-sonnet-5-5";

const JUDGE_SYSTEM = `Je beoordeelt een door AI opgesteld Nederlands juridisch document. Beoordeel elk criterium afzonderlijk en strikt: "pass" alleen als het document er volledig aan voldoet. Geef per criterium een korte reden in het Nederlands.`;
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, pass: { type: "boolean" }, reason: { type: "string" } },
        required: ["index", "pass", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

async function refine(templateId: string, markup: string, instructions: string) {
  const res = await fetch(`${BASE}/api/generate/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, markup, instructions }),
  });
  if (!res.ok) throw new Error(`refine ${res.status}: ${await res.text()}`);
  const text = await res.text();
  if (text.includes("[Fout bij AI-verzoek:")) throw new Error(text.slice(text.lastIndexOf("[Fout bij AI-verzoek:")));
  return text;
}

async function judge(client: any, c: Case, doc: string) {
  const criteria = c.rubric.map((r, i) => `${i}. ${r}`).join("\n");
  const msg = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: `INSTRUCTIE AAN DE OPSTELLER:\n${c.instructions}\n\nCRITERIA:\n${criteria}\n\nDOCUMENT:\n\n${doc}` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("judge refused");
  const text = msg.content.flatMap((b: any) => (b.type === "text" ? [b.text] : [])).join("");
  const { results } = JSON.parse(text) as { results: { index: number; pass: boolean; reason: string }[] };
  return c.rubric.map((r, i) => {
    const hit = results.find((x) => x.index === i);
    return { item: r, pass: hit?.pass ?? false, reason: hit?.reason ?? "niet beoordeeld" };
  });
}

const regexChecks = (c: Case, doc: string) => [
  ...c.must_include.map((p) => ({ item: `bevat /${p}/`, pass: new RegExp(p, "i").test(doc), reason: "" })),
  ...c.must_not_include.map((p) => ({ item: `bevat niet /${p}/`, pass: !new RegExp(p, "i").test(doc), reason: "" })),
];

const selected = cases.filter((c) => !only || c.id === only);
if (!selected.length) throw new Error(`Geen case ${only}`);

// Validate every case before spending anything.
for (const c of selected) {
  const t = TEMPLATES.find((x: { id: string }) => x.id === c.template);
  if (!t) throw new Error(`${c.id}: onbekend sjabloon ${c.template}`);
  const fields = new Set(t.groups.flatMap((g: { fields: { name: string }[] }) => g.fields.map((f) => f.name)));
  for (const k of Object.keys(c.values)) if (!fields.has(k)) throw new Error(`${c.id}: onbekend veld ${k}`);
  [...c.must_include, ...c.must_not_include].forEach((p) => new RegExp(p, "i"));
  if (!c.instructions.trim() || !c.rubric.length) throw new Error(`${c.id}: instructie en rubric zijn verplicht`);
}
if (dry) {
  for (const c of selected) {
    const t = TEMPLATES.find((x: { id: string }) => x.id === c.template);
    console.log(`ok  ${c.id.padEnd(34)} ${c.kind.padEnd(10)} ${t.render({ ...defaults(t), ...c.values }).length} tekens, ${c.rubric.length} criteria`);
  }
  console.log(`\n${selected.length} cases geldig (dry run, geen API-aanroepen).`);
  process.exit(0);
}

const require = createRequire(new URL("../../app/package.json", dir));
const Anthropic = require("@anthropic-ai/sdk").default;
const client = new Anthropic();

const rows: { c: Case; checks: { item: string; pass: boolean; reason: string }[]; error?: string; doc?: string }[] = [];
for (const c of selected) {
  const t = TEMPLATES.find((x: { id: string }) => x.id === c.template);
  process.stdout.write(`${c.id} … `);
  try {
    const doc = await refine(c.template, t.render({ ...defaults(t), ...c.values }), c.instructions);
    const checks = [...regexChecks(c, doc), ...(await judge(client, c, doc))];
    rows.push({ c, checks, doc });
    console.log(`${checks.filter((x) => x.pass).length}/${checks.length}`);
  } catch (e) {
    rows.push({ c, checks: [], error: e instanceof Error ? e.message : String(e) });
    console.log("FOUT");
  }
}

const items = rows.flatMap((r) => r.checks);
const allPass = rows.filter((r) => !r.error && r.checks.every((x) => x.pass)).length;
const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const lines = [
  `# Benchmark: documentgeneratie (${stamp})`,
  "",
  `- **Opsteller:** app ${BASE} (/api/generate/refine)`,
  `- **Beoordelaar:** ${JUDGE_MODEL}`,
  `- **Resultaat:** ${allPass}/${rows.length} cases volledig geslaagd; ${items.filter((x) => x.pass).length}/${items.length} criteria geslaagd`,
  "",
  "| Case | Soort | Criteria geslaagd |",
  "| --- | --- | --- |",
  ...rows.map((r) => `| ${r.c.id} | ${r.c.kind} | ${r.error ? "fout" : `${r.checks.filter((x) => x.pass).length}/${r.checks.length}`} |`),
  "",
  "## Details",
  ...rows.flatMap((r) => [
    "",
    `### ${r.c.id}`,
    `Instructie: ${r.c.instructions}`,
    "",
    ...(r.error ? [`Fout: ${r.error}`] : r.checks.map((x) => `- ${x.pass ? "✅" : "❌"} ${x.item}${x.reason ? ` — ${x.reason}` : ""}`)),
    ...(r.doc ? ["", "<details><summary>Document</summary>", "", "```", r.doc, "```", "", "</details>"] : []),
  ]),
];
mkdirSync(new URL("results/", dir), { recursive: true });
const out = new URL(`results/${stamp}.md`, dir);
writeFileSync(out, lines.join("\n") + "\n");
console.log(`\n${allPass}/${rows.length} cases volledig geslaagd. Rapport: ${out.pathname}`);
