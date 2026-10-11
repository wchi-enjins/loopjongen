/**
 * Approach C: catalog + LLM pick. Fixed pipeline, 3 Claude calls:
 *   1. propose filters + guessed title words/titles   2. local scoring of the 22k-title manifest -> shortlist
 *   3. pick up to 5 laws from the shortlist             4. pick articles from the outlines of the top 3 laws
 *
 *
 * LAW_MODEL / LAW_EFFORT override the model (claude-opus-5-5) and effort (low).
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../ai";
import { pickEffort } from "../models";
import { getLaw } from "../wetten";
import { catalog, type CatalogEntry } from "./manifest";

export type Hit = { id: string; title: string; articles: string[]; why: string };
export type SearchResult = { hits: Hit[]; usage: { input_tokens: number; output_tokens: number }; apiCalls: number; trace: string[] };

type Entry = CatalogEntry;

const MODEL = process.env.LAW_MODEL ?? "claude-opus-5-5";
const EFFORT = pickEffort(process.env.LAW_EFFORT) ?? "low";
const SHORTLIST = 150;
const OUTLINE_CHARS = 60_000; // per law; long codes get shorter snippets


const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
// Catalog-derived data, built on first use (B and A do not need the catalog).
let loaded: { entries: Entry[]; VALUES: Record<"authorities" | "types" | "areas" | "domains", string[]>; titleTokens: string[][] } | undefined;
function data() {
  if (loaded) return loaded;
  const entries = catalog();
  const distinct = (f: (e: Entry) => string[]) => [...new Set(entries.flatMap(f))].sort();
  const VALUES = { authorities: distinct((e) => [e.authority]), types: distinct((e) => [e.type]), areas: distinct((e) => e.areas), domains: distinct((e) => e.domains) };
  return (loaded = { entries, VALUES, titleTokens: entries.map((e) => tokens(e.title)) });
}
const STOP = new Set(["de", "het", "een", "van", "en", "op", "in", "voor", "met", "der", "den", "tot", "te", "aan", "of", "bij", "inzake", "betreffende", "houdende", "ter", "uit"]);
// Short stems must start a token; longer ones may sit inside a Dutch compound ("huur" in "winkelhuur" needs 5+).
const matches = (term: string, toks: string[]) => toks.some((t) => (term.length >= 5 ? t.includes(term) : t.startsWith(term)));

export const normLabel = (label: string) => label.replace(/^(artikel|art\.)\s*/i, "").trim().replace(/\.$/, "");


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

const PROPOSE_SYSTEM = `Je helpt een Nederlandse juridische vraag te koppelen aan de juiste regeling in het Basiswettenbestand (BWB, alle geldende wetten, AMvB's, ministeriële regelingen, beleidsregels, verdragen enz.). Er is alleen een catalogus met titels en metadata; zoeken gebeurt op woorden in de titel.
Geef:
- authorities, types, areas, domains: de waarschijnlijke waarden, uitsluitend gekozen uit de gegeven lijsten (ruim kiezen mag, ook oude ministerienamen).
- words: 10-30 woorden of woordstammen die waarschijnlijk in de titel van de regeling staan (geen woorden uit de vraag die niet in een titel passen). Denk aan het onderwerp, de organisatie, het soort regeling, synoniemen en formele termen; korte stammen (bv. "pacht", "huur") vangen samenstellingen.
- titles: 3-8 plausibele formele titels van de regeling(en) die de vraag beantwoorden, zoals ze in het BWB zouden heten. Denk ook aan specifieke lagere regelingen, niet alleen de bekende hoofdwet.`;

const PICK_SYSTEM = `Je kiest uit een shortlist van regelingen uit het Basiswettenbestand de regelingen die een Nederlandse juridische vraag het meest waarschijnlijk beantwoorden. Rangschik maximaal 5, beste eerst; gebruik alleen id's uit de lijst.
Let op bijna-identieke regelingen (andere sector, organisatie, jaar of BES-variant): kies de variant die past bij de details in de vraag (beroep, organisatie, plaats, begrippen) en zet die bovenaan. Geef de voorkeur aan de specifieke regeling die de vraag rechtstreeks regelt boven een algemene kaderwet. Wijzigingswetten en -besluiten (die alleen andere regelingen wijzigen) kies je alleen als de vraag daar echt over gaat. Geef per regeling een korte reden (why).`;

