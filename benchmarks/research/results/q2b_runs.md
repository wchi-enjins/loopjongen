# Q2b (AP breach-notification and security fines): all deep-search runs compared

**TL;DR:** Six runs so far. **Run 8** (Opus 5.5 at low for split, loop, draft and answer, Haiku 5.5 at high for the tables) costs the same as run 4 (**$0.82**) and is twice as fast (**235 s**), but found **21 of 32 facts (66%)**, 3 fewer than runs 4 and 6, with no wrong facts. The Haiku tables cut the table cost from $1.71 to $0.08 but took 42 s per call, so run 8 is slower than run 6; and its loop never searched Rechtspraak (curator fine lost) or read the AP guidance page on reporting in stages. Of the earlier five, **Run 6** (Opus 5.5 at effort low for every step) is the best so far: **24 of 32 facts (75%)**, the same as run 4, with no wrong facts, in **192 s** (run 4: 456 s), for **$2.57**. It is the only deep run that found the curator fine (in a Rechtspraak ruling), most of the 72-hour guidance and the correct decision years. **Run 7** (Sonnet 5.5 at low for every step) is the fastest and cheapest, **74 s and $0.84**, but found only **11 of 32 (34%)**: like run 5 its loops stopped after a few AP-only searches, and it missed four fines and almost all of the 72-hour guidance. **Run 5** (Sonnet loop and tables, Opus draft, all low) found 17 of 32 in 95 s. At low effort, Opus keeps searching where Sonnet stops; the extra cost is mostly Opus tables ($1.71 of $2.57). Moonlit is still ahead at 30 of 32 in 135 s, though that score is partly circular, since the reference list was built mostly from Moonlit's answer.

Question: which fines did the AP impose for not or late reporting a data breach, or for poor security, with organisation, year, amount and breached AVG provision per case, and what does the AP say about the 72-hour deadline. Coverage is counted against the fact list below (the 30 facts in `questions.json` → `reference`, plus two correct unique finds). Moonlit's answer and trace: `benchmarks/research/moonlit/2026-10-20_q2b_answer.txt`, `2026-10-20_q2b_trace.md`.

## Model per step

The quote check itself is a word-for-word match without a model; only its fix call (when a quote fails) uses one.

| Run | 0. Split | 1. Search loop | 2. Tables | 3. Draft | 4. Answer | 5. Quote fix |
|---|---|---|---|---|---|---|
| 3 | none | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 4 | Haiku 5.5 | Haiku 5.5 (2 loops in parallel) | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 5 | Sonnet 5.5 | Sonnet 5.5 (3 loops in parallel) | Sonnet 5.5 | Opus 5.5 | Opus 5.5 | not needed |
| 6 | Opus 5.5 | Opus 5.5 (2 loops in parallel) | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 7 | Sonnet 5.5 | Sonnet 5.5 (3 loops in parallel) | Sonnet 5.5 | Sonnet 5.5 | Sonnet 5.5 | not needed |
| 8 | Opus 5.5 | Opus 5.5 (2 loops in parallel) | Haiku 5.5 (effort high) | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| Moonlit | unknown | unknown | unknown | unknown | unknown | unknown |

Runs 3 and 4 ran every model at effort high, runs 5 to 7 at effort low (`DEEP_EFFORT=low`). Run 8 ran at low with the tables at high (`DEEP_TABLE_EFFORT=high`), as in run 4.

## Cost per step

