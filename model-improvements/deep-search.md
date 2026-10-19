# Model improvement: deep search

- **Date:** 2026-10-18
- **Follows from:** [law-retrieval.md](law-retrieval.md) and [moonlit-vs-b.md](../competitor%20research/moonlit-vs-b.md)
- **Status:** Plan agreed. Connectors for ACM, Kifid, AP and rechtspraak built and wired into normal search (2026-10-18); deep search not built yet.

**TL;DR:** Moonlit wins on research questions because it loops: it searches many portals, fills tables, drafts with exact quotes and checks its claims. We keep normal search as it is and add deep search as a switchable mode on top. It uses normal search plus new connectors for ACM, Kifid, AP and rechtspraak as tools. None of these sources has an official search API except rechtspraak (and that one has no keyword search), but all four have a free, tested route. We build deep search in four stages that can each be switched on or off, first in `benchmarks/law-retrieval/deep/`, and measure it on two benchmarks. There's no time or search budget for now, so we can compare with Moonlit as closely as possible.

## What Moonlit does

From the traces of the 5-question run (`competitor research/moonlit-raw/2026-10-10-5-questions.md`):

1. **Plan.** It splits the question and plans searches.
2. **Search in parallel.** 6 broad searches, then about 19 targeted ones, over about 21 portals.
3. **Tables (`analyze_documents`).** 2–4 fixed questions over 6–12 documents. Each cell is a cited answer or "not in document".
4. **Draft.** About 1,600 words. Citations may only come from documents it analysed or read.
5. **Claim check, then revise.** Each claim is marked verified, contradicted or not supported. It published even though the second check still failed.

**Citation = an exact quote.** Each answer sentence links to a verbatim quote in the full source text, and that quote links to a table cell.

**The claim checker is noisy.** It checks claims against the wrong document, flags "I didn't find X" as unsupported, and marked correct claims as contradicted.

**Cost:** about 12 minutes for 5 questions, 25 searches, about 64 documents, 8 tables.

## What we have

**Normal search** (`app/src/lib/lawsearch/`): three approaches over the BWB (national legislation). B, the local full-text index plus 2 Claude calls, is best: 95% law@5 in 8 s. A (agentic live search) and C (catalog pick) also exist. `lawContext()` turns the hits into a prompt block with article texts. `app/src/lib/rechtspraak.ts` already searches rechtspraak.

**Source connectors** (`app/src/lib/sources/`, built 2026-10-18, all free, no auth needed). Normal search runs `sourcesContext()` next to `lawContext()`: one Haiku call makes keyword queries, then the top 3 documents per source go into the prompt (2–4 s, so no extra wait). `benchmarks/law-retrieval/sources-smoke.ts` found all 5 known Moonlit documents. ACM's live search is throttled by the site, so we allow 1 search per 5 s and fall back to sitemap titles; AP only has sitemap-title search.

| Source | Official API | How we access it | Full text | Watch out for |
|---|---|---|---|---|
| **ACM** (acm.nl) | No | Search: `GET /nl/zoeken?text=<q>` (HTML, 10 per page, filter `field_publication_type_name[Besluit]=Besluit`). Page: `/nl/publicaties/<slug>`, text in `<main>`. Crawl: `sitemap.xml?page=1..9`, RSS `/nl/nieuws/rss/publicaties` | Decision PDFs at `/system/files/documents/*.pdf` (text layer; they name the breached article) | Rapid free-text searches get sent to `/nl/system/403`. Space them out and retry, or build a local index from the sitemap. No reuse licence stated |
| **Kifid** (kifid.nl) | No (undocumented JSON used by the site) | `GET /api/Search/SearchDecision/?searchTerm=<q>&page=1&pageSize=N&sort=relevance` (keep the trailing slash) | In the same JSON: `pdfContent` holds the whole ruling; `statementLink` is the PDF | Undocumented, can change. Dates are .NET ticks. 14,872 rulings, so a full dump is about 149 calls. Reuse allowed with attribution |
| **AP** (autoriteitpersoonsgegevens.nl) | No | Crawl `sitemap.xml?page=1..3` (5,246 URLs) and index locally. Updates via `/actueel/rss.xml`. Page: `/documenten/<slug>`, body in `div.text-basic-html` | PDF link `<a data-type="pdf" href="/system/files?file=...">` (text layer) | robots.txt disallows the site's `/search`, so keyword search must run on our own index. Reuse of text allowed with attribution |
| **Rechtspraak** | Yes (Open Data), but no keyword search | Search: undocumented `POST uitspraken.rechtspraak.nl/api/zoek` (already in `rechtspraak.ts`) | Official `GET data.rechtspraak.nl/uitspraken/content?id=<ECLI>` (XML; already in `getRuling`) | `/api/zoek` is undocumented. Fallback: Open Data feed with filters, or the bulk zip plus our own index |

