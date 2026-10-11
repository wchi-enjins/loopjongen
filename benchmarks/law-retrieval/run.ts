/**
 * Benchmark for the law search approaches: question -> ranked BWB ids + articles, scored
 * against the gold set in questions.json.
 *
 *   node --import ./benchmarks/law-retrieval/resolve-ts.mjs benchmarks/law-retrieval/run.ts --dry
 *       validate the gold set (ids in manifest, articles via getLaw), no Claude calls
 *   node --import ./benchmarks/law-retrieval/resolve-ts.mjs benchmarks/law-retrieval/run.ts [--approach a|b|b-raw|c|b-then-a|a-and-b] [--case <id>]... [--out <name>]
 *       --approach may be repeated; --out writes results/<name>.{json,md} (default: the date);
 *       --compare <name> adds the summaries from results/<name>.json to the first table
 *       full run (costs API credit; needs ANTHROPIC_API_KEY from .env)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { getLaw } from "../../app/src/lib/wetten.ts";

type Question = { id: string; question: string; law: string; alsoAccept: string[]; articles: string[]; difficulty: string; note: string };
type Hit = { id: string; title: string; articles: string[]; why: string };
type SearchResult = { hits: Hit[]; usage: { input_tokens: number; output_tokens: number }; apiCalls: number; trace: string[] };

const dir = new URL(".", import.meta.url);
const { questions } = JSON.parse(readFileSync(new URL("questions.json", dir), "utf8")) as { questions: Question[] };
const { entries } = JSON.parse(readFileSync(new URL("../../data/bwb/manifest.json", dir), "utf8")) as { entries: { id: string }[] };

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.flatMap((a, i) => (args[i - 1] === "--case" ? [a] : []));
const approachArgs = args.flatMap((a, i) => (args[i - 1] === "--approach" ? [a] : []));
// approach -> [module, exported function]
const APPROACHES: Record<string, [string, string]> = {
  a: ["a-agentic/search.ts", "search"],
  b: ["b-fulltext/search.ts", "search"],
  "b-raw": ["b-fulltext/search.ts", "searchRaw"],
  c: ["c-catalog/search.ts", "search"],
  "b-then-a": ["hybrid/search.ts", "searchFallback"],
  "a-and-b": ["hybrid/search.ts", "searchBoth"],
};
const MODEL = process.env.LAW_MODEL ?? "claude-opus-5-5";
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }; // claude-opus-5-5, USD per token
const TRAP = { target: "BWBR0003866", twin: "BWBR0003865" };
// getLaw labels Burgerlijk Wetboek articles without the book prefix, so "7:271" must match "271".
const BW = new Set(["BWBR0002656", "BWBR0003045", "BWBR0005291", "BWBR0002761", "BWBR0005288", "BWBR0005289", "BWBR0005290", "BWBR0006000", "BWBR0030068"]);

const norm = (label: string) => label.replace(/^(artikel|art\.)\s*/i, "").trim().replace(/\.$/, "").toLowerCase();
const normFor = (law: string, label: string) => (BW.has(law) ? norm(label).replace(/^\d+:/, "") : norm(label));

const selected = questions.filter((q) => !only.length || only.includes(q.id));
if (!selected.length) throw new Error(`Geen vraag ${only.join(", ")}`);
const approaches = approachArgs.length ? approachArgs : Object.keys(APPROACHES);
for (const a of approaches) if (!APPROACHES[a]) throw new Error(`Onbekende aanpak ${a} (${Object.keys(APPROACHES).join("|")})`);

// Validate the gold set before spending anything.
const known = new Set(entries.map((e) => e.id));
let problems = 0;
for (const q of selected) {
  const missing = [q.law, ...q.alsoAccept].filter((id) => !known.has(id));
  if (missing.length) throw new Error(`${q.id}: niet in manifest: ${missing.join(", ")}`);
  if (!dry) continue;
  const law = await getLaw(q.law);
  const labels = new Set(law.items.flatMap((it) => (it.kind === "article" ? [norm(it.label)] : [])));
  const absent = q.articles.filter((a) => !labels.has(norm(a)));
  if (absent.length) problems++;
  console.log(`${absent.length ? "FOUT" : "ok  "} ${q.id.padEnd(42)} ${q.law} ${law.title.slice(0, 50).padEnd(50)} ${absent.length ? `ontbreekt: ${absent.join(", ")}` : `${q.articles.length} artikelen`}`);
}
if (dry) {
  console.log(`\n${selected.length - problems}/${selected.length} vragen geldig (dry run, geen API-aanroepen).`);
  process.exit(problems ? 1 : 0);
}

