# Q2b (AP breach-notification and security fines): all deep-search runs compared

**TL;DR:** Three runs so far. **Run 5** (Sonnet 5.5 loop and tables, Opus 5.5 draft, everything at effort low) took **95 s**, faster than Moonlit (135 s), for $1.16, but found only **17 of 31 facts (55%)**: at low effort each loop did 2-4 AP-only searches and one grid, then stopped, so the curator ruling, most of the 72-hour guidance and two fine splits were never reached. Of the earlier two, **Run 4** (question split into parallel loops, Haiku for loop and tables, 30 hits per search) cost **$0.84**, against $2.35 for run 3, and found more: **24 of 31 facts (77%)** against 21 (68%). It found the three fines run 3 missed (orthodontic practice, CP&A, Belastingdienst FSV), but missed the curator fine, which is only in a court ruling: its Rechtspraak searches used a syntax Rechtspraak doesn't support (now fixed). It was not faster: 456 s against 393 s, because the splitter kept both kinds of fine in one loop and the Haiku table calls took about 39 s each. Moonlit is still ahead: 30 of 31 facts in 135 s. That score is partly circular, though, since the reference list was built mostly from Moonlit's answer.

Question: which fines did the AP impose for not or late reporting a data breach, or for poor security, with organisation, year, amount and breached AVG provision per case, and what does the AP say about the 72-hour deadline. Coverage is counted against the fact list below (the 30 facts in `questions.json` → `reference`, plus one correct unique find). Moonlit's answer and trace: `benchmarks/research/moonlit/2026-10-20_q2b_answer.txt`, `2026-10-20_q2b_trace.md`.

## Model per step

The quote check itself is a word-for-word match without a model; only its fix call (when a quote fails) uses one.

| Run | 0. Split | 1. Search loop | 2. Tables | 3. Draft | 4. Answer | 5. Quote fix |
|---|---|---|---|---|---|---|
| 3 | none | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 4 | Haiku 5.5 | Haiku 5.5 (2 loops in parallel) | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 5 | Sonnet 5.5 | Sonnet 5.5 (3 loops in parallel) | Sonnet 5.5 | Opus 5.5 | Opus 5.5 | not needed |
| Moonlit | unknown | unknown | unknown | unknown | unknown | unknown |

Runs 3 and 4 ran every model at effort high, run 5 at effort low (`DEEP_EFFORT=low`).

## Cost per step

| Run | Setup | 0. Split | 1. Search loop | 2. Tables | 3. Draft | 4. Answer | 5. Quote check | **Total** |
|---|---|---|---|---|---|---|---|---|
| 3 | Q1 run 4 setup, but tables on Opus (`DEEP_TABLE_MODEL` not set) | – | $0.02 | $1.89 | $0.33 | $0.12 | $0 | **$2.35** |
| 4 | Split + parallel loops, 30 hits, new prompts, context cap | < $0.01 | $0.07 | $0.17 | $0.46 | $0.13 | $0.02 | **$0.84** |
| 5 | Run 4 setup plus the Rechtspraak prompt fix, Sonnet loop and tables, effort low | < $0.01 | $0.22 | $0.71 | $0.17 | $0.06 | $0 | **$1.16** |

Costs per step from the Langfuse traces (sessions `2026-10-20_q2b_run3`, `2026-10-20_q2b_run4`, `2026-10-20_q2b_run5`); they add up to the totals in the JSON results.

## Results

| Run | Time | API calls | Searches (sources + laws) | Documents | Correct facts (of 31) | Wrong facts | Rubric |
|---|---|---|---|---|---|---|---|
| 3 | 393 s | 19 | 25 + 4 | 23 | 21 (68%) | 0 found | 9–10 |
| 4 | 456 s | 42 | 36 + 9 | 45 | 24 (77%) | 0 found | 9–10 |
| 5 | 95 s | 20 | 9 + 0 | 16 | 17 (55%) | 2 (years) | 8 |
| Moonlit | 135 s | | 6 | 20 | 30 (97%) | 0 found | 10 |

Rubric (`rubric.md`): all three find most reference cases with the exact articles, name their gaps and back every claim with a quote that passed the check (run 3: 43 of 43; run 4: 41 of 42, 1 fixed). The deep runs lose a point where the gaps hide findable facts: run 4 says Rechtspraak was "not researched" and the Booking start date "not established", though both were findable. Run 5 (24 of 24 quotes passed) scores 8: it gives the publication year instead of the decision year for OLVG and CP&A (2021, decided 2020), and says no AP guidance on "kennisneming" was found, though run 4 found it.

