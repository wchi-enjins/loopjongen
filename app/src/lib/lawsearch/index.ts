import type Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db";
import type { LawSearch } from "../models";
import { search as searchA } from "./agentic";
import { search as searchC } from "./catalog";
import { search as searchB } from "./fulltext";

const SEARCHES = { a: searchA, b: searchB, c: searchC };
const MAX_ARTICLE_CHARS = 6_000;
// ponytail: fixed budget for the found articles; raise or summarise if answers need longer laws.
const MAX_CONTEXT_CHARS = 60_000;

type Row = { law_id: string; law_title: string; label: string; article_title: string; text: string; url: string };

/**
 * Finds the laws and articles for a question with the chosen approach and returns them as a system-prompt block
 * plus a markdown list of sources. Article texts come from the local index (bwb_article, built by
 * benchmarks/law-retrieval/b-fulltext/index.ts); long articles are stored in several rows and joined here.
 */
export async function lawContext(approach: LawSearch, question: string, client: Anthropic) {
  const { hits } = await SEARCHES[approach](question, client);
  if (!hits.length) return { block: "", sources: "" };
  const { rows } = await pool.query<Row>(
    `SELECT law_id, law_title, label, article_title, text, url FROM bwb_article
      WHERE law_id = ANY($1) AND label = ANY($2) ORDER BY ctid`,
    [hits.map((h) => h.id), hits.flatMap((h) => h.articles)],
  );
  let budget = MAX_CONTEXT_CHARS;
  const laws = hits.map((h) => {
    const articles = h.articles.flatMap((label) => {
      const parts = rows.filter((r) => r.law_id === h.id && r.label === label);
      if (!parts.length) return [];
      const text = parts.map((r) => r.text).join("\n").slice(0, Math.min(MAX_ARTICLE_CHARS, Math.max(0, budget)));
      budget -= text.length;
      return text ? [{ label, title: parts[0].article_title, url: parts[0].url, text }] : [];
    });
    return { id: h.id, title: h.title || rows.find((r) => r.law_id === h.id)?.law_title || h.id, articles };
  });
  const attr = (s: string) => s.replace(/"/g, "'");
  const block = laws
    .map(
      (l) =>
        `<regeling id="${l.id}" titel="${attr(l.title)}">\n${l.articles
          .map((a) => `<artikel nr="${a.label}"${a.title ? ` opschrift="${attr(a.title)}"` : ""} url="${a.url}">\n${a.text}\n</artikel>`)
          .join("\n")}\n</regeling>`,
    )
    .join("\n\n");
  const sources = laws
    .map((l) => {
      const url = l.articles[0]?.url ?? `https://wetten.overheid.nl/${l.id}`;
      const arts = l.articles.map((a) => `[art. ${a.label}](${a.url})`).join(", ");
      return `- [${l.title}](${url})${arts ? `: ${arts}` : ""}`;
    })
    .join("\n");
  return { block, sources };
}
