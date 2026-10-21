# Moonlit Luna vs our approach B: 5-question test

_Run 2026-10-10. Moonlit on a free account; B is `benchmarks/law_retrieval/b_fulltext/search.ts` (Opus 5.5, effort low)._

**TL;DR:** Moonlit is an agentic research loop over about 21 Dutch portals. It took 12 minutes, read about 64 documents and answered all 5 questions with cited sources. At finding laws it beat B on 4 of 5 questions, mainly because it reads regulator and court decisions, which name the exact article breached. Every law Moonlit cited is also in B's index, so B's misses are search misses, not missing data. B takes about 10 seconds per question but only covers national legislation (BWB).

## Test questions

All five were asked in one Moonlit chat. Each targets specific portals:

1. **ACM fines** for fake discounts, countdown timers and dark patterns (acm.nl, rechtspraak)
2. **AP on tracking cookies and cookie walls**, its fines, and how they relate to art. 11.7a Telecommunicatiewet (autoriteitpersoonsgegevens.nl, wetten.overheid.nl)
3. **Pay-later (BNPL) under CCD2**: AFM oversight, status of the Dutch implementation bill, Kifid rulings (afm.nl, kifid.nl, officielebekendmakingen)
4. **Advertising Code rules for influencers** and Institute for Human Rights rulings on algorithmic credit checks (reclamecode.nl, oordelen.mensenrechten.nl)
5. **VAT on EU distance sales (OSS)** and when VAT is due with pay-later (kennisgroepen.belastingdienst.nl, rechtspraak)

## How Moonlit's search works

Inferred from the visible thinking trace:

1. **Search:** 6 broad searches in parallel, then about 19 targeted ones, 25 in total. Each returns 10–15 hits, de-duplicated across searches.
2. **Two search modes:** meaning-based search did most of the work. A keyword query with quotes and AND (`"Telecommunicatiewet" AND "11.7a"`) returned 0 hits, which suggests keyword search doesn't match article numbers well.
3. **Fetch by ID:** it can open a known document directly, such as a BWB id.
4. **Tables:** `analyze_documents` asks 2–4 fixed questions over 6–12 documents, one cited cell per document per question, or "not in document". A question that's too compound makes a cell fail with "error", and it then splits the question and retries.
5. **Citation rule:** citations may only come from documents it actually analysed or read.
6. **Draft and check:** it writes a draft, then checks each claim against its sources (verified, contradicted or not supported) and flags decisions mentioned without a citation. Then it revises. The answer was published even though the last check still reported failures.

**The claim checker is noisy.** It sometimes checks a claim against the wrong document. It also flags "I didn't find X" statements as unsupported, and it marked at least one correct claim as contradicted.

## Sources Moonlit used

| Portal | Documents |
|---|---|
| acm.nl | ~11: 2024 fake-discount fines and decisions (Koopjedeal, Leen Bakker, G-star, JYSK, Tommy Hilfiger), Epic/Fortnite 2023 decision and 2024 objection, TrendX 2022, Vodafone 2019, countdown timers 2023, later press releases, NPO cookie order 2014 |
| autoriteitpersoonsgegevens.nl | ~8: annual reports, advisory letters on cookies, Kruidvat and Coolblue decisions (fines and objections), Woo decision on cookie banners |
| wetten.overheid.nl | Telecommunicatiewet, Wet OB 1968 |
| officielebekendmakingen | ~10: CCD2 bill 36924 documents (explanatory memorandum, response to report, motions, amended bill of 6 Oct 2026), progress letter on EU directives, parliamentary papers on cookies, Wet OB amendments, VAT administrative-obligations decree |
| afm.nl | 3 |
| kifid.nl | 5 Klarna rulings (2025–2026) |
| rechtspraak.nl | Supreme Court HR 2023:778, HR 2025:1008, HR 2020:1504; AG opinion PHR 2014:688. It did **not** find the Rotterdam court ruling on fake discounts. |
| reclamecode.nl | 9 RCC rulings (mostly influencer cases, plus 2 credit-advertising cases) |
| oordelen.mensenrechten.nl | 8 rulings (ING, ABN AMRO, Rabobank, Breeze, Santander) |
| kennisgroepen.belastingdienst.nl | Searched 3 times; nothing usable |

