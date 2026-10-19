import { attrsOf, childrenOf, flatten, parseOrdered, parsePlain, tagOf, tidy, type XNode } from "./xml";

const SRU = "https://zoekservice.overheid.nl/sru/Search";
export const HEADERS = { Accept: "application/xml", "User-Agent": "loopjongen-bwb/1.0 (+wesselchi123@gmail.com)" };
const today = () => new Date().toISOString().slice(0, 10);

export type LawHit = {
  id: string;
  title: string;
  type: string;
  authority: string;
  areas: string[];
  validFrom: string;
  url: string;
  xmlUrl: string;
};

function sruUrl(query: string, start = 1, max = 20) {
  const p = new URLSearchParams({
    operation: "searchRetrieve",
    version: "2.0",
    "x-connection": "BWB",
    startRecord: String(start),
    maximumRecords: String(max),
    query,
  });
  return `${SRU}?${p}`;
}

function toHit(record: Record<string, any>): LawHit {
  const gzd = record.recordData.gzd;
  const meta = gzd.originalData.meta;
  const kern = meta.owmskern;
  const ipm = meta.bwbipm ?? {};
  const id = String(kern.identifier);
  const validFrom = String(ipm.geldigheidsperiode_startdatum ?? "");
  const title = typeof kern.title === "object" ? kern.title["#text"] : kern.title;
  return {
    id,
    title: String(title),
    type: String(kern.type ?? ""),
    authority: String(kern.authority ?? ""),
    areas: (ipm.rechtsgebied ?? []).map(String),
    validFrom,
    url: `https://wetten.overheid.nl/${id}/${validFrom}`,
    xmlUrl: String(gzd.enrichedData?.locatie_toestand ?? ""),
  };
}

async function sru(query: string, start = 1, max = 20) {
  const res = await fetch(sruUrl(query, start, max), { headers: HEADERS });
  if (!res.ok) throw new Error(`wetten.overheid.nl gaf status ${res.status}`);
  const doc = parsePlain(await res.text()) as Record<string, any>;
  const r = doc.searchRetrieveResponse;
  const records: Record<string, any>[] = r?.records?.record ?? [];
  return { total: Number(r?.numberOfRecords ?? 0), hits: records.map(toHit) };
}

const ALIASES: Record<string, string> = {
  bw: "Burgerlijk Wetboek",
  rv: "Wetboek van Burgerlijke Rechtsvordering",
  sr: "Wetboek van Strafrecht",
  sv: "Wetboek van Strafvordering",
  awb: "Algemene wet bestuursrecht",
  atw: "Arbeidstijdenwet",
  wml: "Wet minimumloon en minimumvakantiebijslag",
  avg: "Uitvoeringswet Algemene verordening gegevensbescherming",
};

function expand(term: string) {
  const m = term.toLowerCase().match(/^bw\s*(?:boek\s*)?(\d{1,2})$/);
  if (m) return `Burgerlijk Wetboek Boek ${m[1]}`;
  return ALIASES[term.toLowerCase()] ?? term;
}

/** Exact title first, then titles starting with the term, then formal acts, then shorter titles. */
function rank(term: string, h: LawHit) {
  const t = h.title.toLowerCase();
  const q = term.toLowerCase();
  const typeScore = ["wet", "wetboek"].includes(h.type.toLowerCase()) ? 0 : h.type === "AMvB" ? 1 : 2;
  return (t === q ? 0 : t.startsWith(q) ? 1000 : 2000) + typeScore * 100 + Math.min(t.length, 99);
}

