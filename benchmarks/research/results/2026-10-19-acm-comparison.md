# ACM dark patterns (Q1): deep search vs Moonlit

**TL;DR:** Deep search scores **8/10** and Moonlit **6/10**; coverage is **81% vs 36%**, precision 97% vs 100%. Deep search found about twice as many correct facts (38 vs 17) and 30 that Moonlit missed: older discount fines, the court ECLIs, and five other dark-pattern sanctions. It missed the Epic/Fortnite timer fine, the one ACM fine aimed at fake timers, and then wrongly said timers had only been tackled through EU-wide actions. Moonlit's answer is short and every fact in it is correct, but it covers only about a third of what exists.

Question `acm-dark-patterns`: which ACM decisions and fines hit webshops for misleading discounts, fake countdown timers or other dark patterns, with company, year and breached provision per case.

## Scores

Rubric: `benchmarks/research/rubric.md`. Facts were checked against acm.nl, the decision PDFs and rechtspraak.nl on 2026-10-19.

| Criterion | Deep | Moonlit | Reasoning |
|---|---|---|---|
| Decisions found | 2 | 1 | Deep: 4 of 7 reference items plus about 15 other verified cases, but it missed Epic, Vodafone and the 2023 timer sweep. Moonlit: all 7 reference items, but only about a third of the verified cases in the union. |
| Breached article | 2 | 1 | Deep: the exact article, with lid/onder, for 8 cases and never wrong. Missing ones are flagged (borderline 2, because JYSK, PVH and five minor cases have none). Moonlit: exact for Koopjedeal, Epic and Vodafone only. |
| Facts | 2 | 2 | Every checked amount, date, name and number is right in both answers. Deep's wrong timer conclusion is scored under Gaps. |
| Honest gaps | 1 | 1 | Deep: a clear gap list with nothing invented, but it says timers were only tackled through CPC actions when the Epic fine exists. A strict reading of the rubric gives 0. Moonlit: honest, but it reports the ECLI as "not found" although the press release it read lists it. |
| Quotes back every claim | 1 | 1 | Deep: all 42 quotes pass, but 11 claims carry a number, date or name that is not in the quote (it is in the same source, and all of them check out). Moonlit: claim check 2 failed 2 Q1 statements, one of them a wrong-document citation for a correct date. |
| **Total** | **8** | **6** | |

| Coverage and precision | Deep | Moonlit |
|---|---|---|
| **Coverage** (correct facts found, of 47 in the list) | **81%** (38) | **36%** (17) |
| **Precision** (own facts that are correct) | 97% (38 of 39) | 100% (17 of 17) |
| Wrong facts | 1 | 0 |
| Unique finds | 30 | 9 |

**Disagreement with the 2026-10-18 scoring (Moonlit 7/10):** I give Moonlit 1 instead of 2 on Decisions found. It scored 2 only because the reference list was built from its own answer. Against the verified union it misses Seats and Sofas, Belvilla, House of Tickets, TI84shop, Sneakerstad, Bicep Papa and others. The other four criteria match the earlier scoring.

## Fact table

Deep / Moonlit columns: **yes** = stated, **–** = not mentioned, **gap** = flagged as unknown, **guess** = hedged guess. Verdicts marked "(quote)" were checked through the quote in smoke.json and not fetched again. All others were fetched.

