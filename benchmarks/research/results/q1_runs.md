# Q1 (ACM dark patterns): all deep-search runs compared

**TL;DR:** Six iterations on Q1 so far. GPT-6.1 Sol on every step (run 5) cost $2.24 at 53% coverage: precise, but it missed more cases than the Haiku setups and took 27 minutes. The cheapest good setup is **run 4: Haiku for the search loop and the tables, Opus for the draft and answer, $1.39** at 68% coverage, against ≈ $5 and 81% for the all-Opus run. Moonlit scored 36%. Most of the savings came from two changes: Haiku in the loop (≈ $3.20 → $0.50) and Moonlit-style tables on Haiku ($3.41 → $0.08).

Question: which ACM decisions and fines hit webshops for misleading discounts, fake countdown timers or other dark patterns, with company, year and breached provision per case. Coverage is counted against the 47-fact list in `2026-10-19_acm_comparison.md`. Details per run: `2026-10-19_haiku_loop_acm_scores.md`. Moonlit's Q1-only rerun: `2026-10-19_moonlit_q1_rerun.md`.

## Model per step

The quote check itself is a word-for-word match without a model; only its fix call (when a quote fails) uses one.

| Run | 1. Search loop | 2. Tables | 3. Draft | 4. Answer | 5. Quote fix |
|---|---|---|---|---|---|
| 0 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 1 | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 2 | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 3 | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 4 | Haiku 5.5 | Haiku 5.5 | Opus 5.5 | Opus 5.5 | Opus 5.5 |
| 5 | GPT-6.1 Sol | GPT-6.1 Sol | GPT-6.1 Sol | GPT-6.1 Sol | GPT-6.1 Sol |
| Moonlit | unknown | unknown | unknown | unknown | unknown |

Every model ran at effort high.

## Cost per step

| Run | Setup | 1. Search loop | 2. Tables | 3. Draft | 4. Answer | 5. Quote check | **Total** |
|---|---|---|---|---|---|---|---|
| 0 | All Opus 5.5 (`smoke`) | ≈ $3.20 | ≈ $1.15 | ≈ $0.50 | ≈ $0.20 | $0 | **≈ $5** (estimate) |
| 1 | Haiku loop, old tables | $0.46 | $3.41 | $0.69 | $0.17 | $0 | **$4.72** |
| 2 | Haiku loop, Moonlit-style tables | $0.31 | $1.66 | $0.37 | $0.13 | $0 | **$2.48** |
| 3 | Run 2 + table fix | $0.56 | $1.99 | $0.49 | $0.16 | $0 | **$3.20** |
| 4 | Run 3 + Haiku tables | $0.54 | $0.08 | $0.59 | $0.16 | $0.02 | **$1.39** |
| 5 | All GPT-6.1 Sol | $1.13 | $0.80 | $0.24 | $0.05 | $0.02 | **$2.24** |

Run 0 has no per-call log: its numbers are the estimate from `2026-10-19_token_usage.excalidraw`. Runs 1–5 are priced per call from the logs and the JSON trace. The quote check only costs money when a quote fails and a fix call is made.

## Results

| Run | Time | Calls | Documents | Correct facts (of 47) | Wrong facts | Rubric |
|---|---|---|---|---|---|---|
| 0 | 958 s | 38 | 44 | 38 (81%) | 1 | 8 |
| 1 | 1,246 s | 25 | 38 | 31 (66%) | 0 found | 8–9 |
| 2 | 592 s | 26 | 43 | 25 (53%) | 0 found | 8–9 |
| 3 | 710 s | 32 | 47 | 33 (70%) | 0 found | 9–10 |
| 4 | 807 s | 31 | 57 | 32 (68%) | 0 found | 8–10 |
| 5 | 1,633 s | 28 | 58 | 25 (53%) | 0 found | 7–9 |
| Moonlit | ≈ 12 min for 5 questions | | | 17 (36%) | 0 | 6 |
| Moonlit, Q1 only | 166 s | | 23 | ≈ 28 (≈ 60%) | 0 | 9–10 |

