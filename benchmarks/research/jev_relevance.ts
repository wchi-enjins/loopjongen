/**
 * Jev relevance test: does TypeSafe's Jev answer a grid's yes/no relevance question the way the grid table did?
 * Reads Langfuse observation dumps of deep-search runs, takes every grid whose first question asks yes or no, and
 * asks Jev that question over the same document text the table saw (clipped like fillTable). Costs Jev credit
 * ($0.042 per million input tokens).
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs benchmarks/research/jev_relevance.ts --out <name> <langfuse.json>...
 *
 * Needs JEV_API_KEY (.env) and DATABASE_URL. Writes results/<name>.json with one row per document.
 * --cases <results.json> reuses the cases of an earlier run instead of Langfuse dumps. --criteria sends the document as
 * JSON state ({title, published, text}) and adds hand-written yes/no criteria per kind of question (CRITERIA below).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fetchDoc, type Ctx } from "../law_retrieval/deep/tools.ts";
import { clip } from "../law_retrieval/deep/search.ts";
import { pool } from "../../app/src/lib/lawsearch/fulltext.ts";

const DOC_CHARS = 30_000; // as in search.ts, so Jev sees what the table saw
const YES_NO = /\b(yes|ja)\b[^.?]*\b(no|nee)\b/i;

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const from = opt("--cases");
const withCriteria = args.includes("--criteria");
const files = args.filter((a, i) => !a.startsWith("--") && !["--out", "--cases"].includes(args[i - 1]));
if (!out || !(files.length || from)) throw new Error("usage: --out <name> [--criteria] (--cases <results.json> | <langfuse.json>...)");

// What counts as yes, per kind of grid question (Q2b: fines, 72-hour guidance). First match wins.
const CRITERIA: [RegExp, { true: string; false: string }][] = [
  [/list/i, {
    true: "The document lists or summarises several fines the AP imposed for data breach notification or for insufficient security.",
    false: "The document lists no AP fines, or only fines for other violations.",
  }],
  [/boete|fine/i, {
    true: "The document is an AP decision or announcement of an AP fine that is (partly) imposed for insufficient security of personal data (art. 32 AVG, art. 13 Wbp) or for late or missing notification of a data breach (art. 33 AVG, art. 34a Wbp), whichever of these the question asks about. Late reporting under the old art. 34a Wbp counts.",
    false: "The document imposes no fine, or the fine is only for other violations (for example lawful basis, data subject rights, cookies), or it is general guidance, an annual report or a news item without a specific fine.",
  }],
  [/72|melden|reported|meld/i, {
    true: "The document explains when or how a data breach must be reported to the AP: the 72-hour term, when it starts (becoming aware), 'onverwijld', reporting in stages, or the risk assessment that decides whether to report. AP guidance pages, policy rules and AP decisions that apply the term all count.",
    false: "The document does not explain the reporting duty or its timing, for example a fine purely for insufficient security, or a page about other privacy topics.",
  }],
];
const criteriaFor = (q: string) => CRITERIA.find(([re]) => re.test(q))?.[1];

type Case = { question: string; key: string; grid: boolean; jev?: number; tokens?: number; ms?: number; error?: string };
const cases = new Map<string, Case>();
if (from) for (const c of JSON.parse(readFileSync(from, "utf8")) as Case[]) cases.set(`${c.question}\n${c.key}`, { question: c.question, key: c.key, grid: c.grid });
for (const file of files) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const obs: any[] = json.body?.data ?? json.data ?? json;
  for (const o of obs.filter((o) => o.name === "analyze_documents")) {
    const input = typeof o.input === "string" ? JSON.parse(o.input) : o.input;
    const q = input.questions?.[0] ?? "";
    if (!YES_NO.test(q) || typeof o.output !== "string") continue;
    for (const block of o.output.split("\n### ").slice(1)) {
      const key = block.slice(0, block.indexOf(" | "));
      const answer = block.split("\n").find((l: string) => l.startsWith(`- ${q}:`))?.slice(q.length + 3).trim() ?? "";
      const grid = /^(ja|yes)\b/i.test(answer) ? true : /^(nee|no|niet in document)\b/i.test(answer) ? false : undefined;
      if (grid !== undefined) cases.set(`${q}\n${key}`, { question: q, key, grid });
    }
  }
}

const ctx: Ctx = { docs: new Map(), trace: [] };
async function ask(c: Case) {
  try {
    const doc = await fetchDoc(c.key, ctx);
    if (typeof doc === "string") throw new Error(doc);
    const t0 = Date.now();
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.JEV_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: withCriteria ? { title: doc.title, published: doc.date, text: clip(doc.text, DOC_CHARS) } : `${doc.title}\n\n${clip(doc.text, DOC_CHARS)}`,
        questions: { relevant: { type: "noul", instructions: c.question, ...(withCriteria && { criteria: criteriaFor(c.question) }) } },
      }),
    });
    c.ms = Date.now() - t0;
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    c.jev = body.answers.relevant.noul;
    c.tokens = body.usage?.input_tokens;
  } catch (e: any) {
    c.error = String(e?.message ?? e);
  }
}

// ponytail: 4 at a time, no rate-limit handling; add backoff if Jev returns 429s.
const all = [...cases.values()];
for (let i = 0; i < all.length; i += 4) {
  await Promise.all(all.slice(i, i + 4).map(ask));
  process.stderr.write(`\r${Math.min(i + 4, all.length)}/${all.length} documents`);
}
process.stderr.write("\n");
writeFileSync(new URL(`results/${out}.json`, import.meta.url), JSON.stringify(all, null, 2) + "\n");

const ok = all.filter((c) => c.jev !== undefined);
console.log(`${all.length} cases, ${ok.length} answered, ${all.length - ok.length} errors; grid yes ${ok.filter((c) => c.grid).length}, no ${ok.filter((c) => !c.grid).length}`);
for (const t of [0.2, 0.3, 0.4, 0.5, 0.6]) {
  const missed = ok.filter((c) => c.grid && c.jev! < t).length; // relevant documents the filter would drop
  const saved = ok.filter((c) => !c.grid && c.jev! < t).length; // irrelevant documents it would skip
  const agree = ok.filter((c) => c.grid === c.jev! >= t).length;
  console.log(`threshold ${t}: agree ${agree}/${ok.length}, relevant dropped ${missed}, irrelevant skipped ${saved}`);
}
const tokens = ok.reduce((s, c) => s + (c.tokens ?? 0), 0);
const ms = ok.map((c) => c.ms!).sort((a, b) => a - b);
console.log(`input tokens ${tokens}, cost $${((tokens * 0.042) / 1e6).toFixed(5)}, latency median ${ms[ms.length >> 1]} ms, max ${ms.at(-1)} ms`);
for (const c of all.filter((c) => c.error)) console.log(`error ${c.key}: ${c.error}`);
await pool.end();
