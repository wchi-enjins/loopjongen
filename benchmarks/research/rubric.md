# Research-answer rubric

**TL;DR:** Score each answer to the 5 questions in `questions.json` on five criteria, 0–2 points each, so 10 per question and 50 in total. Next to that score, report **coverage** and **precision** from a checked fact list, because the 0–2 scale can't show how much more one answer found. Moonlit's findings are a reference, not gold: check any disagreement against the source before scoring.

## Criteria

| Criterion | 0 | 1 | 2 |
|---|---|---|---|
| **Decisions and rulings found** | Few or none of the relevant cases | About half of the reference cases, or the main one only | Most reference cases, or equally relevant ones that check out |
| **Breached article** | Missing or wrong | Right law, wrong or vague article | Exact article (and lid/onder) as in the decision |
| **Facts** (amounts, dates, names, numbers) | Errors that would mislead | Mostly right, one or two errors | All checked facts right |
| **Honest gaps** | Invents something to fill a gap, or claims "none" when a source exists | Mentions gaps vaguely | Names each gap clearly and doesn't fill it with guesses |
| **Quotes back every claim** | Claims without sources, or quotes that don't appear in the source | Most claims quoted; some quotes paraphrased or missing | Every claim has a quote found word for word in the source (the stage-4 check passes) |

## Coverage and precision

Reported next to the 0–10 score, never added to it.

1. **Fact list:** list every distinct fact any compared answer claims (case, company, year, case number or ECLI, amount, date, breached article, outcome), one per row.
2. **Check** each fact against its source: correct, wrong or unverifiable.
3. **Coverage** = correct facts this answer states ÷ all correct facts in the list, as a percentage. It shows how much of what exists the answer found.
4. **Precision** = correct facts ÷ all facts this answer states that could be checked. It shows how reliable the answer is.
5. Also record the number of wrong facts, and unique finds (correct facts only this answer has).

Coverage is relative to the answers being compared: a fact nobody found doesn't count. Compare coverage only between answers scored against the same fact list.

## How to score

1. Run deep search on each question, one question per run.
2. For each criterion, compare with `reference` and `gaps`. Where the answer differs from Moonlit, open the source and decide who is right. A correct find that Moonlit missed counts in full.
3. A criterion that doesn't apply (for example, no breached article is asked for) scores 2 if the answer doesn't invent one.
4. Score Moonlit's own answer with the same rubric, so both have a baseline.
5. Record per question: score per criterion, total, coverage, precision, wrong facts, time, number of searches, documents read, and cost.

## Caveats

- These are judgement calls until a lawyer checks the references.
- Questions 3–5 rely on portals we don't connect yet (AFM, RCC, College, officiële bekendmakingen, Belastingdienst), so expect low scores there until those are added.
