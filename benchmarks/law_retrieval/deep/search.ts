/**
 * Deep search: an agentic loop over the BWB and the source connectors (tools.ts), then a table step, a draft with
 * verbatim quotes and a deterministic quote check (quotes.ts). Each stage can be switched off to measure what it adds.
 * With the grid stage (default) the loop reads only through analyze_documents, like Moonlit: document texts stay out
 * of the loop context and its tables replace the table step. --no-grid gives the old loop with read_document.
 * With the split stage (default) a first call splits the question into 1-4 independent parts and each part gets its
 * own loop, all in parallel; --no-split runs one loop over the whole question.
 * Plan: model_improvements/deep_search.md
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs benchmarks/law_retrieval/deep/search.ts [--no-split] [--no-loop] [--no-grid] [--no-table] [--no-quotes] [--no-check] "<vraag>"
 *
 * DEEP_MODEL (default claude-opus-5-5) and DEEP_EFFORT (default high) override the model; DEEP_LOOP_MODEL (default
 * DEEP_MODEL) sets the model of the search loop only, DEEP_TABLE_MODEL (default claude-haiku-5-5) that of the table step,
 * DEEP_TABLE_EFFORT (default DEEP_EFFORT) its effort, DEEP_DRAFT_MODEL and DEEP_DRAFT_EFFORT (default DEEP_MODEL and
 * DEEP_EFFORT) those of the draft only. DEEP_JEV=1 has Jev score every search hit (grid stage only, see tools.ts).
 * DEEP_JEV_FLOW=1 adds the Jev workflow: one Rechtspraak search per sub-question, a checklist per part from the split
 * that Jev checks before a loop may stop, a Jev relevance filter before each grid's table (instead of the table's own
 * first question), and a Jev check that each quote supports its claim.
 * DEEP_PLAN=1 replaces the search loop, Moonlit-style: one call (DEEP_PLAN_MODEL, default DEEP_MODEL, at DEEP_EFFORT)
 * writes all searches and the fixed grid questions per sub-question, the searches run in parallel, and each
 * sub-question gets one grid over its top hits, read one document per call in parallel. No follow-up grids.
 * With LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY set, each run is traced in Langfuse (app/src/lib/langfuse.ts).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../../../app/src/lib/ai.ts";
import { pickEffort, supportsEffort } from "../../../app/src/lib/models.ts";
import { normLabel, pool, searchText } from "../../../app/src/lib/lawsearch/fulltext.ts";
import { SOURCES, type Source } from "../../../app/src/lib/sources/index.ts";
import { TOOLS, GRID_TOOL, JEV, fetchDoc, jev, jevDoc, runTool, type Ctx, type Doc } from "./tools.ts";
import { checkQuote, normalize } from "./quotes.ts";
import { openaiMessage } from "./openai.ts";
import { startActiveObservation, startObservation, startTracing } from "../../../app/src/lib/langfuse.ts";

export type Stages = { split: boolean; loop: boolean; grid: boolean; table: boolean; quotes: boolean; check: boolean };
export const ALL: Stages = { split: true, loop: true, grid: true, table: true, quotes: true, check: true };
export type Claim = { text: string; quote: string; doc: string; ok?: boolean }; // doc = Ctx key
export type DeepResult = {
  answer: string;
  claims: Claim[];
  docs: { key: string; title: string; url: string; source: string }[];
  laws: { id: string; title: string; articles: string[]; why: string }[];
  trace: string[];
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number }; // input_tokens includes cache reads
  costUsd: number;
  loopCostUsd: number;
  apiCalls: number;
  ms: number;
  quoteCheck?: { passed: number; failed: number; fixed: number; dropped: number; unsupported?: number };
};

export const MODEL = process.env.DEEP_MODEL ?? "claude-opus-5-5";
export const LOOP_MODEL = process.env.DEEP_LOOP_MODEL ?? MODEL;
export const TABLE_MODEL = process.env.DEEP_TABLE_MODEL ?? "claude-haiku-5-5"; // Q1 run 4: same coverage as Opus at $0.08 instead of $1.99
export const EFFORT = pickEffort(process.env.DEEP_EFFORT) ?? "high";
export const TABLE_EFFORT = pickEffort(process.env.DEEP_TABLE_EFFORT) ?? EFFORT;
export const DRAFT_MODEL = process.env.DEEP_DRAFT_MODEL ?? MODEL;
export const DRAFT_EFFORT = pickEffort(process.env.DEEP_DRAFT_EFFORT) ?? EFFORT;
export const FLOW = process.env.DEEP_JEV_FLOW === "1";
export const PLAN = process.env.DEEP_PLAN === "1";
export const PLAN_MODEL = process.env.DEEP_PLAN_MODEL ?? MODEL;
const PLAN_DOCS = 25; // documents per sub-question grid (Moonlit read 20 for Q2b)
const GATE_ROUNDS = 2; // times Jev may send a loop back for unchecked items
const GATE_P = 0.5; // a checklist item counts as covered at p >= this
const GRID_P = 0.3; // documents below this skip the table (first Jev test: no relevant document dropped at 0.2-0.3)
// ponytail: tuned on 5 hand cases (bad 0.05 and 0.22, short true quotes 0.28 and 0.48); flagged claims go to the fix
// step, not out, so a false flag costs a re-quote. Retune on a run's support-check trace.
const SUPPORT_P = 0.25;
const SUPPORT = process.env.DEEP_JEV_SUPPORT !== "0"; // DEEP_JEV_SUPPORT=0: workflow without the support check (run 9 flagged 15 of 28)
const SUPPORT_CRITERIA = {
  true: "The quote states what the claim says, in other words or partly, so a lawyer can rely on it for this claim. A claim may summarise or name its subject when the source makes clear who it is about.",
  false: "The quote says something else, contradicts the claim, only states what a party itself said while the claim presents it as the regulator's finding, or the claim adds a fact (date, amount, article, party) the quote does not contain.",
};
// ponytail: runaway guard only, no search budget (we compare with Moonlit); add a budget before this moves into the app.
const MAX_TURNS = 100;
const MAX_TABLES = 4; // sub-questions, one table each (Moonlit: 8 tables for 5 questions)
const TABLE_DOCS = 12; // documents per table (Moonlit: 6-12)
const REST_CHARS = 8_000; // per document that no table picked, given to the draft as text
const DOC_CHARS = 30_000; // per document in a table call
// DEEP_PARALLEL_GRIDS=1 (or DEEP_PLAN=1): one document per table call, all in parallel (each stays under Haiku's 100K price step).
const BATCH_CHARS = process.env.DEEP_PARALLEL_GRIDS === "1" || process.env.DEEP_PLAN === "1" ? DOC_CHARS : 120_000; // documents per table call
const DRAFT_CHARS = 400_000; // all document text in the draft when the table step is off
// Haiku 4.5 rejects effort; Haiku models have no server-side fallback.
const base = (model: string, effort: string) => ({
  ...(model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
  output_config: supportsEffort(model) ? { effort } : {},
});

// USD per 1M tokens: fresh input, cache read, 5-minute cache write, output. Haiku 5.5 has a second rate card above
// 100K prompt tokens.
type Price = { in: number; read: number; write: number; out: number };
const PRICES: Record<string, Price | ((prompt: number) => Price)> = {
  "claude-opus-5-5": { in: 4, read: 0.2, write: 5, out: 20 },
  "claude-sonnet-5-5": { in: 2, read: 0.2, write: 2.5, out: 10 },
  "claude-haiku-5-5": (prompt) => (prompt > 100_000 ? { in: 0.5, read: 0.05, write: 0.625, out: 2.5 } : { in: 0.1, read: 0.01, write: 0.125, out: 0.5 }),
  // OpenAI has no cache-write charge; prompts above 272K input tokens pay 2x input and 1.5x output.
  "gpt-6.1-sol": (prompt) => (prompt > 272_000 ? { in: 4, read: 0.2, write: 4, out: 15 } : { in: 2, read: 0.1, write: 2, out: 10 }),
};

export type Run = Ctx & { usage: DeepResult["usage"]; apiCalls: number; costUsd: number; stage: string; progress: number };

// Streams, so long outputs don't hit the SDK's 10-minute limit for plain requests.
async function call(client: Anthropic, run: Run, params: Record<string, any>, model = MODEL, effort = EFFORT) {
  const b = base(model, effort);
  const t0 = Date.now();
  // Named after the step; the input is the newest message only (the loop repeats the whole history every call).
  const gen = startObservation(run.stage, { model, input: params.messages?.at(-1)?.content, modelParameters: supportsEffort(model) ? { effort } : {} }, { asType: "generation" });
  let msg: Anthropic.Beta.BetaMessage;
  const betas = [...(b.betas ?? []), ...(params.betas ?? [])];
  try {
    msg = model.startsWith("gpt-")
      ? ((await openaiMessage({ max_tokens: 64000, ...params }, model, effort)) as any as Anthropic.Beta.BetaMessage)
      : await client.beta.messages
          .stream({ model, max_tokens: 64000, ...b, ...params, ...(betas.length && { betas }), output_config: { ...b.output_config, ...params.output_config } } as any)
          .finalMessage();
  } catch (e: any) {
    gen.update({ level: "ERROR", statusMessage: String(e?.message ?? e) }).end();
    throw e;
  }
  run.apiCalls++;
  const u = msg.usage;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  run.usage.input_tokens += u.input_tokens + read + write;
  run.usage.output_tokens += u.output_tokens;
  run.usage.cache_read_tokens += read;
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  const r = typeof p === "function" ? p(u.input_tokens + read + write) : p;
  const cost = (u.input_tokens * r.in + read * r.read + write * r.write + u.output_tokens * r.out) / 1e6;
  run.costUsd += cost;
  gen.update({
    output: msg.content,
    usageDetails: { input: u.input_tokens, output: u.output_tokens, cache_read_input_tokens: read, cache_creation_input_tokens: write },
    costDetails: { total: cost },
  }).end();
  run.trace.push(`call ${run.apiCalls} ${model}: ${u.input_tokens + read + write} in / ${u.output_tokens} out, ${((Date.now() - t0) / 1000).toFixed(1)} s, total $${run.costUsd.toFixed(3)}`);
  for (const e of msg.context_management?.applied_edits ?? []) run.trace.push(`context cleared: ${JSON.stringify(e)}`);
  if (msg.stop_reason === "refusal") throw new Error("model refused");
  if (msg.stop_reason === "max_tokens") throw new Error(`max_tokens reached after: ${run.trace.at(-1) ?? "start"}`);
  return msg;
}

const textOf = (msg: Anthropic.Beta.BetaMessage) => msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();

async function ask<T>(client: Anthropic, run: Run, system: string, content: string, schema: object, model = MODEL, effort = EFFORT): Promise<T> {
  return JSON.parse(textOf(await call(client, run, { system, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema } } }, model, effort)));
}

const str = { type: "string" };
const arr = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const LAWS = arr(obj({ id: str, articles: arr(str), why: str }));

/** Head and tail of a long text (rulings put the decision at the end), with a note that it was cut. */
export function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const head = Math.round(max * 0.7);
  return `${text.slice(0, head)}\n\n[... ingekort: ${text.length - max} van ${text.length} tekens weggelaten ...]\n\n${text.slice(text.length - (max - head))}`;
}

