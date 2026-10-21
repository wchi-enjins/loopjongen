/**
 * Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl): no API, and robots.txt disallows the site's /search.
 * Search and full text come from the local table ap_doc (scripts/ap_crawl.sh, then scripts/ap_index.ts): every live
 * Dutch page (documenten, actueel, themas) with the text of its PDFs. Without that table, search is a title search
 * over the sitemap and documents are fetched live: the page (<main>) plus its PDF (the decision itself).
 */
import type { FullDoc, SourceDoc } from ".";
import { pool } from "../db";
import { groups } from "./acm";
import { decode, fetchOk, htmlText, mainHtml, pdfText, searchSitemap, slugTitle } from "./web";

const BASE = "https://www.autoriteitpersoonsgegevens.nl";
const KEEP = /^https:\/\/www\.autoriteitpersoonsgegevens\.nl\/(documenten|actueel|themas)\//;
const DUTCH_DATE = /\b\d{1,2} (januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december) \d{4}\b/;

/**
 * Full-text search over ap_doc, best first: websearch syntax ("phrase", or, -word) or a bracketed boolean query
 * (see groups in acm.ts). A title search over the sitemap if the table does not exist yet or is empty.
 */
export async function search(q: string, limit = 10): Promise<SourceDoc[]> {
  const g = groups(q);
  const params = [...(g ? g.flat() : [q]), limit];
  let n = 0;
  const tsq = g
    ? g.map((terms) => `(${terms.map(() => `phraseto_tsquery('dutch', $${++n})`).join(" || ")})`).join(" && ")
    : `websearch_to_tsquery('dutch', $1)`;
  const indexed = await pool
    .query(
      `SELECT id, url, title, coalesce(nullif(date, ''), left(lastmod, 10)) AS date,
         ts_headline('dutch', coalesce(page_text, '') || ' ' || coalesce(pdf_text, ''), q, 'MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') AS snippet
       FROM (SELECT d.*, q, ts_rank_cd(tsv, q, 32) AS rank FROM ap_doc d, (SELECT ${tsq} AS q) x
             WHERE tsv @@ q ORDER BY rank DESC LIMIT $${params.length}) t
       ORDER BY rank DESC`,
      params,
    )
    .then((r) => r.rows, () => null);
  const ready = indexed && (indexed.length || (await pool.query(`SELECT 1 FROM ap_doc LIMIT 1`)).rowCount);
  if (ready) return indexed.map((r) => ({ source: "ap" as const, id: r.id, title: r.title, date: r.date, url: r.url, snippet: r.snippet.trim() }));
  const hits = await searchSitemap(`${BASE}/sitemap.xml`, (u) => KEEP.test(u), q);
  return hits.map((e) => ({ source: "ap", id: e.url.slice(BASE.length + 1), title: slugTitle(e.slug), date: e.lastmod.slice(0, 10), url: e.url, snippet: "" }));
}

/** idOrUrl: a path such as "documenten/besluit-boete-as-watson-kruidvat" or its full url. */
export async function get(idOrUrl: string, pdfs = true): Promise<FullDoc> {
  const url = idOrUrl.startsWith(`${BASE}/`) ? idOrUrl : `${BASE}/${idOrUrl.replace(/^\/+/, "")}`;
  const row = await pool
    .query(`SELECT title, url, date, page_text, pdf_text FROM ap_doc WHERE id = $1`, [url.slice(BASE.length + 1)])
    .then((r) => r.rows[0], () => undefined);
  if (row) return { title: row.title, url: row.url, date: row.date, text: pdfs ? row.page_text + row.pdf_text : row.page_text };
  const html = await (await fetchOk(url)).text();
  let text = htmlText(mainHtml(html));
  const pdf = html.match(/<a [^>]*href="([^"]+)"[^>]*data-type="pdf"/)?.[1];
  if (pdfs && pdf) {
    const pdfUrl = new URL(decode(pdf), BASE).href;
    const body = await pdfText(pdfUrl).catch(() => "");
    if (body) text += `\n\n--- ${pdfUrl} ---\n${body}`;
  }
  return {
    title: decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? ""),
    url,
    date: text.match(DUTCH_DATE)?.[0] ?? "",
    text,
  };
}
