/**
 * Legal sources besides the law itself: ACM and AP decisions, Kifid rulings and case law (rechtspraak.nl).
 * Each source has search(q) -> SourceDoc[] and get(id) -> full plain text (for citing and exact-quote checks).
 * sourcesContext is the normal-search step the chat runs next to lawContext.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getRuling, searchRulings } from "../rechtspraak";
import * as acm from "./acm";
import * as ap from "./ap";
import * as kifid from "./kifid";

export type Source = "acm" | "ap" | "kifid" | "rechtspraak";
export type SourceDoc = { source: Source; id: string; title: string; date: string; url: string; snippet: string };
export type FullDoc = { title: string; url: string; date: string; text: string };

const rechtspraak = {
  async search(q: string): Promise<SourceDoc[]> {
    return (await searchRulings(q)).hits.map((h) => ({ source: "rechtspraak", id: h.ecli, title: `${h.ecli}, ${h.title}`, date: h.decided, url: h.url, snippet: h.summary }));
  },
  async get(ecli: string): Promise<FullDoc> {
    const r = await getRuling(ecli);
    return { title: `${r.court} ${r.decided}, ${r.ecli}`, url: r.url, date: r.decided, text: [r.summary, r.body].filter(Boolean).join("\n\n") };
  },
};

export const SOURCES: Record<Source, { search(q: string, limit?: number): Promise<SourceDoc[]>; get(id: string, pdfs?: boolean): Promise<FullDoc> }> = { acm, ap, kifid, rechtspraak };
export const LABELS: Record<Source, string> = { acm: "ACM", ap: "Autoriteit Persoonsgegevens", kifid: "Kifid", rechtspraak: "Rechtspraak" };
const NAMES = Object.keys(SOURCES) as Source[];

/** All four sources in parallel; a failing source gives no hits (logged) instead of failing the rest. */
export async function searchSources(q: string): Promise<Record<Source, SourceDoc[]>> {
  const results = await Promise.allSettled(NAMES.map((s) => SOURCES[s].search(q)));
  return Object.fromEntries(
    NAMES.map((s, i) => {
      const r = results[i];
      if (r.status === "rejected") console.error(`Zoeken in ${LABELS[s]} mislukt:`, r.reason);
      return [s, r.status === "fulfilled" ? r.value : []];
    }),
  ) as Record<Source, SourceDoc[]>;
}

/** Full text of one document; pdfs=false skips attached decision PDFs (ACM, AP) when the page text is enough. */
export const getSourceDoc = (source: Source, id: string, pdfs = true) => SOURCES[source].get(id, pdfs);

const QUERY_MODEL = "claude-haiku-5-5";
const PER_SOURCE = 3;
// ponytail: only the start of each document goes into the prompt; deep search reads further.
const MAX_DOC_CHARS = 4_000;

const QUERY_SYSTEM = `Je maakt zoekopdrachten om bij een Nederlandse juridische vraag besluiten en uitspraken te vinden bij de ACM, de Autoriteit Persoonsgegevens, het Kifid en rechtspraak.nl. Die zoekmachines zoeken op trefwoorden in titels en tekst: alle woorden van een zoekopdracht moeten voorkomen. Geef 2-4 korte zoekopdrachten van 1-3 woorden, belangrijkste eerst: het kernbegrip, de vakterm uit de wet of besluitpraktijk, en bedrijfsnamen uit de vraag. Bijvoorbeeld: "nepkorting", "tracking cookies boete", "klarna incassokosten".`;

/**
 * Normal search: one cheap model call turns the question into keyword queries, all sources are searched with each,
 * and the top hits per source (start of their full text) come back as a system-prompt block plus a markdown list.
 */
export async function sourcesContext(question: string, client: Anthropic) {
  const msg = await client.messages.create({
    model: QUERY_MODEL,
    max_tokens: 500,
    system: QUERY_SYSTEM,
    messages: [{ role: "user", content: `VRAAG:\n${question}` }],
    output_config: {
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"], additionalProperties: false },
      },
    },
  });
  const { queries } = JSON.parse(msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")) as { queries: string[] };
  if (!queries.length) return { block: "", sources: "" };
  const results = await Promise.all(queries.slice(0, 4).map(searchSources));

  // Per source: take the queries' hits in turns (1st of each query, then 2nd, ...), without duplicates.
  const picked = NAMES.flatMap((s) => {
    const out = new Map<string, SourceDoc>();
    const longest = Math.max(...results.map((r) => r[s].length));
    for (let i = 0; i < longest; i++) for (const r of results) if (r[s][i] && !out.has(r[s][i].id)) out.set(r[s][i].id, r[s][i]);
    return [...out.values()].slice(0, PER_SOURCE);
  });
  if (!picked.length) return { block: "", sources: "" };
  const docs = await Promise.all(
    picked.map(async (d) => {
      const full = await getSourceDoc(d.source, d.id, false).catch(() => null);
      return { ...d, title: full?.title || d.title, date: full?.date || d.date, text: (full?.text || d.snippet).slice(0, MAX_DOC_CHARS) };
    }),
  );
  const attr = (s: string) => s.replace(/"/g, "'");
  const block = docs
    .map((d) => `<document bron="${LABELS[d.source]}" titel="${attr(d.title)}" datum="${d.date}" url="${d.url}">\n${d.text}\n</document>`)
    .join("\n\n");
  const sources = docs.map((d) => `- ${LABELS[d.source]}: [${d.title.replace(/[[\]]/g, "")}](${d.url})${d.date ? ` (${d.date})` : ""}`).join("\n");
  return { block, sources };
}
