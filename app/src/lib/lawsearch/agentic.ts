/**
 * Approach A: agentic live search. Claude plans, searches the BWB via SRU (metadata only),
 * reads outlines and articles, then calls `finish` with ranked laws and articles.
 *
 *
 * LAW_MODEL (default claude-opus-5-5) and LAW_EFFORT (default low) override the model.
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../ai";
import { pickEffort } from "../models";
import { getLaw } from "../wetten";
import { catalog, type CatalogEntry } from "./manifest";

export type Hit = { id: string; title: string; articles: string[]; why: string };
export type SearchResult = { hits: Hit[]; usage: { input_tokens: number; output_tokens: number }; apiCalls: number; trace: string[] };

const MODEL = process.env.LAW_MODEL ?? "claude-opus-5-5";
const EFFORT = pickEffort(process.env.LAW_EFFORT) ?? "low";
const MAX_TURNS = 12;
const SRU = "https://zoekservice.overheid.nl/sru/Search";
const HEADERS = { Accept: "application/xml", "User-Agent": "loopjongen-bwb/1.0 (+wesselchi123@gmail.com)" };
const today = () => new Date().toISOString().slice(0, 10);

// Titles/metadata from the local catalog when present; without it hits show only their id.
let titles: Map<string, CatalogEntry> | undefined;
const byId = () => {
  if (!titles) {
    try {
      titles = new Map(catalog().map((e) => [e.id, e]));
    } catch {
      titles = new Map();
    }
  }
  return titles;
};


export const normLabel = (label: string) => label.replace(/^artikel\s+/i, "").replace(/\.$/, "").trim();

const SYSTEM = `You find the Dutch regulations (BWB, wetten.overheid.nl) and articles that answer a legal question. Obscure ministerial regulations are the hard case: their titles rarely use the question's everyday words.

Work in four steps:
1. Plan (in a few lines, before searching): which kind of regulation probably governs this (wet, AMvB, ministeriele-regeling, beleidsregel, ...), which ministry issues it, which legal area, and which formal words its title would contain. Translate everyday words into regulation vocabulary (e.g. tenant -> huurder; fine -> boete; firing -> ontslag; parental leave -> verlof, arbeid en zorg) and think of the nouns a formal title would use (regeling, besluit, beschikking, voorschrift, reglement, plus the subject matter).
2. Search with search_laws. It matches title words and metadata only, never the article text. Combine a few title words with filters (type, authority, rechtsgebied). If a search returns nothing, try synonyms, formal vocabulary, single broader words, mode "any", or drop a filter. If it returns too many, add a filter or a word. Several targeted searches are cheap; do not stop at the first plausible act.
3. Verify: open the most promising candidates with get_law_outline and read the key articles with read_articles. Watch for near-duplicate regulations (e.g. the same rule per region, sector or year): pick the one whose scope matches the facts in the question.
4. Call finish with up to 5 laws ranked best first, each with the article numbers (best first, at most 8) that answer the question. Put the specific regulation first; general framework acts may follow. Only list laws and articles you have seen in tool results.

Always end by calling finish.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_laws",
    description:
      "Search the titles and metadata of all Dutch national regulations currently in force (SRU, x-connection=BWB). Searches ONLY title words and metadata, not the full text. Returns at most 20 hits (id, title, type, authority, areas) plus the total count. Empty result: try synonyms, the formal regulation vocabulary, broader single words, mode 'any', or fewer filters.",
    input_schema: {
      type: "object",
      properties: {
        words: { type: "string", description: "Title words, e.g. 'subsidie natuurbeheer'. May be empty when filters are given." },
        mode: { type: "string", enum: ["all", "any", "adj"], description: "all = every word in the title, any = at least one, adj = exact phrase" },
        type: {
          type: "string",
          description: "Optional regulation type: wet, AMvB, ministeriele-regeling, beleidsregel, zbo, pbo, KB, circulaire, verdrag, rijkswet, reglement, ministeriele-regeling-archiefselectielijst (and -BES variants)",
        },
        authority: {
          type: "string",
          description:
            "Optional issuing ministry/body, exact spelling, e.g. Defensie, Financiën, Justitie en Veiligheid, Veiligheid en Justitie, Binnenlandse Zaken en Koninkrijksrelaties, Sociale Zaken en Werkgelegenheid, Volksgezondheid, Welzijn en Sport, Onderwijs, Cultuur en Wetenschap, Infrastructuur en Waterstaat, Infrastructuur en Milieu, Economische Zaken en Klimaat, Economische Zaken, Landbouw, Natuur en Voedselkwaliteit, Buitenlandse Zaken, Algemene Zaken. Older regulations keep the ministry name of their time.",
        },
        rechtsgebied: {
          type: "string",
          description:
            "Optional legal area, exact spelling, e.g. Staats- en bestuursrecht, Arbeidsrecht en sociaal-zekerheidsrecht, Arbeidsrecht, Vervoersrecht, Belastingrecht, Gezondheidsrecht en farmaceutisch recht, Openbare orde en veiligheidsrecht, Onderwijsrecht, Strafrecht, Bestuursrecht, Procesrecht, Ambtenarenrecht, Militair recht, Militaire ambtenarenrecht, Wonen, onroerend goed, bouwrecht, Personen- en familierecht, Huurrecht, Consumentenrecht, Verbintenissenrecht, Privacy, Informatierecht, Migratierecht, Milieurecht, Omgevingsrecht",
        },
        overheidsdomein: {
          type: "string",
          description:
            "Optional government domain, e.g. Defensie, Werk- en loopbaan, Rechtspraak, Belastingen, Onderwijs en wetenschap, Gezondheid en zorg, Verkeer en vervoer, Bouwen, wonen en leefomgeving, Familie, jeugd en gezin, Overheid, bestuur en koninkrijk",
        },
      },
      required: ["words", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "get_law_outline",
    description: "Headings and article numbers with titles of one regulation, to choose which articles to read.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "read_articles",
    description: "Full text of up to 10 articles of one regulation. Labels as shown in the outline, e.g. '8', '7:652', '10a'.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, labels: { type: "array", items: { type: "string" } } },
      required: ["id", "labels"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "Final answer: up to 5 laws, best first, each with up to 8 article numbers (best first) and a one-sentence reason.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        hits: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, articles: { type: "array", items: { type: "string" } }, why: { type: "string" } },
            required: ["id", "articles", "why"],
            additionalProperties: false,
          },
        },
      },
      required: ["hits"],
      additionalProperties: false,
    },
  },
];

const cql = (s: string) => s.replace(/["\\]/g, " ").trim();

async function searchLaws(input: Record<string, string>) {
  const parts = [`overheidbwb.geldigheidsdatum==${today()}`];
  if (input.words?.trim()) parts.push(`overheidbwb.titel ${["all", "any", "adj"].includes(input.mode) ? input.mode : "all"} "${cql(input.words)}"`);
  if (input.type) parts.push(`dcterms.type=="${cql(input.type)}"`);
  if (input.authority) parts.push(`overheid.authority=="${cql(input.authority)}"`);
  if (input.rechtsgebied) parts.push(`overheidbwb.rechtsgebied=="${cql(input.rechtsgebied)}"`);
  if (input.overheidsdomein) parts.push(`overheidbwb.overheidsdomein=="${cql(input.overheidsdomein)}"`);
  if (parts.length === 1) return "Give title words or at least one filter.";
  const p = new URLSearchParams({ operation: "searchRetrieve", version: "2.0", "x-connection": "BWB", maximumRecords: "20", query: parts.reverse().join(" and ") });
  const res = await fetch(`${SRU}?${p}`, { headers: HEADERS });
  const xml = await res.text();
  if (!res.ok) return `SRU error ${res.status}: ${xml.match(/<message>([^<]*)/)?.[1] ?? ""}`;
  const total = Number(xml.match(/<numberOfRecords>(\d+)/)?.[1] ?? 0);
  // ponytail: metadata comes from the local manifest instead of parsing the SRU record; ids missing from it show only the id.
  const ids = [...new Set([...xml.matchAll(/<dcterms:identifier>(BWB[RV]\d+)</g)].map((m) => m[1]))];
  const lines = ids.map((id) => {
    const e = byId().get(id);
    return e ? `${id} | ${e.title} | ${e.type} | ${e.authority} | ${e.areas.join(", ")}` : id;
  });
  return `${total} hits${total > 20 ? " (showing 20; narrow the search)" : ""}\n${lines.join("\n")}`;
}

async function outline(id: string) {
  const law = await getLaw(id);
  const lines = law.items.map((it) => (it.kind === "heading" ? `${"#".repeat(it.level)} ${it.text}` : `  ${normLabel(it.label)}${it.title ? ` ${it.title}` : ""}`));
  // ponytail: huge codes (BW, Sr) get cut at 600 lines; add a heading filter if that hurts.
  return `${law.title} (${law.id})\n${lines.slice(0, 600).join("\n")}${lines.length > 600 ? `\n... ${lines.length - 600} more lines cut` : ""}`;
}

async function readArticles(id: string, labels: string[]) {
  const law = await getLaw(id);
  const want = labels.slice(0, 10).map(normLabel);
  return want
    .map((l) => {
      const a = law.items.find((it) => it.kind === "article" && normLabel(it.label) === l);
      return a && a.kind === "article" ? `Artikel ${l}${a.title ? ` ${a.title}` : ""}\n${a.text.slice(0, 4000)}` : `Artikel ${l}: not found`;
    })
    .join("\n\n");
}

async function runTool(name: string, input: any): Promise<string> {
  try {
    if (name === "search_laws") return await searchLaws(input);
    if (name === "get_law_outline") return await outline(input.id);
    if (name === "read_articles") return await readArticles(input.id, input.labels ?? []);
    return `Unknown tool ${name}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function search(question: string, client: Anthropic = anthropic()): Promise<SearchResult> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const trace: string[] = [];
  const messages: any[] = [{ role: "user", content: question }];
  let apiCalls = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    apiCalls++;
    const u = msg.usage;
    usage.input_tokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    usage.output_tokens += u.output_tokens;
    if (msg.stop_reason === "refusal") throw new Error("model refused");
    if (msg.stop_reason === "max_tokens") throw new Error("max_tokens reached");
    messages.push({ role: "assistant", content: msg.content });
    for (const b of msg.content) if (b.type === "text" && b.text.trim()) trace.push(`text: ${b.text.trim().replace(/\s+/g, " ").slice(0, 300)}`);
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const fin = calls.find((b) => b.name === "finish");
    if (fin) {
      const hits = ((fin.input as { hits: unknown }).hits as { id: string; articles: string[]; why: string }[])
        .filter((h) => /^BWB[RV]\d{7}$/.test(h.id))
        .slice(0, 5)
        .map((h) => ({ id: h.id, title: byId().get(h.id)?.title ?? "", articles: h.articles.map(normLabel).slice(0, 8), why: h.why }));
      trace.push(`finish: ${hits.map((h) => h.id).join(", ")}`);
      return { hits, usage, apiCalls, trace };
    }
    if (!calls.length) {
      messages.push({ role: "user", content: "Call finish with your ranked laws and articles." });
      continue;
    }
    const results = [];
    for (const c of calls) {
      const out = await runTool(c.name, c.input); // sequential: at most 1 request to SRU/repository at a time
      trace.push(`${c.name} ${JSON.stringify(c.input)} -> ${out.split("\n")[0].slice(0, 120)}`);
      results.push({ type: "tool_result", tool_use_id: c.id, content: out });
    }
    if (turn === MAX_TURNS - 2) results.push({ type: "text", text: "Last turn: call finish now." } as any);
    messages.push({ role: "user", content: results });
  }
  trace.push("turn cap reached without finish");
  return { hits: [], usage, apiCalls, trace };
}

