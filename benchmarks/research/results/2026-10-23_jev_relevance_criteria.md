# Jev with criteria and JSON state (2026-10-23)

**TL;DR:** We reran the 93 documents of `2026-10-23_jev_relevance.md` with hand-written yes/no `criteria` and the document sent as a JSON `state` (`{title, published, text}`). Jev now gets 6 of the 8 hand-checked disagreements right, up from about 3, and separates relevant documents more clearly (71 of 73 grid-yes at p 0.7 or more, up from 66). The cost and speed are unchanged ($0.034, median 227 ms). One new mistake shows the catch: our criteria covered "security or notification fines" together, so Jev said yes to Uber (a notification fine) for an "art. 32 only" question. Criteria have to match the exact question, so the loop should write them with each grid question, not take them from a fixed list.

Script: `benchmarks/research/jev_relevance.ts --criteria --cases 2026-10-23_jev_relevance.json`; rows: `2026-10-23_jev_relevance_criteria.json`.

## Setup

- The same 93 cases and the same grid labels as the first test.
- Criteria: three hand-written pairs (`CRITERIA` in the script), one per kind of question: lists of fines, fines (security or notification), and 72-hour guidance.

## Results

| | Plain (first test) | Criteria + JSON |
|---|---|---|
| Agree with grid at 0.3 | 88 of 93 | 87 of 93 |
| Grid-yes with p of 0.7 or more | 66 of 73 | 71 of 73 |
| Grid-no with p of 0.22 or less | 16 of 20 | 15 of 20 |
| Hand-checked disagreements right (of 8) | about 3 | 6 |

Agreement with the grid barely moves, because the grid labels are often the ones that are wrong. The hand-checked cases are the better measure.

## Hand-checked disagreements

| Document | Plain p | Criteria p | Right? |
|---|---|---|---|
| boete-hagaziekenhuis (security fine) | 0.91 | 0.98 | yes |
| boete-uber-datalek (late reporting under art. 34a Wbp) | 0.69 | 0.96 | yes (the criteria count the Wbp) |
| datalek-wel-of-niet-melden | 0.38 / 0.59 | 0.97 / 0.96 | yes |
| datalek-dit-moet-u-doen (72-hour start) | 0.22 | 0.85 | yes |
| beleidsregels-meldplicht-datalekken-wbp | 0.22 | 0.86 | yes |
| jaarrapportage-meldplicht-datalekken-2019 | 0.46 | 0.94 | yes |
| jaarverslag-ap-2020 | 0.34 | 0.15 | no (probably relevant) |
| wob-besluit-lijsten-met-datalekken | 0.54 | 0.16 | unclear |

## New mistakes

- **boete-uber-datalek, "fine for violating art. 32 (security)?":** went from 0.05 to 0.93. Our fine criteria covered both kinds, and Jev followed the criteria over the narrower question.
- **brief-ap-college-eindhoven:** went from 0.81 to 0.46. Not checked.

## What it means for Jev recall

- Use criteria and JSON state: they help clearly on guidance pages and borderline fines, the documents the loops miss.
- Write criteria per grid question, in the same call where the loop writes the question. A fixed list per kind of question is too broad.
- Next: build Jev recall into deep search, then run the run 4 and run 6 setups with it.

## Caveats

- These are hand-written criteria. Whether Haiku writes criteria this good is still untested.
- Still one question (Q2b), and the hand check covers only 8 documents.