const docXml = (d: Doc, max: number) => `<document key="${d.key}" title="${d.title}" date="${d.date}">\n${clip(d.text, max)}\n</document>`;

/** Normalised text around the longest run of quote words (3+) found in the document; the start if none is. */
function around(quote: string, text: string, width = 3000) {
  const t = normalize(text);
  const w = normalize(quote).split(" ");
  for (let n = w.length - 1; n >= 3; n--)
    for (let i = 0; i + n <= w.length; i++) {
      const at = t.indexOf(w.slice(i, i + n).join(" "));
      if (at >= 0) return t.slice(Math.max(0, at - width), at + width);
    }
  return t.slice(0, 2 * width); // ponytail: no 3-word overlap shows the document start; search rare words if fixes often miss
}

const LOOP_SYSTEM = `You research a Dutch legal question for a lawyer, as a thorough associate would. Your tools search Dutch national legislation (BWB) and decisions of ACM, Autoriteit Persoonsgegevens, Kifid and the courts (rechtspraak).

1. Plan first, in a few lines before your first search: split the question into sub-questions, and per sub-question name the legislation, regulators and kinds of decisions that may answer it.
2. Search broadly and in parallel: make several tool calls in one turn, with different keywords, synonyms and the formal legal vocabulary. Start each sub-question with one broad bracketed boolean query on acm and ap that covers its variants, for example (cookie OR tracking) AND (boete OR sanctie OR "last onder dwangsom"): it lists up to 30 hits. Rechtspraak and kifid do not understand that syntax: search them separately with 2-4 plain keywords, such as a party name and the regulator. Then search narrower for what it missed.
3. Read the promising documents (read_document, read_law). Read long documents further with offset where the relevant parts are.
4. Follow leads: use what you found (party names, case numbers, ECLI's, article numbers, the documents' own terms) for new searches, and read the articles that decisions say were breached.
5. Stop only when new searches turn up nothing new for any sub-question. There is no budget: being thorough matters more than being fast.

End with a short note and no tool calls: the sub-questions, the key documents (by key) per sub-question, and what you could not find. Do not write the final answer; later steps write it from the documents you read. Only documents you read count as sources.

Hard rule: a search that finds nothing proves nothing. Report it as a gap ("not found in <source>"); never conclude from it that something doesn't exist or only happened elsewhere.`;

