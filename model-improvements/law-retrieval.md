# Model improvement: a search tool that finds the right law

- **Date:** 2026-10-09
- **Follows from:** [article-selection.md](article-selection.md). The model reasons well once it has the right regulation (R3: 30/30); finding the regulation is the bottleneck.
- **Status:** A, B and C built and evaluated on 2026-10-09. B is best (see Results).

## Findings

- **The benchmark regulation is in our source.** *Privacy-regeling centrale registratie tuchtrechtelijke gegevens Koninklijke Marine 1985* is `BWBR0003866` in the BWB. Our search misses it because `searchLaws` (`app/src/lib/wetten.ts`) only matches **title words** (`overheidbwb.titel all "<term>"`), and the questions never use them ("matroos", "tuchtstraf", "bevorderd").
- **Trap:** a near-identical Landmacht version exists (`BWBR0003865`). "Matroos" should lead to Marine.
- **The SRU API has no full-text search.** Searchable fields: title, abbreviation, type, ministry (`authority`), legal area (`rechtsgebied`), government domain, dates. The "search in text" box on wetten.overheid.nl is not in the API.
- The chat has no search tools yet; `/genereren` only adds fixed BW articles.

## BWB size and access

- **22,272 regulations in force** (2026-10-09): 7,922 ministerial regulations, 3,595 treaties, 2,533 acts, 2,073 ZBO rules, 1,784 AMvBs, 1,095 beleidsregels, and smaller groups.
- **Size:** the first 1,000 laws took 122 MB in 106 s, so the full set is roughly 2.7 GB and about 40 minutes.
- **No official bulk download**; we list via SRU (up to 5,000 records per call) and fetch each XML from the repository. `BWBIdList.xml.zip` (3.7 MB) lists every id with its titles.
- **Rate limits:** none documented ([Handleiding SRU BWB](https://data.overheid.nl/sites/default/files/dataset/ab78ba3f-bc07-49cc-95f2-0e23b8653181/resources/Handleiding%2BSRU%2BBWB.pdf)) and none seen in tests. The data is CC-0. `zoekservice.overheid.nl/robots.txt` disallows crawlers. SRU returns 406 without `Accept: application/xml`.
- **Politeness:** we send `User-Agent: loopjongen-bwb/1.0 (+wesselchi123@gmail.com)` (`wetten.ts` and `scripts/bwb-sync.ts`), run 3 parallel requests with 250 ms gaps, back off on 429/5xx, and cache everything. If we get blocked, we contact KOOP; we don't switch IPs.
- **Download:** `node scripts/bwb-sync.ts [--limit N]` writes to `data/bwb/xml/` and `data/bwb/manifest.json` (gitignored). Reruns skip files already on disk.

## Other Dutch sources (later)

| Source | Content | Note |
|---|---|---|
| CVDR | Local regulations (municipalities, provinces, water boards) | Same SRU API (`x-connection=cvdr`), about 344k records |
| Officiële bekendmakingen | Staatsblad, Staatscourant, Kamerstukken | Explanatory memoranda; old texts |
| DSO / Ozon | Omgevingswet plans | API key needed |
| EUR-Lex | EU law | Public API |

## Approaches

| | Idea | Status |
|---|---|---|
| **A. Agentic live search** | Model gets tools over SRU (title any/all, type, ministry, legal area) plus article reading; plans, searches, refines | Built |
| **B. Local full-text index** | All BWB articles in Postgres full-text search (Dutch stemming) | Built, best |
| **C. Catalog + LLM pick** | Model narrows the 22k-title catalog (ministry, type, area, guessed titles), then picks laws and articles | Built |

Evaluation: a gold set of about 20 Dutch questions with the correct BWB id and articles (including the 3 tuchtrecht questions), scored on law recall@1/@5, article recall, latency and cost. Code lives in `benchmarks/law-retrieval/`. The winner moves to `app/src/lib` as a chat tool.

## Results

**2026-10-09, gold set of 21 questions** (Opus 5.5, effort low; full report in `benchmarks/law-retrieval/results/2026-10-09.md`):

| Approach | law@5 | law@1 | article recall | avg time | avg cost |
|---|---|---|---|---|---|
| **B. Full-text index + 2 LLM calls** | **95%** | **90%** | 88% | **8 s** | **$0.045** |
| A. Agentic live search | 90% | 86% | **90%** | 14 s | $0.13 |
| C. Catalog + LLM pick | 90% | 71% | 81% | 14 s | $0.20 |
| B-raw (full-text, no LLM) | 5% | 0% | 5% | 10 s | $0 |

**B (results in `results/2026-10-09-b.md`)** is the best overall: the most often right, the fastest and about 3× cheaper than A.
- **How it works:** all 397,655 articles of 22,271 laws sit in Postgres table `bwb_article`, 848 MB. Postgres full-text search uses Dutch stemming and weights title > heading > text, with a GIN index. The table builds in 105 s with `b-fulltext/index.ts`, and `wetten.ts` now exports `parseLaw()` for it.
- **The two Claude calls:**
  1. Claude writes 3–6 queries, each a set of AND-ed concepts with OR-ed synonyms.
  2. Rankings are fused (RRF), then Claude picks laws and articles from the top 15.
- **Fixed** *lesmotor*: the words appear in the article text, not the title.
- **Still missed** *diplomaat*: the articles say "geprivilegieerde" and "kennisneming", never "ambassade" or "inzage". This is a vocabulary gap, and embeddings or a second query round could fix it.
- **Article losses** (Awb 6:7, Invorderingsregeling 1ce): for big laws, the pick step only sees the 5 best articles per law.
- **B-raw shows the LLM query step is what makes B work.** Raw question words in one OR query are useless.

**A and C:**

- **Tuchtrecht questions (both approaches):** Q2 and Q3 have Marine first. On Q1, Landmacht comes first with Marine second, which counts as found. All gold articles were found. Without a search tool, the chat and Moonlit Luna couldn't find this regulation at all.
- **Common and mid questions:** A gets 11/11 in first place. C gets 10/11; on the proeftijd question BW Boek 7 came only 4th and its articles were never read.
- **Both approaches missed the same 2 obscure questions,** because the law's title shares no words with the question:
  - *lesmotor*: the question says "lesaanduiding", but the law is titled *Regeling vaststelling L-bord*.
  - *diplomaat*: the question is about personal data at an embassy, but the law is titled *Beleidsregels Protocollaire Basisadministratie*.

  Both approaches only search titles, so this is a ceiling for both. Full-text search (approach B) is what would close it.
- **A wins:** it's more often first, finds more articles and is cheaper. Its cost varies more: the 2 misses cost $0.35–0.70 because it kept searching.

**Backend load (2026-10-10).** Each approach ran on 3 questions (`awb-bezwaartermijn`, `arbeid-dagelijkse-rusttijd`, `tuchtrecht-km-correctie`), one process per approach. Results are in `results/2026-10-10-load-{a,b,c}.md`. The table shows the average per question; Postgres is measured from its container's cgroup counters.

| | Backend CPU | Backend memory | Postgres CPU (net) | overheid.nl calls (wait) | Claude cost |
|---|---|---|---|---|---|
| A | 190 ms | ~270 MB | 0 | 2.7 (0.2 s) | $0.055 |
| B | 55 ms | ~100 MB | **~1.2 s** (0.2–2.5 s) | 0 | $0.049 |
| C | 520 ms | ~260 MB | 0 | 6.0 (1.6 s) | $0.216 |

- **Postgres has background noise** of about 9 ms of CPU per second, which A and C also show. B's figure above has that noise subtracted.
- **Disk reads were 0 MB**, so the index (848 MB) sits fully in memory. The container uses about 1.3 GB.
- **Server cost is negligible:** about 1.2 CPU-seconds per question is a fraction of a cent, while Claude costs $0.05–0.20. One vCPU of Postgres handles roughly 1 B question per second, so a small database server with 2 vCPU and about 4 GB RAM is plenty to start with.
- **B's heavy queries** come from common words (the Awb question took 2.5 s of CPU) and from `ts_headline`. Both can be optimized later.
- **B varies between runs.** In this run B missed `tuchtrecht-km-correctie` (Landmacht only) and found no Awb articles, while both were right in the full run. Repeat the 21-question run several times before trusting B's 95%.

Rerun:

```bash
set -a && . ./.env && set +a && node --no-warnings --import ./benchmarks/law-retrieval/resolve-ts.mjs benchmarks/law-retrieval/run.ts   # --approach a|c, --case <id>, --dry
```

What exists in `benchmarks/law-retrieval/`:
- **`questions.json`**: 21 gold questions (5 common, 6 mid, 10 obscure, including the 3 tuchtrecht questions). Each gold article was checked against the law text, and no question contains its law's title.
- **`a-agentic/search.ts`**: a tool loop (up to 12 turns) with `search_laws`, `get_law_outline`, `read_articles` and `finish`.
- **`c-catalog/search.ts`**: 3 fixed calls. It guesses filters and title words, scores 22k titles locally, picks laws, then picks articles.
- **`run.ts`**: measures law@1/@5, article recall, time and cost, with breakdowns by difficulty and for the tuchtrecht questions.
- **`resolve-ts.mjs`**: lets plain Node import `app/src/lib/wetten.ts`.

A review found and removed benchmark-specific hints from both prompts: the example words "registratie tuchtrechtelijke" and "tucht", and the "armed forces branch" example.

**Open points:**
- Next: improve B with cheap fixes. Show more matched articles for big laws, raise the 30-hits-per-query cap, and add a second query round using the candidates' own vocabulary. Then consider a hybrid with embeddings for vocabulary gaps, or A with B's `searchText` as a tool.
- Keeping the index current: rebuilding takes 2 min. `bwb-sync.ts` plus `index.ts` can run nightly, or only on changed laws.
- The gold set is small (21 questions) and was written by an agent. Have a lawyer check it and add more obscure questions.
- Q1 on its own doesn't say "Marine", so both approaches put Landmacht first. Their article 10(2) differs: deletion at unit level after 1 year for Marine, 4 years for Landmacht. Decision (2026-10-09): for now, a result list that includes the right law counts as found, so **law@5 is the headline metric** and law@1 is secondary. Gold stays Marine only.
- `getLaw` labels articles in BW books without the book number ("Artikel 652" instead of "7:652"). `run.ts` corrects for this.
- `getLaw` returns no articles for some beleidsregels, where the content sits in an annex. Possible parser bug: "4.1" appears twice in the Regeling houders van dieren.