Not used, and not relevant to these questions: dnb, cbho, procurement experts committee, local regulations, Raad van State, arbitration board, disciplinary-law portals, PUC RSJ.

## Law-finding: Moonlit vs B

All provisions Moonlit cited were checked and are present in B's `bwb_article` index.

| Q | Moonlit | B | Better |
|---|---|---|---|
| 1 | Prijzenwet 2b(2) + Besluit prijsaanduiding producten 5a(1) (the basis for the fake-discount fines), Whc 8.8, BW 6:193b/c/d/e/g/i at sub-paragraph level | BW 6:193a–i, Whc 2.9/2.15, the lowest-price exception rule. Missed Prijzenwet/Bpp | Moonlit |
| 2 | Tw 11.7a (after its keyword search failed), Tw 15.1, GDPR 4/5/6 | Tw 11.7a straight away, 15.1/15.4, AP fining policy 2023, GDPR Implementation Act 14 | Draw. B was faster on 11.7a; the GDPR is EU law, outside the BWB |
| 3 | Wft 2:60, 1:20(1)(e) old Wft, BW 7:58(2)(e), 7:60, 7:61, 3:40(2), plus the bill and its status | BW 7:57–70a, Wft exemption rules; Wft 2:64a/c is wrong (servicing non-performing loans) | Moonlit |
| 4 | Equal Treatment Act (Awgb) 1 and 2(1), Bgfo 53(8) | Act establishing the Institute (powers only), Bgfo 53/54, AFM policy rule on credit ads. Missed the Awgb | Moonlit |
| 5 | Wet OB 5a(1)(a), 6k, 13, 34g, Union scheme, transfer of receivables | Wet OB 28s–28si, 2a, 37 (off-topic). Missed 5a/6k/13 | Moonlit |

**Rough score** for laws found, out of 5: Moonlit about 4.5, B about 3.

### Speed and scope

| | Moonlit | B |
|---|---|---|
| Time | ~12 min for 5 questions in one chat | 8–14 s per question |
| Calls | 25 searches, ~64 documents, 8 tables, 2 rounds of claim checks | 2 Claude calls per question |
| Sources | ~21 portals: case law, regulators, bills, parliamentary papers | BWB only (national legislation) |
| Output | A full answer with 249 cited passages | Laws, articles and a short reason each; no answer text |
| Hallucination check | Claim checker (noisy) | Pick step limited to candidate ids; all 5 marked "not confident" |

## Why Moonlit wins on law-finding

1. **It finds laws through decisions.** A regulator's decision names the article breached ("artikel 2b, tweede lid, Prijzenwet"). B searches statute text for the question's own words, which often don't appear in the article.
2. **It loops.** Moonlit keeps searching until it has what it needs. B does one round of queries and one pick.
3. **It covers bills and EU law**, which the BWB doesn't hold.

## Ideas for B

- **Index decisions and rulings** (Kifid, ACM, AP, rechtspraak.nl) and extract the articles they cite. This links practice terms ("nepkortingen") to the right law, and is the biggest expected gain.
- **Add a second query round** that uses the candidates' own vocabulary (already an open point in `model_improvements/law_retrieval.md`).
- **Make the pick step prefer substantive law** over a law that only sets up an institution (Awgb vs Wet CRM in Q4).
- **Add officiële bekendmakingen** (same SRU API) to cover bills and parliamentary papers.

## Assumptions and caveats

- This was one run per system. B varies between runs (see `law_retrieval.md`), and Moonlit probably does too.
- **The comparison isn't like for like.** Moonlit answers the whole question; B only finds laws. These questions mostly target non-BWB sources, which favours Moonlit.
- **All five questions went in one Moonlit chat.** One question per chat may behave differently.
- **The scores are my judgement, not a gold set.** Nobody has checked them against a lawyer's answer.
- **Moonlit's claims about fines, rulings and dates haven't been verified independently.** Its own citations point to the documents above.
- The Moonlit run used a free account; Premium may use different models or depth (see `moonlit_free_vs_premium.md`).
- B's raw output is in the session scratchpad and won't be kept; rerun `b_fulltext/search.ts` with the questions above to reproduce it.