| Run | Setup | 0. Split | 1. Search loop | 2. Tables | 3. Draft | 4. Answer | 5. Quote check | **Total** |
|---|---|---|---|---|---|---|---|---|
| 3 | Q1 run 4 setup, but tables on Opus (`DEEP_TABLE_MODEL` not set) | – | $0.02 | $1.89 | $0.33 | $0.12 | $0 | **$2.35** |
| 4 | Split + parallel loops, 30 hits, new prompts, context cap | < $0.01 | $0.07 | $0.17 | $0.46 | $0.13 | $0.02 | **$0.84** |
| 4b | Exact repeat of run 4 | < $0.01 | $0.09 | $0.17 | $0.55 | $0.14 | $0 | **$0.95** |
| 4 JEV | Run 4 with `DEEP_JEV=1` (Jev: about $0.16 of the loop cost) | < $0.01 | $0.04 + $0.16 Jev | $0.14 | $0.50 | $0.14 | $0.01 | **$0.99** |
| 4 parallel grids | Run 4 with `DEEP_PARALLEL_GRIDS=1` | < $0.01 | $0.09 | $0.17 | $0.52 | $0.14 | $0.04 | **$0.97** |
| 5 | Run 4 setup plus the Rechtspraak prompt fix, Sonnet loop and tables, effort low | < $0.01 | $0.22 | $0.71 | $0.17 | $0.06 | $0 | **$1.16** |
| 6 | Run 5 setup, Opus for every step, effort low | < $0.01 | $0.55 | $1.71 | $0.21 | $0.08 | $0.02 | **$2.57** |
| 6 JEV | Run 6 with `DEEP_JEV=1` | < $0.01 | $0.39 + $0.04 Jev | $1.54 | $0.23 | $0.07 | $0 | **$2.28** |
| 7 | Run 5 setup, Sonnet for every step, effort low | < $0.01 | $0.25 | $0.50 | $0.07 | $0.02 | $0 | **$0.84** |
| 8 | Run 6 setup, but Haiku tables at effort high | < $0.01 | $0.48 | $0.08 | $0.19 | $0.06 | $0.02 | **$0.82** |
| 9 | Jev workflow: Haiku high everywhere but an Opus low draft, `DEEP_JEV=1 DEEP_JEV_FLOW=1` | < $0.01 | $0.30 + $0.35 Jev | $0.24 | $0.50 | < $0.01 | $0.01 | **$1.41** |
| 9b | Run 9 with the leak fix, support check off (`DEEP_JEV_SUPPORT=0`) | < $0.01 | $0.07 + $0.22 Jev | $0.15 | $0.33 | < $0.01 | < $0.01 | **$0.77** |
| 10 | Moonlit-style plan (`DEEP_PLAN=1`): Opus high plan, no loop, one parallel Haiku grid per sub-question | $0.07 (plan) | – | $0.22 | $0.52 | $0.10 | $0.09 | **$0.99** |
| 10b | Run 10 with AP fine decisions ranked first in the grid selection | $0.10 (plan) | – | $0.22 | $0.62 | $0.14 | $0.06 | **$1.13** |

Costs per step from the Langfuse traces (sessions `2026-10-20_q2b_run3`, `2026-10-20_q2b_run4`, `2026-10-20_q2b_run5`, `2026-10-21_q2b_run6`, `2026-10-21_q2b_run7`, `2026-10-22_q2b_run8`, and `2026-10-23_q2b_run9` for run 4b, `2026-10-23_q2b_run4jev`, `2026-10-23_q2b_run6jev`, `2026-10-23_q2b_run9`, `2026-10-23_q2b_run9b`, `2026-10-23_q2b_run4parallel_grids`, `2026-10-23_q2b_run10`, `2026-10-23_q2b_run10b`); they add up to the totals in the JSON results.

## Results

| Run | Time | API calls | Searches (sources + laws) | Documents | Correct facts (of 32) | Wrong facts | Rubric |
|---|---|---|---|---|---|---|---|
| 3 | 393 s | 19 | 25 + 4 | 23 | 21 (66%) | 0 found | 9–10 |
| 4 | 456 s | 42 | 36 + 9 | 45 | 24 (75%) | 0 found | 9–10 |
| 4b | 568 s | 52 | 45 + 11 | 36 | 25 (78%) | 0 found | 9–10 |
| 4 JEV | 429 s | 40 | 23 + 4 | 161 scored by Jev | 25 (78%) | 0 found | 9–10 |
| 4 parallel grids | 383 s | 87 | 45 + 8 | 42 | 28 (88%) | 0 found | 9–10 |
| 5 | 95 s | 20 | 9 + 0 | 16 | 17 (53%) | 2 (years) | 8 |
| 6 | 192 s | 26 | 11 + 0 | 23 | 24 (75%) | 0 found | 9 |
| 6 JEV | 144 s | 20 | 4 + 0 | scored by Jev | 23 (72%) | 0 found | 8–9 |
| 7 | 74 s | 21 | 11 + 0 | 10 | 11 (34%) | 1 (Booking date) | 7 |
| 8 | 235 s | 25 | 8 + 0 | 19 | 21 (66%) | 0 found | 9 |
| 9 | 809 s | 110 | 88 + 7 | 272 (incl. Jev-scored hits) | 24 (75%) | 0 found | 8 |
| 9b | 461 s | 49 | 43 + 3 | 35 | 21 (66%) | 1 (CP&A year 2021) | 8 |
| 10 | 225 s | 77 | 19 + 2 | 58 | 19 (59%) | 0 found | 7 |
| 10b | 280 s | 79 | 21 | 58 | 24 (75%) | 1 (Booking "discovered" 10 Jan) | 8 |
| Moonlit | 135 s | | 6 | 20 | 30 (94%) | 0 found | 10 |

