# Q1 (ACM dark patterns): Moonlit rerun on Q1 alone

**TL;DR:** Given only Q1 (instead of all five questions), Moonlit found **about 28 of the 47 facts (≈ 60%)**, up from 17 (36%), with no wrong facts and a rubric score of about **9–10**. That is close to our best runs (68–70%, 12–13 min), but it took **2 min 46 s**. The speed comes from the architecture, not the model: documents are read only through its grid, never into the agent's context; the grid is a tool called during the search; and search is boolean over full text.

Export (gitignored): `benchmarks/research/moonlit/2026-10-19_q1_answer.{docx,txt}`. Fact list: `2026-10-19_acm_comparison.md`. Our runs: `q1_runs.md`.

## Effort

| | Moonlit (Q1 only) | Our run 4 (Haiku loop + tables) | Our run 5 (GPT-6.1) |
|---|---|---|---|
| Time | **166 s** | 807 s | 1,633 s |
| Searches | 5 | 41 | 96 |
| Documents read | 23 (all through its grid) | 57 | 58 |
| Grids / tables | 2 (21 docs × 4 questions, then 2 × 2 to fill a gap) | 4, after the loop | 4, after the loop |
| Answer | ≈ 960 words, 136 quoted sources | 1,492 words | 1,259 words |

## Facts (against the 47-fact list)

- **Found (≈ 28):** rows 1–11, 15, 17–22, 26–30, 32, 35, 37, 38, 41. Row 25 (Nov 2025 sweep) is partial: no "18 of 24".
- **Beyond the list:** JYSK's and PVH's article (row 12, which no answer had confirmed before), Epic's court ruling (ECLI:NL:RBROT:2026:171), the Bol draft commitments decision (Aug 2026), Koopjedeal's eight announcements.
- **Missed:** Vodafone (its first answer had it), KPN, Belvilla, Wish, Temu, Booking/Expedia, Boomfietsen, TI84shop, Sneakerstad, Bicep Papa, the travel firms, On that ass. It read "other dark patterns" narrowly.
- **Imprecise, not wrong:** it says ACM "verklaart" Bol's commitments binding (it is a draft decision), and that SHEIN "eindigde" without a fine (still open).
- The fact list was built from our answers and the first Moonlit run, so this coverage understates Moonlit somewhat.

## Rubric (provisional)

| Criterion | Score | Note |
|---|---|---|
| Decisions found | 2 | All core discount and timer cases; misses the wider dark-pattern cases |
| Breached article | 2 | Exact for every fine, including JYSK and PVH |
| Facts | 2 | Nothing wrong found; two loose wordings (Bol, SHEIN) |
| Honest gaps | 2 | Separates fines from action without a fine; scopes Epic as not a webshop |
| Quotes back every claim | 1–2 | Quotes for nearly every claim, but one claim that failed its own check was published |
| **Total** | **9–10** | First Moonlit run: 6 |

## What we can learn

1. **Documents never enter the agent's context.** "23 read" equals the documents its two grids analysed. The agent sees search results and grid answers only. Our loop keeps full texts, so calls reach about 400k tokens: slower, and above the 100K price line.
2. **The grid is a tool inside the loop.** It ran a broad grid, saw that Seats and Sofas had no article, and ran a small grid on just that. Our tables only run after the loop.
3. **Few broad boolean searches over full text.** Five `OR`/`AND`/quoted-phrase queries, 25–30 hits each. Its index returns ACM decision PDFs as text (one document bundles all five 2024 decisions). This supports the parked TODO: local full-text index for ACM and AP.
4. **One grid row per case.** A document with five decisions gave five rows, like our run 3 fix.
5. **Deliberate scope cut.** It skipped cases seen only in search results and put action without a fine in its own section: higher precision, lower recall.
6. **Its claim check is noisy.** Several "contradicted by" verdicts cite unrelated documents (for example, a House of Tickets claim against the TrendX decision), so claim-to-source matching looks misaligned. Keep our word-for-word quote check.

## Next

- Make the table step a tool in the search loop, and keep only search results and table answers in the loop context, not document texts.
- Then rerun Q1 on run 4's setup and compare time, cost and coverage with this run.
