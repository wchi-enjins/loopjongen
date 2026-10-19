# ACM dark patterns (Q1): Haiku 5.5 in the search loop

**TL;DR (run 4, Haiku tables):** with Haiku on the table step as well, Q1 costs **$1.39** (run 3: $3.20, Opus run ≈ $5) at the same quality: 68% coverage, no wrong facts found. The table step fell from $1.99 to $0.08.

**TL;DR (run 3, table fix):** Haiku loop plus Moonlit-style tables with several quotes per cell and untabled documents passed to the draft: **$3.20 instead of ≈ $5**, 12 minutes, **70% coverage** (Opus 81%, Moonlit 36%), no wrong facts found, and the best rubric score so far (9–10).

**TL;DR (run 2, new tables):** with law search working and Moonlit-style tables, the whole run costs **$2.48 instead of ≈ $5** and takes 10 minutes, at the same rubric score (8–9). Coverage fell to 53%: the smaller tables drop some facts the loop did find.

**TL;DR (run 1):** With Haiku 5.5 running the search loop (all later steps still on Opus 5.5), the loop cost **$0.46 instead of about $3.20**, and the answer held up: **66% coverage** of the 47-fact list (Opus loop 81%, Moonlit 36%) with **no wrong facts found**. It found the Epic/Fortnite timer fine and the 2023 timer sweep that the Opus loop missed, and avoided the Opus run's wrong timer conclusion. It missed seven smaller cases the Opus loop found. Caveat: the BWB law tools failed in this run (setup error, see below), so it is not yet a clean comparison.

Run: `2026-10-19-haiku-loop-acm.{md,json,log}`. Fact list and the Opus/Moonlit scores: `2026-10-19-acm-comparison.md`.

## Setup error: no law search

`search_laws` and `read_law` failed on every call (`ECONNREFUSED` on port 5432). The run loaded `.env` but not `.envrc`, which holds `DATABASE_URL` (port 5433). So the loop could only use the ACM, AP, Kifid and rechtspraak connectors. The articles in the answer come from decisions and rulings, and the answer says the law texts were not read.

## Cost and effort

| | Opus loop (`smoke.json`) | Haiku loop |
|---|---|---|
| Loop calls | 31 | 17 |
| Documents read | 44 | 38 |
| Loop cost | ≈ $3.20 (estimate from the trace) | **$0.46** (priced per call) |
| Table | 16 questions over 44 documents | 24 questions over 38 documents |
| Whole run | ≈ $5 (estimate) | $4.72 |
| Time | 958 s | 1,246 s |

The whole run barely got cheaper because the Opus table step wrote about 109k output tokens (≈ $3.07), against roughly 30k in the Opus run. Opus picked 24 table questions from Haiku's notes, against 16 last time. That is a table-step issue, not a loop issue: capping the number of questions or moving the table to Haiku fixes it.

The loop context grew to about 400k tokens per call, because document texts are never dropped. That puts every Haiku call above the 100K price line ($0.50 instead of $0.10 per 1M input tokens).

## Facts (against the 47-fact list)

| | Opus loop | Haiku loop | Moonlit |
|---|---|---|---|
| Correct facts found | 38 (81%) | **31 (66%)** | 17 (36%) |
| Wrong facts | 1 (row 36) | 0 found | 0 |

- **Found that the Opus loop missed:** Epic's two fines with articles and the binding instruction (rows 26–29), the 2023 timer sweep (row 30), JYSK and PVH amounts stated firmly (rows 10–11).
- **Missed that the Opus loop found:** Leen Bakker's article and 39 announcements (6–7), fine reductions and category (14, 16), the ECLIs (18, flagged as not found although the court press release it read lists them), ACM competence since 2023 (20), Booking and Expedia (33–34), Boomfietsen (42), TI84shop (44–45), Bicep Papa (47), the travel firms (48), On that ass (49).
- **New, not in the list:** the Rechtbank Rotterdam ruling on Epic of 14 Jan 2026 (ECLI:NL:RBROT:2026:171), which the comparison noted neither earlier answer had; the telecom ruling of 5 Feb 2021 with the new fine amounts (checked on acm.nl: the court raised the reduction from 25% to 40%, amounts correct); Sneakerstad's articles; PlatteTV and Perfectionbody.
- **Drift:** a section on AP cookie fines (Kruidvat, Coolblue) and a civil ruling. Labelled as "not ACM decisions", but off-question.

