# CLAUDE.md

1. At the start of every new session, print the TODO list below before your first response.
2. Keep code changes minimal: only change or add code that the task actually requires. Don't touch unrelated code.
3. Keep chat responses concise and include a TL;DR.
4. Whenever a new process or concept is tried, write down its final form as a convention below, and tell the user which convention was added or changed.
5. Never use emojis: not in chat, docs, code, output or commits. Use words instead (yes/no/partly).

## Conventions

- Naming:
  - File and folder names are snake_case: `acm_crawl.ts`, `law_retrieval/`, `server_log.ts`, React components too (`nav.tsx`; the component itself stays `Nav`). Exceptions are names a tool fixes (`README.md`, `CLAUDE.md`, `AGENTS.md`, `Dockerfile`, `docker-compose.yml`, `package.json`, Next.js `page.tsx`/`route.ts`/`[id]`) and app router folders, because they are URLs.
  - Dates are always YYYY-MM-DD. A dated file name starts with the date, then `_` and the rest: `2026-10-19_haiku_loop_acm.md` (so also `--out 2026-10-20_<name>` for benchmarks).

- Business and legal logic, validation and anything security-related live in the backend (the API routes and `lib`). The frontend handles only UI state and presentation; when logic is needed on both sides, it lives in shared `lib` code and the backend has the final say.