Rubric (`rubric.md`): all three find most reference cases with the exact articles, name their gaps and back every claim with a quote that passed the check (run 3: 43 of 43; run 4: 41 of 42, 1 fixed). The deep runs lose a point where the gaps hide findable facts: run 4 says Rechtspraak was "not researched" and the Booking start date "not established", though both were findable. Run 5 (24 of 24 quotes passed) scores 8: it gives the publication year instead of the decision year for OLVG and CP&A (2021, decided 2020), and says no AP guidance on "kennisneming" was found, though run 4 found it. Run 6 (27 of 28 quotes passed, 1 fixed) scores 9: it lists "how much investigation time an organisation has" as not found, though the AP guidance it read answers it (fact 24). Run 7 (15 of 15 passed) scores 7: it found only 9 of the 14 fine cases, and it gives 10 January 2019 as the day Booking discovered the breach. That is Booking's own date in its report; the AP held that Booking knew on 13 January. Run 8 (23 of 24 passed, 1 fixed) scores 9: it lists the AP's "reasonable degree of certainty" test and reporting in stages as not found, though both are on AP guidance pages that run 6 read.

## Fact list

✓ stated and correct, ✗ missing. Facts 1–30 are the `reference` in `questions.json` (`verified: false`); 31 and 32 were checked in `ap_doc` (`documenten/boete-cpa-verzuimregistratie`: letter dated 24 maart 2020; "stelt het boetebedrag inzake overtreding van artikel 9 ... vast op € 725.000" and a basic fine of € 310,000 for art. 32).