const JEV_RULE = `\n\nWith every search_sources call, pass relevance: the sub-question it is for, what counts as yes and what as no. Make yes and no exactly as narrow as the sub-question (if it asks only about art. 32 fines, a fine for late reporting is no). Hits come sorted by p, the chance the full text is relevant: grid the hits with high p even when their title does not look relevant, and skip those with low p.`;
// Grid stage: the loop reads through analyze_documents and never sees document texts.
const FLOW_RULE = `\n\nSearch rechtspraak at least once per sub-question, with 2-4 plain keywords (a party name, the regulator, the subject), even when the regulator's own decisions seem to answer it: court rulings on appeal change fines and outcomes.`;
const LOOP_GRID_SYSTEM = (LOOP_SYSTEM + (JEV ? JEV_RULE : "") + (FLOW ? FLOW_RULE : "")).replace(
  /^3\. .*$/m,
  "3. Read through analyze_documents: give each sub-question its own grid of 2-4 fixed questions. Make the first question a relevance filter (for example: does this document decide a case of the kind the sub-question asks about? yes or no), then ask the facts you need (who, what sanction or amount, which article, what outcome); for a legal norm, ask how the regulator reads it and which defences it rejected. Grid the decisions themselves (AP: ap:documenten/boete-...), not the press releases about them. You see only the answers and quotes, never the full text. Then run small grids on just the documents with gaps, for example a missing article or amount.",
).replace("Only documents you read count as sources.", "Only documents in a grid count as sources.");
const GRID_TOOLS = [...TOOLS.filter((t) => t.name.startsWith("search_")), GRID_TOOL];

const SPLIT_SYSTEM = `Split a Dutch legal research question into the parts that can be researched independently, each by its own search, at most ${MAX_TABLES}. Do not split a question that has one part: return it as the only part. Keep parts together when one needs the other's findings. Write each part as a self-contained question in the question's language, repeating the regulator, law, sector and period it is about.`;
const CHECKS_RULE = ` For each part, also write 3-6 checks: short yes/no questions that a complete answer to that part must pass, about what a thorough lawyer would look for, for example "Is for each fine the court ruling on appeal named, if there is one?", "Is it explained when the term starts?", "Are the exceptions named?". Name kinds of facts, not facts you expect.`;

// The loop's prompt stays under ~100K tokens (Haiku 5.5's higher rate card): past 80K the API drops the oldest tool
// results, keeping the last 10 and every grid. Nothing is lost for the answer: grids and read documents go to the
// draft from run.docs and grids, not from the loop's messages. Each clear rewrites the cache once, hence 20K minimum.
const CLEAR_OLD_RESULTS = {
  edits: [{
    type: "clear_tool_uses_20250919",
    trigger: { type: "input_tokens", value: 80_000 },
    keep: { type: "tool_uses", value: 10 },
    clear_at_least: { type: "input_tokens", value: 20_000 },
    exclude_tools: [GRID_TOOL.name],
  }],
};

const TABLE_Q_SYSTEM = `Je maakt analysetabellen voor een juridische onderzoeksvraag. Splits de vraag in hooguit ${MAX_TABLES} deelvragen. Geef per deelvraag:
- 2 tot 4 vaste, korte vragen die je aan elk document over die deelvraag kunt stellen (bijvoorbeeld: wie kreeg een boete, hoe hoog, welk artikel is geschonden, wat was de uitkomst);
- de keys van de gelezen documenten die de deelvraag waarschijnlijk beantwoorden, de belangrijkste eerst, hooguit ${TABLE_DOCS}. Laat documenten weg die niet over de deelvraag gaan. Een document mag bij meer deelvragen horen.
Schrijf in het Nederlands.`;

const TABLE_SYSTEM = `Je vult een analysetabel. Beantwoord voor elk document elke vraag in één cel: een kort antwoord plus letterlijke citaten uit dat document die het antwoord dragen (elk woord voor woord overgenomen, hooguit twee zinnen, geen weglatingen). Noemt het document meer zaken, bedrijven of bedragen, noem ze dan allemaal in het antwoord, met per zaak een eigen citaat. Staat het antwoord niet in het document, zet dan answer op "niet in document" en quotes op []. Lange documenten zijn ingekort; dat staat in de tekst. Gebruik als doc de key van het document. Schrijf in het Nederlands.`;