export async function searchLaws(q: string, page = 1) {
  const term = expand(q.trim().replace(/["\\]/g, " "));
  const filter = `overheidbwb.geldigheidsdatum==${today()}`;
  const query = /^BWBR\d{7}$/i.test(term)
    ? `dcterms.identifier==${term.toUpperCase()} and ${filter}`
    : `overheidbwb.titel all "${term}" and ${filter}`;
  const res = await sru(query, (page - 1) * 20 + 1, 20);
  res.hits.sort((a, b) => rank(term, a) - rank(term, b));
  return res;
}

export type LawItem =
  | { kind: "heading"; level: number; text: string }
  | { kind: "article"; label: string; title: string; text: string; url: string };

const STRUCTURE = new Set([
  "boek", "deel", "titeldeel", "hoofdstuk", "afdeling", "paragraaf", "sub-paragraaf", "circulaire.divisie", "divisie",
]);
const SKIP = new Set(["meta-data", "kop", "redactie", "bwb-wijzigingen", "bwb-inputbestand", "redactionele-correcties"]);
const SKIP_BUT_NOTES = new Set([...SKIP].filter((t) => t !== "redactie"));
const BLOCKS = new Set(["al", "li", "lid", "lijst", "tussenkop", "row", "table", "tgroup", "aanhef", "considerans.al"]);

function kopText(node: XNode) {
  const kop = childrenOf(node).find((c) => tagOf(c) === "kop");
  if (!kop) return { label: "", nr: "", titel: "" };
  const part = (t: string) =>
    tidy(flatten(childrenOf(kop).filter((c) => tagOf(c) === t), new Set(), new Set(["meta-data"])));
  return { label: part("label"), nr: part("nr"), titel: part("titel") };
}

function articleText(node: XNode) {
  const parts: string[] = [];
  for (const c of childrenOf(node)) {
    const t = tagOf(c);
    if (!t || SKIP.has(t)) continue;
    if (t === "lid") {
      const nr = childrenOf(c).find((x) => tagOf(x) === "lidnr");
      const nrText = nr ? tidy(flatten([nr], new Set(), new Set())) : "";
      const rest = childrenOf(c).filter((x) => tagOf(x) !== "lidnr");
      parts.push(`${nrText ? nrText + ". " : ""}${tidy(flatten(rest, BLOCKS, SKIP))}`);
    } else if (t === "lijst") {
      for (const li of childrenOf(c).filter((x) => tagOf(x) === "li")) {
        const nr = childrenOf(li).find((x) => tagOf(x) === "li.nr");
        const rest = childrenOf(li).filter((x) => tagOf(x) !== "li.nr");
        parts.push(`${nr ? tidy(flatten([nr], new Set(), new Set())) + " " : ""}${tidy(flatten(rest, BLOCKS, SKIP))}`);
      }
    } else if (t !== "#text") {
      parts.push(tidy(flatten([c], BLOCKS, SKIP)));
    }
  }
  const text = parts
    .filter(Boolean)
    .join("\n")
    .replace(/(^|\n)((?:[a-z]{1,3}|\d{1,3}°?|[ivx]{1,5})\.?)\n+/g, "$1$2 ")
    .replace(/\n{2,}/g, "\n");
  // Amending acts (verzamelwetten) only keep an editorial note, e.g. "Wijzigt de Faillissementswet."
  return text || tidy(flatten(childrenOf(node), BLOCKS, SKIP_BUT_NOTES));
}

function walk(nodes: XNode[], ctx: { id: string; date: string; depth: number; out: LawItem[] }) {
  for (const n of nodes) {
    const t = tagOf(n);
    if (!t || t === "#text" || SKIP.has(t)) continue;
    if (t === "artikel") {
      const { label, nr, titel } = kopText(n);
      const anchor = (attrsOf(n)["bwb-ng-variabel-deel"] ?? "").replace(/^\//, "").replace(/\//g, "_");
      ctx.out.push({
        kind: "article",
        label: [label, nr].filter(Boolean).join(" ") || attrsOf(n).label || "Artikel",
        title: titel,
        text: articleText(n),
        url: `https://wetten.overheid.nl/${ctx.id}/${ctx.date}${anchor ? "#" + anchor : ""}`,
      });
      continue;
    }
    if (STRUCTURE.has(t)) {
      const { label, nr, titel } = kopText(n);
      const head = [label, nr].filter(Boolean).join(" ");
      if (head || titel) {
        ctx.out.push({ kind: "heading", level: Math.min(ctx.depth + 1, 4), text: [head, titel].filter(Boolean).join(". ") });
      }
      walk(childrenOf(n), { ...ctx, depth: ctx.depth + 1 });
      continue;
    }
    walk(childrenOf(n), ctx);
  }
}

/** Parse a BWB toestand XML into headings and articles; `date` is the validFrom used in article urls. */
export function parseLaw(xml: string, id: string, date: string): LawItem[] {
  const items: LawItem[] = [];
  walk(parseOrdered(xml), { id, date, depth: 0, out: items });
  return items;
}

type Law = { id: string; title: string; validFrom: string; url: string; items: LawItem[] };
const cache = new Map<string, Law>();

export async function getLaw(id: string): Promise<Law> {
  const key = `${id}:${today()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { hits } = await sru(`dcterms.identifier==${id} and overheidbwb.geldigheidsdatum==${today()}`, 1, 1);
  const meta = hits[0];
  if (!meta?.xmlUrl) throw new Error(`Geen geldende versie gevonden voor ${id}`);
  const res = await fetch(meta.xmlUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Repository gaf status ${res.status}`);
  const items = parseLaw(await res.text(), id, meta.validFrom);
  const law = { id, title: meta.title, validFrom: meta.validFrom, url: meta.url, items };
  if (cache.size > 15) cache.delete(cache.keys().next().value!);
  cache.set(key, law);
  return law;
}