| # | Fact | Run 3 | Run 4 | Run 4b | Run 4 JEV | Run 4 parallel grids | Run 5 | Run 6 | Run 6 JEV | Run 7 | Run 8 | Run 9 | Run 9b | Run 10 | Run 10b | Moonlit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Uber, 6 Nov 2018, € 600,000, art. 34a lid 1 and 2 Wbp | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (year only) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (year only) | ✓ | ✓ | ✓ |
| 2 | Uber reported 371 days late | ✗ | ✓ ("ruim een jaar") | ✗ | ✗ | ✓ (14 Nov 2016 to 21 Nov 2017) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ ("ruim een jaar", two dates) | ✓ (14 Nov 2016 to 21 Nov 2017) | ✓ |
| 3 | PVV Overijssel, 16 Jun 2020, € 7,500, art. 33 lid 1 AVG | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 | PVV Overijssel never reported | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| 5 | Booking.com, 10 Dec 2020, € 475,000, art. 33 lid 1 AVG | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6 | Booking.com 22 days late | ✓ | ✗ | ✓ ("22 dagen te laat") | ✓ ("22 dagen te laat") | ✓ ("22 dagen te laat") | ✓ (16 Jan to 6 Feb 2019) | ✓ (16 Jan to 6 Feb 2019) | ✓ (16 Jan to 6 Feb 2019) | ✗ (Booking's own 10 Jan) | ✓ ("22 dagen te laat") | ✓ ("22 dagen te laat") | ✓ (16 Jan to 6 Feb 2019) | ✓ ("22 dagen te laat") | ✓ (16 Jan to 6 Feb 2019) | ✓ |
| 7 | HagaZiekenhuis, 18 Jun 2019, € 460,000, art. 32 lid 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8 | Haga lowered to € 350,000 by Rb Den Haag | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9 | OLVG, 26 Nov 2020, € 440,000, art. 32 lid 1 | ✓ | ✓ | ✓ | ✓ (article not quoted) | ✓ | ✓ (but year 2021) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (OLVG missing) | ✗ | ✓ | ✓ |
| 10 | Orthodontic practice, 4 Feb 2021, € 12,000, art. 32 lid 1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ (amount lost) | ✓ | ✗ | ✓ | ✓ |
| 11 | CP&A, € 15,000, art. 9 lid 1 and 32 lid 1 | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| 12 | UWV, 31 May 2021, € 450,000, art. 13 Wbp and 32 lid 1 and 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (no date or article) | ✓ |
| 13 | Transavia, 23 Sep 2021, € 400,000, art. 32 lid 1 and 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (amount only) | ✓ | ✓ |
| 14 | BZ (NVIS), 24 Feb 2022, € 565,000, art. 32 lid 1 and 13 lid 1 onder e | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 15 | BZ: € 465,000 of it for art. 32 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ ("not established") | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| 16 | Financiën (FSV), 7 Apr 2022, € 3.7 million in total | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ (FSV missing) | ✓ |
| 17 | FSV: € 500,000 of it for art. 32 lid 1 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ ("not confirmed") | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| 18 | SVB, 19 Jan 2023, € 150,000, art. 32 lid 1 and 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| 19 | HAN, 15 Dec 2025, € 175,000, art. 32 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (amount lost) | ✓ | ✓ | ✓ | ✓ |
| 20 | Curator, 9 Dec 2021, € 310,000, art. 5 lid 1 onder f jo. 32 lid 1 and 2 | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| 21 | Curator: € 148,750 on objection | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| 22 | Curator: Rb Gelderland lowered it to € 58,125 | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| 23 | The 72 hours start at "a reasonable degree of certainty" | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 24 | Ongoing investigation is no reason to wait; report in stages | ✗ | ✓ | ✓ (stages only) | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 25 | A late report needs a justification | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 26 | AP step plan: first report within 72 hours, follow-up later | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 27 | No report needed only if a risk is unlikely | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 28 | Judged case by case; data seen by an unauthorised person is already a risk | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| 29 | The controller stays responsible when a processor is involved | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| 30 | Fear of reputational damage or waiting for a full investigation are no good reasons (Jaarrapportage 2021) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| 31 | CP&A decision dated 24 Mar 2020 | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ (says 2021) | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ (says 2021) | ✗ | ✓ | ✗ |
| 32 | CP&A: € 725,000 for art. 9 and € 310,000 for art. 32 before lowering to € 15,000 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (only the € 1,035,000 total) | ✗ | ✗ | ✗ |
| | **Total** | **21** | **24** | **25** | **25** | **28** | **17** | **24** | **23** | **11** | **21** | **24** | **21** | **19** | **24** | **30** |

Run 4 also states 72-hour details nobody else has (weekend, holidays or a late-informed DPO are no excuse; ransomware breaches almost always need reporting; art. 41–42 UAVG exceptions; the € 10 million Uber fine of 2023 is not a breach fine). These are quoted but not yet checked, so they are not in the list.

## Per step: runs 3 to 8

| Step | Run 3 | Run 4 | Run 5 | Run 6 | Run 7 | Run 8 |
|---|---|---|---|---|---|---|
| 0. Split | – | 2 parts: all fines together, and the 72-hour rule. Q1 and Q2b split into 3 in a test, so the fines staying together is the model's choice, not a cap. | 3 parts: art. 33 fines, art. 32 fines, the 72-hour rule (Sonnet split by kind of fine without a prompt change). | 2 parts, like run 4: all fines together, and the 72-hour rule. | 3 parts, like run 5. | 2 parts, like run 6. |
| 1. Search loop | One loop, 11 calls, 25 + 4 searches, mostly plain AND queries. Found the curator fine through its Rechtspraak ruling. Missed 3 AP fines: 10 hits per search covered about 5 fines. | Loop 1 (fines) 334 s, loop 2 (72 hours) 271 s, in parallel. 30 hits per search reached all 13 AP fine decisions. But 26 Rechtspraak searches used the bracketed boolean syntax, which only ACM and AP understand: 0–2 hits each, no ruling read, so the curator fine was lost. The context cap fired 8 times (about 24K tokens each). | 3 loops of 31, 32 and 43 s. Each did 2-4 searches and one grid (3 in all), then stopped. Every search was AP only: no Rechtspraak (curator fine lost) and no law search. The 72-hour loop ran 3 searches and read no AP guidance page. | Loop 1 (fines) 124 s, loop 2 (72 hours) 63 s, 14 calls, 5 grids. Searched AP by party names to find more fines, and ran one Rechtspraak search with plain keywords: it found the curator ruling (RBGEL:2025:6547) and the Haga ruling. The 72-hour loop read the AP guidance pages (zo-meldt-u-een-datalek, stappenplan, datalek-dit-moet-u-doen). Missed the orthodontic practice. | 3 loops of 36, 39 and 45 s, 14 calls, 3 grids over 3, 3 and 8 documents. AP only, no Rechtspraak, no laws. Never gridded CP&A, FSV, SVB, the orthodontic practice or any AP guidance page. | Loop 1 (fines) 129 s, loop 2 (72 hours) 173 s, 13 calls, 5 grids, 8 searches. Found all 13 AP fine decisions, including the orthodontic practice, by searching party names. AP only: no Rechtspraak (curator fine lost). Read the Jaarrapportage (fact 30, a first for a deep run) but not zo-meldt-u-een-datalek (facts 23, 24, 26). |
| 2. Tables | 6 Opus calls, $1.89, 207 s | 18 Haiku calls, $0.17, about 39 s each. Grids in one loop ran one after another, so loop 1 was mostly waiting on tables. | 6 Sonnet calls, $0.71, about 14 s each. 61% of the cost; at low effort Haiku would be about a tenth of that. | 8 Opus calls, $1.71, about 18 s each: 66% of the cost. | 4 Sonnet calls, $0.50, about 16 s each. | 8 Haiku calls at high, $0.08, about 42 s each (88K output tokens, mostly thinking). The tables are now the slow part: loop 2 waited on them for most of its 173 s. |
| 3. Draft | Opus, 77 s, $0.33 | Opus, 79 s, $0.46 (45 documents against 23) | Opus low, 31 s, $0.17 (16 documents) | Opus low, 38 s, $0.21 (23 documents). Took decision dates from the text: no wrong years. | Sonnet low, 17 s, $0.07 (10 documents). Also gave decision dates (OLVG 26 Nov 2020), but stated Booking's own discovery date as fact. | Opus low, 35 s, $0.19 (19 documents). Decision dates from the text, no wrong years. |
| 4. Answer | Opus, 34 s | Opus, 37 s | Opus low, 17 s | Opus low, 22 s | Sonnet low, 9 s | Opus low, 17 s |

## What changed per run

- **Run 3:** Q1's run 4 setup, but `DEEP_TABLE_MODEL` was not set, so the tables ran on Opus (80% of the cost). AP search returned 10 hits, so each query covered about 5 fines (press release plus decision per fine).
- **Run 4:** tables default to Haiku; AP and ACM search return 30 hits in deep search; the loop starts each sub-question with one broad boolean query; one grid per sub-question with a yes/no relevance filter, over the decisions rather than the press releases; old search results are cleared past 80K prompt tokens; the question is split into parts with one loop each, in parallel.
- **Run 4 parallel grids (2026-10-23):** run 4 with `DEEP_PARALLEL_GRIDS=1`: one document per table call, all of a grid's documents in parallel. Grids took 19 s on average (median 19 s, max 30 s) against 35-40 s in runs 4, 4b and 4 JEV, at the same cost per document ($0.003). The batches were never above Haiku's 100K price step, so that saving did not exist. With faster grids the loops made more turns in less time (31 calls, 45 searches, 15 grids, loops 206 and 230 s) and the run finished in 383 s, the fastest Haiku run. 28 of 32, the best deep run so far: Uber's 371 days (as dates), the curator fine via Rechtspraak, CP&A with its date and its € 725,000 and € 310,000 split. One run, so 3-4 facts of it may be variance; worth a repeat (run 4parallel_grids b).

  | Run | Grids | Document rows | Table calls | Avg per grid | Median | Max | Cost per grid | Cost per document |
  |---|---|---|---|---|---|---|---|---|
  | 4 | 13 | 63 | 18 | 40 s | 34 s | 72 s | $0.013 | $0.0026 |
  | 4b | 20 | 57 | 23 | 36 s | 33 s | 77 s | $0.009 | $0.0030 |
  | 4 JEV | 13 | 51 | 17 | 35 s | 27 s | 77 s | $0.011 | $0.0027 |
  | 4 parallel grids | 15 | 57 | 52 | 19 s | 19 s | 30 s | $0.012 | $0.0030 |
- **Replay of run 4 parallel grids, steps 3-5 at Opus 5.5 low (2026-10-23):** the same draft material (the draft call's input from Langfuse, 154K characters) replayed with `benchmarks/research/replay_finish.ts`, so only the draft, fix and answer differ. Opus low: 54 s and $0.44 (draft 34 s $0.36, fix 3 s $0.02, answer 17 s $0.06) against Opus high: 149 s and $0.70 (draft 98 s $0.52, fix 8 s $0.04, answer 43 s $0.14). But 23 claims instead of 46, and 24 of 32 facts instead of 28: it dropped Uber's 371 days (2), PVV never reporting (4), no report needed if a risk is unlikely (27) and the € 725,000 for art. 9 (32). No wrong facts. On the same material, high effort writes about twice as many claims, and those carry 4 facts. Result: `2026-10-23_q2b_run4parallel_grids_replay_opus_low.md`.
- **Replay of run 4 parallel grids, steps 3-5 at Haiku 5.5 high (2026-10-23):** same material. 193 s and $0.04 (draft 106 s $0.022, fix 26 s $0.005, answer 61 s $0.009), against Opus high 149 s $0.70 and Opus low 54 s $0.44. 61 claims (most of all), 7 not verbatim (6 fixed, 1 dropped). 24 of 32 facts, like Opus low, but other ones: it kept Uber's 371 days, PVV never reporting and the CP&A split, and lost the orthodontist amount (10), the UWV date (12), the FSV total of € 3.7 million (16) and the curator's € 148,750 on objection (21). 1 small error: "kennisname" described as the AP being reasonably certain, instead of the organisation. Writes long and hedges (a "Niet gevonden" list of 12 items). Result: `2026-10-23_q2b_run4parallel_grids_replay_haiku_high.md`.
- **Run 10 (2026-10-23):** Moonlit-style, `DEEP_PLAN=1`: one Opus 5.5 high call planned 3 sub-questions with 6-7 searches and 4 fixed questions each; the 19 + 2 searches ran in parallel; each sub-question got one grid over its top 25 hits (Haiku 5.5 high, one document per call, at most 16 at once); no loop, no follow-up grids. First attempt failed on the org's concurrent-request limit (429) at about 100 parallel table calls, hence the cap of 16. Time per step: plan 31 s, searches about 2 s, grids 75 s (73 calls), draft 73 s, quote fix 18 s, answer 26 s: 225 s in all, the fastest deep run that read decisions, but still 90 s slower than Moonlit. Only 19 of 32: the grids held just 5 of the 13 AP fine decisions, because the top-25 cut took hits from every query in turn, and 17 Rechtspraak rulings and 18 press releases filled the slots. Lost OLVG, the orthodontist, CP&A, Transavia's date, FSV and SVB. Fix to try: rank decisions (ap:documenten/boete-...) before press releases and rulings, or 40 documents per sub-question.
- **Grid replay of run 10 with decisions ranked first (2026-10-23):** `benchmarks/research/replay_grids.ts` searched run 10's plan again and gridded it with the new selection (AP fine decisions first, then other documents, guidance and rulings, then laws, press releases and Woo pages; within a kind by best rank), no new plan and no draft. 67 s, $0.21, 73 table calls. All 13 fine decisions reached a grid (security grid: 11 of 25 slots, against 2). By a keyword check of the grids, about 28 of 32 facts are now in the material (run 10's tables: about 20); still absent are 6 (no "22 dagen" row this time), 15, 28 and 30. That is an upper bound: the draft can still drop facts. Result: `2026-10-23_q2b_run10_grids_ranked.md`.
- **Run 10b (2026-10-23):** run 10 with the decision-first ranking, and a new Opus plan (so other searches than run 10). Plan 40 s, grids 74 s (75 Haiku calls), draft 111 s, fix 12 s, answer 40 s: 280 s, $1.13. 12 of the 13 fine decisions reached a grid (FSV did not; UWV only through its press release), so 24 of 32 against run 10's 19. Lost: the UWV date and article, FSV (16, 17), and 28-30 and 32 as in most runs. 1 wrong fact: it states 10 January 2019 as the day Booking discovered the breach, Booking's own date (run 7's error). Draft $0.62 is the largest cost, as in every Opus-high run.
- **Run 5:** Sonnet 5.5 for split, loop and tables, Opus 5.5 for draft and answer, every step at effort low; loop prompt now sends Rechtspraak and Kifid plain keywords. In run 4 about 85% of each Haiku table call's output was hidden thinking at effort high (for example 16K output tokens for about 2K of visible table), which is what low effort cuts.
- **Run 6:** run 5 with Opus 5.5 for every step, effort low.
- **Run 6 JEV (2026-10-23):** run 6 with `DEEP_JEV=1`. The Opus loop at low made only 4 searches (run 6: 11) and none on Rechtspraak, so the curator fine (facts 20-22) was lost again; it says itself that Rechtspraak was not searched. 23 of 32 against 24, 48 s faster and $0.29 cheaper (fewer loop turns and one table call less). Jev cost $0.04. It did find CP&A with its date (11, 31). Like run 4 JEV: leaner, not more complete.
- **Run 7:** run 5 with Sonnet 5.5 for every step, effort low.
- **Run 4b (2026-10-23):** an exact repeat of run 4, to measure run-to-run variance (Langfuse session `2026-10-23_q2b_run9`, its name before the rename). 25 of 32 against run 4's 24, but not the same facts: 21 in both, 4 only in 4b (Booking 22 days late, all three curator facts via the Rechtspraak ruling), 3 only in run 4 (Uber 371 days, CP&A fine and its date). So a single run of this setup swings by about 3 to 4 facts, and a difference of 1 to 2 facts between setups is noise.
- **Run 4 JEV (2026-10-23):** run 4 with `DEEP_JEV=1`: Jev scores every search hit on full text against a relevance question and yes/no criteria that the loop writes per search, and the hits come back sorted. The loop passed relevance in all 23 searches. Half the searches of 4b (23 against 45) and 6 fewer grids, 139 s faster, but the same 25 of 32 as 4b, and almost the same facts: it found the guidance pages, but the facts Jev was meant to recover (28, 30, CP&A) still missed. Within run-to-run variance, Jev made the loop leaner, not more complete. The document count (161) includes every hit Jev fetched to score.
- **Run 9 (2026-10-23):** the Jev workflow (`DEEP_JEV_FLOW=1` with `DEEP_JEV=1`): Haiku 5.5 high for split, loop, tables, quote fix and answer, Opus 5.5 low for the draft only. The split wrote 5-6 checks per part; the gate sent both loops back twice (open: exceptions, articles per fine, court outcomes), which doubled the loop (88 searches, 56 on Rechtspraak, 61 loop calls). The Rechtspraak rule worked: curator fine back (20-22) and CP&A found. 24 of 32, but lost two amounts (orthodontist, HAN) that runs 4 and 4b had. The quote support check flagged 15 of 28 claims at 0.25, far too many: the Haiku fix re-quoted them, and the draft had only 29 claims (4b: 52). Bug found: Jev-scored hits stayed in `ctx.docs` (272 documents), so the draft got every scored hit as extra text ($0.50 at Opus low; also in runs 4 JEV and 6 JEV). Fixed after this run: hits fetched only for scoring are removed again.
- **Run 9b (2026-10-23):** run 9 with the Jev-hit leak fixed (35 documents instead of 272) and the quote support check off. Not an exact repeat, despite the letter. Cheaper and faster ($0.77, 461 s; draft $0.33 instead of $0.50) but 21 of 32: OLVG and the curator fine are missing, and CP&A has the publication year 2021. The Rechtspraak rule fired (23 searches) but most used 5-9 words, which Rechtspraak ANDs, so 0 hits; the curator ruling never came up. The gate saw the gaps (appeal outcomes p 0.07, year and amount per fine 0.07-0.28) but stopped after its 2 rounds with them still open.
- **Run 8:** run 6 with Haiku 5.5 tables at effort high (new `DEEP_TABLE_EFFORT`), the table setup of run 4.

## Per part: runs 4, 4jev, 6 and 6jev (rated 2026-10-23)

Each answer is split into parts and scored from 1 to 5. Run 4 is the original run of 2026-10-20, not run4b.

| Part | 4 | 4jev | 6 | 6jev | Explainer |
|---|---|---|---|---|---|
| Short summary at the top | 5 | 4 | 4 | 1 | Run 4 gives all three parts with counts, range and the late-filing rule. 4jev is split into sub-bullets and gives citations as a range "[11]-[30]". Run 6 has no citations on its security bullet. 6jev has no summary at all. |
| Reporting fines: cases found | 4 | 4 | 4 | 4 | All four have Booking and PVV Overijssel, and correctly mark Uber as a Wbp case, not a GDPR one. No run finds a GDPR art. 33 fine from 2022 or later. |
| Reporting fines: Booking details | 3 | 5 | 3 | 3 | Only 4jev adds the timeline: told on 13 Jan, reported on 7 Feb, 22 days late, and why the fine was not lowered. The others give only the offence period. |
| Reporting fines: PVV details | 3 | 3 | 5 | 5 | Runs 6 and 6jev explain that the base fine of 525k was cut to 7.5k because PVV could not pay more. Runs 4 and 4jev leave that out. |
| Reporting fines: Uber context | 4 | 4 | 3 | 5 | 6jev adds that the AP already read "onverwijld" (without delay) under the Wbp as 72 hours. 4 and 4jev give the dates (6 Nov 2018, reported more than a year late). |
| Security fines: coverage | 4 | 4 | 4 | 4 | Each has 10 of the 11 cases. Run 4 misses the curator case, 4jev misses CP&A, 6 misses the orthodontist practice, 6jev misses the curator case. |
| Security fines: amounts and changes on appeal | 3 | 5 | 5 | 3 | 4jev and 6 trace the curator fine from 310k to 148,750 to 58,125. Run 6 also gives CP&A's amounts before the cut (310k and 725k). 4 and 6jev only mention the Haga cut. |
| Security fines: GDPR article per case | 5 | 3 | 5 | 5 | 4jev says three times "follows from the analysis, not checked word for word" (OLVG, SVB, orthodontist). That is honest but weaker. The others state the article with a citation. |
| Security fines: what each fine was for | 5 | 5 | 2 | 1 | Runs 4 and 4jev have a column on what went wrong, such as no two-factor login, no HTTPS or old MD5 hashing. Run 6 only notes this for a few cases. 6jev only gives amounts and articles. |
| Dates and years | 4 | 4 | 5 | 4 | Run 6 gives both the year and the full decision date for every case, which is exactly what the question asked for. The others give only the date. |
| Keeping out cases that don't fit | 4 | 5 | 3 | 3 | 4jev explains why it leaves out the 2026 fines on ten municipalities and notes that Transavia did report on time. Run 4 does the same for Uber's 10M fine. 6 and 6jev don't do this. |
| 72 hours: the legal rule and its exception | 5 | 5 | 5 | 4 | All quote art. 33(1) and the no-risk exception. 6jev adds that the risk must be judged objectively, but its main rule leaves out "without undue delay". |
| 72 hours: when the clock starts (kennisname) | 5 | 5 | 4 | 4 | 4 and 4jev note that older AP texts counted from discovery (ontdekking), while the current text counts from awareness (kennisname). 4jev adds that a limited leak is still no reason not to report. |
| 72 hours: late reports and invalid excuses | 5 | 5 | 3 | 5 | Run 6 leaves out the data protection officer being told too late. Run 4 also covers Booking's legal-certainty (lex certa) argument. |
| 72 hours: phased reporting and complex leaks | 5 | 5 | 3 | 4 | Run 4 covers ransomware and "report when in doubt". 4jev covers ransomware and phishing. 6jev covers hacking and phishing. Run 6 has one line. |
| 72 hours: processors | 5 | 5 | 1 | 4 | 4jev says the clock starts once the processor informs the organisation. Run 4 adds the advice to agree a deadline in hours in the processor contract. Run 6 leaves processors out. |
| 72 hours: enforcement and exemptions | 5 | 4 | 1 | 2 | Run 4 names the UAVG art. 41-42 exemptions and the risk of a fine. 4jev has an enforcement section. Run 6 has nothing on this. |
| "Not found" section | 4 | 5 | 4 | 4 | 4jev is the most specific, listing each claim it could not check and what is missing. Run 6 mentions an open 262.5k fine. 6jev notes that no art. 34 fine was found. |
| Quote accuracy | 4 | 4 | 4 | 5 | Wrong quotes: 1 of 42 in run 4, 1 of 54 in 4jev, 1 of 28 in run 6, and 0 of 36 in 6jev. |
| Readability and length | 4 | 3 | 5 | 4 | Run 6 is compact and easy to scan. 4jev is very long at 48 KB. |
| Cost and speed | 5 | 5 | 2 | 3 | Run 4 cost $0.84 and took 456 s. 4jev cost $0.99 and took 429 s. Run 6 cost $2.57 and took 192 s. 6jev cost $2.28 and took 144 s. |
| **Total (out of 105)** | **91** | **92** | **75** | **77** | Without cost and speed: 4jev 87, run 4 86, 6jev 74, run 6 73. |

Jev on run 4 adds detail, quotes and better scoping, at the cost of hedging on which GDPR article applies. Jev on run 6 makes it faster and cheaper, with cleaner quotes and a better 72-hour section, but drops the summary and the "what went wrong" details.

## Candidate setup (decided 2026-10-22)

Runs 4 and 6 find the same facts (24 of 32) with the same rubric score and differ only in speed against cost. Unless a later run beats them, deep search gets two modes:

| Mode | Setup | Time | Cost |
|---|---|---|---|
| Standard | Run 4: Haiku 5.5 split, loop and tables, Opus 5.5 draft and answer, effort high | 456 s | $0.84 |
| Fast | Run 6: Opus 5.5 for every step, effort low | 192 s | $2.57 |

## Next

Open items as of 2026-10-23, most promising first.

- **Dates (proposed, not built):** runs 5 and 7 gave the page's publication date as the decision year or discovery date. For AP, a document's `date` is the page's `<time>`, else the first Dutch date in the text, else the sitemap lastmod (`app/src/lib/sources/ap.ts`, `scripts/ap_index.ts`), but deep search passes it as a bare `date=`. Plan: label it `published` in `docXml`, the document index, `read_document` and the search result lines (`deep/search.ts`, `deep/tools.ts`), and tell the table and draft prompts to take a decision or ruling date only from the text, else write "published <date>". It touches deep search only. Don't make the answer hedge ("might be this or that"); a lawyer needs a usable date.
- **Jev for recall (untested):** the loops lose facts because the right documents never reach a grid (AP guidance pages in runs 5, 7 and 8, the curator ruling in runs 4, 5, 7 and 8). Score all 30 hits of every search on full text with Jev per sub-question (about $0.01 per search, 0.25 s per document) and give the loop the top ones. Jev as a filter before the tables works but saves little; see `2026-10-23_jev_relevance.md`.
- **Jev criteria and JSON state (tested 2026-10-23):** hand-written criteria plus `{title, published, text}` as the state got 6 of 8 hand-checked disagreements right (about 3 without), for the same cost and speed. Criteria must match the exact question: broad ones made Jev say yes to a notification fine for an "art. 32 only" question. So the loop writes criteria with each grid question. See `2026-10-23_jev_relevance_criteria.md`.
- **Haiku tables at low:** `DEEP_TABLE_EFFORT` now exists (default `DEEP_EFFORT`). At high, about 85% of a Haiku table call's output is hidden thinking (42 s per call in run 8). Run 8 at `DEEP_TABLE_EFFORT=low` is the obvious next run, and so is run 4 with only the tables at low. Both test whether the facts hold.
- **Loop effort:** low made the Sonnet loop stop after one grid; the Opus loop kept going. A separate loop effort (for example a `DEEP_LOOP_EFFORT`) would allow a medium Sonnet or Haiku loop with low tables; not built yet.
- **Rechtspraak is hit or miss:** the prompt fix after run 4 works (run 6 found the curator ruling), but runs 5, 7 and 8 never searched Rechtspraak at all. Consider making one Rechtspraak search per sub-question a rule in the loop prompt.
- **Splitter:** Sonnet split the fines by kind (runs 5 and 7); Haiku and Opus kept them in one loop (runs 4, 6, 8), which makes that loop the slow one. Asking it to split lists by kind of case is untested.
- **Recall in grids:** no deep run found facts 15 (BZ split per violation) and 28 (when data seen by an unauthorised person is a risk), though both are in documents they read. Add "split the fine per violation" to the grid prompt's fact questions.

## Caveats

- One run per setup, so differences of a few facts are within run-to-run variance.
- The reference was built mostly from Moonlit's answer and is not verified (`verified: false`), so Moonlit's 30 of 32 is partly circular. Facts only the deep runs found count once they are checked (facts 31 and 32).
- Scores are judgement calls, not a lawyer's check.