| # | Fact | Deep | Moonlit | Verdict | Source |
|---|---|---|---|---|---|
| 1 | Five webshops fined €621,000 in total (decision 2 May 2024) | yes | – | correct | [press release](https://www.acm.nl/nl/publicaties/acm-legt-boetes-op-aan-webwinkels-voor-nepkortingen) |
| 2 | Day Traders (Koopjedeal) €163,000 | yes | yes | correct | same |
| 3 | Koopjedeal: art. 2b lid 2 Prijzenwet jo. art. 5a lid 1 Bpp | yes | yes | correct | [bezwaar](https://www.acm.nl/nl/publicaties/beslissing-op-bezwaar-boetebesluit-day-traders-koopjedeal) |
| 4 | Koopjedeal artificially raised its "van" prices | yes | yes | correct | [court press release](https://www.acm.nl/nl/publicaties/rechtbank-bevestigt-boetes-acm-voor-nepkortingen-leen-bakker-en-koopjedeal) |
| 5 | Leen Bakker €130,000 | yes | yes | correct | press release |
| 6 | Leen Bakker: art. 2b lid 2 Prijzenwet jo. art. 5a lid 1 Bpp | yes | – | correct | [ECLI:NL:RBROT:2025:12967](https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:RBROT:2025:12967) |
| 7 | Leen Bakker: 39 wrong price announcements | yes | – | correct | same |
| 8 | G-Star €110,000 | yes | yes | correct | press release |
| 9 | G-Star: art. 2b lid 2 Prijzenwet jo. art. 5a lid 1 Bpp | yes | – | correct | [G-Star PDF](https://www.acm.nl/system/files/documents/boetebesluit-g-star-raw-estore.pdf) |
| 10 | JYSK €112,500 | guess | yes | correct (it is in the press release deep search read) | [press release](https://www.acm.nl/nl/publicaties/acm-legt-boetes-op-aan-webwinkels-voor-nepkortingen) |
| 11 | Tommy Hilfiger (PVH) €105,500 | guess | yes | correct (same) | same |
| 12 | JYSK and PVH: same article as G-Star | guess | gap | correct (neither confirmed it) | [JYSK PDF](https://www.acm.nl/system/files/documents/boetebesluit-jysk.pdf), [PVH PDF](https://www.acm.nl/system/files/documents/boetebesluit-pvh-brands-netherlands-tommy-hilfiger.pdf) |
| 13 | G-Star, JYSK and PVH admitted the breach and got a lower fine | yes | – | correct | press release |
| 14 | Basic fine cut by 1/3 because art. 5a was enforced for the first time; G-Star got 10% off for simplified settlement | yes | – | correct (JYSK also got the 10%) | G-Star PDF |
| 15 | Koopjedeal's objection rejected on 29 Aug 2024 | yes | – | correct | bezwaar |
| 16 | On objection: fine correctly set in category III | yes | – | correct (quote) | bezwaar |
| 17 | Rechtbank Rotterdam upheld the Leen Bakker and Koopjedeal fines on 11 Nov 2025 | yes | yes | correct | court press release |
| 18 | ECLI:NL:RBROT:2025:12967 (Leen Bakker) and :12968 (Koopjedeal) | yes | gap | correct (mapping checked by amount) | [12967](https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:RBROT:2025:12967), [12968](https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:RBROT:2025:12968) |
| 19 | Both rulings are final | yes | yes | correct | court press release |
| 20 | ACM has been competent to enforce art. 5a Bpp since 1 Jan 2023 | yes | – | correct | 12967 |
| 21 | Seats and Sofas, 4 May 2018: €200,000 (8.8 Whc jo. 6:193c lid 1 onder d BW) and €150,000 (2b Prijzenwet jo. 3 lid 1, 4 lid 1 Bpp) | yes | – | correct | [ECLI:NL:CBB:2020:914](https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:CBB:2020:914) |
| 22 | Seats and Sofas: upheld by the Rechtbank Rotterdam on 23 May 2019 and the CBb on 1 Dec 2020; final | yes | – | correct | [Rb press release](https://www.acm.nl/nl/publicaties/uitspraak-rechtbank-boete-seats-en-sofas) |
| 23 | Belvilla (@Leisure BR), Dec 2017: €325,000 for misleading "vanaf" prices and unavoidable costs | yes | – | correct | [Belvilla](https://www.acm.nl/nl/publicaties/boete-voor-belvilla-voor-misleidende-prijsvermelding) |
| 24 | Wish (2022) banned fake discounts after ACM action; no fine | yes | – | correct (quote) | [Wish](https://www.acm.nl/nl/publicaties/wish-stopt-met-schijnkortingen-en-prijspersonalisatie-na-actie-acm) |
| 25 | Nov 2025 sweep: 18 of 24 sellers misleading; companies addressed, no sanctions yet | yes | – | correct | [sweep](https://www.acm.nl/nl/publicaties/acm-ziet-nog-veel-misleidende-kortingen-en-adviseert-eerst-checken-dan-bestellen) |
| 26 | Epic Games (Fortnite), decision 18 Dec 2023: €562,500 for misleading timers (8.8 Whc jo. 6:193g onder g BW) | – | yes | correct | [Epic decision PDF](https://www.acm.nl/system/files/documents/sanctiebesluit-fortnite.pdf) |
| 27 | Epic: €562,500 for directly urging children to buy (8.8 Whc jo. 6:193i onder e BW) | – | yes | correct | same |
| 28 | Epic: binding instruction on the Item Shop dark pattern (6:193b lid 2 BW) | – | yes | correct | same |
| 29 | Epic's objection rejected (27 Nov 2024) | – | yes | correct | [Epic bezwaar](https://www.acm.nl/nl/publicaties/bezwaar-epic-tegen-boetes-en-bindende-aanwijzing-fortnite-ongegrond) |
| 30 | 2023 timer sweep: dozens of webshops addressed, 41 cases, no names, no fines | – | yes | correct | [countdown timers](https://www.acm.nl/nl/publicaties/acm-spreekt-webshops-aan-die-misleidende-countdowntimers-gebruiken) |
| 31 | Temu (2024): CPC action covering timers and scarcity claims; no sanction | yes | – | correct (quote) | [Temu](https://www.acm.nl/nl/publicaties/eu-toezichthouders-temu-moet-zich-houden-aan-consumentenregels) |
| 32 | SHEIN (2025): CPC action covering timers, scarcity and fake discounts; no fine yet | yes | – | correct (quote) | [SHEIN](https://www.acm.nl/nl/publicaties/acm-en-europese-consumententoezichthouders-shein-moet-website-aanpassen) |
| 33 | Booking.com (2019): commitments, including no false scarcity; ACM led | yes | – | correct | [Booking](https://www.acm.nl/nl/publicaties/booking-past-website-aan-na-optreden-van-de-europese-consumententoezichthouders) |
| 34 | Expedia (2020): similar commitments | yes | – | correct (quote) | [Booking/Expedia](https://www.acm.nl/nl/publicaties/booking-en-expedia-informeren-consumenten-nu-duidelijker-over-hun-aanbod) |
| 35 | Fake timers fall under art. 6:193g onder g BW | yes | – | correct (quote) | [BW 6:193g](https://wetten.overheid.nl/BWBR0005289/2026-07-16#Boek6_Titeldeel3_Afdeling3A_Artikel193g) |
| 36 | Fake timers were only tackled in EU CPC actions; no ACM sanction against an individual company | yes | – | **wrong** (see 26 and 30) | Epic decision PDF |
| 37 | TrendX, Nov 2022: €100,000 for fake reviews and unclear delivery times | yes | yes | correct | [TrendX](https://www.acm.nl/nl/publicaties/boete-voor-oneerlijke-handelspraktijken-trendx) |
| 38 | TrendX: 8.8 Whc jo. 6:193c lid 1 onder b and c and 6:193g onder v BW | yes | gap | correct (quote) | same |
| 39 | Vodafone, Dec 2019: €1,159,000 (8.8 Whc jo. 6:193d jo. 6:193e onder c BW) | – | yes | correct | [Vodafone PDF](https://www.acm.nl/sites/default/files/documents/2019-12/besluit-boete-vodafone-voor-oneerlijke-handelspraktijken-op-websites.pdf) |
| 40 | Vodafone: €1,961,500 (8.8 Whc jo. 6:193c lid 1 onder d BW) | – | yes | correct | same |
| 41 | House of Tickets, 22 May 2026: €270,000 for bidding bots (8.8 Whc jo. 6:193c lid 1 onder d and 6:193g onder v BW) | yes | – | correct | [House of Tickets](https://www.acm.nl/nl/publicaties/boete-house-tickets-voor-misleiding-bij-online-veilingen) |
| 42 | Boomfietsen (2019): €50,000, including an unclear order button; reduced on objection | yes | – | correct | [Boomfietsen](https://www.acm.nl/nl/publicaties/acm-beboet-webwinkel-voor-onduidelijke-informatie-op-website) |
| 43 | KPN (Telfort, Simyo), 2019: over €3.4m, misleading omission of one-off costs | yes | – | correct | [KPN](https://www.acm.nl/nl/publicaties/boete-kpn-voor-oneerlijke-handelspraktijken-op-websites) |
| 44 | TI84shop, Sep 2023: order subject to penalty payments (last onder dwangsom) up to €250,000, including review suppression | yes | – | correct | [TI84 PDF](https://www.acm.nl/system/files/documents/acm-legt-webwinkel-ti-84shop-last-onder-dwangsom-op.pdf) |
| 45 | TI84shop: 6:193g onder aa, 6:193b lid 2, 6:193c lid 1 onder b, 6:230r BW | yes | – | correct | same |
| 46 | Sneakerstad (2022): order subject to penalty payments up to €150,000 | yes | – | correct (quote) | [Sneakerstad](https://www.acm.nl/nl/publicaties/acm-dwingt-webwinkel-sneakerstad-te-voldoen-aan-regels-consumentenbescherming) |
| 47 | Bicep Papa (Nov 2020): order subject to penalty payments up to €100,000 for fake likes and followers | yes | – | correct | [Bicep Papa](https://www.acm.nl/nl/publicaties/acm-legt-last-onder-dwangsom-op-aan-bicep-papa-voor-gebruik-nepvolgers-en-neplikes) |
| 48 | D-Reizen, Prijsvrij and Elmar (2024): orders subject to penalty payments for price jumps (articles as cited); withdrawn on 20 Dec 2024 after suspension | yes | – | correct | [travel firms](https://www.acm.nl/nl/publicaties/acm-trekt-drie-lasten-opgelegd-aan-reisaanbieders-voor-prijsverspringingen) |
| 49 | On that ass (2024): hidden subscription; addressed without a sanction | yes | – | correct (quote) | [On that ass](https://www.acm.nl/nl/publicaties/acm-webwinkel-boxershorts-ass-moet-duidelijker-zijn-over-abonnement) |

Neither answer mentions that the Rechtbank Rotterdam rejected Epic's appeal (ACM item dated 14 Jan 2026), even though that is a court ruling on the main timer case.

## Counts

Union: 47 correct facts that at least one system stated firmly, plus 1 wrong fact. Row 12 is excluded because neither system confirmed it.

| | Deep | Moonlit |
|---|---|---|
| Correct facts found | 38 (81% of 47) | 17 (36% of 47) |
| Own claims correct (precision) | 38 of 39 (97%) | 17 of 17 (100%) |
| Wrong claims | 1 (row 36) | 0 |
| Unique finds the other missed | 30 | 9 (Epic ×4, 2023 timer sweep, JYSK/PVH amounts, Vodafone ×2) |
| Honest gaps | 6 (JYSK/PVH amounts and article, Belvilla, Bicep Papa and other articles, fine maximum, timer fine) | 3 (four discount-fine articles, ECLI, TrendX article) |
| Invented fill-ins | 0 (JYSK/PVH guesses are labelled "vermoedelijk") | 0 |
| Gaps that were answerable from a document it had read | JYSK/PVH amounts (in the press release it quoted) | ECLI (in the court press release) |

## Where each wins

- **Deep search: coverage.** It found 30 facts Moonlit missed, including fines from 2017–2018, House of Tickets (2026) and the review and fake-likes orders. It also took the ECLIs from the press release and opened both rulings.
- **Deep search: breached articles.** It gives exact articles, with lid/onder, for 8 cases, against Moonlit's 3. It took them from rulings and decision pages rather than news items, for example the TrendX articles Moonlit said were missing.
- **Moonlit: the timer case.** It found Epic/Fortnite, the only ACM fine for misleading timers, which the ACM itself calls a dark pattern, and the 2023 sweep of dozens of webshops. Deep search ran searches on "afteltimer" and "aftelklok" on acm.nl, got 0 hits, and wrongly concluded that no such sanction exists.
- **Moonlit: concise and clean.** About 250 words, 100% precision and no wrong conclusion. It gives the JYSK/PVH amounts that deep search had in hand but would not state.
- **Deep search: claims are easier to check outside the app.** Each claim has a numbered verbatim quote and a URL. Moonlit's citations only work inside its viewer, and the pasted answer has none.

## Other differences

- **Length:** deep search is about 1,360 words plus 42 numbered sources (about 2,840 words in total) and is sometimes hard to scan. Moonlit's section 1 is about 250 words.
- **Relevance drift:** deep search includes borderline items that are not webshop dark patterns, such as KPN telecom pricing, travel price jumps and Booking/Expedia. Moonlit's Vodafone entry is a similar telecom case.
- **Time and cost:** deep search took 958 s, 38 API calls, 45 searches and 38 documents read, at about $5 estimated. Moonlit took about 12 min for all 5 questions together; its cost is unknown (free tier). Note that `smoke.md` still records €10 and `smoke.json` records `costUsd` 21.0. Both were calculated before the cache-read price fix in `run.ts`.

## Caveats

- Only question 1 of 5 was run.
- Deep search ran on the first, unoptimised version: no context trimming, and Opus at high effort for every step. The planned cost fixes may change the results, so Q1 should be re-run on the fixed version for a clean comparison.
- One run per system, so run-to-run variance is unknown.
- Moonlit ran 9 days earlier (2026-10-10) on a free account.
- Scores are judgement calls, not a lawyer's check. Facts marked "(quote)" were checked only through deep search's own quote, not fetched again.
