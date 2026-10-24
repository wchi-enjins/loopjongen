# Jev as a relevance filter before grid tables (2026-10-23)

**TL;DR:** TypeSafe's Jev (`jev-latest`, served as jev-1.14.0) answered the grid's yes/no relevance question for 93 documents from Q2b runs 4 to 8 in about 0.25 s each, for $0.03 in total. At a cutoff of 0.2 it would have skipped 15 of the 20 documents the grids judged irrelevant, and dropped none they judged relevant. Where they disagree, the grid is wrong about as often as Jev. The saving is modest: the loops already pick mostly relevant documents (73 of 93), so a filter cuts about 16% of the documents sent to the tables. That's worth about $0.27 per run with Opus tables, and little with Haiku tables.

Script: `benchmarks/research/jev_relevance.ts`; rows per document: `2026-10-23_jev_relevance.json`.

## Setup

- **Ground truth:** every grid in the Q2b runs 4–8 whose first question asks yes or no (14 questions, 93 documents). The table model's answer to that question counts as the label: 73 yes, 20 no. Run 5 had no such grid.
- **Jev input:** the same document text the table saw (title, then `clip` to 30,000 characters, as in `fillTable`), with the grid's own question as one `noul` question. Jev returns the probability of yes.
- **Dutch:** works. The questions were mixed Dutch and English, and all documents are Dutch.
- **Context:** documents averaged about 8,600 input tokens. No errors at 30,000 characters.

## Results

| Cutoff (yes if p ≥) | Agree with grid | Relevant dropped | Irrelevant skipped (of 20) |
|---|---|---|---|
| 0.2 | 88 of 93 | 0 | 15 |
| 0.3 | 88 of 93 | 1 | 16 |
| 0.5 | 85 of 93 | 4 | 16 |

- **Cost:** 800,920 input tokens, $0.034 (output is free). That is about $0.0004 per document.
- **Speed:** median 247 ms, max 738 ms per document, 4 in parallel.
- **Separation:** when the grid said yes, Jev's p was 0.7 or more for 68 of 73 documents. When it said no, p was 0.22 or less for 16 of 20.

## Disagreements (checked by hand)

| Document | Grid | Jev p | Who is right |
|---|---|---|---|
| boete-hagaziekenhuis ("fine for late notification or insufficient security?") | no | 0.91 | Jev: Haga is a security fine (art. 32) |
| boete-uber-datalek ("about the 72-hour term or late reporting under art. 33?") | no | 0.69 | Unclear: late reporting, but under art. 34a Wbp, not art. 33 |
| datalek-wel-of-niet-melden (two near-identical questions) | yes / no | 0.38 / 0.59 | Grid is inconsistent; the page is relevant (when to report) |
| datalek-dit-moet-u-doen ("when does the 72-hour period start?") | no | 0.22 | Jev: run 6 took 72-hour facts from this page |
| wob-besluit-lijsten-met-datalekken ("lists AP fines?") | no | 0.54 | Unclear |
| beleidsregels-meldplicht-datalekken-wbp ("relevant for the 72 hours?") | yes | 0.22 | Grid: it defines "onverwijld" as 72 hours under the Wbp |
| jaarverslag-ap-2020 ("relevant for the 72 hours?") | yes | 0.34 | Probably grid |
| jaarrapportage-meldplicht-datalekken-2019 ("about late reported breaches?") | yes | 0.46 | Grid |

## What it would change

- **As a filter before the tables:** skip documents with p < 0.2. In these runs that is about 16% fewer documents in the tables, so about 16% less table cost and time. Run 6 (Opus tables, $1.71) would save about $0.27, at about $0.01 of Jev. Runs with Haiku tables (run 4: $0.17) save little in money, a bit in time.
- **Better use to test next:** recall, not filtering. The loops lost facts because they never put the right documents in a grid (the AP guidance pages in runs 5 and 7, the curator ruling in runs 4 and 8). Jev could score all 30 hits of every search on full text for each sub-question, at about $0.01 per search, and hand the loop the top ones.

## Caveats

- The grid labels are not gold: the table model judged them, and several are wrong (see above).
- One question (Q2b) and 93 documents. The cutoff of 0.2 is tuned on the same data it is reported on.
- TypeSafe does not publish a context window, language support or data retention policy. That still matters before client text goes to it in the app.