## Fact list

✓ stated and correct, ✗ missing. Facts 1–30 are the `reference` in `questions.json` (`verified: false`); 31 was checked in `ap_doc` (`documenten/boete-cpa-verzuimregistratie`, letter dated 24 maart 2020).

| # | Fact | Run 3 | Run 4 | Run 5 | Moonlit |
|---|---|---|---|---|---|
| 1 | Uber, 6 Nov 2018, € 600,000, art. 34a lid 1 and 2 Wbp | ✓ | ✓ | ✓ (year only) | ✓ |
| 2 | Uber reported 371 days late | ✗ | ✓ ("ruim een jaar") | ✗ | ✓ |
| 3 | PVV Overijssel, 16 Jun 2020, € 7,500, art. 33 lid 1 AVG | ✓ | ✓ | ✓ | ✓ |
| 4 | PVV Overijssel never reported | ✓ | ✓ | ✓ | ✓ |
| 5 | Booking.com, 10 Dec 2020, € 475,000, art. 33 lid 1 AVG | ✓ | ✓ | ✓ | ✓ |
| 6 | Booking.com 22 days late | ✓ | ✗ | ✓ (16 Jan to 6 Feb 2019) | ✓ |
| 7 | HagaZiekenhuis, 18 Jun 2019, € 460,000, art. 32 lid 1 | ✓ | ✓ | ✓ | ✓ |
| 8 | Haga lowered to € 350,000 by Rb Den Haag | ✓ | ✓ | ✓ | ✓ |
| 9 | OLVG, 26 Nov 2020, € 440,000, art. 32 lid 1 | ✓ | ✓ | ✓ (but year 2021) | ✓ |
| 10 | Orthodontic practice, 4 Feb 2021, € 12,000, art. 32 lid 1 | ✗ | ✓ | ✓ | ✓ |
| 11 | CP&A, € 15,000, art. 9 lid 1 and 32 lid 1 | ✗ | ✓ | ✓ | ✓ |
| 12 | UWV, 31 May 2021, € 450,000, art. 13 Wbp and 32 lid 1 and 2 | ✓ | ✓ | ✓ | ✓ |
| 13 | Transavia, 23 Sep 2021, € 400,000, art. 32 lid 1 and 2 | ✓ | ✓ | ✓ | ✓ |
| 14 | BZ (NVIS), 24 Feb 2022, € 565,000, art. 32 lid 1 and 13 lid 1 onder e | ✓ | ✓ | ✓ | ✓ |
| 15 | BZ: € 465,000 of it for art. 32 | ✗ | ✗ | ✗ | ✓ |
| 16 | Financiën (FSV), 7 Apr 2022, € 3.7 million in total | ✗ | ✓ | ✓ | ✓ |
| 17 | FSV: € 500,000 of it for art. 32 lid 1 | ✗ | ✓ | ✗ ("not confirmed") | ✓ |
| 18 | SVB, 19 Jan 2023, € 150,000, art. 32 lid 1 and 2 | ✓ | ✓ | ✓ | ✓ |
| 19 | HAN, 15 Dec 2025, € 175,000, art. 32 | ✓ | ✓ | ✓ | ✓ |
| 20 | Curator, 9 Dec 2021, € 310,000, art. 5 lid 1 onder f jo. 32 lid 1 and 2 | ✓ | ✗ | ✗ | ✓ |
| 21 | Curator: € 148,750 on objection | ✓ | ✗ | ✗ | ✓ |
| 22 | Curator: Rb Gelderland lowered it to € 58,125 | ✓ | ✗ | ✗ | ✓ |
| 23 | The 72 hours start at "a reasonable degree of certainty" | ✓ | ✓ | ✗ | ✓ |
| 24 | Ongoing investigation is no reason to wait; report in stages | ✗ | ✓ | ✗ | ✓ |
| 25 | A late report needs a justification | ✓ | ✓ | ✓ | ✓ |
| 26 | AP step plan: first report within 72 hours, follow-up later | ✓ | ✓ | ✗ | ✓ |
| 27 | No report needed only if a risk is unlikely | ✓ | ✓ | ✗ | ✓ |
| 28 | Judged case by case; data seen by an unauthorised person is already a risk | ✗ | ✗ | ✗ | ✓ |
| 29 | The controller stays responsible when a processor is involved | ✓ | ✓ | ✗ | ✓ |
| 30 | Fear of reputational damage or waiting for a full investigation are no good reasons (Jaarrapportage 2021) | ✗ | ✗ | ✗ | ✓ |
| 31 | CP&A decision dated 24 Mar 2020 | ✗ | ✓ | ✗ (says 2021) | ✗ |
| | **Total** | **21** | **24** | **17** | **30** |

