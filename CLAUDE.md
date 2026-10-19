# CLAUDE.md

1. At the start of every new session, print the TODO list below before your first response.
2. Keep code changes minimal: only change or add code that the task actually requires. Don't touch unrelated code.
3. Keep chat responses concise and include a TL;DR.

## Conventions

- Business and legal logic, validation and anything security-related live in the backend (the API routes and `lib`). The frontend handles only UI state and presentation; when logic is needed on both sides, it lives in shared `lib` code and the backend has the final say.

## TODO

- [x] Make the data collected with feedback (blue dot) WAY more extensive. Done 2026-10-01: form fields, network log with model/effort per AI call, server logs, app version, more environment info and a screenshot.
- [x] Test models based on https://www.vals.ai/benchmarks/hlab . this mentions anthropic and openai are not at all best picks for these subjects. also check https://www.vals.ai/benchmarks/legal_bench frontier models score differently here.
- [ ] Local full-text index for ACM and AP (parked 2026-10-18): crawl their sitemaps plus decision PDFs into Postgres, refresh via sitemap lastmod or RSS. Replaces title-only search (AP robots.txt forbids its search; ACM throttles live search) and gives deep search full text for quote checks. See `model-improvements/deep-search.md` and issue #5 (ACM).
