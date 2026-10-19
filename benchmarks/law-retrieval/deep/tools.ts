/**
 * Deep search tools: search and read ACM, AP, Kifid, rechtspraak (app/src/lib/sources) and the BWB (bwb_article index).
 * Every document read is kept in full in ctx.docs, so quotes can be checked against the complete source text.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { SOURCES, getSourceDoc, type Source } from "../../../app/src/lib/sources/index.ts";
import { normLabel, pool, searchText } from "../../../app/src/lib/lawsearch/fulltext.ts";

export type Doc = { key: string; source: Source | "bwb"; id: string; title: string; url: string; date: string; text: string };
export type Ctx = { docs: Map<string, Doc>; trace: string[] }; // key = "<source>:<id>"; bwb articles: "bwb:<lawId>:<label>"

const NAMES = Object.keys(SOURCES) as Source[];
// ponytail: fixed window per read; the model pages on with offset, the full text stays in ctx.docs.
const MAX_RESULT_CHARS = 30_000;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_sources",
    description:
      "Keyword search in Dutch regulator decisions and case law. Sources: acm = ACM (competition/consumer authority) decisions and press releases; ap = Autoriteit Persoonsgegevens (data protection authority) decisions, fines and guidance; kifid = Kifid financial services complaint rulings (full-text search); rechtspraak = Dutch court rulings (full-text search). ACM search is full text over ACM's publications and their decision PDFs, in web-search syntax: words are ANDed, 'or' between words, \"quoted phrase\", -word to exclude; or a bracketed boolean query such as (afteltimer OR \"aftellende klok\") AND (boete OR sanctie), so one broad query can replace many narrow ones (publications not indexed yet match on title only). AP search mainly matches titles, so use short title-like Dutch keywords there (1-3 words, e.g. 'boete cookies'); all words usually must match. Returns per source up to 10 hits as key | title | date | snippet; pass keys to read_document or analyze_documents.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short Dutch keywords." },
        sources: { type: "array", items: { type: "string", enum: NAMES }, description: "Optional subset; default all four." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_laws",
    description:
      "Full-text search (Dutch stemming) over every article of all Dutch national legislation in force (BWB: wetten, AMvB's, ministeriële regelingen, beleidsregels). Query syntax is web-search style: words are ANDed, 'or' between words, \"quoted phrase\", -word to exclude. Returns up to 20 articles as law id | law title | article label | snippet; pass law id and labels to read_law.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "read_document",
    description: `Full text of a document from search_sources (or a bwb key from read_law), by its key, e.g. 'acm:<slug>', 'kifid:<slug>', 'rechtspraak:ECLI:NL:HR:2023:778'. ACM and AP include their attached decision PDFs. Long texts are cut at ${MAX_RESULT_CHARS} characters; pass offset to read further. Quote only text you have read here.`,
    input_schema: {
      type: "object",
      properties: { key: { type: "string" }, offset: { type: "integer", description: "Character offset to start from (default 0)." } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "read_law",
    description: "Full text of articles of one BWB regulation, by law id (e.g. 'BWBR0005290') and article labels as shown by search_laws (e.g. '6:193b', '11.7a'). Each article is stored as document 'bwb:<law id>:<label>'.",
    input_schema: {
      type: "object",
      properties: { law_id: { type: "string" }, articles: { type: "array", items: { type: "string" } } },
      required: ["law_id", "articles"],
      additionalProperties: false,
    },
  },
];

/** Moonlit-style grid: reads documents for the loop and returns only answers with quotes. Run in search.ts. */
export const GRID_TOOL: Anthropic.Beta.BetaTool = {
  name: "analyze_documents",
  description:
    "Reads up to 12 documents for you and answers 1-4 fixed questions for each, as a table: one row per document, each cell a short answer with verbatim quotes; a document about several cases or companies gets one quote per case. You see only the table, not the document text. Keys come from search_sources, or are 'bwb:<law id>:<article label>' for law articles from search_laws (e.g. 'bwb:BWBR0005290:6:193g'). Start with a broad grid over the promising hits, then run small grids to fill gaps (a missing article, amount or outcome).",
  input_schema: {
    type: "object",
    properties: {
      questions: { type: "array", items: { type: "string" }, description: "1-4 short questions, asked of every document." },
      keys: { type: "array", items: { type: "string" }, description: "Up to 12 document keys, most important first." },
    },
    required: ["questions", "keys"],
    additionalProperties: false,
  },
};

const clip = (text: string, offset = 0) => {
  const part = text.slice(offset, offset + MAX_RESULT_CHARS);
  const end = offset + part.length;
  return end < text.length || offset > 0 ? `${part}\n\n[showing characters ${offset}-${end} of ${text.length}${end < text.length ? `; call again with offset ${end} for more` : ""}]` : part;
};