## Per step: Haiku setup (run 4) vs GPT-6.1 (run 5)

Performance scores are judgement calls (1–5), backed by the counts in each cell. GPT's loop read most of the cases it then missed (Seats and Sofas, Booking/Expedia, the Nov 2025 sweep, the ECLIs); they were lost between the tables and the draft, not in the search.

| Step | Haiku cost | Haiku performance | GPT-6.1 cost | GPT-6.1 performance |
|---|---|---|---|---|
| 1. Search loop | $0.54 | **4/5**: 20 calls, 41 searches, 51 reads, 57 documents. Reached TI84shop, Sneakerstad, KPN, Seats and Sofas. Missed Bicep Papa, Booking/Expedia, T.O.M. | $1.13 | **4/5**: 18 calls, 96 searches, 59 reads, 58 documents. Reached Seats and Sofas, Booking/Expedia, the ECLIs, Bicep Papa, T.O.M., Bol.com. Missed KPN, TI84shop, Sneakerstad. |
| 2. Tables | $0.08 | **4/5**: 4 tables, 166 cells, 15 documents left out | $0.80 | **3/5**: 4 tables, 168 cells, 19 documents left out |
| 3. Draft | $0.59 | **4/5**: 46 claims; almost everything the loop read made it into the answer | $0.24 | **3/5**: 39 claims. Dropped cases the loop had read and would not attach Leen Bakker's article. More precise about articles and follow-up rulings. |
| 4. Answer | $0.16 | **4/5**: 1,492 words, clearly organized | $0.05 | **4/5**: 1,259 words. Tighter; separates formal decisions from warnings and voluntary fixes. |
| 5. Quote check | $0.02 | **5/5**: 45 of 46 quotes passed, 1 fixed | $0.02 | **4/5**: 37 of 39 passed, 2 fixed |
| **Total** | **$1.39** | **32 of 47 facts (68%)** | **$2.24** | **25 of 47 facts (53%)** |
| Time | 13 min | | 27 min | |

## What changed per run

- **Run 0:** all steps on Opus 5.5 at effort high. One table: every question over every document read (16 × 44 = 704 cells).
- **Run 1:** search loop on Haiku 5.5. Law search failed (`.envrc` not loaded), so no BWB articles. Opus picked 24 table questions: 912 cells, which made the table step the most expensive step.
- **Run 2:** law search fixed. Tables like Moonlit's `analyze_documents`: one per sub-question, 2–4 questions, at most 12 picked documents (≤ 192 cells). Cheaper and faster, but facts in documents no table picked were lost.
- **Run 3:** a cell lists every case in a document, each with its own quote, and documents no table picked go to the draft as text. Coverage back to 70%.
- **Run 4:** the table step on Haiku too. Same quality, table step from $1.99 to $0.08. The draft is now the most expensive step (42%).
- **Run 5:** every step on `gpt-6.1-sol` (effort high) through a small Responses API adapter (`deep/openai.ts`). The loop searched widely (96 source searches, 13 law lookups, 59 reads in 18 calls) and its later calls went over 272K input tokens, the higher rate. The answer is the most careful so far: exact articles for most cases, plus later stages that no other run had (Bicep Papa's articles and the CBb ruling of 22 Apr 2025, T.O.M.'s final fines after the CBb, a Bol.com draft commitments decision of Aug 2026). But it missed Seats and Sofas, KPN, Boomfietsen, TI84shop and Sneakerstad, gave no ECLIs, and would not attribute Leen Bakker's article although the ECLI mapping was available. 2 of 39 quotes needed a fix. Draft and answer cost less than on Opus ($0.29 against $0.75), but it was the slowest run (27 min).

## Caveats

- One run per setup, so differences of a few facts are within run-to-run variance of the search loop.
- Scores are judgement calls, not a lawyer's check.
- Prices: Anthropic rates from the API skill; GPT-6.1 Sol from OpenAI's announcement via search ($2 / $0.10 cached / $10 per 1M tokens, higher above 272K input tokens).
