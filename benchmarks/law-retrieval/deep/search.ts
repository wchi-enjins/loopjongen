/**
 * Deep search: an agentic loop over the BWB and the source connectors (tools.ts), then a table step, a draft with
 * verbatim quotes and a deterministic quote check (quotes.ts). Each stage can be switched off to measure what it adds.
 * Plan: model-improvements/deep-search.md
 *
 *   node --no-warnings --import ./benchmarks/law-retrieval/resolve-ts.mjs benchmarks/law-retrieval/deep/search.ts [--no-loop] [--no-table] [--no-quotes] [--no-check] "<vraag>"
 *
 * DEEP_MODEL (default claude-opus-5-5) and DEEP_EFFORT (default high) override the model.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../../../app/src/lib/ai.ts";
import { pickEffort, supportsEffort } from "../../../app/src/lib/models.ts";
import { normLabel, pool } from "../../../app/src/lib/lawsearch/fulltext.ts";
import { TOOLS, runTool, type Ctx, type Doc } from "./tools.ts";
import { checkQuote, normalize } from "./quotes.ts";

export type Stages = { loop: boolean; table: boolean; quotes: boolean; check: boolean };
export const ALL: Stages = { loop: true, table: true, quotes: true, check: true };
export type Claim = { text: string; quote: string; doc: string; ok?: boolean }; // doc = Ctx key
export type DeepResult = {
  answer: string;
  claims: Claim[];
  docs: { key: string; title: string; url: string; source: string }[];
  laws: { id: string; title: string; articles: string[]; why: string }[];
  trace: string[];
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number }; // input_tokens includes cache reads
  apiCalls: number;
  ms: number;
  quoteCheck?: { passed: number; failed: number; fixed: number; dropped: number };
};

const MODEL = process.env.DEEP_MODEL ?? "claude-opus-5-5";
const EFFORT = pickEffort(process.env.DEEP_EFFORT) ?? "high";
// ponytail: runaway guard only, no search budget (we compare with Moonlit); add a budget before this moves into the app.
const MAX_TURNS = 100;
const DOC_CHARS = 30_000; // per document in a table call
const BATCH_CHARS = 120_000; // documents per table call
const DRAFT_CHARS = 400_000; // all document text in the draft when the table step is off
// Haiku 4.5 rejects effort and the server-side fallback beta.
const BASE = supportsEffort(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: EFFORT } } : { output_config: {} };

type Run = Ctx & { usage: DeepResult["usage"]; apiCalls: number };

// Streams, so long outputs don't hit the SDK's 10-minute limit for plain requests.
async function call(client: Anthropic, run: Run, params: Record<string, any>) {
  const msg = await client.beta.messages
    .stream({ model: MODEL, max_tokens: 64000, ...BASE, ...params, output_config: { ...BASE.output_config, ...params.output_config } } as any)
    .finalMessage();
  run.apiCalls++;
  const u = msg.usage;
  run.usage.input_tokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  run.usage.output_tokens += u.output_tokens;
  run.usage.cache_read_tokens += u.cache_read_input_tokens ?? 0;
  if (msg.stop_reason === "refusal") throw new Error("model refused");
  if (msg.stop_reason === "max_tokens") throw new Error(`max_tokens reached after: ${run.trace.at(-1) ?? "start"}`);
  return msg;
}

const textOf = (msg: Anthropic.Beta.BetaMessage) => msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();

async function ask<T>(client: Anthropic, run: Run, system: string, content: string, schema: object): Promise<T> {
  return JSON.parse(textOf(await call(client, run, { system, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema } } })));
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

End with a short note and no tool calls: the sub-questions, the key documents (by key) per sub-question, and what you could not find. Do not write the final answer; later steps write it from the documents you read. Only documents you read count as sources.`;

const TABLE_Q_SYSTEM = `Je maakt een analysetabel voor een juridische onderzoeksvraag. Splits de vraag in deelvragen en schrijf per deelvraag 2 tot 4 vaste, korte vragen die je aan elk gevonden document kunt stellen (bijvoorbeeld: wie kreeg een boete, hoe hoog, welk artikel is geschonden, wat was de uitkomst). Schrijf in het Nederlands.`;

const TABLE_SYSTEM = `Je vult een analysetabel. Beantwoord voor elk document elke vraag in één cel: een kort antwoord plus een letterlijk citaat uit dat document dat het antwoord draagt (woord voor woord overgenomen, hooguit twee zinnen, geen weglatingen). Staat het antwoord niet in het document, zet dan answer op "niet in document" en quote op "". Lange documenten zijn ingekort; dat staat in de tekst. Gebruik als doc de key van het document. Schrijf in het Nederlands.`;

const DRAFT_QUOTES = `Je schrijft het onderbouwde antwoord op een juridische onderzoeksvraag als lijst claims, voor een advocaat.
- Elke claim is één feitelijke bewering of conclusie in het Nederlands (text), met een letterlijk citaat (quote) uit één gelezen document dat de claim draagt, en de key van dat document (doc).
- Kopieer het citaat woord voor woord uit de documenttekst of de tabel: hooguit twee zinnen, geen weglatingen of eigen woorden.
- Gebruik alleen de documenten hieronder als bron.
- Kun je een deel van de vraag niet met een citaat onderbouwen, neem het dan op als claim met lege quote en lege doc: dat wordt een expliciet open punt.
- Dek alle deelvragen.
- laws: de BWB-regelingen die de vraag beantwoorden, de meest relevante eerst, elk met BWB-id, artikelnummers (beste eerst) en één zin waarom. Alleen regelingen die je in de documenten hebt gezien (keys bwb:<id>:<artikel>) of die de gelezen besluiten noemen.`;

const DRAFT_PLAIN = `Je beantwoordt een juridische onderzoeksvraag voor een advocaat, in het Nederlands, in markdown (kopjes en opsommingen waar dat helpt).
- Baseer je alleen op de documenten hieronder en noem bij elke bewering de bron bij naam (titel, ECLI of artikel, datum).
- Zeg expliciet wat je niet hebt gevonden. Verzin niets.
- laws: de BWB-regelingen die de vraag beantwoorden, de meest relevante eerst, elk met BWB-id, artikelnummers (beste eerst) en één zin waarom.`;

const FIX_SYSTEM = `Deze citaten staan niet letterlijk in hun brondocument. Geef per claim (i) een citaat dat wél woord voor woord in de getoonde tekst staat en de claim draagt, en pas de claimtekst zo nodig aan zodat die niet meer zegt dan het citaat. Staat er niets in de tekst dat de claim draagt, zet dan drop op true. Schrijf in het Nederlands.`;

const RENDER_SYSTEM = `Je schrijft het eindantwoord op een juridische onderzoeksvraag voor een advocaat, in het Nederlands, in markdown (kopjes en opsommingen waar dat helpt).
- Gebruik uitsluitend de genummerde claims. Zet na elke bewering het nummer van de claim(s) die haar dragen, bijvoorbeeld [3] of [2][5].
- Voeg geen feiten, bronnen of citaten toe die niet in de claims staan.
- Zet de open punten onder een kopje "Niet gevonden".
- Geen bronnenlijst: die wordt automatisch toegevoegd.`;

export async function deepSearch(question: string, stages: Stages = ALL, client: Anthropic = anthropic()): Promise<DeepResult> {
  const t0 = Date.now();
  const run: Run = { docs: new Map(), trace: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }, apiCalls: 0 };

  // 1. Search loop (loop=false: one round of tool calls).
  const notes: string[] = [];
  let firstRound = "";
  const messages: any[] = [{ role: "user", content: question }];
  for (let turn = 0; ; turn++) {
    if (turn === MAX_TURNS) {
      run.trace.push("turn cap reached");
      break;
    }
    const msg = await call(client, run, { system: LOOP_SYSTEM, tools: TOOLS, cache_control: { type: "ephemeral" }, messages });
    messages.push({ role: "assistant", content: msg.content });
    const text = textOf(msg);
    if (text) {
      notes.push(text);
      run.trace.push(`text: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) break;
    const results = await Promise.all(calls.map(async (c) => ({ type: "tool_result", tool_use_id: c.id, content: await runTool(c.name, c.input, run) })));
    messages.push({ role: "user", content: results });
    if (!stages.loop) {
      firstRound = results.map((r) => r.content).join("\n\n");
      break;
    }
  }
  const docs = [...run.docs.values()];
  const index = docs.map((d) => `- ${d.key} | ${d.title}${d.date ? ` | ${d.date}` : ""}`).join("\n");

  // 2. Table: fixed questions per sub-question, one cell per document per question.
  let table = "";
  if (stages.table && docs.length) {
    const { subquestions } = await ask<{ subquestions: { subquestion: string; questions: string[] }[] }>(
      client, run, TABLE_Q_SYSTEM,
      `Vraag: ${question}\n\nAantekeningen uit het zoeken:\n${notes.join("\n\n")}\n\nGelezen documenten:\n${index}`,
      obj({ subquestions: arr(obj({ subquestion: str, questions: arr(str) })) }),
    );
    const qs = subquestions.flatMap((s) => s.questions);
    run.trace.push(`table: ${qs.length} questions over ${docs.length} documents`);
    const batches: Doc[][] = [[]];
    let size = 0;
    for (const d of docs) {
      const n = Math.min(d.text.length, DOC_CHARS);
      if (size + n > BATCH_CHARS && batches.at(-1)!.length) {
        batches.push([]);
        size = 0;
      }
      batches.at(-1)!.push(d);
      size += n;
    }
    const qList = qs.map((q, i) => `${i + 1}. ${q}`).join("\n");
    for (const batch of batches) {
      // sequential: many parallel high-effort calls run into rate limits
      const { rows } = await ask<{ rows: { doc: string; cells: { answer: string; quote: string }[] }[] }>(
        client, run, TABLE_SYSTEM,
        `Vragen:\n${qList}\n\n${batch.map((d) => docXml(d, DOC_CHARS)).join("\n\n")}`,
        obj({ rows: arr(obj({ doc: str, cells: arr(obj({ answer: str, quote: str })) })) }),
      );
      for (const r of rows)
        table += `\n### ${r.doc} | ${run.docs.get(r.doc)?.title ?? ""}\n${r.cells.map((c, i) => `- ${qs[i] ?? `vraag ${i + 1}`}: ${c.answer}${c.quote ? ` | "${c.quote}"` : ""}`).join("\n")}\n`;
    }
    table = `Vragen per deelvraag:\n${subquestions.map((s) => `- ${s.subquestion}: ${s.questions.join(" / ")}`).join("\n")}\n${table}`;
  }

  // 3. Draft: claims with quotes, or a plain answer.
  const perDoc = Math.min(DOC_CHARS, Math.floor(DRAFT_CHARS / Math.max(docs.length, 1)));
  const material = [
    `Vraag: ${question}`,
    `Aantekeningen uit het zoeken:\n${notes.join("\n\n")}`,
    `Gelezen documenten:\n${index || "(geen)"}`,
    table ? `Analysetabel:\n${table}` : docs.map((d) => docXml(d, perDoc)).join("\n\n"),
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
  const result = { docs: docs.map(({ key, title, url, source }) => ({ key, title, url, source })), laws, trace: run.trace, usage: run.usage };
  if (!stages.quotes) return { ...result, answer: draft.answer ?? "", claims: [], apiCalls: run.apiCalls, ms: Date.now() - t0 };

  const claims = draft.claims!.filter((c) => c.quote.trim() && run.docs.has(c.doc));
  const gaps = draft.claims!.filter((c) => !claims.includes(c)).map((c) => c.text);

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
  return { ...result, answer: `${body}\n\n## Bronnen\n${sources.join("\n")}`, claims, apiCalls: run.apiCalls, ms: Date.now() - t0, quoteCheck };
}

/** For benchmarks/law-retrieval/run.ts (law@5): deep search with every stage, laws as hits. */
export async function search(question: string, client: Anthropic = anthropic()) {
  const r = await deepSearch(question, ALL, client);
  return { hits: r.laws, usage: r.usage, apiCalls: r.apiCalls, trace: r.trace };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const stages = Object.fromEntries(Object.keys(ALL).map((k) => [k, !args.includes(`--no-${k}`)])) as Stages;
  try {
    console.log(JSON.stringify(await deepSearch(args.filter((a) => !a.startsWith("--")).join(" "), stages), null, 2));
  } finally {
    await pool.end();
  }
}
