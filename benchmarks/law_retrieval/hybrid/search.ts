/**
 * Hybrids of approach B (full-text index, b_fulltext) and approach A (agentic live search, a_agentic).
 *
 *   searchFallback: B first; only when B's pick call says it is not confident, run A and use A's answer.
 *   searchBoth:     A and B on the same question in parallel; rankings fused (reciprocal rank), articles merged.
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs benchmarks/law_retrieval/hybrid/search.ts [--both] "<vraag>"
 */
import { search as searchA } from "../a_agentic/search.ts";
import { search as searchB, pool, type Hit, type SearchResult } from "../b_fulltext/search.ts";

const tagged = (prefix: string, r: SearchResult) => r.trace.map((t) => `[${prefix}] ${t}`);
const usage = (...rs: SearchResult[]) => ({
  input_tokens: rs.reduce((s, r) => s + r.usage.input_tokens, 0),
  output_tokens: rs.reduce((s, r) => s + r.usage.output_tokens, 0),
});

export async function searchFallback(question: string): Promise<SearchResult> {
  const b = await searchB(question);
  if (b.confident && b.hits.length) return { ...b, trace: [...tagged("b", b), "fallback: no (B confident)"] };
  const a = await searchA(question);
  return {
    hits: a.hits.length ? a.hits : b.hits,
    usage: usage(a, b),
    apiCalls: a.apiCalls + b.apiCalls,
    trace: [...tagged("b", b), "fallback: yes (B not confident)", ...tagged("a", a)],
  };
}

export async function searchBoth(question: string): Promise<SearchResult> {
  const [a, b] = await Promise.all([searchA(question), searchB(question)]);
  // Reciprocal rank fusion: a law both found ranks above one found by only one; ties keep A's order first.
  const score = new Map<string, number>();
  const merged = new Map<string, Hit>();
  for (const r of [a, b])
    r.hits.forEach((h, i) => {
      score.set(h.id, (score.get(h.id) ?? 0) + 1 / (1 + i));
      const m = merged.get(h.id);
      if (!m) merged.set(h.id, { ...h, articles: [...h.articles] });
      else m.articles = [...new Set([...m.articles, ...h.articles])].slice(0, 8);
    });
  const hits = [...merged.values()].sort((x, y) => score.get(y.id)! - score.get(x.id)!).slice(0, 5);
  return {
    hits,
    usage: usage(a, b),
    apiCalls: a.apiCalls + b.apiCalls,
    trace: [...tagged("a", a), ...tagged("b", b), `fused: ${hits.map((h) => `${h.id} (${score.get(h.id)!.toFixed(2)})`).join(", ")}`],
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const question = args.filter((a) => a !== "--both").join(" ");
  try {
    console.log(JSON.stringify(await (args.includes("--both") ? searchBoth : searchFallback)(question), null, 2));
  } finally {
    await pool.end();
  }
}
