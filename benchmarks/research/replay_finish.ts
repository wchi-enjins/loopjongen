/**
 * Replays steps 3-5 (draft, quote check, answer) of a finished deep-search run on its own step-2 output, so the
 * draft and answer models can be compared on identical material. The material is the draft call's input in Langfuse.
 *
 *   npx langfuse-cli api observations list --trace-id <id> --name draft --fields core,basic,io --all --json > draft.json
 *   DEEP_MODEL=... DEEP_EFFORT=... node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs \
 *     benchmarks/research/replay_finish.ts --out <name> draft.json
 *
 * Writes results/<name>.{md,json}: the answer, and time, cost and model per step.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ALL, DRAFT_EFFORT, DRAFT_MODEL, EFFORT, MODEL, finish, type Run } from "../law_retrieval/deep/search.ts";
import { fetchDoc, type Doc } from "../law_retrieval/deep/tools.ts";
import { pool } from "../../app/src/lib/lawsearch/fulltext.ts";

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (!out || !file) throw new Error("usage: --out <name> <draft.json>");
const json = JSON.parse(readFileSync(file, "utf8"));
const material: string = (json.body?.data ?? json.data ?? json)[0].input;
const question = material.match(/^Vraag: (.*)$/m)![1];

// Every document the draft saw is in the index ("- key | title") and may be cited, so the quote check needs it.
const run: Run = { docs: new Map(), trace: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }, apiCalls: 0, costUsd: 0, stage: "draft", progress: 0 };
const index = material.slice(material.indexOf("Gelezen documenten:"), material.indexOf("Analysetabel:"));
const keys = [...index.matchAll(/^- (\S+) \|/gm)].map((m) => m[1]);
const docs = (await Promise.all(keys.map((k) => fetchDoc(k, run)))).filter((d): d is Doc => typeof d !== "string");
run.trace.length = 0;

const t0 = Date.now();
const result = await finish((await import("../../app/src/lib/ai.ts")).anthropic(), run, ALL, question, material, docs, t0, 0);
const calls = run.trace.filter((l) => l.startsWith("call "));
const steps = ["draft", ...(calls.length > 2 ? ["quote fix"] : []), "answer"];
const rows = calls.map((l, i) => {
  const m = l.match(/^call \d+ (\S+): (\d+) in \/ (\d+) out, ([\d.]+) s, total \$([\d.]+)/)!;
  return { step: steps[i], model: m[1], effort: i === 0 ? DRAFT_EFFORT : EFFORT, in: +m[2], out: +m[3], s: +m[4], total: +m[5] };
});
const table = [
  "| Step | Model | Effort | Tokens in / out | Time | Cost |",
  "|---|---|---|---|---|---|",
  ...rows.map((r, i) => `| ${r.step} | ${r.model} | ${r.effort} | ${r.in} / ${r.out} | ${r.s} s | $${(r.total - (rows[i - 1]?.total ?? 0)).toFixed(3)} |`),
  `| **Total** | | | | **${((Date.now() - t0) / 1000).toFixed(0)} s** | **$${run.costUsd.toFixed(3)}** |`,
].join("\n");
const md = `# Replay steps 3-5: ${out}\n\n- **Material:** ${file} (${material.length} characters, ${docs.length} documents)\n- **Draft:** ${DRAFT_MODEL} (${DRAFT_EFFORT}); **fix and answer:** ${MODEL} (${EFFORT})\n- **Quote check:** ${JSON.stringify(result.quoteCheck)}\n\n${table}\n\n${result.answer}\n`;
writeFileSync(new URL(`results/${out}.md`, import.meta.url), md);
writeFileSync(new URL(`results/${out}.json`, import.meta.url), JSON.stringify({ rows, quoteCheck: result.quoteCheck, claims: result.claims, trace: run.trace }, null, 2) + "\n");
console.log(table);
await pool.end();
