/**
 * Approach B: full-text search over all article texts (Postgres table bwb_article, built by index.ts) + LLM.
 * Fixed pipeline, 2 Claude calls:
 *   1. question -> 3-6 queries (AND of OR-groups)  2. SQL: top articles per query, laws ranked by aggregated score
 *   3. pick up to 5 laws and their articles from the ~15 candidate laws
 * searchRaw is a no-LLM baseline: one OR query of the question's words.
 *
 *
 * LAW_MODEL / LAW_EFFORT override the model (claude-opus-5-5) and effort (low).
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../ai";
import { pickEffort } from "../models";
import { pool } from "../db";

export { pool };

export type Hit = { id: string; title: string; articles: string[]; why: string };
// confident: the pick call judged that a candidate really answers the question (used by hybrid/search.ts).
export type SearchResult = { hits: Hit[]; usage: { input_tokens: number; output_tokens: number }; apiCalls: number; trace: string[]; confident?: boolean };
export type ArticleRow = { law_id: string; law_title: string; law_type: string; label: string; article_title: string; path: string; rank: number; snippet: string };

const MODEL = process.env.LAW_MODEL ?? "claude-opus-5-5";
const EFFORT = pickEffort(process.env.LAW_EFFORT) ?? "low";
const PER_QUERY = 30; // articles per query
const CANDIDATES = 15; // laws shown to the pick call
const SHOWN = 5; // articles with snippet per candidate law
const TOC_MAX = 60; // laws with at most this many articles also get their full article list


// Same as normLabel in c-catalog/search.ts (index.ts already stores labels normalized).
export const normLabel = (label: string) => label.replace(/^(artikel|art\.)\s*/i, "").trim().replace(/\.$/, "");

/**
 * Full-text search with Dutch stemming: best matching articles, best first. `query` is either websearch_to_tsquery
 * syntax (note: "a or b c" means a | (b & c)) or concepts: AND over groups, OR within a group, each term a word or phrase.
 */
export async function searchText(query: string | string[][], limit = PER_QUERY): Promise<ArticleRow[]> {
  const params: (string | number)[] = [];
  const p = (v: string | number) => (params.push(v), `$${params.length}`);
  const tsq =
    typeof query === "string"
      ? `websearch_to_tsquery('dutch', ${p(query)})`
      : query
          .filter((g) => g.length)
          .map((g) => `(${g.map((t) => `phraseto_tsquery('dutch', ${p(t)})`).join(" || ")})`)
          .join(" && ");
  if (!tsq) return [];
  const { rows } = await pool.query(
    `SELECT law_id, law_title, law_type, label, article_title, path, rank,
       ts_headline('dutch', text, q, 'MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') AS snippet
     FROM (SELECT a.*, q, ts_rank_cd(tsv, q, 32) AS rank
           FROM bwb_article a, (SELECT ${tsq} AS q) x
           WHERE tsv @@ q ORDER BY rank DESC LIMIT ${p(limit)}) t
     ORDER BY rank DESC`,
    params,
  );
  return rows;
}

type Art = ArticleRow & { score: number };
type Law = { id: string; title: string; type: string; score: number; queries: number; arts: Art[] };
const K = 10; // reciprocal rank fusion constant

/**
 * Reciprocal rank fusion over the queries: a law scores 1/(K + its position among the laws a query found), summed
 * over queries, so a narrow query that finds 2 laws counts as much as a broad one, and agreeing queries add up.
 * Articles are fused the same way by their position within each query.
 */
function rankLaws(results: ArticleRow[][]): Law[] {
  const laws = new Map<string, Law>();
  for (const rows of results) {
    const order: string[] = [];
    rows.forEach((r, i) => {
      const law = laws.get(r.law_id) ?? { id: r.law_id, title: r.law_title, type: r.law_type, score: 0, queries: 0, arts: [] };
      laws.set(r.law_id, law);
      if (!order.includes(r.law_id)) order.push(r.law_id), law.queries++, (law.score += 1 / (K + order.length));
      const art = law.arts.find((a) => a.label === r.label);
      if (!art) law.arts.push({ ...r, score: 1 / (K + i + 1) });
      else if (art.rank < r.rank) Object.assign(art, r, { score: art.score + 1 / (K + i + 1) }); // keep the best snippet
      else art.score += 1 / (K + i + 1);
    });
  }
  for (const law of laws.values()) {
    if (/^wijziging/i.test(law.title)) law.score *= 0.5; // amending acts rarely hold the answer
    law.arts.sort((a, b) => b.score - a.score);
  }
  return [...laws.values()].sort((a, b) => b.score - a.score);
}