const ARTICLES_SYSTEM = `Je krijgt een Nederlandse juridische vraag en de inhoudsopgave (artikelnummers, opschriften en begin van de tekst) van 1 tot 3 regelingen. Kies per regeling de artikelen die nodig zijn om de vraag te beantwoorden, belangrijkste eerst, maximaal 8 per regeling. Neem ook definitie- of uitzonderingsartikelen op als het antwoord ervan afhangt. Gebruik alleen artikelnummers die in de inhoudsopgave staan, exact zoals daar geschreven (bv. "8", "7:652", "10a"). Lege lijst als de regeling niet relevant is.`;

export async function search(question: string, client: Anthropic = anthropic()): Promise<SearchResult> {
  const res: SearchResult = { hits: [], usage: { input_tokens: 0, output_tokens: 0 }, apiCalls: 0, trace: [] };
  const log = (s: string) => res.trace.push(s);
  const { entries, VALUES, titleTokens } = data();

  // 1. Propose filters and title words.
  type Proposal = { authorities: string[]; types: string[]; areas: string[]; domains: string[]; words: string[]; titles: string[] };
  const p = await ask<Proposal>(
    client,
    PROPOSE_SYSTEM,
    `VRAAG:\n${question}\n\nMINISTERIES/AUTORITEITEN:\n${VALUES.authorities.join("; ")}\n\nSOORTEN:\n${VALUES.types.join("; ")}\n\nRECHTSGEBIEDEN:\n${VALUES.areas.join("; ")}\n\nOVERHEIDSDOMEINEN:\n${VALUES.domains.join("; ")}`,
    obj({ authorities: strArr, types: strArr, areas: strArr, domains: strArr, words: strArr, titles: strArr }),
    res,
  );
  log(`filters: ${[...p.authorities, ...p.types, ...p.areas, ...p.domains].join(", ")}`);
  log(`words: ${p.words.join(", ")}`);
  log(`titles: ${p.titles.join(" | ")}`);

  // 2. Local scoring: IDF-weighted title-term overlap plus soft metadata bonuses.
  // ponytail: bag-of-stems scoring, no phrase/bigram matching; add bigrams if near-duplicate titles keep tying.
  const weights = new Map<string, number>();
  for (const w of p.words.flatMap(tokens)) weights.set(w, 1);
  for (const w of p.titles.flatMap(tokens)) if (!weights.has(w)) weights.set(w, 0.5);
  for (const w of weights.keys()) if (w.length < 3 || STOP.has(w)) weights.delete(w);
  const terms = [...weights].map(([term, weight]) => {
    const df = titleTokens.filter((t) => matches(term, t)).length;
    return { term, weight: weight * Math.log((entries.length + 1) / (df + 1)), df };
  });
  const titleSet = new Set(p.titles.map(norm));
  const auth = new Set(p.authorities), types = new Set(p.types), areas = new Set(p.areas), domains = new Set(p.domains);
  const TYPE_PREF: Record<string, number> = { wet: 0.5, AMvB: 0.4, "ministeriele-regeling": 0.3 };
  const scored = entries
    .map((e, i) => {
      const hit = terms.filter((t) => matches(t.term, titleTokens[i]));
      if (!hit.length) return null;
      const score =
        hit.reduce((s, t) => s + t.weight, 0) +
        (titleSet.has(norm(e.title)) ? 10 : 0) +
        (auth.has(e.authority) ? 2 : 0) +
        (e.areas.some((a) => areas.has(a)) ? 1 : 0) +
        (e.domains.some((d) => domains.has(d)) ? 0.5 : 0) +
        (types.has(e.type) ? 0.5 : 0) +
        (TYPE_PREF[e.type] ?? 0) -
        (/^wijziging/i.test(e.title) ? 3 : 0); // amending acts rarely hold the answer
      return { e, score };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST);
  log(`shortlist: ${scored.length} titles; top: ${scored.slice(0, 8).map((x) => `${x.e.id} ${x.e.title.slice(0, 60)} (${x.score.toFixed(1)})`).join(" | ")}`);
  if (!scored.length) return res;

  // 3. Pick and rank laws from the shortlist.
  const byId = new Map(scored.map((x) => [x.e.id, x.e]));
  const list = scored.map(({ e }) => `${e.id} | ${e.title} | ${e.type} | ${e.authority} | ${e.areas.join(", ")}`).join("\n");
  const pick = await ask<{ hits: { id: string; why: string }[] }>(
    client,
    PICK_SYSTEM,
    `VRAAG:\n${question}\n\nSHORTLIST (id | titel | soort | ministerie | rechtsgebieden):\n${list}`,
    obj({ hits: { type: "array", items: obj({ id: { type: "string" }, why: { type: "string" } }) } }),
    res,
  );
  const picked = pick.hits.filter((h, i, a) => byId.has(h.id) && a.findIndex((x) => x.id === h.id) === i).slice(0, 5);
  if (picked.length < pick.hits.length) log(`dropped ids not in shortlist: ${pick.hits.filter((h) => !byId.has(h.id)).map((h) => h.id).join(", ")}`);
  res.hits = picked.map((h) => ({ id: h.id, title: byId.get(h.id)!.title, articles: [], why: h.why }));
  log(`picked (shortlist rank): ${res.hits.map((h) => `${h.id} #${scored.findIndex((x) => x.e.id === h.id) + 1}`).join(", ")}`);

  // 4. Articles for the top 3 laws, one call over all outlines.
  const laws = (await Promise.all(res.hits.slice(0, 3).map((h) => getLaw(h.id).catch((e) => (log(`getLaw ${h.id} failed: ${e.message}`), null))))).filter((l) => l !== null);
  if (!laws.length) return res;
  const outlines = laws.map((law) => {
    const arts = law.items.filter((it) => it.kind === "article");
    const snip = Math.max(40, Math.min(200, Math.floor(OUTLINE_CHARS / Math.max(arts.length, 1)) - 30));
    const lines = law.items.map((it) =>
      it.kind === "heading" ? `# ${it.text}` : `${normLabel(it.label)}${it.title ? ` (${it.title})` : ""}: ${it.text.replace(/\s+/g, " ").slice(0, snip)}`,
    );
    return { id: law.id, labels: new Set(arts.map((a) => normLabel(a.label))), text: `=== ${law.id} ${law.title} ===\n${lines.join("\n")}` };
  });
  log(`outlines: ${outlines.map((o) => `${o.id} ${o.labels.size} articles`).join(", ")}`);
  const art = await ask<{ laws: { id: string; articles: string[] }[] }>(
    client,
    ARTICLES_SYSTEM,
    `VRAAG:\n${question}\n\n${outlines.map((o) => o.text).join("\n\n")}`,
    obj({ laws: { type: "array", items: obj({ id: { type: "string" }, articles: strArr }) } }),
    res,
  );
  for (const o of outlines) {
    const got = (art.laws.find((l) => l.id === o.id)?.articles ?? []).map(normLabel);
    const hit = res.hits.find((h) => h.id === o.id)!;
    hit.articles = [...new Set(got.filter((a) => o.labels.has(a)))].slice(0, 8);
    if (hit.articles.length < got.length) log(`${o.id}: dropped unknown articles ${got.filter((a) => !o.labels.has(a)).join(", ")}`);
  }
  // A law whose outline yielded no relevant article is likely a near-miss (e.g. a sibling variant): move it to the end.
  const empty = res.hits.filter((h) => outlines.some((o) => o.id === h.id) && !h.articles.length);
  if (empty.length) log(`demoted (no relevant articles): ${empty.map((h) => h.id).join(", ")}`);
  res.hits = [...res.hits.filter((h) => !empty.includes(h)), ...empty];
  return res;
}

