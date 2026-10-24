# Q1 (ACM dark patterns): Moonlit MCP by hand

**TL;DR:** Claude (Opus 5.5) answered Q1 in Claude Code using only the Moonlit MCP connector on the free plan. After a quick first pass of 9 calls (about 23–32% coverage), all 158 hits of the main search were listed and the 19 relevant decisions read: **26 of the 47 facts (55%), no wrong facts, rubric 8–9**. It took **30 Moonlit calls**, about 15 minutes and no Moonlit cost (free plan). Its strength is the exact breached article for every case, straight from each decision's dictum. Its weakness is coverage: one keyword query misses cases without "korting" or "timer" in the text (TrendX, KPN, TI84shop, the 2023 timer sweep, Temu and Booking).

Fact list: `2026-10-19_acm_comparison.md`. All runs: `q1_runs.md`. Plans and prices: `../2026-10-22_moonlit_plans.md`.

## How it ran

| Step | Calls | What |
|---|---|---|
| Find the ACM source id | 1 | `get_search_filters` (sources, "Consument en Markt") |
| Keyword search, first page of 25 | 1 | `(boete OR "last onder dwangsom") AND (webwinkel* OR webshop* OR online*) AND (aftelklok* OR timer OR korting* OR "van-voor*" OR doorgestreept* OR "dark pattern*" OR schaarste)`, ACM only, newest first: 158 hits |
| Timer search | 1 | `(aftelklok* OR "countdown timer" OR ...) AND (boete* OR boetebesluit OR dwangsom)` |
| First reads | 6 | 2024 fake-discount press release, GT Ecom, Reizendeal, bol draft commitments, court press release, Epic objection decision |
| All 158 hits | 2 | Same keyword search, 100 per page, pages 1 and 2 |
| Second reads | 19 | Five 2024 fine decisions, four 2024 no-fine decisions, Koopjedeal objection, Epic 2023, 2023 fake-discount press release, Sneakerstad, Privilege, We Love Musthaves, Vodafone, Seats and Sofas, Belvilla, World Ticket Center |
| **Total** | **30** | 1 unit per call; the free plan has 100 a month |

The second reads ran in a subagent, so the documents stayed out of the main context.

## Score

| Criterion | Score | Why |
|---|---|---|
| Decisions found | 1–2 | All the 2024 fake-discount fines, Epic, Vodafone, Seats and Sofas, Belvilla, Sneakerstad, plus finds outside the list. Missed TrendX, KPN, TI84shop, Bicep Papa, House of Tickets, Boomfietsen, the 2023 timer sweep, the Nov 2025 sweep and the CPC actions (Temu, SHEIN, Booking/Expedia). |
| Breached article | 2 | Exact article with lid/onder for every case, taken from the dictum, including JYSK and PVH (row 12). |
| Facts | 2 | Every amount, date and name checked out. |
| Honest gaps | 2 | Gaps named. The ECLI-to-company mapping was left open rather than guessed. |
| Quotes back every claim | 1 | A verbatim dictum quote for each provision, but no formal word-for-word check over every claim. |
| **Total** | **8–9** | |

**Facts:** rows 1–13, 15, 17, 19, 20, 21, 23, 26–29, 39, 40 and 46, which is 26 of 47 (55%). Precision 100%, 0 wrong.

**Finds outside the fact list:** Reizendeal (2024: order subject to penalty payments, €8,000 a week up to €80,000; 8.8 Whc jo. 6:193d and 6:193f(c) BW, and 8.2a Whc jo. 6:230v(2) and (3) BW; the 15-minute countdown timer is weighed as time pressure under 6:193d lid 4). Privilege (2022: hard-to-cancel membership, up to €240,000; 6:236 onder j and o, 6:233 and 6:193h BW). We Love Musthaves (2020). World Ticket Center (2014). Four 2024 fake-discount investigations closed without a fine. Koopjedeal's ability-to-pay request, rejected on objection.

## Compared

| | Coverage | Wrong | Rubric | Time | Cost |
|---|---|---|---|---|---|
| Moonlit MCP, first 9 calls | 23–32% | 0 | 5–6 | ≈ 5 min | 9 units |
| **Moonlit MCP, 30 calls** | **55%** | **0** | **8–9** | ≈ 15 min | 30 units (≈ €2.10 at MCP Pro rates) plus Claude Code usage |
| Moonlit Luna, Q1 only | ≈ 60% | 0 | 9–10 | 166 s | 1 Luna chat |
| Our run 4 (Haiku loop) | 68% | 0 | 8–10 | 807 s | $1.39 API |

## Lessons

- MCP search is cheap per call but costs a call per page and per document. A thorough answer needs 30–60 calls, not 10.
- One boolean query with broad OR groups still misses whole case types. Two or three narrower queries (fake reviews, hidden costs, subscriptions, CPC actions) would probably have found most of the misses for about 5 more calls.
- The precision of the articles comes from reading the dictum of the decision itself, not the press release.
