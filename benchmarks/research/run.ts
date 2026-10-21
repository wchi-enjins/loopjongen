/**
 * Research-answer benchmark: runs deep search on Moonlit's questions (questions.json), one at a time.
 * Score the answers by hand with rubric.md.
 *
 *   docker compose up -d db && set -a && . ./.env && set +a
 *   node --import ./benchmarks/law_retrieval/resolve_ts.mjs benchmarks/research/run.ts [--stages loop,table,quotes,check] [--case <id>]... [--out <name>]
 *       --stages: the stages to switch on (default all; one left out is off); --case may be repeated;
 *       --out writes results/<name>.{json,md} (default: the date). Costs API credit.
 *   With Langfuse keys set (see app/src/lib/langfuse.ts) every question is a trace; --out is the session.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { deepSearch, ALL, MODEL, EFFORT, LOOP_MODEL, TABLE_MODEL, type Stages, type DeepResult } from "../law_retrieval/deep/search.ts";
import { pool } from "../../app/src/lib/db.ts";
import { propagateAttributes, startTracing } from "../../app/src/lib/langfuse.ts";

type Question = { id: string; question: string; portals: string[]; verified: boolean; reference: string[]; gaps: string[] };

const dir = new URL(".", import.meta.url);
const { questions } = JSON.parse(readFileSync(new URL("questions.json", dir), "utf8")) as { questions: Question[] };

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = args.flatMap((a, i) => (args[i - 1] === "--case" ? [a] : []));
const date = new Date().toISOString().slice(0, 10);
const out = opt("--out") ?? date;
const on = opt("--stages")?.split(",");
for (const s of on ?? []) if (!(s in ALL)) throw new Error(`Onbekende stage ${s} (${Object.keys(ALL).join(",")})`);
const stages = Object.fromEntries(Object.keys(ALL).map((s) => [s, on ? on.includes(s) : true])) as Stages;

const selected = questions.filter((q) => !only.length || only.includes(q.id));
if (!selected.length) throw new Error(`Geen vraag ${only.join(", ")}`);

type Row = { id: string; question: string; result?: DeepResult; costUsd: number; error?: string };
const rows: Row[] = [];
const stopTracing = startTracing();
for (const q of selected) {
  console.log(`${q.id} …`);
  try {
    const result = await propagateAttributes({ sessionId: out, tags: ["research", q.id] }, () => deepSearch(q.question, stages));
    const { costUsd, loopCostUsd } = result;
    rows.push({ id: q.id, question: q.question, result, costUsd });
    console.log(`${(result.ms / 1000).toFixed(0)}s  ${result.apiCalls} calls  ${result.docs.length} docs  $${costUsd.toFixed(3)} (loop $${loopCostUsd.toFixed(3)})`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    rows.push({ id: q.id, question: q.question, costUsd: 0, error });
    console.log(`FOUT ${error}`);
  }
}

const stageList = Object.entries(stages).filter(([, v]) => v).map(([s]) => s).join(", ") || "geen";
const lines = [`# Benchmark: research-antwoorden (${date})`, "", `- **Stages:** ${stageList}`, `- **Model zoeklus:** ${LOOP_MODEL}`, `- **Model tabellen:** ${TABLE_MODEL}`, `- **Model concept en antwoord:** ${MODEL}`, `- **Effort:** ${EFFORT}`, `- **Vragen:** ${selected.length} (questions.json, scoren met rubric.md)`, ""];
for (const r of rows) {
  lines.push(`## ${r.id}`, "", `> ${r.question}`, "");
  if (!r.result) {
    lines.push(`**Fout:** ${r.error}`, "");
    continue;
  }
  const { answer, quoteCheck: qc, ms, apiCalls, docs, usage } = r.result;
  lines.push(
    `- **Tijd:** ${(ms / 1000).toFixed(0)} s, **API-calls:** ${apiCalls}, **tokens:** ${usage.input_tokens} in / ${usage.output_tokens} uit, **kosten:** $${r.costUsd.toFixed(3)} (zoeklus $${r.result.loopCostUsd.toFixed(3)})`,
    `- **Quote-check:** ${qc ? `${qc.passed} ok, ${qc.failed} fout, ${qc.fixed} hersteld, ${qc.dropped} geschrapt` : "uit"}`,
    `- **Documenten gelezen (${docs.length}):** ${docs.map((d) => `[${d.title || d.key}](${d.url})`).join("; ") || "geen"}`,
    "",
    answer,
    "",
  );
}

mkdirSync(new URL("results/", dir), { recursive: true });
writeFileSync(new URL(`results/${out}.json`, dir), JSON.stringify({ date, stages, questions: rows }, null, 2) + "\n");
writeFileSync(new URL(`results/${out}.md`, dir), lines.join("\n") + "\n");
console.log(`\nRapport: ${new URL(`results/${out}.md`, dir).pathname}`);
await stopTracing();
await pool.end(); // the lib keeps a Postgres pool open; close it so node exits
