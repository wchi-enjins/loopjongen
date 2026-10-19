# CLAUDE.md

1. At the start of every new session, print the TODO list below before your first response.
2. Keep code changes minimal: only change or add code that the task actually requires. Don't touch unrelated code.
3. Keep chat responses concise and include a TL;DR.

## Conventions

- Business and legal logic, validation and anything security-related live in the backend (the API routes and `lib`). The frontend handles only UI state and presentation; when logic is needed on both sides, it lives in shared `lib` code and the backend has the final say.

## Benchmarks

- Research benchmark (deep search on Moonlit's questions, scored by hand with `benchmarks/research/rubric.md`). While it runs it shows a progress bar that fills left to right (step, calls, documents, cost, time). Costs API credit: Q1 is about $1.40 on the Haiku setup below.

  ```bash
  DEEP_LOOP_MODEL=claude-haiku-5-5 DEEP_TABLE_MODEL=claude-haiku-5-5 \
    node --no-warnings --import ./benchmarks/law-retrieval/resolve-ts.mjs \
    benchmarks/research/run.ts --case acm-dark-patterns --out <name>
  ```

  - Keys and `DATABASE_URL` come from `.envrc` (direnv). Without direnv, load both `.env` and `.envrc`, or law search fails on the wrong port.
  - Models: `DEEP_MODEL` (default `claude-opus-5-5`), `DEEP_LOOP_MODEL` and `DEEP_TABLE_MODEL` (default `DEEP_MODEL`). `gpt-6.1-sol` also works.
  - In the background: add `> benchmarks/research/results/<name>.log 2>&1` and follow the bar with `tail -f` on that log.
  - Results go to `benchmarks/research/results/<name>.{md,json}`; the per-call costs are in the JSON trace.

## TODO

- [x] Make the data collected with feedback (blue dot) WAY more extensive. Done 2026-10-01: form fields, network log with model/effort per AI call, server logs, app version, more environment info and a screenshot.
- [x] Test models based on https://www.vals.ai/benchmarks/hlab . this mentions anthropic and openai are not at all best picks for these subjects. also check https://www.vals.ai/benchmarks/legal_bench frontier models score differently here.
- [ ] Local full-text index for ACM and AP (parked 2026-10-18): crawl their sitemaps plus decision PDFs into Postgres, refresh via sitemap lastmod or RSS. Replaces title-only search (AP robots.txt forbids its search; ACM throttles live search) and gives deep search full text for quote checks. See `model-improvements/deep-search.md` and issue #5 (ACM).
- [ ] Langfuse tracing for the chat app with masked content (parked 2026-10-19). Decided: trace every chat turn (steps, model, effort, tokens, cost, latency, errors) but no client text (customer data, documents, questions, answers). Langfuse's `mask` only covers `langfuse.*` attributes, and the OpenInference Anthropic integration puts the full `system` prompt in `llm.invocation_parameters`, so use an allowlist span processor (keep the model name, `llm.token_count.*` and non-content `langfuse.*`). Plan: `app/src/instrumentation.ts` starts NodeSDK with that processor and `AnthropicInstrumentation.manuallyInstrument`, `@anthropic-ai/sdk` goes in `serverExternalPackages`, root spans in the chat, review and refine routes, the conversation id as session, and the environment set. Deep search tracing: `app/src/lib/langfuse.ts`.
