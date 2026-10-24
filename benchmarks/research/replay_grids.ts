/**
 * Replays only the grid step of a DEEP_PLAN run: its plan (from the result's trace) is searched again and gridded with
 * the current selection and table settings, without a new plan or a draft. Shows which documents and facts reach the
 * tables; a fact that is not in a grid cannot reach the answer.
 *
 *   DEEP_PLAN=1 node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs \
 *     benchmarks/research/replay_grids.ts --out <name> results/<run>.json
 *
 * Writes results/<name>.md (the grids) and prints time and cost.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { executePlan, TABLE_MODEL, TABLE_EFFORT, type PlanPart, type Run } from "../law_retrieval/deep/search.ts";
import { anthropic } from "../../app/src/lib/ai.ts";
import { pool } from "../../app/src/lib/lawsearch/fulltext.ts";

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (!out || !file) throw new Error("usage: --out <name> <results.json>");
const trace: string[] = JSON.parse(readFileSync(file, "utf8")).questions[0].result.trace;
const plan: PlanPart[] = trace.find((l) => l.startsWith("plan:"))!.split("\n  - ").slice(1).map((b) => ({
  subquestion: b.split("\n")[0],
  searches: [...b.matchAll(/^ {6}search \[([\w,]*)\] (.*)$/gm)].map((m) => ({ sources: m[1].split(",").filter(Boolean), query: m[2] })),
  questions: [...b.matchAll(/^ {6}ask (.*)$/gm)].map((m) => m[1]),
}));

const run: Run = { docs: new Map(), trace: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }, apiCalls: 0, costUsd: 0, stage: "search", progress: 0 };
const grids: string[] = [];
const t0 = Date.now();
await executePlan(anthropic(), run, plan, grids);
const s = ((Date.now() - t0) / 1000).toFixed(0);
const picks = run.trace.filter((l) => l.startsWith("plan grid"));
writeFileSync(new URL(`results/${out}.md`, import.meta.url), `# Grid replay: ${out}\n\n- **Plan from:** ${file}\n- **Tables:** ${TABLE_MODEL} (${TABLE_EFFORT})\n- **Time:** ${s} s, **cost:** $${run.costUsd.toFixed(3)}, **calls:** ${run.apiCalls}\n${picks.map((p) => `- ${p}`).join("\n")}\n\n${grids.map((g, i) => `## Grid ${i + 1}\n${g}`).join("\n\n")}\n`);
console.log(`${s} s, $${run.costUsd.toFixed(3)}, ${run.apiCalls} calls\n${picks.join("\n")}`);
await pool.end();
