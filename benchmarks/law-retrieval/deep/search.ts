/**
 * Deep search: an agentic loop over the BWB and the source connectors (tools.ts), then a table step, a draft with
 * verbatim quotes and a deterministic quote check (quotes.ts). Each stage can be switched off to measure what it adds.
 * With the grid stage (default) the loop reads only through analyze_documents, like Moonlit: document texts stay out
 * of the loop context and its tables replace the table step. --no-grid gives the old loop with read_document.
 * Plan: model-improvements/deep-search.md
 *
 *   node --no-warnings --import ./benchmarks/law-retrieval/resolve-ts.mjs benchmarks/law-retrieval/deep/search.ts [--no-loop] [--no-grid] [--no-table] [--no-quotes] [--no-check] "<vraag>"
 *
 * DEEP_MODEL (default claude-opus-5-5) and DEEP_EFFORT (default high) override the model; DEEP_LOOP_MODEL (default
 * DEEP_MODEL) sets the model of the search loop only, DEEP_TABLE_MODEL (default DEEP_MODEL) that of the table step.
 * With LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY set, each run is traced in Langfuse (app/src/lib/langfuse.ts).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../../../app/src/lib/ai.ts";
import { pickEffort, supportsEffort } from "../../../app/src/lib/models.ts";
import { normLabel, pool } from "../../../app/src/lib/lawsearch/fulltext.ts";
import { TOOLS, GRID_TOOL, fetchDoc, runTool, type Ctx, type Doc } from "./tools.ts";
import { checkQuote, normalize } from "./quotes.ts";
import { openaiMessage } from "./openai.ts";
import { startActiveObservation, startObservation, startTracing } from "../../../app/src/lib/langfuse.ts";

export type Stages = { loop: boolean; grid: boolean; table: boolean; quotes: boolean; check: boolean };
export const ALL: Stages = { loop: true, grid: true, table: true, quotes: true, check: true };
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
  quoteCheck?: { passed: number; failed: number; fixed: number; dropped: number };
};

export const MODEL = process.env.DEEP_MODEL ?? "claude-opus-5-5";
export const LOOP_MODEL = process.env.DEEP_LOOP_MODEL ?? MODEL;
export const TABLE_MODEL = process.env.DEEP_TABLE_MODEL ?? MODEL;
export const EFFORT = pickEffort(process.env.DEEP_EFFORT) ?? "high";
// ponytail: runaway guard only, no search budget (we compare with Moonlit); add a budget before this moves into the app.
const MAX_TURNS = 100;
const MAX_TABLES = 4; // sub-questions, one table each (Moonlit: 8 tables for 5 questions)
const TABLE_DOCS = 12; // documents per table (Moonlit: 6-12)
const REST_CHARS = 8_000; // per document that no table picked, given to the draft as text
const DOC_CHARS = 30_000; // per document in a table call
const BATCH_CHARS = 120_000; // documents per table call
const DRAFT_CHARS = 400_000; // all document text in the draft when the table step is off
// Haiku 4.5 rejects effort; Haiku models have no server-side fallback.
const base = (model: string) => ({
  ...(model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
  output_config: supportsEffort(model) ? { effort: EFFORT } : {},
});

// USD per 1M tokens: fresh input, cache read, 5-minute cache write, output. Haiku 5.5 has a second rate card above
// 100K prompt tokens.
type Price = { in: number; read: number; write: number; out: number };
const PRICES: Record<string, Price | ((prompt: number) => Price)> = {
  "claude-opus-5-5": { in: 4, read: 0.2, write: 5, out: 20 },
  "claude-haiku-5-5": (prompt) => (prompt > 100_000 ? { in: 0.5, read: 0.05, write: 0.625, out: 2.5 } : { in: 0.1, read: 0.01, write: 0.125, out: 0.5 }),
  // OpenAI has no cache-write charge; prompts above 272K input tokens pay 2x input and 1.5x output.
  "gpt-6.1-sol": (prompt) => (prompt > 272_000 ? { in: 4, read: 0.2, write: 4, out: 15 } : { in: 2, read: 0.1, write: 2, out: 10 }),
};

type Run = Ctx & { usage: DeepResult["usage"]; apiCalls: number; costUsd: number; stage: string; progress: number };

// Streams, so long outputs don't hit the SDK's 10-minute limit for plain requests.
async function call(client: Anthropic, run: Run, params: Record<string, any>, model = MODEL) {
  const b = base(model);
  const t0 = Date.now();
  // Named after the step; the input is the newest message only (the loop repeats the whole history every call).
  const gen = startObservation(run.stage, { model, input: params.messages?.at(-1)?.content, modelParameters: supportsEffort(model) ? { effort: EFFORT } : {} }, { asType: "generation" });
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = model.startsWith("gpt-")
      ? ((await openaiMessage({ max_tokens: 64000, ...params }, model, EFFORT)) as any as Anthropic.Beta.BetaMessage)
      : await client.beta.messages
          .stream({ model, max_tokens: 64000, ...b, ...params, output_config: { ...b.output_config, ...params.output_config } } as any)
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
  if (msg.stop_reason === "refusal") throw new Error("model refused");
  if (msg.stop_reason === "max_tokens") throw new Error(`max_tokens reached after: ${run.trace.at(-1) ?? "start"}`);
  return msg;
}

const textOf = (msg: Anthropic.Beta.BetaMessage) => msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();

async function ask<T>(client: Anthropic, run: Run, system: string, content: string, schema: object, model = MODEL): Promise<T> {
  return JSON.parse(textOf(await call(client, run, { system, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema } } }, model)));
}

const str = { type: "string" };
const arr = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const LAWS = arr(obj({ id: str, articles: arr(str), why: str }));

/** Head and tail of a long text (rulings put the decision at the end), with a note that it was cut. */
function clip(text: string, max: number) {
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
2. Search broadly and in parallel: make several tool calls in one turn, with different keywords, synonyms and the formal legal vocabulary.
3. Read the promising documents (read_document, read_law). Read long documents further with offset where the relevant parts are.
4. Follow leads: use what you found (party names, case numbers, ECLI's, article numbers, the documents' own terms) for new searches, and read the articles that decisions say were breached.
5. Stop only when new searches turn up nothing new for any sub-question. There is no budget: being thorough matters more than being fast.

End with a short note and no tool calls: the sub-questions, the key documents (by key) per sub-question, and what you could not find. Do not write the final answer; later steps write it from the documents you read. Only documents you read count as sources.

Hard rule: a search that finds nothing proves nothing. Report it as a gap ("not found in <source>"); never conclude from it that something doesn't exist or only happened elsewhere.`;

// Grid stage: the loop reads through analyze_documents and never sees document texts.
const LOOP_GRID_SYSTEM = LOOP_SYSTEM.replace(
  /^3\. .*$/m,
  "3. Read through analyze_documents: put the promising hits in one grid with 1-4 fixed questions (for example who, what sanction or amount, which article, what outcome). You see only the answers and quotes, never the full text. Then run small grids on just the documents with gaps, for example a missing article or amount.",
).replace("Only documents you read count as sources.", "Only documents in a grid count as sources.");
const GRID_TOOLS = [...TOOLS.filter((t) => t.name.startsWith("search_")), GRID_TOOL];

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

const FIX_SYSTEM = `Deze citaten staan niet letterlijk in hun brondocument. Geef per claim (i) een citaat dat wél woord voor woord in de getoonde tekst staat en de claim draagt, en pas de claimtekst zo nodig aan zodat die niet meer zegt dan het citaat. Staat er niets in de tekst dat de claim draagt, zet dan drop op true. Schrijf in het Nederlands.`;

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
  const results = await Promise.all(batches.map((batch) =>
    ask<{ rows: { doc: string; cells: { answer: string; quotes: string[] }[] }[] }>(
      client, run, TABLE_SYSTEM,
      `Vragen:\n${qList}\n\n${batch.map((d) => docXml(d, DOC_CHARS)).join("\n\n")}`,
      obj({ rows: arr(obj({ doc: str, cells: arr(obj({ answer: str, quotes: arr(str) })) })) }),
      TABLE_MODEL,
    ),
  ));
  return results
    .flatMap(({ rows }) => rows)
    .map((r) => `\n### ${r.doc} | ${run.docs.get(r.doc)?.title ?? ""}\n${r.cells.map((c, i) => `- ${qs[i] ?? `vraag ${i + 1}`}: ${c.answer}${c.quotes.map((q) => ` | "${q}"`).join("")}`).join("\n")}\n`)
    .join("");
}

