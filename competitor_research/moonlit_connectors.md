# Moonlit's sources: how we can get at each one

_Researched 2026-10-20. Source list: `moonlit_vs_b.md` (10 portals Moonlit used in the 5-question test plus 8 it lists but didn't use); Moonlit publishes no list itself. robots.txt files read in full on 2026-10-20 with our User-Agent; sitemap URLs counted the same day._

**TL;DR:** 9 of the 18 sources have an open API we can poll or bulk-harvest (all KOOP sources, Rechtspraak including Raad van State, Tweede Kamer, Kifid, kennisgroepen). 6 have no API but a sitemap we can crawl (ACM and AP, which we already do, plus CRM oordelen, DNB, CvAE and De Geschillencommissie). 3 are hard: AFM (broken sitemap), RCC (rulings only via its search form) and the arbitration board (robots.txt forbids everything). Watch out: wetten.overheid.nl blocks `ClaudeBot`/`anthropic-ai` by name, so we may use its SRU API but must not crawl its pages as a Claude bot.

## Table

| Source | Online search | API polling | MCP / CLI | robots.txt (for `*`) | Crawl option | Size | Crawl limits / licence | **Route** |
|---|---|---|---|---|---|---|---|---|
| **ACM** acm.nl (used) | `/nl/zoeken` disallowed and throttled (→ 403) | none | Ansvar dutch-competition-mcp (paid gateway, competition only) | Crawl-delay 10; disallow `/nl/zoeken` | sitemap (9 pages) + diwoo sitemap, RSS publicaties | 13,325 publications + PDFs | 10 s/request; no licence stated (decisions: Aw art. 11) | **Own crawl → `acm_doc`** (running, 2,491/13,294) |
| **AP** autoriteitpersoonsgegevens.nl (used) | `/search` disallowed | none | none | Disallow `/search`, `/node`, bare list pages; GPTBot blocked | sitemap 5,246 URLs, RSS `/actueel/rss.xml` | 4,209 NL pages, ~3,200 PDFs | None set (we use 1 s); reuse with attribution, ask for commercial use | **Own crawl → `ap_doc`** (`ap_crawl.sh` + `ap_index.ts`) |
| **wetten.overheid.nl** BWB (used) | HTML only | SRU `x-connection=BWB`, CC-0, ≤1000 records/call | NL-GOV-MCP, nl-eli-mcp (both active), wetsuite (py) | Allow all but search results/`/service/`; **blocks ClaudeBot, anthropic-ai, GPTBot, CCBot, Google-Extended…**; Bingbot 10 s; legal bots AstralLaw/45weg allowed at 30 s | sitemap 47,148 URLs; `BWBIdList.xml.zip` | 22,272 in force, ~2.7 GB XML | KOOP "fair use" (no numbers); CC-0 | **SRU + repository XML → `bwb_article`** (built) |
| **Officiële bekendmakingen** Stb/Stcrt/Kst (used) | HTML; results pages disallowed | SRU `c.product-area==officielepublicaties` on repository.overheid.nl, CC-0 | NL-GOV-MCP; opentk-mcp (stale); PyPublicaties (stale) | Disallow search results only | daily diff `_events/YYYY-MM-DD.xml`; FRBR folders browsable | Stb 49,720 · Stcrt 858,919 · Kst 466,604 (6.7M incl. local bulletins) | KOOP fair use; CC-0 | **SRU harvest of Stb + Kst (+ Stcrt filtered) + daily `_events`** |
| ↳ Tweede Kamer (alt. for Kst) | Yes | OData v4 (250/page) + SyncFeed (full + incremental), no key, CC-0 | tkconv (SQLite mirror, active), tkapi (py) | n/a | SyncFeed | 615,407 documents (from 2008); mirror 9.2 GB + 16 GB index | None documented | Option if Kst via SRU falls short |
| **AFM** afm.nl (used) | Sitecore endpoints return HTML partials (test call 500) | registers only, no decisions | none | Allow all but `/sitecore` | sitemap in robots.txt is a 404; RSS = last 50 items | ~1,160 actueel, 758 sector pages (facet counts, unverified) | None documented; "alle rechten voorbehouden" (decisions: Aw art. 11) | **Crawl `actueel` listings + boete PDFs, then RSS for updates** |
| **Kifid** kifid.nl (used) | Yes | undocumented JSON `/api/Search/SearchDecision/` with full text (`pdfContent`) | none (tiny scrapers) | Allow all but CMS paths | sitemap (607) has no rulings | 14,872 rulings (~149 calls) | None documented; reuse with attribution | **Live JSON search** (built); full dump via the same API is cheap |
| **Rechtspraak** (used) | undocumented `POST uitspraken.rechtspraak.nl/api/zoek` | Open Data feed (`modified` filter) + `content?id=<ECLI>`, CC-0 | NL-GOV-MCP, rechtspraak-extractor (py), rechtspraak-mcp (light) | www: 403 (Akamai) even for robots.txt; uitspraken: disallow `/api/pdfdownload` only | feed by `modified` (~2,600 changes/week); no bulk zip any more (UU snapshot 2022: 6 GB zipped) | 968,047 with full text (3.78M ECLIs) | **Max 10 requests/s**; no full-set download promised; CC-0 | **Live search** (built) now; later a local index via the feed |
| **RCC** reclamecode.nl (used) | HTML form only, 10/page | none | none | Only a sitemap line (allow all) | sitemap (445) has no rulings; RSS = last 10 | ~470 rulings/yr, est. 7–9k total (unverified) | None documented; private body, so **copyright: ask SRC** | **Page the search form by date range, fetch each `uitspraakId`; RSS for updates** |
| **CRM oordelen** oordelen.mensenrechten.nl (used) | GET `/oordelen?ZoekTerm=…` (HTML) | none | none | None (no robots.txt); www allows all | sitemap 5,083 URLs with lastmod | 5,082 oordelen (1994–2026), ~0.3 GB HTML | None documented (public body: Aw art. 11 plausible) | **Crawl via sitemap, refresh on lastmod** |
| **Kennisgroepen** Belastingdienst (used) | WordPress filter UI | WP REST `/wp-json/wp/v2/wt_publication` (full HTML, `modified_after`) | none | Allow all | sitemap 1,168 + RSS | 1,168 publications (since 2022) | None documented; **CC0** | **Poll WP REST API** (~12 calls for everything) |
| **DNB** dnb.nl | `/zoekresultaten/` disallowed | API portal = statistics + register only (key, 30/min) | NL-GOV-MCP (statistics only) | Disallow `/zoekresultaten/` | sitemap 5,359 NL URLs (lastmod) + 4 RSS feeds (handhaving, sanctie…) | 945 Open Boek Toezicht, 90 toezicht publications, ~830 sector news | None documented; site ©, datasets CC-BY | **Crawl sitemap (Open Boek Toezicht + handhaving), RSS for updates** |
| **CBHO** (closed 2023) | cbho.nl gone | (only 4 stubs in Rechtspraak data) | none | n/a (domain gone) | one-off: RvS yearly PDF bundles 2000–2022, Wayback (716 ruling PDFs) | Closed archive; total unverified | Aw art. 11 | **One-off import of RvS bundles; new cases are RVS ECLIs** |
| **CvAE** commissievanaanbestedingsexperts.nl | Elastic-style UI, backend not found | none | none | Only a sitemap line | sitemap 564 URLs (473 adviezen, lastmod) | 473 adviezen (2013–2026, ~20/yr) | Licence unclear | **Crawl sitemap + PDFs** |
| **CVDR** lokaleregelgeving | HTML only | SRU `x-connection=cvdr`, CC-0 | NL-GOV-MCP `cvdr_search`, wetsuite | None (no robots.txt) | no sitemap, no verified daily diff | ~344k regulations | KOOP fair use; CC-0 | **SRU** (live search, or harvest if local rules matter) |
| **Raad van State** | HTML only; Cloudflare challenge after ~3 requests | via Rechtspraak Open Data (full text) | via the Rechtspraak MCPs | Crawl-delay 30; disallow `/aspx/`, `export=pdf`, `rss=true` | crawling impractical | 127,062 rulings on the site, 99,391 with full text in Open Data | Rechtspraak limits; publication can lag months | **Rechtspraak feed** (`creator=Raad_van_State`), already reachable |
| **Arbitration board** (likely Raad van Arbitrage voor de Bouw) | POST form on raadvanarbitrage.info, maybe login | none | none | **`Disallow: /` for all** | No | Unverified (awards since 1992) | Private body; ask for an export | **Ask RvA for an export** (or skip) |
| ↳ De Geschillencommissie (runner-up) | HTML filters | WordPress, `/wp-json/` unverified | none | Allow all | sitemap 13,248 URLs (11,614 rulings) | 11,795 rulings | None found; © footer | Crawl sitemap (or WP REST if open) |
| **Tuchtrecht** tuchtrecht.overheid.nl | HTML; `/zoeken/resultaat?domein=…` | SRU `c.product-area==tuchtrecht` (XML + PDF), CC-0, daily updates | NL-GOV-MCP `tuchtrecht_search` | None (no robots.txt) | no sitemap; harvest = 49 SRU pages | 48,558 rulings | KOOP fair use; CC-0 | **SRU harvest** |
| **PUC / RSJ** puc.overheid.nl | ASP.NET postback form | SRU `x-connection=pod`, `overheidpod.kanaal==rsj`, CC-0 | none | **Crawl-delay 120**; GPTBot blocked | sitemap per channel (lastmod), too slow at 120 s | RSJ 27,302 (all channels 63,831) | KOOP fair use; CC-0 | **SRU harvest** (skips the 120 s crawl delay) |

## Routes in short

- **KOOP SRU (one client for five sources):** BWB, officiële bekendmakingen, CVDR, tuchtrecht, PUC. Same endpoint family, CC-0, fair use without numbers. We already have the BWB client (`wetten.ts`, `bwb_sync.ts`); the rest is a different `x-connection` or `c.product-area`. Note `zoekservice.overheid.nl` and `repository.overheid.nl` disallow all crawling in robots.txt: we use them only as the documented API, never as a crawl.
- **Rechtspraak Open Data** also covers Raad van State. Keep to ≤10 requests/s.
- **Undocumented or open JSON:** Kifid (built), kennisgroepen (WP REST, CC0).
- **Sitemap crawl:** ACM, AP (both running/built), CRM oordelen, DNB, CvAE, De Geschillencommissie. Same pattern as the CLAUDE.md crawl convention.
- **Hard:** AFM (no sitemap: crawl listings), RCC (search form only, copyright), arbitration board (robots.txt `Disallow: /`, ask), CBHO (one-off archive).

## What SRU is, and its limits

SRU (Search/Retrieve via URL) is a standard search protocol from the library world, maintained by the Library of Congress. KOOP, the government's publication office, uses it as the API for all its collections. A call is a plain HTTP GET with a CQL query (Contextual Query Language) in the URL, and it returns XML records with metadata and a link to the full document (XML, HTML or PDF on `repository.overheid.nl`). You pick the collection with `x-connection` or `c.product-area`, so one client covers BWB, CVDR, officiële bekendmakingen, tuchtrecht and PUC.

```
https://zoekservice.overheid.nl/sru/Search?x-connection=BWB&operation=searchRetrieve&version=2.0&query=dcterms.title any "huur"&maximumRecords=10
```

We already use it in `app/src/lib/wetten.ts` and `scripts/bwb_sync.ts`. It returns 406 without `Accept: application/xml`.

Limits:

- **Fair use:** no key, no account, no published rate limit. KOOP's manual mentions a "fair use policy" without numbers. Our BWB sync (3 parallel requests, 250 ms apart) has never been throttled. If KOOP objects, we contact them; we don't switch IPs.
- **Page size:** at most 1000 records per call, so a full harvest is many calls (tuchtrecht about 49, Staatscourant about 860).
- **Format:** XML. The JSON output is described as "limited, not optimal".
- **robots.txt:** `zoekservice.overheid.nl` and `repository.overheid.nl` disallow all crawling. That's aimed at crawlers following links; calling the documented API isn't crawling. Don't spider the `frbr` folder listings.
- **Mostly metadata search, not full text.** For the BWB you search titles, ids, dates and types, not article text. That's why approach A (live SRU) lost to B (local full-text index) in `model_improvements/law_retrieval.md`. Expected to be the same for the other collections (tuchtrecht records add a summary); not verified whether any collection supports full-text search.

So SRU is for harvesting and syncing (page through everything, then poll on modified date or `_events`). For good search we still build a local index.

## MCP servers worth knowing

- [WAINUTAI/NL-GOV-MCP](https://github.com/WAINUTAI/NL-GOV-MCP) (Apache-2.0, active): BWB, officiële bekendmakingen, Tweede Kamer, CVDR, tuchtrecht, Rechtspraak, DNB statistics. Covers none of the regulators' decisions.
- [matematicsolutions/nl-eli-mcp](https://github.com/matematicsolutions/nl-eli-mcp): BWB versions by date.
- [Ansvar-Systems/dutch-competition-mcp](https://github.com/Ansvar-Systems/dutch-competition-mcp): ACM decisions via a paid gateway.
- Nothing exists for AP, AFM, RCC, CRM, kennisgroepen or CvAE: a regulator index is open ground.

## robots.txt notes

- **wetten.overheid.nl** names about 50 bots. Blocked completely: GPTBot, ChatGPT-User, OAI-SearchBot, **ClaudeBot, Claude-Web, anthropic-ai**, CCBot, PerplexityBot, Google-Extended, Applebot-Extended, cohere, Mistral and others, plus "rag-kennisbank" and "dataset-sprint". Two legal-AI bots are explicitly allowed with Crawl-delay 30: AstralLaw and 45weg-legal-research. So KOOP whitelists legal crawlers that ask; an option for us if we ever need the HTML.
- **ACM**, **Raad van State** and **PUC** are the only ones with a crawl delay for `*` (10, 30 and 120 s).
- **www.rechtspraak.nl** returns 403 from Akamai even for robots.txt; the API hosts are not blocked.
- No robots.txt at all: lokaleregelgeving, tuchtrecht, oordelen.mensenrechten.nl, data.rechtspraak.nl.

## Not verified

- KOOP's fair-use numbers; total GB for most sources.
- AFM site size (facet counts may depend on the query); RCC total.
- Which body Moonlit means by "arbitration board" (RvA is our best guess), RvA size and login.
- Licences for RvS, CRM, CvAE, De Geschillencommissie. "Aw art. 11" (no copyright on public authorities' decisions) is our reading, not legal advice.
- Daily diffs for CVDR, tuchtrecht and PUC (`_events` returns 404 there).