const DRAFT_QUOTES = `Je schrijft het onderbouwde antwoord op een juridische onderzoeksvraag als lijst claims, voor een advocaat.
- Elke claim is één feitelijke bewering of conclusie in het Nederlands (text), met een letterlijk citaat (quote) uit één gelezen document dat de claim draagt, en de key van dat document (doc).
- Kopieer het citaat woord voor woord uit de documenttekst of de tabel: hooguit twee zinnen, geen weglatingen of eigen woorden.
- Gebruik alleen de documenten hieronder als bron.
- Kun je een deel van de vraag niet met een citaat onderbouwen, neem het dan op als claim met lege quote en lege doc: dat wordt een expliciet open punt.
- Dek alle deelvragen.
- Harde regel: niets gevonden is een open punt, geen conclusie. Schrijf nooit dat iets niet bestaat of alleen elders gebeurde omdat je er geen document over vond.
- laws: de BWB-regelingen die de vraag beantwoorden, de meest relevante eerst, elk met BWB-id, artikelnummers (beste eerst) en één zin waarom. Alleen regelingen die je in de documenten hebt gezien (keys bwb:<id>:<artikel>) of die de gelezen besluiten noemen.`;

const DRAFT_PLAIN = `Je beantwoordt een juridische onderzoeksvraag voor een advocaat, in het Nederlands, in markdown (kopjes en opsommingen waar dat helpt).
- Baseer je alleen op de documenten hieronder en noem bij elke bewering de bron bij naam (titel, ECLI of artikel, datum).
- Zeg expliciet wat je niet hebt gevonden. Verzin niets.
- Harde regel: niets gevonden is een open punt, geen conclusie. Schrijf nooit dat iets niet bestaat of alleen elders gebeurde omdat je er geen document over vond.
- laws: de BWB-regelingen die de vraag beantwoorden, de meest relevante eerst, elk met BWB-id, artikelnummers (beste eerst) en één zin waarom.`;

const FIX_SYSTEM = `Deze citaten staan niet letterlijk in hun brondocument, of dragen hun claim niet volledig. Geef per claim (i) een citaat dat wél woord voor woord in de getoonde tekst staat en de claim draagt, en pas de claimtekst zo nodig aan zodat die niet meer zegt dan het citaat. Staat er niets in de tekst dat de claim draagt, zet dan drop op true. Schrijf in het Nederlands.`;

const RENDER_SYSTEM = `Je schrijft het eindantwoord op een juridische onderzoeksvraag voor een advocaat, in het Nederlands, in markdown (kopjes en opsommingen waar dat helpt).
- Gebruik uitsluitend de genummerde claims. Zet na elke bewering het nummer van de claim(s) die haar dragen, bijvoorbeeld [3] of [2][5].
- Voeg geen feiten, bronnen of citaten toe die niet in de claims staan.
- Zet de open punten onder een kopje "Niet gevonden".
- Geen bronnenlijst: die wordt automatisch toegevoegd.`;

/**
 * One status line on stderr, redrawn in place every 0.5 s: a bar that fills left to right as steps finish, the step,
 * calls, documents, cost and time. Search loop 0-60%, tables 60-85%, draft 85-95%, check and answer the rest.
 */
function progress(run: Run) {
  const t0 = Date.now();
  const width = 30;
  const draw = () => {
    const filled = Math.round(run.progress * width);
    const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
    process.stderr.write(`\r${bar} ${String(Math.round(run.progress * 100)).padStart(3)}%  ${run.stage.padEnd(6)} ${run.apiCalls} calls  ${run.docs.size} docs  $${run.costUsd.toFixed(2)}  ${Math.round((Date.now() - t0) / 1000)}s `);
  };
  const timer = setInterval(draw, 500);
  return () => {
    clearInterval(timer);
    draw();
    process.stderr.write("\n");
  };
}

// ponytail: one global cap on table calls; run 10 hit the org's concurrent-request limit (429) at about 100. Run 4
// parallel grids ran up to about 24 fine. Raise it if the org tier allows more.
const TABLE_CONCURRENCY = 16;
let tablesRunning = 0;
const tableQueue: (() => void)[] = [];
async function tableSlot<T>(f: () => Promise<T>): Promise<T> {
  if (tablesRunning >= TABLE_CONCURRENCY) await new Promise<void>((r) => tableQueue.push(r));
  tablesRunning++;
  try {
    return await f();
  } finally {
    tablesRunning--;
    tableQueue.shift()?.();
  }
}

/** One analysis table: every question asked of every document, in batches of BATCH_CHARS; returned as markdown. */
async function fillTable(client: Anthropic, run: Run, qs: string[], picked: Doc[]) {
  const batches: Doc[][] = [[]];
  let size = 0;
  for (const d of picked) {
    const n = Math.min(d.text.length, DOC_CHARS);
    if (size + n > BATCH_CHARS && batches.at(-1)!.length) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1)!.push(d);
    size += n;
  }
  const qList = qs.map((q, i) => `${i + 1}. ${q}`).join("\n");
  // Parallel; on a rate limit (429) the SDK retries with backoff (maxRetries 2).
  const results = await Promise.all(batches.map((batch) => tableSlot(() =>
    ask<{ rows: { doc: string; cells: { answer: string; quotes: string[] }[] }[] }>(
      client, run, TABLE_SYSTEM,
      `Vragen:\n${qList}\n\n${batch.map((d) => docXml(d, DOC_CHARS)).join("\n\n")}`,
      obj({ rows: arr(obj({ doc: str, cells: arr(obj({ answer: str, quotes: arr(str) })) })) }),
      TABLE_MODEL,
      TABLE_EFFORT,
    ),
  )));
  return results
    .flatMap(({ rows }) => rows)
    .map((r) => `\n### ${r.doc} | ${run.docs.get(r.doc)?.title ?? ""}\n${r.cells.map((c, i) => `- ${qs[i] ?? `vraag ${i + 1}`}: ${c.answer}${c.quotes.map((q) => ` | "${q}"`).join("")}`).join("\n")}\n`)
    .join("");
}