async function searchSourcesTool(input: { query: string; sources?: string[] }, ctx: Ctx) {
  const names = input.sources?.length ? NAMES.filter((s) => input.sources!.includes(s)) : NAMES;
  const results = await Promise.allSettled(names.map((s) => SOURCES[s].search(input.query)));
  ctx.trace.push(`search_sources "${input.query}" [${names}]: ${results.map((r, i) => `${names[i]} ${r.status === "fulfilled" ? r.value.length : "error"}`).join(", ")}`);
  return names
    .map((s, i) => {
      const r = results[i];
      if (r.status === "rejected") return `## ${s}: search failed (${r.reason?.message ?? r.reason})`;
      const lines = r.value.map((d) => `${s}:${d.id} | ${d.title} | ${d.date}${d.snippet ? ` | ${d.snippet.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
      return `## ${s}: ${lines.length} hits\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

async function searchLawsTool(input: { query: string }, ctx: Ctx) {
  const rows = await searchText(input.query, 20);
  ctx.trace.push(`search_laws "${input.query}": ${rows.length} articles`);
  if (!rows.length) return "No articles found. Try fewer or other words, synonyms, or 'or' between alternatives.";
  return rows.map((r) => `${r.law_id} | ${r.law_title} | art. ${r.label || "-"}${r.article_title ? ` (${r.article_title})` : ""} | ${r.snippet.replace(/\s+/g, " ")}`).join("\n");
}

type Row = { law_title: string; label: string; article_title: string; text: string; url: string };

async function readLaw(input: { law_id: string; articles: string[] }, ctx: Ctx) {
  const labels = [...new Set(input.articles.map(normLabel))];
  // Long articles are stored in several rows (as in lawContext in app/src/lib/lawsearch/index.ts).
  const { rows } = await pool.query<Row>(
    `SELECT law_title, label, article_title, text, url FROM bwb_article WHERE law_id = $1 AND label = ANY($2) ORDER BY ctid`,
    [input.law_id, labels],
  );
  const found = labels.flatMap((label) => {
    const parts = rows.filter((r) => r.label === label);
    if (!parts.length) return [];
    const p = parts[0];
    const doc: Doc = {
      key: `bwb:${input.law_id}:${label}`,
      source: "bwb",
      id: `${input.law_id}:${label}`,
      title: `${p.law_title}, art. ${label}${p.article_title ? ` (${p.article_title})` : ""}`,
      url: p.url,
      date: "",
      text: parts.map((r) => r.text).join("\n"),
    };
    ctx.docs.set(doc.key, doc);
    return [doc];
  });
  const missing = labels.filter((l) => !found.some((d) => d.id.endsWith(`:${l}`)));
  ctx.trace.push(`read_law ${input.law_id} [${labels}]: ${found.length} found${missing.length ? `, missing ${missing}` : ""}`);
  const body = found.map((d) => `<document key="${d.key}" title="${d.title}" url="${d.url}">\n${d.text}\n</document>`).join("\n\n");
  return clip((missing.length ? `Not found in ${input.law_id}: art. ${missing.join(", ")}\n\n` : "") + body);
}

/** The document for a key, fetched into ctx.docs on first use; an error string if there is none. */
export async function fetchDoc(key: string, ctx: Ctx): Promise<Doc | string> {
  let doc = ctx.docs.get(key);
  if (doc) return doc;
  const i = key.indexOf(":");
  const source = key.slice(0, i) as Source | "bwb";
  const id = key.slice(i + 1);
  if (source === "bwb") {
    const j = id.indexOf(":"); // law ids have no colon, labels can ("8:1")
    await readLaw({ law_id: id.slice(0, j), articles: [id.slice(j + 1)] }, ctx);
    return ctx.docs.get(key) ?? `Error: no article for key ${key}`;
  }
  if (!NAMES.includes(source)) return `Error: unknown key ${key}; use a key from search_sources ("<source>:<id>")`;
  doc = { key, source, id, ...(await getSourceDoc(source, id)) };
  ctx.docs.set(key, doc);
  return doc;
}

async function readDocument(input: { key: string; offset?: number }, ctx: Ctx) {
  const doc = await fetchDoc(input.key, ctx);
  if (typeof doc === "string") return doc;
  ctx.trace.push(`read_document ${input.key}${input.offset ? ` @${input.offset}` : ""}: ${doc.text.length} chars`);
  return `<document key="${doc.key}" title="${doc.title}" date="${doc.date}" url="${doc.url}">\n${clip(doc.text, input.offset ?? 0)}\n</document>`;
}

const HANDLERS: Record<string, (input: any, ctx: Ctx) => Promise<string>> = {
  search_sources: searchSourcesTool,
  search_laws: searchLawsTool,
  read_document: readDocument,
  read_law: readLaw,
};

/** Runs one tool call; never throws (errors come back as text, so the model can retry). */
export async function runTool(name: string, input: any, ctx: Ctx): Promise<string> {
  const handler = HANDLERS[name];
  if (!handler) return `Error: unknown tool ${name}`;
  const t0 = Date.now();
  try {
    return await handler(input, ctx);
  } catch (e: any) {
    ctx.trace.push(`${name} ${JSON.stringify(input)}: error ${e?.message ?? e}`);
    return `Error: ${e?.message ?? e}`;
  } finally {
    ctx.trace.push(`${name} took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
