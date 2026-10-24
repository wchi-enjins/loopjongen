# Moonlit plans, usage and expected cost per research question

**TL;DR:** Moonlit sells two ways to research. **Luna** is their own assistant: chats, fast answers and deep research runs in their app. The **MCP connector** gives our own model (Claude) their search and documents, at 1 call per search page or document. A thorough Q1 answer took **30 MCP calls**: about **€2 in Moonlit calls plus our model cost**, against **one Luna chat** for similar quality (about 55% vs 60% coverage). For our benchmarks, MCP Pro (€79 a month, 1,200 calls) covers about 25–40 questions a month. Premium (€125) is the only plan with enough deep research runs (30) to benchmark Luna's best mode.

Prices are from Moonlit's compare-plans page as seen on 2026-10-22, excl. VAT. Our free account: 100 calls a month, resets on the 2nd. Q1 numbers: `results/2026-10-22_moonlit_mcp_q1.md` and `results/2026-10-19_moonlit_q1_rerun.md`.

## Plans

| | Free | Student | Premium | MCP Basic | MCP Pro | Enterprise |
|---|---|---|---|---|---|---|
| Price a month | €0 | €6.95 | €125 | €39 (€35.10 billed yearly, €509.65 a year incl. VAT) | €79 | Custom |
| Full data layer, every jurisdiction | yes | yes | yes | yes | yes | yes |
| Source tracing on every citation | yes | yes | yes | yes | yes | yes |
| Luna chat | 5 a week | Unlimited | Unlimited | 5 a week | 5 a week | Unlimited |
| Luna fast answers a month | no | 25 | Unlimited | no | no | Unlimited |
| Luna deep research runs a month | no | 5 | 30 | no | no | 30 per seat |
| Workspace answers a month | no | 500 | 1,000 | no | no | 1,000 per seat |
| Monitor answers a month | no | no | 1,000 | no | no | 1,000 per seat, shared |
| Team workspaces | no | no | no | no | no | yes |
| MCP calls a month | 100 | 100 | 100 (1,200 with an add-on, price not shown) | 500 | 1,200 | Pooled, from 10 accounts |
| SSO and user management | no | no | no | no | no | yes |
| Support | Docs | Docs | Email | Email | Email | Priority, with onboarding |

## How usage is counted

- **MCP:** 1 unit per tool call, checked against our account: 9 calls used 9 units. Searches, document reads and filter lookups count. `get_account_status`, `get_research_guidance` and `convert_to_celex` are free. A search page counts as 1 call whatever its size, so ask for 100 results per page.
- **Luna:** counted per chat, fast answer or deep research run, not per search or document. One Q1 chat ran 5 searches and read 23 documents for that one chat.
- **Model cost:** a Luna answer includes Moonlit's model. An MCP answer also costs our own model's tokens. Claude Code usage was not measured for the MCP run; for our own deep search pipeline, a comparable run costs $1.39–$5.

## Cost per research question

The MCP figures assume 30–60 calls for a thorough question like Q1: 30 is what Q1 took, and 60 allows for the extra queries that would close its coverage gaps.

| Way | Cost per question (Moonlit only) | Questions a month | Expected Q1 quality |
|---|---|---|---|
| Free, MCP | €0 | 1–3 (100 calls) | 55%, 8–9 rubric (measured at 30 calls) |
| Free, Luna chat | €0 | about 21 (5 a week) | about 60%, 9–10 rubric (measured, Q1-only chat) |
| Student, Luna deep research | €1.39 (€6.95 / 5) | 5 | Not measured. Probably at least the chat's quality, since it is their thorough mode. |
| Premium, Luna deep research | €4.17 (€125 / 30), less if chats and fast answers are also used | 30 runs plus unlimited chat | Same as Student deep research |
| MCP Basic | €2.34–€4.68 (€0.078 a call) | 8–16 | Like the free MCP run. Depends on our model and query plan, not the plan. |
| MCP Pro | €1.98–€3.95 (€0.066 a call) | 20–40 | Same |

## Expectations

- **Quality does not depend on the plan.** Every plan has the same data layer and source tracing. The plan only sets how much you can run: quality differs by mode (MCP with our model, Luna chat, Luna deep research) and by how many calls a run may make.
- **MCP vs Luna for the same question:** Luna's chat matched our 30-call MCP run in under 3 minutes, because its grid reads documents outside the model context. MCP is worth paying for when our own pipeline adds something Luna lacks (our ACM/AP index, our law search, our own answer format), or for benchmarking Moonlit's data against our sources.
- **Benchmarking:** one full benchmark (5 questions × 30–60 calls) needs 150–300 calls, more than Free's 100. MCP Basic fits 1–3 benchmarks a month, MCP Pro 4–8. Benchmarking Luna deep research on all 5 questions needs Student (exactly 5 runs) or Premium.
- **Unknown:** what a Luna "chat" includes against a "fast answer" or "deep research run", which mode produced our Q1 baseline, and the price of Premium's 1,200-call add-on. Ask Moonlit before buying.