/** analyze_documents: fetches the documents into run.docs and returns only their table. Never throws, like runTool. */
async function grid(client: Anthropic, run: Run, input: { questions: string[]; keys: string[] }, grids: string[], maxDocs = TABLE_DOCS) {
  try {
    const qs = input.questions.slice(0, 4);
    const t0 = Date.now();
    const got = await Promise.all([...new Set(input.keys)].slice(0, maxDocs).map((k) => fetchDoc(k, run).catch((e) => `Error: ${k}: ${e?.message ?? e}`)));
    const picked = got.filter((d): d is Doc => typeof d !== "string");
    const errors = got.filter((d): d is string => typeof d === "string");
    run.trace.push(`analyze_documents: ${qs.length} questions over ${picked.length} documents${errors.length ? `, ${errors.length} failed` : ""}, fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!qs.length || !picked.length) return [...errors, "Error: give 1-4 questions and at least one valid key."].join("\n");
    if (FLOW && qs.length > 1) {
      // Jev answers the first (relevance) question on the full text; the table only extracts the rest.
      const ps = await Promise.all(picked.map((d) => jevDoc(d.key, qs[0], run)));
      const out = picked.filter((_, i) => (ps[i] ?? 1) < GRID_P);
      run.trace.push(`grid filter "${qs[0]}": ${picked.map((d, i) => `${d.key} ${ps[i]?.toFixed(2) ?? "?"}`).join(", ")}`);
      picked.splice(0, picked.length, ...picked.filter((d) => !out.includes(d)));
      qs.shift();
      if (out.length) errors.push(`Not relevant by Jev (p < ${GRID_P}), skipped: ${out.map((d) => d.key).join(", ")}`);
      if (!picked.length) return errors.join("\n");
    }
    const table = `Vragen: ${qs.join(" / ")}\n${await fillTable(client, run, qs, picked)}`;
    grids.push(table);
    return [...errors, table].join("\n");
  } catch (e: any) {
    run.trace.push(`analyze_documents: error ${e?.message ?? e}`);
    return `Error: ${e?.message ?? e}`;
  }
}

export async function deepSearch(question: string, stages: Stages = ALL, client: Anthropic = anthropic()): Promise<DeepResult> {
  const run: Run = { docs: new Map(), trace: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }, apiCalls: 0, costUsd: 0, stage: "search", progress: 0 };
  const stop = progress(run);
  try {
    return await startActiveObservation("deep-search", async (root) => {
      root.update({ input: question, metadata: { stages, model: MODEL, loopModel: LOOP_MODEL, tableModel: TABLE_MODEL, effort: EFFORT, tableEffort: TABLE_EFFORT, draftModel: DRAFT_MODEL, draftEffort: DRAFT_EFFORT, jev: JEV, jevFlow: FLOW } });
      const result = await research(question, stages, client, run);
      root.update({ output: { answer: result.answer, costUsd: result.costUsd, apiCalls: result.apiCalls, ms: result.ms, docs: result.docs.length, quoteCheck: result.quoteCheck } });
      run.progress = 1;
      return result;
    }, { asType: "agent" });
  } finally {
    stop();
  }
}

const PLAN_SYSTEM = `You plan the research for a Dutch legal question for a lawyer, as a thorough senior associate would. You get one shot: your searches all run at once, the top hits of each sub-question are read by an assistant who answers your fixed questions for every document, and the answer is written from those tables. There are no follow-up searches, so cover every variant now.

Sources: ${(TOOLS[0] as any).description}
Also "laws": full-text search over all Dutch national legislation (BWB), plain keywords; returns articles.

Give 1-4 sub-questions. Per sub-question:
- searches: 4-8 queries, each with its sources. For acm and ap use broad bracketed boolean queries that cover synonyms and the formal vocabulary, for example (datalek OR inbreuk) AND (boete OR sanctie). For rechtspraak and kifid use 2-4 plain keywords (they AND every word), such as a party name plus the regulator. Include at least one rechtspraak search for appeals of the decisions, and one laws search when a statutory norm is asked.
- questions: 2-4 fixed questions asked of every document. First a relevance filter (yes or no, does this document decide or explain what the sub-question asks), then the facts a lawyer needs: who, when (the decision date from the text, not the publication date), what sanction or amount, which article, what outcome or appeal; for a norm, how the regulator reads it and the exceptions.`;

/** Moonlit-style search: one planning call, all searches in parallel, one grid per sub-question. */
async function planSearch(client: Anthropic, run: Run, question: string, grids: string[]) {
  run.stage = "plan";
  const names = [...Object.keys(SOURCES), "laws"];
  const { subquestions } = await ask<{ subquestions: { subquestion: string; searches: { query: string; sources: string[] }[]; questions: string[] }[] }>(
    client, run, PLAN_SYSTEM, question,
    obj({ subquestions: arr(obj({ subquestion: str, searches: arr(obj({ query: str, sources: arr({ type: "string", enum: names }) })), questions: arr(str) })) }),
    PLAN_MODEL,
  );
  return executePlan(client, run, subquestions, grids);
}

export type PlanPart = { subquestion: string; searches: { query: string; sources: string[] }[]; questions: string[] };

// Grid order: AP fine decisions first, then other documents, guidance and rulings, then laws, press releases and Woo
// disclosures (a press release ranks above its own decision, and a Woo page named "boete" is no decision). Run 10's
// turn-taking over all hit lists kept 5 of the 13 fine decisions in 25 slots.
const KIND = (k: string) =>
  /^ap:documenten\/(besluit-(op-bezwaar-)?)?boete/.test(k) ? 0
  : /^ap:(themas\/|documenten\/(?!wo[ob]-))|^acm:|^rechtspraak:|^kifid:/.test(k) ? 1
  : 2;

/** Runs a plan: all searches in parallel, then one grid per sub-question over its top PLAN_DOCS hits. */
export async function executePlan(client: Anthropic, run: Run, subquestions: PlanPart[], grids: string[]) {
  run.trace.push(`plan: ${subquestions.map((s) => `\n  - ${s.subquestion}${s.searches.map((q) => `\n      search [${q.sources}] ${q.query}`).join("")}${s.questions.map((q) => `\n      ask ${q}`).join("")}`).join("")}`);
  run.stage = "search";
  run.progress = 0.1;
  const notes: string[] = [];
  await Promise.all(subquestions.slice(0, MAX_TABLES).map(async (s) => {
    // Every query on every source in parallel; hit lists are interleaved, so each query's best hits come first.
    const lists = await Promise.all(s.searches.flatMap((q) => (q.sources.length ? q.sources : Object.keys(SOURCES)).map(async (src) => {
      try {
        const keys = src === "laws"
          ? (await searchText(q.query, 20)).map((r) => `bwb:${r.law_id}:${r.label}`)
          : (await SOURCES[src as Source].search(q.query, 30)).map((d) => `${src}:${d.id}`);
        run.trace.push(`search_sources "${q.query}" [${src}]: ${src} ${keys.length}`);
        return keys;
      } catch (e: any) {
        run.trace.push(`search_sources "${q.query}" [${src}]: error ${e?.message ?? e}`);
        return [];
      }
    })));
    const best = new Map<string, number>(); // key -> best rank in any list
    for (const l of lists) l.forEach((k, i) => best.set(k, Math.min(best.get(k) ?? i, i)));
    const keys = [...best.keys()].sort((a, b) => KIND(a) - KIND(b) || best.get(a)! - best.get(b)!).slice(0, PLAN_DOCS);
    run.trace.push(`plan grid "${s.subquestion.slice(0, 60)}": ${keys.filter((k) => KIND(k) === 0).length} decisions of ${keys.length}`);
    run.progress += 0.1 / Math.min(subquestions.length, MAX_TABLES);
    const table = await grid(client, run, { questions: s.questions, keys }, grids, PLAN_DOCS);
    notes.push(`### ${s.subquestion}\nZoekvragen: ${s.searches.map((q) => `[${q.sources}] ${q.query}`).join("; ")}\nGelezen in de tabel: ${keys.length} documenten${table.startsWith("Error") ? `\n${table}` : ""}`);
    run.progress += 0.4 / Math.min(subquestions.length, MAX_TABLES);
  }));
  return notes;
}