- Never delete the Docker data: no `docker compose down -v`, `docker volume rm`/`prune` of `loopjongen_pgdata`, `docker system prune --volumes` or a Docker Desktop reset. The `db` volume holds the BWB index and the ACM crawl (`acm_doc`, days to rebuild at ACM's 10 s crawl delay). `docker compose down` and restarts are fine.

- Long-running scripts (crawls, benchmarks, imports) show one progress line on stderr, redrawn in place each second: a blue bar of 30 cells (`\x1b[34m█\x1b[0m` done, `░` to go), then `done/total <items>`, failures if any, average seconds per item, time left, and the expected finish day and time (nl-NL). The line must fit the terminal width (shrink the bar, then cut the text): a wrapped line can't be redrawn and floods the terminal. Problems (a failed item, a missing file, a stop) show as red lines under the bar, the last 5 kept, each also in the log. Details per item go to a log file in `data/`, not to the terminal; without a terminal (redirected output) print the log lines instead. Example: `scripts/acm_crawl.ts` (`bar()`). Crawlers also record the time per item (wall time including the crawl delay, plus the number of requests) in the log line and in the item's row, e.g. `acm_doc.crawl_ms` and `requests`.

- Sources without an API (ACM, AP) are crawled into a local copy, because their own search is off limits (AP: robots.txt disallows `/search`; ACM: throttled) and a title search misses most documents (Moonlit's Q2 answer cited AP documents with no keyword in their title). How:
  - Read robots.txt first and keep its Crawl-delay (ACM 10 s; AP sets none, we use 1 s). Use the app's honest User-Agent: AP's firewall rejects browser-like ones.
  - List pages from the sitemap (Dutch content only, newest first) and download each page plus its linked PDFs to `data/<source>/` (gitignored). Each page gets a row in `done.tsv` or the table, so a rerun continues where it stopped.
  - Stop hard on any sign of a block: 429, 403 or 5xx, `Retry-After`, the firewall's "Request Rejected" page, or a "PDF" that isn't one. A network error gets one retry after 30 s. 404/410 means gone, not failed: AP still lists about 1,700 deleted pages in its sitemap.
  - A separate index step builds the table from the local files, so it can be rebuilt without crawling again: `scripts/ap_crawl.sh`, then `scripts/ap_index.ts`. ACM does both in `scripts/acm_crawl.ts`.
- Source tables (`acm_doc`, `ap_doc`): one row per page.
  - Columns: `id` (the path after the domain), `url`, `title`, `date` (YYYY-MM-DD), `lastmod` (from the sitemap), `page_text` (the page's `<main>`), `pdf_text` (each PDF after a `--- <url> ---` line, see `joinPdfs`), `crawled` (the lastmod the text belongs to), `crawl_ms` and `requests`.
  - A generated `tsv` with Dutch stemming (title weight A, page and PDF text weight C, cut to the first 400k characters because a tsvector holds at most 1 MB), with a GIN index.
  - `app/src/lib/sources/<source>.ts` searches it with `websearch_to_tsquery` or a bracketed boolean query (`groups()` in `acm.ts`), ranks with `ts_rank_cd` and builds snippets with `ts_headline`. While the table is empty it falls back to a title search over the sitemap and live fetches.
  - PDFs over 50 MB (AP's Woo bundles, mostly scans) are not indexed until we add OCR.

## Benchmarks

- Research benchmark (deep search on Moonlit's questions, scored by hand with `benchmarks/research/rubric.md`). While it runs it shows a progress bar that fills left to right (step, calls, documents, cost, time). Costs API credit: Q1 is about $1.40 on the Haiku setup below.

  ```bash
  DEEP_LOOP_MODEL=claude-haiku-5-5 DEEP_TABLE_MODEL=claude-haiku-5-5 \
    node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs \
    benchmarks/research/run.ts --case acm-dark-patterns --out <name>
  ```

  - Keys and `DATABASE_URL` come from `.envrc` (direnv). Without direnv, load both `.env` and `.envrc`, or law search fails on the wrong port.
  - Models: `DEEP_MODEL` (default `claude-opus-5-5`), `DEEP_LOOP_MODEL` (default `DEEP_MODEL`), `DEEP_TABLE_MODEL` (default `claude-haiku-5-5`). `gpt-6.1-sol` also works. Jev recall: `DEEP_JEV=1` (Jev scores every search hit on full text against the loop's relevance question and criteria, and sorts the hits; about $0.01 and 2 s per search). Jev workflow: `DEEP_JEV_FLOW=1` (one Rechtspraak search per sub-question, a checklist per part from the split that Jev checks before a loop may stop, Jev instead of the table as the grid's relevance filter, and a Jev check that each quote supports its claim). One document per table call, all in parallel: `DEEP_PARALLEL_GRIDS=1`. Moonlit-style, no search loop: `DEEP_PLAN=1` (one call on `DEEP_PLAN_MODEL`, default `DEEP_MODEL`, writes all searches and fixed grid questions per sub-question; the searches run in parallel and each sub-question gets one grid over its top 25 hits, one document per call; no follow-up grids). Draft only: `DEEP_DRAFT_MODEL` and `DEEP_DRAFT_EFFORT` (default `DEEP_MODEL` and `DEEP_EFFORT`); answer and quote fix use `DEEP_MODEL`. Effort: `DEEP_EFFORT` (default `high`) for every step, `DEEP_TABLE_EFFORT` (default `DEEP_EFFORT`) for the tables only.
  - Deep search first splits the question into 1-4 independent parts (`split` stage, on the loop model) and runs one search loop per part in parallel, sharing documents and grids; each loop is its own `loop <n>` span in Langfuse. Leave `split` out of `--stages` (or pass `--no-split` to `deep/search.ts`) for one loop over the whole question.
  - In the background: add `> benchmarks/research/results/<name>.log 2>&1` and follow the bar with `tail -f` on that log.
  - Results go to `benchmarks/research/results/<name>.{md,json}`; the per-call costs are in the JSON trace.
  - A repeat of an earlier run's exact setup (to check run-to-run variance) keeps that run's number plus a letter: `run4b`, `run4c`. An earlier setup with one feature switched on gets the run number plus the feature: `run4jev` (run 4 with `DEEP_JEV=1`). Any other change gets a new number.
  - To compare draft and answer models without rerunning the search: pull the run's draft input from Langfuse (`--name draft --fields core,basic,io`) and replay steps 3-5 on it with `benchmarks/research/replay_finish.ts --out <run>_replay_<model>_<effort> <draft.json>`, setting `DEEP_DRAFT_MODEL`/`DEEP_MODEL`/`DEEP_EFFORT`. Costs only the draft, fix and answer calls. To test a change to the document selection or the tables of a `DEEP_PLAN` run, replay only its grid step on its saved plan: `DEEP_PLAN=1 ... benchmarks/research/replay_grids.ts --out <run>_grids_<change> results/<run>.json`; it shows which documents and facts reach the tables (an upper bound for the answer).
  - Every benchmarked question has one comparison page of all its runs, `benchmarks/research/results/<question>_runs.md` (`q1_runs.md`, `q2b_runs.md`; undated, because it is updated in place). After every run of that question, add the run to it: model per step, cost per step (from Langfuse), results (time, calls, searches, documents, correct facts of the page's fact list, wrong facts, rubric), the fact list column, and a line under "What changed per run". A newly benchmarked question gets a page in the same layout.
  - Jev (TypeSafe's yes/no, choice and score model): `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer $JEV_API_KEY` (in `.env`) and a body `{model: "jev-latest", state: <text>, questions: {<name>: {type: "noul", instructions: <question>}}}`; the answer is `answers.<name>.noul`, the probability of yes. The request format comes from the `typesafe-sdk` source on PyPI, since the public docs are not reachable. Example and relevance test: `benchmarks/research/jev_relevance.ts`.
  - Moonlit MCP runs by hand: 1 unit per call, so ask for 100 results per page and read documents in a subagent to keep them out of the context. Plans, limits and cost per question: `benchmarks/research/2026-10-22_moonlit_plans.md`.
  - Langfuse traces (session id = `<name>`, tags `research` + case id): find the root with `npx langfuse-cli api observations list --is-root-observation --from-start-time <date>T00:00:00Z --fields core,basic,trace_context --json`, then pull every span with `--trace-id <id> --fields core,basic,io,model,usage,metrics --all --json`. Use `observations`, not the deprecated `traces` endpoint; needs `LANGFUSE_HOST="$LANGFUSE_BASE_URL"`.

## TODO

- [x] Make the data collected with feedback (blue dot) WAY more extensive. Done 2026-10-01: form fields, network log with model/effort per AI call, server logs, app version, more environment info and a screenshot.
- [x] Test models based on https://www.vals.ai/benchmarks/hlab . this mentions anthropic and openai are not at all best picks for these subjects. also check https://www.vals.ai/benchmarks/legal_bench frontier models score differently here.
- [ ] Local full-text index for ACM and AP (parked 2026-10-18): crawl their sitemaps plus decision PDFs into Postgres, refresh via sitemap lastmod or RSS. Replaces title-only search (AP robots.txt forbids its search; ACM throttles live search) and gives deep search full text for quote checks. See `model_improvements/deep_search.md` and issue #5 (ACM).
- [ ] Langfuse tracing for the chat app with masked content (parked 2026-10-19). Decided: trace every chat turn (steps, model, effort, tokens, cost, latency, errors) but no client text (customer data, documents, questions, answers). Langfuse's `mask` only covers `langfuse.*` attributes, and the OpenInference Anthropic integration puts the full `system` prompt in `llm.invocation_parameters`, so use an allowlist span processor (keep the model name, `llm.token_count.*` and non-content `langfuse.*`). Plan: `app/src/instrumentation.ts` starts NodeSDK with that processor and `AnthropicInstrumentation.manuallyInstrument`, `@anthropic-ai/sdk` goes in `serverExternalPackages`, root spans in the chat, review and refine routes, the conversation id as session, and the environment set. Deep search tracing: `app/src/lib/langfuse.ts`.