/** analyze_documents: fetches the documents into run.docs and returns only their table. Never throws, like runTool. */
async function grid(client: Anthropic, run: Run, input: { questions: string[]; keys: string[] }, grids: string[]) {
  try {
    const qs = input.questions.slice(0, 4);
    const t0 = Date.now();
    const got = await Promise.all([...new Set(input.keys)].slice(0, TABLE_DOCS).map((k) => fetchDoc(k, run).catch((e) => `Error: ${k}: ${e?.message ?? e}`)));
    const picked = got.filter((d): d is Doc => typeof d !== "string");
    const errors = got.filter((d): d is string => typeof d === "string");
    run.trace.push(`analyze_documents: ${qs.length} questions over ${picked.length} documents${errors.length ? `, ${errors.length} failed` : ""}, fetched in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!qs.length || !picked.length) return [...errors, "Error: give 1-4 questions and at least one valid key."].join("\n");
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
      root.update({ input: question, metadata: { stages, model: MODEL, loopModel: LOOP_MODEL, tableModel: TABLE_MODEL, effort: EFFORT } });
      const result = await research(question, stages, client, run);
      root.update({ output: { answer: result.answer, costUsd: result.costUsd, apiCalls: result.apiCalls, ms: result.ms, docs: result.docs.length, quoteCheck: result.quoteCheck } });
      run.progress = 1;
      return result;
    }, { asType: "agent" });
  } finally {
    stop();
  }
}

async function research(question: string, stages: Stages, client: Anthropic, run: Run): Promise<DeepResult> {
  const t0 = Date.now();

  // 1. Search loop (loop=false: one round of tool calls).
  const notes: string[] = [];
  const grids: string[] = [];
  let firstRound = "";
  const messages: any[] = [{ role: "user", content: question }];
  for (let turn = 0; ; turn++) {
    if (turn === MAX_TURNS) {
      run.trace.push("turn cap reached");
      break;
    }
    const msg = await call(client, run, { system: stages.grid ? LOOP_GRID_SYSTEM : LOOP_SYSTEM, tools: stages.grid ? GRID_TOOLS : TOOLS, cache_control: { type: "ephemeral" }, messages }, LOOP_MODEL);
    messages.push({ role: "assistant", content: msg.content });
    const text = textOf(msg);
    if (text) {
      notes.push(text);
      run.trace.push(`text: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) break;
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
    run.progress = (0.6 * (turn + 1)) / (turn + 7);
    if (!stages.loop) {
      firstRound = results.map((r) => r.content).join("\n\n");
      break;
    }
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
  const draft = await ask<{ claims?: Claim[]; answer?: string; laws: { id: string; articles: string[]; why: string }[] }>(
    client, run, stages.quotes ? DRAFT_QUOTES : DRAFT_PLAIN, material,
    obj(stages.quotes ? { claims: arr(obj({ text: str, quote: str, doc: str })), laws: LAWS } : { answer: str, laws: LAWS }),
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
    const failed = claims.filter((c) => !c.ok);
    quoteCheck = { passed: claims.length - failed.length, failed: failed.length, fixed: 0, dropped: 0 };
    if (failed.length) {
      const { fixes } = await ask<{ fixes: { i: number; text: string; quote: string; drop: boolean }[] }>(
        client, run, FIX_SYSTEM,
        failed.map((c, i) => `## Claim ${i}\nClaim: ${c.text}\nCitaat (niet gevonden): ${c.quote}\nTekst uit ${c.doc} rond de beste gedeeltelijke match:\n${around(c.quote, run.docs.get(c.doc)!.text)}`).join("\n\n"),
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

/** For benchmarks/law-retrieval/run.ts (law@5): deep search with every stage, laws as hits. */
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