## Rubric (provisional)

| Criterion | Opus loop | Haiku loop | Note |
|---|---|---|---|
| Decisions found | 2 | 2 | Epic, the sweep, and most discount cases |
| Breached article | 2 | 2 | Exact articles for about 9 cases; Leen Bakker, JYSK and PVH flagged as not verified |
| Facts | 2 | 2 | Nothing wrong found in the checked facts |
| Honest gaps | 1 | 1 | Clear gaps and the timer conclusion is careful, but the ECLIs were answerable |
| Quotes back every claim | 1 | 1–2 | 47/47 quotes pass; numbers outside the quotes not yet checked |
| **Total** | **8** | **8–9** | Moonlit 6 |

## Rerun: law search on, Moonlit-style tables

Run: `2026-10-19-haiku-loop-tables-acm.{md,json,log}`. Same Haiku loop, now with `.envrc` loaded, and the table step changed to one table per sub-question (at most 4 tables, 2–4 questions, at most 12 picked documents each).

| | Opus loop | Haiku loop, run 1 | Haiku loop + new tables |
|---|---|---|---|
| Whole run | ≈ $5 | $4.72 | **$2.48** |
| Loop | ≈ $3.20 | $0.46 | $0.31 |
| Table cells | 704 | 912 | ≤ 192 (4 tables over 12, 9, 12, 9 documents) |
| Time | 958 s | 1,246 s | **592 s** |
| Documents read | 44 | 38 | 43 (4 of them law articles) |
| Correct facts (of 47) | 38 (81%) | 31 (66%) | **25 (53%)** |
| Wrong facts | 1 | 0 found | 0 found |
| Quote check | 42/42 | 47/47 | 46/46 |

- **Gained:** both ECLIs with the right mapping (row 18, missed by every earlier answer), Leen Bakker's article (6), Boomfietsen (42). New and checked on acm.nl: World Ticket Center 2015 (€350,000, pre-ticked insurance) and five webshops in 2016 (€590,000 together, cancellation rules). Epic's court ruling again.
- **Lost against run 1:** the JYSK and PVH amounts (10–11, now listed as a gap although the press release was read), the admission discount (13), the Nov 2025 sweep (25), Temu and SHEIN (31–32), Sneakerstad's amount (46), "rulings are final" (19).
- **Cause, partly the tables:** the Nov 2025 sweep and the JYSK/PVH amounts were in documents the loop read, but did not reach the draft. A document that is not picked for a table, or whose cell misses the fact, is now lost. Temu, SHEIN and TI84shop were not read in this run at all; that is loop variance.
- **Law search:** 4 law articles read; 6:193g, 5a Bpp and the 30-day rule are now quoted from the law itself. The Prijzenwet id is still wrong (`BWBR0002176`, should be `BWBR0002353`): the loop never read it.
- **Drift:** less than run 1 (no AP cookie fines), but a "related cases" section with cancellation and delivery-information fines.

Rubric (provisional): Decisions 2, Article 2, Facts 2, Gaps 1 (JYSK/PVH amounts were answerable), Quotes 1–2. **8–9**, same as the other two deep runs.

## Run 3: table fix (several quotes per cell, untabled documents to the draft)

Run: `2026-10-19-haiku-loop-tables2-acm.{md,json,log}`. Two changes: a cell lists every case or company in a document, each with its own quote, and documents that no table picked go to the draft as text (8,000 characters each; 5 of 47 here).