const articlesOf = (law: Law) => law.arts.map((a) => a.label).filter(Boolean);

async function ask<T>(client: Anthropic, system: string, content: string, schema: Record<string, unknown>, res: SearchResult, maxTokens = 8000): Promise<T> {
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  res.apiCalls++;
  res.usage.input_tokens += msg.usage.input_tokens;
  res.usage.output_tokens += msg.usage.output_tokens;
  if (msg.stop_reason === "refusal") throw new Error("model refused");
  if (msg.stop_reason === "max_tokens") throw new Error("max_tokens reached");
  return JSON.parse(msg.content.flatMap((b: any) => (b.type === "text" ? [b.text] : [])).join(""));
}

const strArr = { type: "array", items: { type: "string" } };
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const QUERY_SYSTEM = `Je zoekt in de volledige tekst van alle artikelen van alle geldende Nederlandse regelingen (Basiswettenbestand: wetten, AMvB's, ministeriële regelingen, beleidsregels, verdragen enz.) naar de regeling en artikelen die een juridische vraag beantwoorden. Elk artikel is doorzoekbaar op zijn tekst, opschrift, hoofdstuktitels en de titel van de regeling; woorden worden gestemd (Nederlands).
Geef 3-6 queries. Een query is een lijst van 2-4 begrippen die allemaal in hetzelfde artikel moeten voorkomen, belangrijkste begrip eerst (bij nul treffers valt het laatste begrip weg). Elk begrip is een lijst van alternatieven (synoniemen, varianten, woordgroepen), bv. [["ontslag", "opzegging"], ["arbeidsovereenkomst"], ["dringende reden"]].
- neem de kernwoorden uit de vraag zelf op én, als alternatieven ernaast, de formele woorden die in de wettekst zelf staan (bv. huurder, verhuurder, opzegging, bezwaarschrift, aanslag, belanghebbende, bestuursorgaan, betrokkene, verantwoordelijke, bevoegd gezag).
- Nederlandse samenstellingen zijn één woord: neem zowel de samenstelling als losse delen als alternatieven op (bv. ["erfpachtcanon", "erfpacht", "canon"]).
- noem organisaties, beroepen of functies uit de vraag in minstens één query als die het onderscheid kunnen maken tussen bijna-identieke regelingen.
- varieer: één query met het centrale begrip, één met de specifieke handeling of termijn, één met de organisatie of het soort regeling.`;

const PICK_SYSTEM = `Je kiest uit kandidaat-regelingen uit het Basiswettenbestand (gevonden met full-text search over artikelteksten) de regelingen en artikelen die een Nederlandse juridische vraag beantwoorden. Rangschik maximaal 5 regelingen, beste eerst; per regeling maximaal 8 artikelen, belangrijkste eerst, ook definitie- of uitzonderingsartikelen als het antwoord ervan afhangt. Gebruik alleen id's en artikelnummers uit de kandidatenlijst, exact zoals daar geschreven.
Let op bijna-identieke regelingen (zelfde regel voor een andere sector, organisatie, jaar of BES-variant): kies op basis van feiten in de vraag (beroep, organisatie, plaats, begrippen) en zet die bovenaan; neem beide op als de vraag het niet beslist. Geef de voorkeur aan de specifieke regeling die de vraag rechtstreeks regelt boven een algemene kaderwet; wijzigingsregelingen alleen als de vraag daarover gaat. Geef per regeling een korte reden (why).
Zet confident op true als een kandidaat de vraag rechtstreeks beantwoordt, inclusief de gevraagde details; op false als de kandidaten alleen algemeen of zijdelings over het onderwerp gaan.`;