/** The independent parts of the question, each self-contained; just the question when it does not split. */
export async function split(client: Anthropic, run: Run, question: string) {
  const { parts } = FLOW
    ? await ask<{ parts: { question: string; checks: string[] }[] }>(client, run, SPLIT_SYSTEM + CHECKS_RULE, question, obj({ parts: arr(obj({ question: str, checks: arr(str) })) }), LOOP_MODEL)
    : { parts: (await ask<{ parts: string[] }>(client, run, SPLIT_SYSTEM, question, obj({ parts: arr(str) }), LOOP_MODEL)).parts.map((q) => ({ question: q, checks: [] as string[] })) };
  const kept = parts.map((p) => ({ question: p.question.trim(), checks: p.checks })).filter((p) => p.question).slice(0, MAX_TABLES);
  run.trace.push(`split: ${kept.length} parts${kept.map((p) => `\n  - ${p.question}${p.checks.map((c) => `\n      check: ${c}`).join("")}`).join("")}`);
  return kept.length > 1 ? kept : [{ question, checks: kept.flatMap((p) => p.checks) }];
}

/** The checklist items Jev does not find covered in the loop's notes and grids. */
async function gaps(run: Run, checks: string[], notes: string[], grids: string[]) {
  const state = { notes: notes.join("\n\n").slice(-60_000), tables: grids.join("\n").slice(-60_000) };
  const ps = await Promise.all(checks.map((c) => jev(state, `Do these research notes and tables answer this check? ${c}`, run)));
  run.trace.push(`gate: ${checks.map((c, i) => `${ps[i]?.toFixed(2) ?? "?"} ${c}`).join(" / ")}`);
  return checks.filter((_, i) => (ps[i] ?? 1) < GATE_P);
}