No CLI or SDK exists for any of them, and no paid third party is needed.

## Decisions (agreed 2026-10-18)

- **Normal search keeps its one-shot shape.** It now also searches the four sources once per question.
- **Deep search is a switchable mode on top.** It uses normal search and the source connectors as tools.
- **Built first as an experiment** in `benchmarks/law-retrieval/deep/`, using the `lib` code. Once it beats normal search on the research questions, it moves into the app behind a switch.
- **No time or search budget for now.** It searches as long as it needs, so we can compare it with Moonlit as closely as possible. We still log time, calls and cost.

## What to build, in order

Each stage has its own switch, so we can measure what it adds.

1. **Search loop.** Several rounds over normal search and the connectors. Each round uses what the last one found (names, article numbers, the documents' own words) until nothing new turns up.
2. **Table step.** Fixed questions over the documents found (for example: who was fined, how much, which article). One cell per document per question, with a quote or "not in document".
3. **Draft with exact quotes.** Every claim carries a verbatim quote and its source. A claim without a quote is dropped or marked as a gap.
4. **Quote check.** A deterministic check that each quote appears word for word in the source text (after normalising whitespace and quote marks). This replaces Moonlit's noisy model-based checker. A failed quote gets fixed or removed before the answer goes out.

## Hard rules

- **Nothing found is a gap, not a conclusion.** When searches turn up nothing, deep search reports "not found in <source>". It never concludes that something doesn't exist or only happened elsewhere. (Added 2026-10-19 after Q1: it missed Epic/Fortnite and wrongly said timers were only tackled in EU-wide actions.)

## Benchmarks

| Benchmark | What it measures | Runs on |
|---|---|---|
| **Law-finding** | law@5 on the existing gold set (`benchmarks/law-retrieval/questions.json`) | Normal and deep |
| **Research answers** | Moonlit's 5 questions, scored with a rubric (`benchmarks/research/questions.json`, `benchmarks/research/rubric.md`) | Deep only |

Moonlit's findings in `questions.json` are a reference, not gold: nobody has checked them.

## Open points

- **Decisions name the breached article** (ACM, AP, Kifid, rechtspraak). Extracting those could also feed law-finding for normal search; see the ideas in `moonlit-vs-b.md`.
- **More portals later:** AFM, Reclame Code Commissie, College voor de Rechten van de Mens, officiële bekendmakingen (bills and parliamentary papers, same SRU API), Belastingdienst kennisgroepen. Questions 3–5 need these, so deep search will score low there until they're added.
- **Live search or local index** for ACM and AP. A local index is more reliable (no throttle, no robots issue) but needs a refresh job.
- **Undocumented endpoints** (Kifid, rechtspraak `/api/zoek`) can break without notice. Cache results and keep a fallback.
- **The rubric scores are judgement calls** until a lawyer checks the reference answers.

## Results

| Date | Question | Deep search | Moonlit | Report |
|---|---|---|---|---|
| 2026-10-19 | Q1 `acm-dark-patterns` | 8/10, coverage 81%, precision 97% (1 wrong) | 6/10, coverage 36%, precision 100% | [`benchmarks/research/results/2026-10-19-acm-comparison.md`](../benchmarks/research/results/2026-10-19-acm-comparison.md) |

Q1 ran on the first, unoptimised version (no context trimming, Opus at high effort for every step, ≈ $5 per question). Re-run it after the cost fixes for a clean comparison; Q2–Q5 haven't run yet. Token breakdown: `benchmarks/research/results/2026-10-19-token-usage.excalidraw`.
