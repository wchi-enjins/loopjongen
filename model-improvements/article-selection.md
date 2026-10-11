# Model improvement: selecting the right articles for legal questions

- **Date:** 2026-10-01
- **Model:** Opus 5.5
- **Benchmark:** [benchmarks/2026-10-01-tuchtrecht-registratie-km-1985.md](../benchmarks/2026-10-01-tuchtrecht-registratie-km-1985.md)

## Observation

In the benchmark on the *Privacy-regeling centrale registratie tuchtrechtelijke gegevens KM 1985*, the score depends entirely on which source the model had:

| Response | What it had | Score |
|---|---|---|
| R1 | No source | 0/30 |
| R2 | The wrong law (Wet militair tuchtrecht) | 1.5/30 |
| R3 | The full regulation | 30/30 |
| L1 (Moonlit Luna, 2026-10-09) | No source given; searched its own corpus + web, didn't find it | 0/30 |

None of the responses invented article numbers.

### The responses as a chain

R1 → R2 → R3 are successive turns, each with an attachment:

1. **R1:** no source; points to the WMT as the framework and asks for the regulation.
2. **R2:** gets the **WMT**, the wrong source, so it still can't answer.
3. **R3:** gets the full regulation and answers flawlessly.

## Hypothesis

The current Opus 5.5 model may not be the best at working out **which articles/source it needs** to answer a legal question:
- It asked for the wrong source (WMT) instead of naming the specific registration regulation and articles (2, 5, 6, 8, 10).
- Without the right source, it falls back on general frameworks (AVG/Awb) instead of looking further.

**Strengthened by R3:** with the right source in context, the legal reasoning is excellent (30/30). So the problem is the selection/request step, not the reasoning.

**Not specific to our model (L1):** Moonlit Luna, a legal tool with its own law corpus, got the same questions without the regulation. It ran 19 searches and couldn't find the regulation either. It guessed at wrong titles (1990s Wbp-era rules, "MP 11-50") and then honestly declined to answer. So finding an obscure, old ministerial regulation is a hard retrieval problem in general, not just an Opus weakness. Being able to find it would be a real edge.

Unconfirmed: part of the cause could be the retrieval pipeline (chunking, top-k, article indexing) rather than the model.

## Next steps to test

1. ~~**Isolate:** run the questions with the full regulation in context.~~ Done (R3: 30/30). Reasoning is not the bottleneck.
2. **Inspect retrieval:** log which source/articles the model requests or retrieves per question, and why it chose the WMT.
3. **Compare models:** run the same R1 → R2 chain with other models (e.g. Fable 5.1, Sonnet 5.5) and compare which source they ask for. Partly done: Moonlit Luna (L1) can't find it either.
4. **Prompting:** make the model first list which regulation and articles it needs ("plan → retrieve → answer") before it answers.
5. **Search tool:** build a tool that finds the right law from the question. See [law-retrieval.md](law-retrieval.md).