/** One search loop (loop=false: one round of tool calls); returns its notes and, for loop=false, the raw results. */
async function searchLoop(client: Anthropic, run: Run, stages: Stages, prompt: string, grids: string[], tag: string, checks: string[] = []) {
  const notes: string[] = [];
  let gateRounds = 0;
  let firstRound = "";
  const messages: any[] = [{ role: "user", content: prompt }];
  for (let turn = 0; ; turn++) {
    if (turn === MAX_TURNS) {
      run.trace.push(`turn cap reached${tag}`);
      break;
    }
    const msg = await call(client, run, { system: stages.grid ? LOOP_GRID_SYSTEM : LOOP_SYSTEM, tools: stages.grid ? GRID_TOOLS : TOOLS, cache_control: { type: "ephemeral" }, messages, betas: ["context-management-2025-06-27"], context_management: CLEAR_OLD_RESULTS }, LOOP_MODEL);
    messages.push({ role: "assistant", content: msg.content });
    const text = textOf(msg);
    if (text) {
      notes.push(text);
      run.trace.push(`text${tag}: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) {
      const open = FLOW && stages.loop && checks.length && gateRounds < GATE_ROUNDS ? await gaps(run, checks, notes, grids) : [];
      if (!open.length) break;
      gateRounds++;
      messages.push({ role: "user", content: `Not covered yet:\n${open.map((c) => `- ${c}`).join("\n")}\n\nSearch and grid further for these (try rechtspraak and the regulator's guidance pages), then end with a new note. If they truly have no answer in the sources, say so in the note.` });
      continue;
    }
    const results = await Promise.all(calls.map(async (c) => ({
      type: "tool_result",
      tool_use_id: c.id,
      content: await startActiveObservation(c.name, async (tool) => {
        tool.update({ input: c.input });
        const out = c.name === GRID_TOOL.name && stages.grid ? await grid(client, run, c.input as any, grids) : await runTool(c.name, c.input, run);
        tool.update({ output: out });
        return out;
      }, { asType: "tool" }),
    })));
    messages.push({ role: "user", content: results });
    // ponytail: the loop length is unknown, so the bar creeps towards 60% per turn; use the turn cap if that misleads.
    run.progress = Math.max(run.progress, (0.6 * (turn + 1)) / (turn + 7));
    if (!stages.loop) {
      firstRound = results.map((r) => r.content).join("\n\n");
      break;
    }
  }
  return { notes, firstRound };
}

async function research(question: string, stages: Stages, client: Anthropic, run: Run): Promise<DeepResult> {
  const t0 = Date.now();

  // 1. Search loops: one per independent part of the question, in parallel, sharing run.docs and grids.
  const grids: string[] = [];
  let notes: string[];
  let firstRound = "";
  if (PLAN) notes = await planSearch(client, run, question, grids);
  else {
  const parts = stages.split ? await split(client, run, question) : [{ question, checks: [] as string[] }];
  const branches = await Promise.all(parts.map(({ question: part, checks }, i) =>
    startActiveObservation(`loop ${i + 1}`, async (span) => {
      const prompt = parts.length > 1 ? `${part}\n\n(This is one part of the question below; other searches cover the other parts. Research only your part.)\n\n${question}` : question;
      span.update({ input: prompt });
      const branch = await searchLoop(client, run, stages, prompt, grids, parts.length > 1 ? ` ${i + 1}` : "", checks);
      span.update({ output: branch.notes.at(-1) });
      return branch;
    }, { asType: "agent" }),
  ));
  notes = branches.map((b, i) => (parts.length > 1 ? `### ${parts[i].question}\n${b.notes.join("\n\n")}` : b.notes.join("\n\n")));
  firstRound = branches.map((b) => b.firstRound).filter(Boolean).join("\n\n");
  }
  const loopCostUsd = run.costUsd;
  const docs = [...run.docs.values()];
  const index = docs.map((d) => `- ${d.key} | ${d.title}${d.date ? ` | ${d.date}` : ""}`).join("\n");

  run.stage = "tables";
  run.progress = 0.6;
  // 2. Tables, like Moonlit's analyze_documents: one per sub-question, with its 2-4 fixed questions asked only of the
  // documents that may answer it, one cell per document per question.
  // With the grid stage the loop's own grids are the tables, and every document it read is in one.
  let table = grids.map((g, i) => `\n## Grid ${i + 1}\n${g}`).join("");
  const inTable = new Set<string>(stages.grid ? docs.map((d) => d.key) : []);
  if (!stages.grid && stages.table && docs.length) {
    const { subquestions } = await ask<{ subquestions: { subquestion: string; questions: string[]; docs: string[] }[] }>(
      client, run, TABLE_Q_SYSTEM,
      `Vraag: ${question}\n\nAantekeningen uit het zoeken:\n${notes.join("\n\n")}\n\nGelezen documenten:\n${index}`,
      obj({ subquestions: arr(obj({ subquestion: str, questions: arr(str), docs: arr(str) })) }),
      TABLE_MODEL,
      TABLE_EFFORT,
    );
    // All tables in parallel, joined in sub-question order.
    const parts = await Promise.all(subquestions.slice(0, MAX_TABLES).map(async (s) => {
      const qs = s.questions.slice(0, 4);
      const picked = [...new Set(s.docs)].flatMap((k) => run.docs.get(k) ?? []).slice(0, TABLE_DOCS);
      for (const d of picked) inTable.add(d.key);
      run.trace.push(`table "${s.subquestion}": ${qs.length} questions over ${picked.length} documents`);
      if (!qs.length || !picked.length) return "";
      const part = `\n## ${s.subquestion}\nVragen: ${qs.join(" / ")}\n${await fillTable(client, run, qs, picked)}`;
      run.progress += 0.25 / Math.min(subquestions.length, MAX_TABLES);
      return part;
    }));
    table += parts.join("");
  }

  if (table) run.trace.push(`not in a table: ${docs.filter((d) => !inTable.has(d.key)).length} documents, given to the draft as text`);

  run.stage = "draft";
  run.progress = 0.85;
  // 3. Draft: claims with quotes, or a plain answer.
  const perDoc = Math.min(DOC_CHARS, Math.floor(DRAFT_CHARS / Math.max(docs.length, 1)));
  const material = [
    `Vraag: ${question}`,
    `Aantekeningen uit het zoeken:\n${notes.join("\n\n")}`,
    `Gelezen documenten:\n${index || "(geen)"}`,
    table ? `Analysetabel:\n${table}` : docs.map((d) => docXml(d, perDoc)).join("\n\n"),
    // Documents no table picked still reach the draft, so their facts are not lost.
    table && docs.some((d) => !inTable.has(d.key)) && `Overige gelezen documenten (niet in een tabel, ingekort):\n${docs.filter((d) => !inTable.has(d.key)).map((d) => docXml(d, REST_CHARS)).join("\n\n")}`,
    firstRound && `Zoekresultaten (alleen snippets, niet gelezen):\n${firstRound}`,
  ].filter(Boolean).join("\n\n");
  return finish(client, run, stages, question, material, docs, t0, loopCostUsd);
}

/** Steps 3-5: draft, quote check and answer from the draft material; run.docs must hold every document it cites. */
export async function finish(client: Anthropic, run: Run, stages: Stages, question: string, material: string, docs: Doc[], t0: number, loopCostUsd: number): Promise<DeepResult> {
  run.stage = "draft";
  run.progress = 0.85;
  const draft = await ask<{ claims?: Claim[]; answer?: string; laws: { id: string; articles: string[]; why: string }[] }>(
    client, run, stages.quotes ? DRAFT_QUOTES : DRAFT_PLAIN, material,
    obj(stages.quotes ? { claims: arr(obj({ text: str, quote: str, doc: str })), laws: LAWS } : { answer: str, laws: LAWS }),
    DRAFT_MODEL,
    DRAFT_EFFORT,
  );
  const lawTitle = (id: string) => docs.find((d) => d.source === "bwb" && d.id.startsWith(`${id}:`))?.title.split(", art. ")[0] ?? "";
  const laws = draft.laws
    .filter((l) => /^BWB[RV]\d{7}$/.test(l.id))
    .map((l) => ({ id: l.id, title: lawTitle(l.id), articles: [...new Set(l.articles.map(normLabel))], why: l.why }));
  run.trace.push(`laws: ${laws.map((l) => l.id).join(", ")}`);
  const result = { docs: docs.map(({ key, title, url, source }) => ({ key, title, url, source })), laws, trace: run.trace, usage: run.usage, loopCostUsd };
  if (!stages.quotes) return { ...result, answer: draft.answer ?? "", claims: [], costUsd: run.costUsd, apiCalls: run.apiCalls, ms: Date.now() - t0 };

  const claims = draft.claims!.filter((c) => c.quote.trim() && run.docs.has(c.doc));
  const gaps = draft.claims!.filter((c) => !claims.includes(c)).map((c) => c.text);

  run.stage = "check";
  run.progress = 0.95;
  // 4. Quote check: verbatim match, one fix round for failures, drop what still fails.
  let quoteCheck: DeepResult["quoteCheck"];
  if (stages.check) {
    for (const c of claims) c.ok = checkQuote(c.quote, run.docs.get(c.doc)!.text);
    let unsupported = 0;
    if (FLOW && SUPPORT) {
      // A verbatim quote can still not carry its claim (run 7: Booking's own date stated as the AP's finding).
      const verbatim = claims.filter((c) => c.ok);
      const ps = await Promise.all(verbatim.map((c) => jev({ claim: c.text, quote: c.quote, source: run.docs.get(c.doc)!.title }, "Does the quote support the claim?", run, SUPPORT_CRITERIA)));
      verbatim.forEach((c, i) => { if ((ps[i] ?? 1) < SUPPORT_P) { c.ok = false; unsupported++; } });
      run.trace.push(`support check: ${unsupported} of ${verbatim.length} quotes do not carry their claim`);
    }
    const failed = claims.filter((c) => !c.ok);
    quoteCheck = { passed: claims.length - failed.length, failed: failed.length, fixed: 0, dropped: 0, ...(FLOW && { unsupported }) };
    if (failed.length) {
      const { fixes } = await ask<{ fixes: { i: number; text: string; quote: string; drop: boolean }[] }>(
        client, run, FIX_SYSTEM,
        failed.map((c, i) => `## Claim ${i}\nClaim: ${c.text}\nCitaat (niet gevonden, of draagt de claim niet): ${c.quote}\nTekst uit ${c.doc} rond de beste gedeeltelijke match:\n${around(c.quote, run.docs.get(c.doc)!.text)}`).join("\n\n"),
        obj({ fixes: arr(obj({ i: { type: "integer" }, text: str, quote: str, drop: { type: "boolean" } })) }),
      );
      for (const f of fixes) {
        const c = failed[f.i];
        if (!c || f.drop) continue;
        Object.assign(c, { text: f.text || c.text, quote: f.quote, ok: checkQuote(f.quote, run.docs.get(c.doc)!.text) });
        if (c.ok) quoteCheck.fixed++;
      }
      quoteCheck.dropped = failed.filter((c) => !c.ok).length;
    }
    run.trace.push(`quote check: ${JSON.stringify(quoteCheck)}`);
  }

  run.stage = "answer";
  run.progress = 0.97;
  // Render the answer from the surviving claims, with a sources list built here (not by the model).
  const kept = claims.filter((c) => c.ok !== false);
  const body = textOf(await call(client, run, {
    system: RENDER_SYSTEM,
    messages: [{
      role: "user",
      content: `Vraag: ${question}\n\nClaims:\n${kept.map((c, i) => `[${i + 1}] ${c.text}\n    Citaat: "${c.quote}" (${run.docs.get(c.doc)!.title})`).join("\n") || "(geen)"}\n\nOpen punten:\n${gaps.map((g) => `- ${g}`).join("\n") || "(geen)"}`,
    }],
  }));
  const sources = kept.map((c, i) => {
    const d = run.docs.get(c.doc)!;
    return `${i + 1}. ${d.title}${d.date ? `, ${d.date}` : ""}: "${c.quote}"${d.url ? ` ${d.url}` : ""}`;
  });
  return { ...result, answer: `${body}\n\n## Bronnen\n${sources.join("\n")}`, claims, costUsd: run.costUsd, apiCalls: run.apiCalls, ms: Date.now() - t0, quoteCheck };
}

/** For benchmarks/law_retrieval/run.ts (law@5): deep search with every stage, laws as hits. */
export async function search(question: string, client: Anthropic = anthropic()) {
  const r = await deepSearch(question, ALL, client);
  return { hits: r.laws, usage: r.usage, apiCalls: r.apiCalls, trace: r.trace };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const stages = Object.fromEntries(Object.keys(ALL).map((k) => [k, !args.includes(`--no-${k}`)])) as Stages;
  const stopTracing = startTracing();
  try {
    console.log(JSON.stringify(await deepSearch(args.filter((a) => !a.startsWith("--")).join(" "), stages), null, 2));
  } finally {
    await stopTracing();
    await pool.end();
  }
}
