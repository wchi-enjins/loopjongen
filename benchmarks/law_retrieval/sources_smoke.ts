/**
 * Smoke test for the source connectors (app/src/lib/sources): for each of Moonlit's 5 questions, search every source
 * with hand-written keyword queries, print the top 5 hits, fetch the full text of the first hit and mark whether the
 * documents Moonlit found show up. No Claude calls.
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs benchmarks/law_retrieval/sources_smoke.ts [--q 1]...
 */
import { readFileSync } from "node:fs";
import { LABELS, SOURCES, getSourceDoc, type Source, type SourceDoc } from "../../app/src/lib/sources/index.ts";

const md = readFileSync(new URL("../../competitor_research/moonlit_raw/2026-10-10_5_questions.md", import.meta.url), "utf8");
const questions = [...md.matchAll(/^\d\. .*?▎ (.*)$/gm)].map((m) => m[1].replace(/ Tests .*$/, "").trim());

const QUERIES: Record<Source, string[]>[] = [
  { acm: ["nepkorting", "epic fortnite"], ap: ["dark patterns"], kifid: ["misleidende korting"], rechtspraak: ["nepkortingen ACM"] },
  { acm: ["cookies"], ap: ["kruidvat cookies", "tracking cookies boete"], kifid: ["cookies"], rechtspraak: ["cookiewall"] },
  { acm: ["achteraf betalen"], ap: ["kredietcheck"], kifid: ["klarna", "achteraf betalen incassokosten"], rechtspraak: ["achteraf betalen kredietkosten", "klarna"] },
  { acm: ["influencer"], ap: ["algoritme krediet"], kifid: ["kredietcheck"], rechtspraak: ["reclame code commissie influencer"] },
  { acm: ["btw"], ap: ["betaaldienst"], kifid: ["btw achteraf betalen"], rechtspraak: ["afstandsverkopen btw", "btw achteraf betalen"] },
];

const KNOWN: { q: number; source: Source; name: string; match: (d: SourceDoc) => boolean }[] = [
  { q: 1, source: "acm", name: "ACM nepkortingen boetebesluiten (2 mei 2024)", match: (d) => /boete.*nepkorting/.test(d.id) },
  { q: 1, source: "acm", name: "ACM Epic/Fortnite besluit", match: (d) => /epic/.test(d.id) },
  { q: 2, source: "ap", name: "AP boete Kruidvat (tracking cookies)", match: (d) => /kruidvat/.test(d.id) },
  { q: 3, source: "kifid", name: "Kifid 2026-0304 Klarna", match: (d) => d.id.includes("2026-0304") },
  { q: 3, source: "rechtspraak", name: "HR ECLI:NL:HR:2023:778", match: (d) => d.id === "ECLI:NL:HR:2023:778" },
];

const args = process.argv.slice(2);
const only = args.flatMap((a, i) => (args[i - 1] === "--q" ? [Number(a)] : []));
const summary: string[] = [];

for (const [qi, question] of questions.entries()) {
  const q = qi + 1;
  if (only.length && !only.includes(q)) continue;
  console.log(`\n=== Vraag ${q}: ${question}`);
  const found: SourceDoc[] = [];
  for (const source of Object.keys(SOURCES) as Source[]) {
    for (const query of QUERIES[qi][source]) {
      let hits: SourceDoc[] = [];
      try {
        hits = (await SOURCES[source].search(query)).slice(0, 5);
      } catch (err) {
        console.log(`\n[${LABELS[source]}] "${query}": FOUT ${err instanceof Error ? err.message : err}`);
        continue;
      }
      found.push(...hits);
      console.log(`\n[${LABELS[source]}] "${query}": ${hits.length} hits`);
      hits.forEach((h, i) => console.log(`  ${i + 1}. ${h.title.slice(0, 110)} (${h.date})\n     ${h.url}${h.snippet ? `\n     ${h.snippet.replace(/\s+/g, " ").slice(0, 140)}` : ""}`));
      if (query === QUERIES[qi][source][0] && hits[0]) {
        try {
          const t0 = Date.now();
          const doc = await getSourceDoc(source, hits[0].id);
          console.log(`  -> volledige tekst #1: "${doc.title}" (${doc.date}), ${doc.text.length} tekens, ${Date.now() - t0} ms: ${doc.text.replace(/\s+/g, " ").slice(0, 160)}…`);
        } catch (err) {
          console.log(`  -> volledige tekst #1: FOUT ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }
  for (const k of KNOWN.filter((k) => k.q === q)) summary.push(`${found.some((d) => d.source === k.source && k.match(d)) ? "FOUND  " : "MISSING"} Q${q} ${k.name}`);
}

console.log(`\n=== Moonlit-documenten\n${summary.join("\n")}`);