Run 4 also states 72-hour details nobody else has (weekend, holidays or a late-informed DPO are no excuse; ransomware breaches almost always need reporting; art. 41–42 UAVG exceptions; the € 10 million Uber fine of 2023 is not a breach fine). These are quoted but not yet checked, so they are not in the list.

## Per step: runs 3 to 5

| Step | Run 3 | Run 4 | Run 5 |
|---|---|---|---|
| 0. Split | – | 2 parts: all fines together, and the 72-hour rule. Q1 and Q2b split into 3 in a test, so the fines staying together is the model's choice, not a cap. | 3 parts: art. 33 fines, art. 32 fines, the 72-hour rule (Sonnet split by kind of fine without a prompt change). |
| 1. Search loop | One loop, 11 calls, 25 + 4 searches, mostly plain AND queries. Found the curator fine through its Rechtspraak ruling. Missed 3 AP fines: 10 hits per search covered about 5 fines. | Loop 1 (fines) 334 s, loop 2 (72 hours) 271 s, in parallel. 30 hits per search reached all 13 AP fine decisions. But 26 Rechtspraak searches used the bracketed boolean syntax, which only ACM and AP understand: 0–2 hits each, no ruling read, so the curator fine was lost. The context cap fired 8 times (about 24K tokens each). | 3 loops of 31, 32 and 43 s. Each did 2-4 searches and one grid (3 in all), then stopped. Every search was AP only: no Rechtspraak (curator fine lost) and no law search. The 72-hour loop ran 3 searches and read no AP guidance page. |
| 2. Tables | 6 Opus calls, $1.89, 207 s | 18 Haiku calls, $0.17, about 39 s each. Grids in one loop ran one after another, so loop 1 was mostly waiting on tables. | 6 Sonnet calls, $0.71, about 14 s each. 61% of the cost; at low effort Haiku would be about a tenth of that. |
| 3. Draft | Opus, 77 s, $0.33 | Opus, 79 s, $0.46 (45 documents against 23) | Opus low, 31 s, $0.17 (16 documents) |
| 4. Answer | Opus, 34 s | Opus, 37 s | Opus low, 17 s |

## What changed per run

- **Run 3:** Q1's run 4 setup, but `DEEP_TABLE_MODEL` was not set, so the tables ran on Opus (80% of the cost). AP search returned 10 hits, so each query covered about 5 fines (press release plus decision per fine).
- **Run 4:** tables default to Haiku; AP and ACM search return 30 hits in deep search; the loop starts each sub-question with one broad boolean query; one grid per sub-question with a yes/no relevance filter, over the decisions rather than the press releases; old search results are cleared past 80K prompt tokens; the question is split into parts with one loop each, in parallel.
- **Run 5:** Sonnet 5.5 for split, loop and tables, Opus 5.5 for draft and answer, every step at effort low; loop prompt now sends Rechtspraak and Kifid plain keywords. In run 4 about 85% of each Haiku table call's output was hidden thinking at effort high (for example 16K output tokens for about 2K of visible table), which is what low effort cuts.

## Next

- **Effort per step:** low is fast everywhere but makes the loop stop after one grid. Try effort per step: loop at medium (thorough), tables and draft at low (speed), tables back on Haiku (cost). That needs a separate effort setting per step; today `DEEP_EFFORT` sets all of them.
- **Speed:** the tables are the bottleneck. Try the Haiku tables at a lower effort (extraction needs little reasoning), and let a loop start its grids in one turn.
- **Splitter:** it kept both kinds of fine in one loop. Ask it to split lists by kind of case when each kind can be searched on its own.
- **Rechtspraak:** fixed after run 4. The loop prompt now says the boolean syntax is for ACM and AP only, and that Rechtspraak and Kifid need 2–4 plain keywords.
- **Recall:** neither run found facts 15, 28 and 30, though they are in documents both runs read. The gaps are in the grid questions.

## Caveats

- One run per setup, so differences of a few facts are within run-to-run variance.
- The reference was built mostly from Moonlit's answer and is not verified (`verified: false`), so Moonlit's 30 of 31 is partly circular. Facts only the deep runs found count once they are checked (fact 31).
- Scores are judgement calls, not a lawyer's check.
