import { childrenOf, findFirst, flatten, parseOrdered, parsePlain, tidy } from "./xml";

export type RulingHit = {
  ecli: string;
  title: string;
  summary: string;
  decided: string;
  published: string;
  type: string;
  areas: string[];
  procedures: string[];
  references: string[];
  url: string;
};

export type Sort = "relevance" | "date";

export async function searchRulings(q: string, page = 1, sort: Sort = "relevance") {
  const pageSize = 20;
  const res = await fetch("https://uitspraken.rechtspraak.nl/api/zoek", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      StartRow: (page - 1) * pageSize,
      PageSize: pageSize,
      ShouldReturnHighlights: false,
      ShouldCountFacets: false,
      SortOrder: sort === "date" ? "UitspraakDatumDesc" : "Relevance",
      SearchTerms: [{ Term: q, Field: "AlleVelden" }],
      Contentsoorten: [],
      Rechtsgebieden: [],
      Instanties: [],
      DatumPublicatie: [],
      DatumUitspraak: [],
      Advanced: { PublicatieStatus: "AlleenGepubliceerd" },
      CorrelationId: crypto.randomUUID(),
      Proceduresoorten: [],
    }),
  });
  if (!res.ok) throw new Error(`rechtspraak.nl gaf status ${res.status}`);
  const data = (await res.json()) as { ResultCount: number; Results: Record<string, any>[] };
  const hits: RulingHit[] = (data.Results ?? []).map((r) => ({
    ecli: r.TitelEmphasis,
    title: r.Titel,
    summary: r.Tekstfragment ?? "",
    decided: r.Uitspraakdatum ?? "",
    published: r.Publicatiedatum ?? "",
    type: r.GerechtelijkProductType ?? "",
    areas: r.Rechtsgebieden ?? [],
    procedures: r.Proceduresoorten ?? [],
    references: (r.Vindplaatsen ?? []).map((v: any) => v.Vindplaats).filter((v: string) => v && v !== "Rechtspraak.nl"),
    url: r.DeeplinkUrl ?? `https://uitspraken.rechtspraak.nl/details?id=${r.TitelEmphasis}`,
  }));
  return { total: data.ResultCount ?? 0, hits };
}

const BLOCKS = new Set(["para", "title", "listitem", "row", "paragroup"]);
const SPLIT = new Set(["parablock", "section", "paragroup"]);

export const ECLI_RE = /^ECLI:[A-Z]{2}:[A-Z0-9]{1,7}:\d{4}:[A-Z0-9.]{1,25}$/i;

export async function getRuling(ecli: string) {
  const res = await fetch(`https://data.rechtspraak.nl/uitspraken/content?id=${encodeURIComponent(ecli)}`);
  if (!res.ok) throw new Error(`rechtspraak.nl gaf status ${res.status}`);
  const xml = await res.text();

  const plain = parsePlain(xml) as Record<string, any>;
  const descs = plain["open-rechtspraak"]?.RDF?.Description;
  const d = (Array.isArray(descs) ? descs[0] : descs) ?? {};
  const val = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
  const list = (v: any): string[] => (v == null ? [] : (Array.isArray(v) ? v : [v]).map(val).filter(Boolean));

  const tree = parseOrdered(xml);
  const section = (tag: string) => {
    const node = findFirst(tree, tag);
    if (!node) return "";
    // parablocks/sections become paragraphs, para/title become lines
    const blocks = new Set([...BLOCKS, ...SPLIT]);
    return tidy(flatten(childrenOf(node), blocks, new Set()).replace(/\n(?=\n)/g, "\n"));
  };
  const body = section("uitspraak") || section("conclusie");
  const bodyType = findFirst(tree, "uitspraak") ? "Uitspraak" : findFirst(tree, "conclusie") ? "Conclusie" : "";

  return {
    ecli: val(d.identifier) || ecli,
    court: val(d.creator),
    decided: val(d.date),
    published: val(d.issued),
    caseNumbers: list(d.zaaknummer),
    type: val(d.type) || bodyType,
    procedures: list(d.procedure),
    areas: list(d.subject),
    references: list(d.hasVersion?.list?.item ?? d.hasVersion),
    summary: section("inhoudsindicatie"),
    body,
    url: `https://uitspraken.rechtspraak.nl/details?id=${ecli}`,
    sourceUrl: `https://data.rechtspraak.nl/uitspraken/content?id=${ecli}`,
  };
}
