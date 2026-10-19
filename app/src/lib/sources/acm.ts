/**
 * ACM (acm.nl): no API, so plain HTML. Search and full text come from the local table acm_doc, filled by
 * scripts/acm-crawl.ts: every publication in the sitemap, with page text and decision PDFs once crawled. Pages not
 * crawled yet are searched by title and fetched live. robots.txt disallows the site's own search (/nl/zoeken) and
 * asks for a Crawl-delay of 10 s, which fetchOk keeps.
 */
import type { FullDoc, SourceDoc } from ".";
import { pool } from "../db";
import { fetchOk, htmlText, mainHtml, pdfText as pdfToText, searchSitemap, slugTitle } from "./web";

const BASE = "https://www.acm.nl";
const PUB = "/nl/publicaties/";
const MAX_PDFS = 8;

/**
 * Boolean query with brackets, e.g. `(afteltimer OR "aftellende klok") AND (boete OR sanctie)`, as AND over
 * OR-groups of words or phrases (websearch_to_tsquery has no brackets); null for a query without brackets.
 */
export function groups(q: string): string[][] | null {
  if (!q.includes("(")) return null;
  const parts = q.replace(/\bAND\b/g, " ").match(/\([^()]*\)|"[^"]*"|[^\s()"]+/g) ?? [];
  return parts
    .map((p) => (p.startsWith("(") ? p.slice(1, -1).split(/\s+OR\s+/i) : [p]).map((t) => t.replace(/"/g, "").trim()).filter(Boolean))
    .filter((g) => g.length);
}

/**
 * Full-text search over acm_doc, best first: websearch syntax ("phrase", or, -word) or a bracketed boolean query
 * (see groups). A title search over the sitemap if the table does not exist yet or is empty.
 */
export async function search(q: string): Promise<SourceDoc[]> {
  const g = groups(q);
  const params = g ? g.flat() : [q];
  let n = 0;
  const tsq = g
    ? g.map((terms) => `(${terms.map(() => `phraseto_tsquery('dutch', $${++n})`).join(" || ")})`).join(" && ")
    : `websearch_to_tsquery('dutch', $1)`;
  const indexed = await pool
    .query(
      `SELECT id, url, title, coalesce(nullif(date, ''), left(lastmod, 10)) AS date,
         ts_headline('dutch', coalesce(page_text, '') || ' ' || coalesce(pdf_text, ''), q, 'MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "') AS snippet
       FROM (SELECT d.*, q, ts_rank_cd(tsv, q, 32) AS rank FROM acm_doc d, (SELECT ${tsq} AS q) x
             WHERE tsv @@ q ORDER BY rank DESC LIMIT 10) t
       ORDER BY rank DESC`,
      params,
    )
    .then((r) => r.rows, () => null);
  const ready = indexed && (indexed.length || (await pool.query(`SELECT 1 FROM acm_doc LIMIT 1`)).rowCount);
  if (ready) return indexed.map((r) => ({ source: "acm" as const, id: r.id, title: r.title, date: r.date, url: r.url, snippet: r.snippet.trim() }));
  const hits = await searchSitemap(`${BASE}/sitemap.xml`, (u) => u.startsWith(BASE + PUB), q);
  return hits.map((e) => ({ source: "acm", id: e.url.slice(BASE.length + PUB.length), title: slugTitle(e.slug), date: e.lastmod.slice(0, 10), url: e.url, snippet: "" }));
}

/** idOrUrl: the path after /nl/publicaties/ (usually a slug) or the acm.nl url. pdfs=false skips the decision PDFs (faster, page text only). */
export async function get(idOrUrl: string, pdfs = true): Promise<FullDoc> {
  const url = idOrUrl.startsWith(`${BASE}/`) ? idOrUrl : `${BASE}${PUB}${encodeURI(idOrUrl)}`;
  const id = idOrUrl.startsWith(BASE + PUB) ? idOrUrl.slice((BASE + PUB).length) : idOrUrl;
  const row = await pool
    .query(`SELECT title, url, date, page_text, pdf_text FROM acm_doc WHERE id = $1 AND crawled IS NOT NULL`, [id])
    .then((r) => r.rows[0], () => undefined);
  const doc = row ? { title: row.title, url: row.url, date: row.date, pageText: row.page_text, pdfText: row.pdf_text } : await fetchLive(url, pdfs);
  return { title: doc.title, url: doc.url, date: doc.date, text: pdfs ? doc.pageText + doc.pdfText : doc.pageText };
}

/** A publication page from acm.nl: its <main> text and, unless pdfs=false, the text of its decision PDFs. */
export async function fetchLive(url: string, pdfs = true) {
  const html = await (await fetchOk(url)).text();
  const main = mainHtml(html);
  const pageText = htmlText(main);
  let pdfText = "";
  if (pdfs) {
    // Relative /system/files/documents links are the decisions under "Documenten"; absolute ones are general guides.
    const links = [...new Set([...main.matchAll(/href="(\/system\/files\/documents\/[^"]+\.pdf)"/g)].map((m) => BASE + m[1]))].slice(0, MAX_PDFS);
    const texts = await Promise.all(links.map((l) => pdfToText(l).catch(() => "")));
    pdfText = links.map((l, i) => (texts[i] ? `\n\n--- ${l} ---\n${texts[i]}` : "")).join("");
  }
  return {
    title: htmlText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""),
    url,
    date: main.match(/<time datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ?? pageText.match(/Publicatiedatum\s+(\d{2}-\d{2}-\d{4})/)?.[1] ?? "",
    pageText,
    pdfText,
  };
}