// Backend load per question: CPU/memory of this node process (stands in for the app backend), CPU/disk/memory
// of the Postgres container from its cgroup counters (exact, not sampled; null without docker), and the
// requests to overheid.nl. Run one approach per process so getLaw's in-memory cache is not shared.
const DB_CONTAINER = process.env.LOAD_DB_CONTAINER ?? "loopjongen-db-1";
type Load = { appCpuMs: number; appRssMB: number; dbCpuMs: number | null; dbReadMB: number | null; dbMemMB: number | null; bwbCalls: number; bwbWaitMs: number };
function dbCounters() {
  try {
    const out = execFileSync("docker", ["exec", DB_CONTAINER, "cat", "/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/io.stat", "/sys/fs/cgroup/memory.current"], { encoding: "utf8" });
    return {
      cpuUs: Number(out.match(/usage_usec (\d+)/)?.[1]),
      readBytes: [...out.matchAll(/rbytes=(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0),
      mem: Number(out.trim().split("\n").at(-1)),
    };
  } catch {
    return null;
  }
}
const bwb = { calls: 0, waitMs: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/overheid\.nl|officiele-overheidspublicaties\.nl/.test(url)) return realFetch(input, init);
  const t = performance.now();
  try {
    return await realFetch(input, init);
  } finally {
    bwb.calls++;
    bwb.waitMs += performance.now() - t;
  }
};
function startLoad() {
  const db0 = dbCounters(), cpu0 = process.cpuUsage(), bwb0 = { ...bwb };
  return (): Load => {
    const cpu = process.cpuUsage(cpu0), db1 = db0 && dbCounters();
    return {
      appCpuMs: (cpu.user + cpu.system) / 1000,
      appRssMB: process.memoryUsage().rss / 1e6,
      dbCpuMs: db0 && db1 ? (db1.cpuUs - db0.cpuUs) / 1000 : null,
      dbReadMB: db0 && db1 ? (db1.readBytes - db0.readBytes) / 1e6 : null,
      dbMemMB: db1 ? db1.mem / 1e6 : null,
      bwbCalls: bwb.calls - bwb0.calls,
      bwbWaitMs: bwb.waitMs - bwb0.waitMs,
    };
  };
}

type Row = { q: Question; top: string[]; articles: string[]; at1: boolean; at5: boolean; recall: number; seconds: number; usage: SearchResult["usage"]; apiCalls: number; cost: number; trace: string[]; hits: Hit[]; load: Load; error?: string };

function score(q: Question, r: SearchResult) {
  const ok = new Set([q.law, ...q.alsoAccept]);
  const top = r.hits.map((h) => h.id);
  const hit = r.hits.find((h) => ok.has(h.id));
  const got = new Set((hit?.articles ?? []).map((a) => normFor(hit!.id, a)));
  return {
    top,
    articles: hit?.articles ?? [],
    at1: ok.has(top[0]),
    at5: top.slice(0, 5).some((id) => ok.has(id)),
    recall: q.articles.filter((a) => got.has(norm(a))).length / q.articles.length,
  };
}

const results: Record<string, Row[]> = {};
for (const a of approaches) {
  const [file, fn] = APPROACHES[a];
  const search = (await import(new URL(file, dir).href))[fn] as (q: string) => Promise<SearchResult>;
  const rows: Row[] = (results[a] = []);
  console.log(`\n== aanpak ${a} (${file} ${fn}) ==`);
  for (const q of selected) {
    process.stdout.write(`${q.id} … `);
    const t0 = performance.now();
    const stopLoad = startLoad();
    try {
      const r = await search(q.question); // sequential: be polite to overheid.nl
      const seconds = (performance.now() - t0) / 1000;
      const load = stopLoad();
      const s = score(q, r);
      const cost = r.usage.input_tokens * PRICE.input + r.usage.output_tokens * PRICE.output;
      rows.push({ q, ...s, seconds, usage: r.usage, apiCalls: r.apiCalls, cost, trace: r.trace, hits: r.hits, load });
      console.log(`${s.at1 ? "@1" : s.at5 ? "@5" : "mis"}  recall ${s.recall.toFixed(2)}  ${seconds.toFixed(0)}s  $${cost.toFixed(3)}  cpu app ${load.appCpuMs.toFixed(0)}ms db ${load.dbCpuMs?.toFixed(0) ?? "-"}ms  bwb ${load.bwbCalls}x  [${s.top.join(", ")}]`);
    } catch (e) {
      const seconds = (performance.now() - t0) / 1000;
      const load = stopLoad();
      const error = e instanceof Error ? e.message : String(e);
      rows.push({ q, top: [], articles: [], at1: false, at5: false, recall: 0, seconds, usage: { input_tokens: 0, output_tokens: 0 }, apiCalls: 0, cost: 0, trace: [], hits: [], load, error });
      console.log(`FOUT ${error}`);
    }
  }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const summary = (rows: Row[]) => ({
  n: rows.length,
  lawAt1: avg(rows.map((r) => +r.at1)),
  lawAt5: avg(rows.map((r) => +r.at5)),
  articleRecall: avg(rows.map((r) => r.recall)),
  avgSeconds: avg(rows.map((r) => r.seconds)),
  avgCostUsd: avg(rows.map((r) => r.cost)),
  errors: rows.filter((r) => r.error).length,
});
const loadSummary = (rows: Row[]) => {
  const db = rows.filter((r) => r.load.dbCpuMs !== null);
  return {
    avgAppCpuMs: avg(rows.map((r) => r.load.appCpuMs)),
    peakAppRssMB: Math.max(0, ...rows.map((r) => r.load.appRssMB)),
    avgDbCpuMs: db.length ? avg(db.map((r) => r.load.dbCpuMs!)) : null,
    avgDbReadMB: db.length ? avg(db.map((r) => r.load.dbReadMB!)) : null,
    dbMemMB: db.length ? Math.max(...db.map((r) => r.load.dbMemMB!)) : null,
    avgBwbCalls: avg(rows.map((r) => r.load.bwbCalls)),
    avgBwbWaitSeconds: avg(rows.map((r) => r.load.bwbWaitMs)) / 1000,
  };
};
const tucht = (rows: Row[]) =>
  rows
    .filter((r) => r.q.law === TRAP.target)
    .map((r) => {
      const t = r.top.indexOf(TRAP.target), w = r.top.indexOf(TRAP.twin);
      const verdict = t === 0 ? "Marine #1" : t > 0 && (w < 0 || t < w) ? `Marine #${t + 1}` : w >= 0 ? `Landmacht #${w + 1} boven Marine` : "geen van beide";
      return { id: r.q.id, verdict, recall: r.recall };
    });
const difficulties = [...new Set(selected.map((q) => q.difficulty))];

const date = new Date().toISOString().slice(0, 10);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : date;
const compare = args.includes("--compare") ? args[args.indexOf("--compare") + 1] : null;
const earlier: Record<string, { summary: ReturnType<typeof summary> }> = compare
  ? JSON.parse(readFileSync(new URL(`results/${compare}.json`, dir), "utf8")).approaches
  : {};
const json = {
  date,
  model: MODEL,
  effort: process.env.LAW_EFFORT ?? "low",
  approaches: Object.fromEntries(
    Object.entries(results).map(([a, rows]) => [
      a,
      {
        summary: summary(rows),
        load: loadSummary(rows),
        byDifficulty: Object.fromEntries(difficulties.map((d) => [d, summary(rows.filter((r) => r.q.difficulty === d))])),
        tuchtrecht: tucht(rows),
        questions: rows.map((r) => ({
          id: r.q.id,
          difficulty: r.q.difficulty,
          gold: { law: r.q.law, alsoAccept: r.q.alsoAccept, articles: r.q.articles },
          top: r.top,
          articles: r.articles,
          hits: r.hits,
          lawAt1: r.at1,
          lawAt5: r.at5,
          articleRecall: r.recall,
          seconds: r.seconds,
          usage: r.usage,
          apiCalls: r.apiCalls,
          costUsd: r.cost,
          load: r.load,
          error: r.error,
          trace: r.trace,
        })),
      },
    ]),
  ),
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sumRow = (label: string, s: ReturnType<typeof summary>) =>
  `| ${label} | ${s.n} | ${pct(s.lawAt1)} | ${pct(s.lawAt5)} | ${pct(s.articleRecall)} | ${s.avgSeconds.toFixed(0)}s | $${s.avgCostUsd.toFixed(3)} | ${s.errors} |`;
const head = ["| Aanpak | n | law@1 | law@5 | artikel-recall | gem. tijd | gem. kosten | fouten |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
const lines = [
  `# Benchmark: wetten zoeken (${date})`,
  "",
  `- **Model:** ${MODEL}, effort ${json.effort}`,
  `- **Vragen:** ${selected.length} (questions.json)`,
  "",
  ...head,
  ...Object.entries(results).map(([a, rows]) => sumRow(a, summary(rows))),
  ...Object.entries(earlier).map(([a, r]) => sumRow(`${a} (${compare})`, r.summary)),
  "",
  "## Backend-belasting (gemiddeld per vraag)",
  "",
  "| Aanpak | CPU backend | geheugen backend (piek) | CPU Postgres | schijf gelezen Postgres | geheugen Postgres | calls overheid.nl | wachttijd overheid.nl |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...Object.entries(results).map(([a, rows]) => {
    const l = loadSummary(rows);
    const n = (x: number | null, d: number, u: string) => (x === null ? "-" : `${x.toFixed(d)} ${u}`);
    return `| ${a} | ${n(l.avgAppCpuMs, 0, "ms")} | ${n(l.peakAppRssMB, 0, "MB")} | ${n(l.avgDbCpuMs, 0, "ms")} | ${n(l.avgDbReadMB, 1, "MB")} | ${n(l.dbMemMB, 0, "MB")} | ${l.avgBwbCalls.toFixed(1)} | ${l.avgBwbWaitSeconds.toFixed(1)} s |`;
  }),
  "",
  "## Per moeilijkheid",
  "",
  ...head,
  ...Object.entries(results).flatMap(([a, rows]) => difficulties.map((d) => sumRow(`${a} / ${d}`, summary(rows.filter((r) => r.q.difficulty === d))))),
  "",
  "## Tuchtrecht (Marine BWBR0003866 vs. Landmacht BWBR0003865)",
  "",
  "| Aanpak | Vraag | Uitkomst | artikel-recall |",
  "| --- | --- | --- | --- |",
  ...Object.entries(results).flatMap(([a, rows]) => tucht(rows).map((t) => `| ${a} | ${t.id} | ${t.verdict} | ${pct(t.recall)} |`)),
  "",
  "## Per vraag",
  "",
  `| Vraag | Moeilijkheid | Gold | ${Object.keys(results).map((a) => `${a}: top 3 / recall`).join(" | ")} |`,
  `| --- | --- | --- | ${Object.keys(results).map(() => "---").join(" | ")} |`,
  ...selected.map(
    (q) =>
      `| ${q.id} | ${q.difficulty} | ${q.law} ${q.articles.join(",")} | ${Object.values(results)
        .map((rows) => {
          const r = rows.find((x) => x.q === q)!;
          return r.error ? `fout: ${r.error.slice(0, 40)}` : `${r.at1 ? "✅" : r.at5 ? "🟡" : "❌"} ${r.top.slice(0, 3).join(", ")} / ${pct(r.recall)}`;
        })
        .join(" | ")} |`,
  ),
];
mkdirSync(new URL("results/", dir), { recursive: true });
writeFileSync(new URL(`results/${out}.json`, dir), JSON.stringify(json, null, 2) + "\n");
writeFileSync(new URL(`results/${out}.md`, dir), lines.join("\n") + "\n");
console.log(`\n${Object.entries(results).map(([a, rows]) => sumRow(a, summary(rows))).join("\n")}\nRapport: ${new URL(`results/${out}.md`, dir).pathname}`);
// b-fulltext keeps a Postgres pool open; close it so node exits.
if (approaches.some((a) => a.includes("b"))) await (await import(new URL("b-fulltext/search.ts", dir).href)).pool.end();