| | Opus loop | Haiku run 1 | Haiku + tables | **Haiku + table fix** |
|---|---|---|---|---|
| Whole run | ≈ $5 | $4.72 | $2.48 | **$3.20** |
| Loop | ≈ $3.20 | $0.46 | $0.31 | $0.56 |
| Time | 958 s | 1,246 s | 592 s | 710 s |
| Documents read | 44 | 38 | 43 | 47 (4 law articles, incl. the Prijzenwet) |
| Correct facts (of 47) | 38 (81%) | 31 (66%) | 25 (53%) | **33 (70%)** |
| Wrong facts | 1 | 0 found | 0 found | 0 found |
| Quote check | 42/42 | 47/47 | 46/46 | 47/47 |

- **Back thanks to the fix:** JYSK and PVH amounts (10–11), the admission (13), "rulings are final" (19). JYSK's article is now quoted too (row 12, which no earlier answer confirmed).
- **Also found:** Leen Bakker's 39 announcements (7), ACM competence since 2023 (20), the 2023 sweep's 41 cases (30), Temu and SHEIN (31–32), Bicep Papa (47), both ECLIs (18), Epic's court ruling.
- **New, beyond the list:** T.O.M. B.V. 2016 (€500,000, quote checked), Tele2's original fine (€2.7m, matches the court table), nine telecom companies removing cancellation hurdles, CVmaker, Amazon Prime.
- **Still missing:** the Nov 2025 sweep (25), Booking and Expedia (33–34), Vodafone's articles (39–40, listed as not read), Boomfietsen (42), TI84shop (44–45), Sneakerstad (46), the travel firms (48), On that ass (49), fine reductions (14, 16).
- **Law ids:** Prijzenwet and Bpp now right; the Whc is still a made-up id (`BWBR0020889`, should be `BWBR0020586`), because the loop never read it.

Rubric (provisional): Decisions 2, Article 2, Facts 2, Gaps 2 (no gap that a read document answers), Quotes 1–2. **9–10**, the best deep run so far.

## Run 4: Haiku on the table step too

Run: `2026-10-19-haiku-tables-haiku-acm.{md,json,log}`. Same as run 3, with `DEEP_TABLE_MODEL=claude-haiku-5-5` (picking questions and documents, and filling the cells). Draft and answer stay on Opus.

| Step | Run 3 (Opus tables) | Run 4 (Haiku tables) |
|---|---|---|
| 1. Search loop (Haiku) | $0.56 | $0.54 |
| 2. Table step | $1.99 | **$0.08** |
| 3. Draft with quotes | $0.49 | $0.59 |
| 4. Answer text | $0.16 | $0.16 |
| 5. Quote check (fix call) | $0 | $0.02 |
| **Total** | **$3.20** | **$1.39** |
| Time | 710 s | 807 s |
| Documents read / not in a table | 47 / 5 | 57 / 15 |
| Correct facts (of 47) | 33 (70%) | **32 (68%)** |
| Wrong facts | 0 found | 0 found |

- **Haiku's tables are wordier but cheap:** about 130k output tokens over 8 calls, for $0.08 in total. It put fewer documents in tables (15 left out against 5), so the draft got more raw text and cost $0.10 more.
- **Found that run 3 missed:** the Nov 2025 sweep (25), TI84shop with its articles (44–45), Sneakerstad's amount (46), On that ass (49). New and checked: the ACM published four "no fine" decisions in the same 2024 round; GT Ecom (2025, €90,000, with articles); Tix.nl; the fine maximum quoted from art. 2.15 Whc.
- **Missed that run 3 found:** G-Star's article (9, now "not verified"), the admission (13), Epic's objection (29), Leen Bakker's 39 announcements (7), ACM competence since 2023 (20), Bicep Papa (47).
- **Law ids:** the Whc is now right (`BWBR0020586`, read art. 2.15); the Prijzenwet is missing from the list (not read this time).

Rubric (provisional): Decisions 2, Article 2, Facts 2, Gaps 1–2, Quotes 1–2. **8–10**, in line with run 3. With one run each, the difference between runs 3 and 4 is within loop variance.

## Next

- Run Q1 once or twice more on this setup to see run-to-run variance.
- Drop old document texts from the loop context: calls reached about 400k tokens, so every Haiku call pays the rate above 100K.
- Let the loop read the laws named in the decisions it read (Whc 8.8 is cited everywhere but never read), so the law ids are right.