export async function search(question: string, client: Anthropic = anthropic()): Promise<SearchResult> {
  const res: SearchResult = { hits: [], usage: { input_tokens: 0, output_tokens: 0 }, apiCalls: 0, trace: [] };
  const log = (s: string) => res.trace.push(s);

  // 1. Full-text queries.
  const { queries } = await ask<{ queries: string[][][] }>(client, QUERY_SYSTEM, `VRAAG:\n${question}`, obj({ queries: { type: "array", items: { type: "array", items: strArr } } }), res, 2000);
  // 2. Run them (dropping the last concept while nothing matches) and rank laws.
  const results = await Promise.all(
    queries.slice(0, 6).map(async (q) => {
      for (let n = q.length; n > 0; n--) {
        const rows = await searchText(q.slice(0, n));
        if (rows.length || n === 1) return log(`query ${JSON.stringify(q.slice(0, n))}${n < q.length ? ` (relaxed)` : ""}: ${rows.length} articles`), rows;
      }
      return [];
    }),
  );
  const laws = rankLaws(results).slice(0, CANDIDATES);
  log(`candidates: ${laws.map((l) => `${l.id} ${l.title.slice(0, 50)} (${l.score.toFixed(3)}, ${l.queries}q)`).join(" | ")}`);
  if (!laws.length) return { ...res, confident: false };

  // 3. Pick laws and articles.
  // Small laws also get their full table of contents, so the pick call can add articles no query matched.
  const { rows: toc } = await pool.query(
    `SELECT law_id, label, max(article_title) AS title FROM bwb_article
     WHERE law_id = ANY($1) AND label <> '' AND law_id IN (SELECT law_id FROM bwb_article WHERE law_id = ANY($1) GROUP BY law_id HAVING count(DISTINCT label) <= $2)
     GROUP BY law_id, label ORDER BY law_id, min(ctid)`,
    [laws.map((l) => l.id), TOC_MAX],
  );
  const known = new Map(laws.map((l) => [l.id, new Set([...articlesOf(l), ...toc.filter((t: any) => t.law_id === l.id).map((t: any) => t.label as string)])]));
  const list = laws
    .map((l) => {
      const arts = l.arts.slice(0, SHOWN).map((a) => `  - ${a.label ? `art. ${a.label}` : "(tekst zonder artikelen)"}${a.article_title ? ` (${a.article_title})` : ""}${a.path ? ` [${a.path.slice(0, 150)}]` : ""}: ${a.snippet.replace(/\s+/g, " ")}`);
      const contents = toc.filter((t: any) => t.law_id === l.id).map((t: any) => `${t.label}${t.title ? ` (${t.title})` : ""}`);
      const more = articlesOf(l).slice(SHOWN, SHOWN + 15);
      const tail = contents.length ? `\n  inhoud: art. ${contents.join("; ")}` : more.length ? `\n  andere treffers: art. ${more.join(", ")}` : "";
      return `${l.id} | ${l.title} | ${l.type}\n${arts.join("\n")}${tail}`;
    })
    .join("\n\n");
  const pick = await ask<{ hits: { id: string; articles: string[]; why: string }[]; confident: boolean }>(
    client,
    PICK_SYSTEM,
    `VRAAG:\n${question}\n\nKANDIDATEN (id | titel | soort, met de best passende artikelen):\n${list}`,
    obj({ hits: { type: "array", items: obj({ id: { type: "string" }, articles: strArr, why: { type: "string" } }) }, confident: { type: "boolean" } }),
    res,
  );
  const byId = new Map(laws.map((l) => [l.id, l]));
  for (const h of pick.hits) {
    const law = byId.get(h.id);
    if (!law) {
      log(`dropped id not in candidates: ${h.id}`);
      continue;
    }
    if (res.hits.some((x) => x.id === h.id) || res.hits.length >= 5) continue;
    const ok = known.get(h.id)!;
    const got = h.articles.map(normLabel);
    const articles = [...new Set(got.filter((a) => ok.has(a)))].slice(0, 8);
    if (articles.length < got.length) log(`${h.id}: dropped articles not in candidates ${got.filter((a) => !ok.has(a)).join(", ")}`);
    res.hits.push({ id: h.id, title: law.title, articles, why: h.why });
  }
  log(`picked (candidate rank): ${res.hits.map((h) => `${h.id} #${laws.findIndex((l) => l.id === h.id) + 1}`).join(", ")}; confident: ${pick.confident}`);
  return { ...res, confident: pick.confident };
}

/** No-LLM baseline: one OR query of the question's words, top 5 laws by aggregated score. */
export async function searchRaw(question: string): Promise<SearchResult> {
  const res: SearchResult = { hits: [], usage: { input_tokens: 0, output_tokens: 0 }, apiCalls: 0, trace: [] };
  // Stopwords are dropped by the 'dutch' config; "or" itself would be an operator, so drop it.
  const words = [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && w !== "or"))];
  const query = words.join(" or ");
  res.trace.push(`query "${query}"`);
  const laws = rankLaws([await searchText(query, 100)]).slice(0, 5);
  res.hits = laws.map((l) => ({ id: l.id, title: l.title, articles: articlesOf(l).slice(0, 8), why: `score ${l.score.toFixed(3)}` }));
  return res;
}

