/**
 * Polite ACM crawl into the full-text table acm_doc (searched by app/src/lib/sources/acm.ts). Every /nl/publicaties/
 * url in the sitemap gets a row at once (title from the slug, so title search works right away); then each new or
 * changed page (sitemap lastmod) is fetched with its decision PDFs, newest first. fetchOk keeps robots.txt's
 * Crawl-delay of 10 s, so a full first crawl takes 1.5-2.5 days.
 *
 *   node --no-warnings --import ./benchmarks/law-retrieval/resolve-ts.mjs scripts/acm-crawl.ts [--limit 50]
 *
 * Resumable: a re-run only fetches pages whose lastmod changed. A run without --limit also deletes rows whose url
 * left the sitemap. Stops at the first 403 or 429, so a block is never hammered.
 */
import { pool } from "../app/src/lib/db.ts";
import { fetchLive } from "../app/src/lib/sources/acm.ts";
import { sitemap, slugTitle } from "../app/src/lib/sources/web.ts";

const BASE = "https://www.acm.nl";
const PUB = "/nl/publicaties/";
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
// tsvector holds at most 1 MB; very long PDFs are indexed on their first 400k characters (stored in full).
const TSV_CHARS = 400_000;

await pool.query(`CREATE TABLE IF NOT EXISTS acm_doc (
  id text PRIMARY KEY, url text NOT NULL, title text NOT NULL, date text NOT NULL DEFAULT '', lastmod text NOT NULL,
  page_text text, pdf_text text,
  crawled text, -- the lastmod the stored text belongs to; NULL = not crawled yet
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('dutch', title), 'A') ||
    setweight(to_tsvector('dutch', left(coalesce(page_text, '') || ' ' || coalesce(pdf_text, ''), ${TSV_CHARS})), 'C')
  ) STORED)`);
await pool.query(`CREATE INDEX IF NOT EXISTS acm_doc_tsv ON acm_doc USING gin (tsv)`);

const t0 = Date.now();
const entries = await sitemap(`${BASE}/sitemap.xml`, (u) => u.startsWith(BASE + PUB));
const ids = entries.map((e) => e.url.slice((BASE + PUB).length));
await pool.query(
  `INSERT INTO acm_doc (id, url, title, lastmod) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
   ON CONFLICT (id) DO UPDATE SET url = excluded.url, lastmod = excluded.lastmod`,
  [ids, entries.map((e) => e.url), entries.map((e) => slugTitle(e.slug)), entries.map((e) => e.lastmod)],
);
if (LIMIT === Infinity) {
  const { rowCount } = await pool.query(`DELETE FROM acm_doc WHERE NOT (id = ANY($1))`, [ids]);
  if (rowCount) console.log(`removed ${rowCount} pages that left the sitemap`);
}
const { rows: todo } = await pool.query<{ id: string; url: string; lastmod: string }>(
  `SELECT id, url, lastmod FROM acm_doc WHERE crawled IS DISTINCT FROM lastmod ORDER BY lastmod DESC LIMIT $1`,
  [LIMIT === Infinity ? null : LIMIT],
);
console.log(`sitemap: ${entries.length} publications; to crawl: ${todo.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

let done = 0, pdfs = 0, chars = 0, gone = 0;
const failed: string[] = [];
for (const [i, d] of todo.entries()) {
  const t = Date.now();
  try {
    const doc = await fetchLive(d.url);
    await pool.query(`UPDATE acm_doc SET title = $2, date = $3, page_text = $4, pdf_text = $5, crawled = $6 WHERE id = $1`, [
      d.id, doc.title || slugTitle(d.id), doc.date, doc.pageText, doc.pdfText, d.lastmod,
    ]);
    const n = doc.pdfText.split("\n\n--- ").length - 1;
    done++, (pdfs += n), (chars += doc.pageText.length + doc.pdfText.length);
    console.log(`[${i + 1}/${todo.length}] ${d.id.slice(0, 70)}: ${n} pdf, ${doc.pageText.length + doc.pdfText.length} chars, ${((Date.now() - t) / 1000).toFixed(0)}s`);
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code; // e.g. UND_ERR_CONNECT_TIMEOUT behind "fetch failed"
    const msg = (err as Error).message + (cause ? ` (${cause})` : "");
    if (/status (403|429)/.test(msg)) {
      console.log(`stopping: ${msg} at ${d.url}`);
      break;
    }
    if (/status 404/.test(msg)) {
      gone++;
      await pool.query(`DELETE FROM acm_doc WHERE id = $1`, [d.id]);
    } else failed.push(`${d.url}: ${msg}`);
  }
}

const secs = (Date.now() - t0) / 1000;
console.log(`\n${done} crawled (${pdfs} pdfs, ${(chars / 1e6).toFixed(1)}M chars), ${gone} gone (404), ${failed.length} failed, ${(secs / 60).toFixed(1)} min`);
if (failed.length) console.log("failed:\n" + failed.join("\n"));
await pool.end();
