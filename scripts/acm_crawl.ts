/**
 * Polite ACM crawl: raw copies in data/acm/ (html/<slug>.html, pdf/<file>.pdf) and the full-text table acm_doc built
 * from them (searched by app/src/lib/sources/acm.ts). Every /nl/publicaties/ url in the sitemap gets a row at once
 * (title from the slug, so title search works right away); then each new or changed page (sitemap lastmod), or page
 * whose raw copy is missing or incomplete, is downloaded with its decision PDFs, newest first. fetchOk keeps robots.txt's Crawl-delay of
 * 10 s, so a full first crawl takes 1.5-3 days.
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs scripts/acm_crawl.ts [--limit 50] [--sample 40] [--reindex]
 *
 * The terminal shows a progress bar; each page's line goes to data/acm_crawl.log. --sample N crawls N pages never
 * crawled before, spread from newest to oldest, to measure the time per page.
 *
 * Resumable: a re-run only downloads what is new, changed or missing, and PDFs already on disk are not fetched again.
 * A run without --limit also deletes rows whose url left the sitemap (the raw files stay). Stops at the first 403 or
 * 429, so a block is never hammered. --reindex rebuilds acm_doc from data/acm/ without contacting acm.nl.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pool } from "../app/src/lib/db.ts";
import { extractText } from "../app/src/lib/extract.ts";
import { joinPdfs, parsePage } from "../app/src/lib/sources/acm.ts";
import { fetchOk, sitemap, slugTitle } from "../app/src/lib/sources/web.ts";

const BASE = "https://www.acm.nl";
const PUB = "/nl/publicaties/";
const DOCS = "/system/files/documents/";
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const SAMPLE = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) : 0;
const REINDEX = args.includes("--reindex");
// tsvector holds at most 1 MB; very long PDFs are indexed on their first 400k characters (stored in full).
const TSV_CHARS = 400_000;

const DIR = fileURLToPath(new URL("../data/acm/", import.meta.url));
const HTML_DIR = join(DIR, "html");
const PDF_DIR = join(DIR, "pdf");
mkdirSync(HTML_DIR, { recursive: true });
mkdirSync(PDF_DIR, { recursive: true });

/**
 * Readable file name for a slug or PDF path ("/" becomes "__", as old-style urls have publicatie/<n>/<slug>); long
 * ones are cut and get a hash, so they stay unique and under 255 bytes.
 */
function fileName(key: string, ext: string) {
  const name = encodeURIComponent(key.replace(/\//g, "__"));
  return (name.length > 200 ? `${name.slice(0, 180)}-${createHash("sha1").update(key).digest("hex").slice(0, 8)}` : name) + ext;
}
const htmlFile = (id: string) => join(HTML_DIR, fileName(id, ".html"));
// /system/files/documents/<f>.pdf is stored as <f>.pdf; other paths (older pages: /sites/default/files/...) in full.
const pdfFile = (url: string) => {
  const path = url.slice(BASE.length);
  return join(PDF_DIR, fileName(path.startsWith(DOCS) ? path.slice(DOCS.length) : path.slice(1), ".pdf"));
};
/** Whether a page's raw copy is complete: its HTML and every PDF it links (a PDF that is gone is tried again). */
const complete = (id: string) => existsSync(htmlFile(id)) && parsePage(readFileSync(htmlFile(id), "utf8")).pdfs.every((l) => existsSync(pdfFile(l)));
const LOG = new URL("acm_crawl.log", new URL("../data/", import.meta.url));
/** One line in data/acm_crawl.log (and on stdout when there is no terminal for the bar). */
function log(line: string) {
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  if (!process.stderr.isTTY) console.log(line);
}

/**
 * Blue bar on the terminal, redrawn in place: done / total, failures, seconds per item, time left and the expected
 * finish, with the last EVENTS problems as red lines below it. Every line fits the terminal width (the bar shrinks,
 * then the text is cut), since a wrapped line can't be redrawn.
 */
const EVENTS = 5;
function bar(total: number, label: string) {
  const t0 = Date.now();
  let done = 0, failed = 0, drawn = 0;
  const events: string[] = [];
  const draw = () => {
    if (!process.stderr.isTTY) return;
    const per = done + failed ? (Date.now() - t0) / 1000 / (done + failed) : 0;
    const left = per * (total - done - failed);
    const eta = left > 3600 ? `${(left / 3600).toFixed(1)} h` : `${Math.round(left / 60)} min`;
    const finish = new Date(Date.now() + left * 1000).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const cols = (process.stderr.columns || 80) - 1;
    let text = ` ${done}/${total} ${label}${failed ? `, ${failed} failed` : ""}${done + failed ? `, ${per.toFixed(1)} s each, ${eta} left, done ${finish}` : ""}`;
    const width = Math.max(5, Math.min(30, cols - text.length));
    text = text.slice(0, Math.max(0, cols - width));
    const filled = total ? Math.round(((done + failed) / total) * width) : width;
    const lines = [`\x1b[34m${"█".repeat(filled)}\x1b[0m${"░".repeat(width - filled)}${text}`, ...events.map((e) => `\x1b[31m${e.slice(0, cols)}\x1b[0m`)];
    // Back to the bar's line, then rewrite the bar and the event lines under it.
    process.stderr.write(`${drawn > 1 ? `\x1b[${drawn - 1}A` : ""}\r${lines.map((l) => `\x1b[2K${l}`).join("\n")}`);
    drawn = lines.length;
  };
  const timer = setInterval(draw, 1000);
  draw();
  return {
    tick: (ok = true) => (ok ? done++ : failed++, done + failed === total || draw()),
    /** A problem: logged, and shown in red under the bar (the last EVENTS of them). */
    event: (line: string) => {
      log(line);
      events.push(`${new Date().toLocaleTimeString("nl-NL")} ${line}`);
      if (events.length > EVENTS) events.shift();
      draw();
    },
    stop: () => (clearInterval(timer), draw(), process.stderr.isTTY && process.stderr.write("\n")),
  };
}

const save = (file: string, data: string | Buffer) => {
  writeFileSync(file + ".tmp", data);
  renameSync(file + ".tmp", file);
};

await pool.query(`CREATE TABLE IF NOT EXISTS acm_doc (
  id text PRIMARY KEY, url text NOT NULL, title text NOT NULL, date text NOT NULL DEFAULT '', lastmod text NOT NULL,
  page_text text, pdf_text text,
  crawled text, -- the lastmod the stored text belongs to; NULL = not crawled yet
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('dutch', title), 'A') ||
    setweight(to_tsvector('dutch', left(coalesce(page_text, '') || ' ' || coalesce(pdf_text, ''), ${TSV_CHARS})), 'C')
  ) STORED)`);
await pool.query(`CREATE INDEX IF NOT EXISTS acm_doc_tsv ON acm_doc USING gin (tsv)`);
// Time per item: wall time of the last download (page + PDFs, including the crawl delay) and its number of requests.
await pool.query(`ALTER TABLE acm_doc ADD COLUMN IF NOT EXISTS crawl_ms integer, ADD COLUMN IF NOT EXISTS requests integer`);

/** Extracts a page and its PDFs (undefined = not available) into its acm_doc row. */
async function index(id: string, crawled: string, html: string, pdfs: (Buffer | undefined)[]) {
  const page = parsePage(html);
  const texts = await Promise.all(page.pdfs.map((_, i) => (pdfs[i] ? extractText(pdfs[i], "application/pdf", "doc.pdf").catch(() => "") : "")));
  // Some PDFs extract with NUL bytes, which Postgres text refuses.
  const pdfText = joinPdfs(page.pdfs, texts).replaceAll("\0", "");
  await pool.query(`UPDATE acm_doc SET title = $2, date = $3, page_text = $4, pdf_text = $5, crawled = $6 WHERE id = $1`, [
    id, page.title || slugTitle(id), page.date, page.pageText, pdfText, crawled,
  ]);
  return { pdfs: texts.filter(Boolean).length, chars: page.pageText.length + pdfText.length };
}

const t0 = Date.now();

if (REINDEX) {
  const { rows } = await pool.query<{ id: string; lastmod: string; crawled: string | null }>(`SELECT id, lastmod, crawled FROM acm_doc`);
  const onDisk = rows.filter((r) => existsSync(htmlFile(r.id)));
  const progress = bar(onDisk.length, "pages reindexed");
  for (const r of onDisk) {
    const html = readFileSync(htmlFile(r.id), "utf8");
    const pdfs = parsePage(html).pdfs.map((l) => (existsSync(pdfFile(l)) ? readFileSync(pdfFile(l)) : undefined));
    await index(r.id, r.crawled ?? r.lastmod, html, pdfs);
    progress.tick();
  }
  progress.stop();
  log(`reindexed ${onDisk.length} pages from data/acm/ in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await pool.end();
  process.exit(0);
}

if (process.stderr.isTTY) process.stderr.write("reading the sitemap (10 requests, about 2 min)…\n");
const entries = await sitemap(`${BASE}/sitemap.xml`, (u) => u.startsWith(BASE + PUB));
const ids = entries.map((e) => e.url.slice((BASE + PUB).length));
await pool.query(
  `INSERT INTO acm_doc (id, url, title, lastmod) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
   ON CONFLICT (id) DO UPDATE SET url = excluded.url, lastmod = excluded.lastmod`,
  [ids, entries.map((e) => e.url), entries.map((e) => slugTitle(e.slug)), entries.map((e) => e.lastmod)],
);
if (LIMIT === Infinity) {
  const { rowCount } = await pool.query(`DELETE FROM acm_doc WHERE NOT (id = ANY($1))`, [ids]);
  if (rowCount) log(`removed ${rowCount} pages that left the sitemap`);
}
const { rows: all } = await pool.query<{ id: string; url: string; lastmod: string; crawled: string | null }>(
  `SELECT id, url, lastmod, crawled FROM acm_doc ORDER BY lastmod DESC`,
);
const due = all.filter((d) => d.crawled !== d.lastmod || !complete(d.id));
// --sample: pages never crawled, evenly spread over the list (newest first), so new and old pages both count.
const fresh = due.filter((d) => d.crawled === null);
const todo = SAMPLE ? Array.from({ length: Math.min(SAMPLE, fresh.length) }, (_, i) => fresh[Math.floor((i * fresh.length) / Math.min(SAMPLE, fresh.length))]) : due.slice(0, LIMIT);
log(`sitemap: ${entries.length} publications; to crawl: ${todo.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

let done = 0, pdfCount = 0, chars = 0, gone = 0;
const failed: string[] = [];
const progress = bar(todo.length, "pages");
for (const [i, d] of todo.entries()) {
  const t = Date.now();
  try {
    const html = await (await fetchOk(d.url)).text();
    save(htmlFile(d.id), html);
    const pdfs: (Buffer | undefined)[] = [];
    let requests = 1;
    for (const l of parsePage(html).pdfs) {
      const file = pdfFile(l);
      try {
        if (!existsSync(file)) requests++, save(file, Buffer.from(await (await fetchOk(l)).arrayBuffer()));
        pdfs.push(readFileSync(file));
      } catch (err) {
        // A missing PDF is skipped; any other error fails the page, so a re-run tries it again.
        if (!/status 404/.test((err as Error).message)) throw err;
        progress.event(`pdf gone (404): ${l}`);
        pdfs.push(undefined);
      }
    }
    const ms = Date.now() - t;
    const r = await index(d.id, d.lastmod, html, pdfs);
    await pool.query(`UPDATE acm_doc SET crawl_ms = $2, requests = $3 WHERE id = $1`, [d.id, ms, requests]);
    done++, (pdfCount += r.pdfs), (chars += r.chars);
    log(`[${i + 1}/${todo.length}] ${d.lastmod.slice(0, 10)} ${d.id.slice(0, 70)}: ${r.pdfs} pdf, ${requests} requests, ${r.chars} chars, ${(ms / 1000).toFixed(1)}s`);
    progress.tick();
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code; // e.g. UND_ERR_CONNECT_TIMEOUT behind "fetch failed"
    const msg = (err as Error).message + (cause ? ` (${cause})` : "");
    progress.tick(false);
    if (/status (403|429)/.test(msg)) {
      progress.event(`stopping: ${msg} at ${d.url}`);
      break;
    }
    if (/status 404/.test(msg)) {
      gone++;
      progress.event(`page gone (404), removed: ${d.url}`);
      await pool.query(`DELETE FROM acm_doc WHERE id = $1`, [d.id]);
    } else {
      failed.push(`${d.url}: ${msg}`);
      progress.event(`failed ${d.url}: ${msg}`);
    }
  }
}
progress.stop();

const secs = (Date.now() - t0) / 1000;
const summary = `${done} crawled (${pdfCount} pdfs, ${(chars / 1e6).toFixed(1)}M chars, ${done ? (secs / done).toFixed(1) : 0} s per page), ${gone} gone (404), ${failed.length} failed, ${(secs / 60).toFixed(1)} min`;
log(summary);
// Without a terminal, log() has already printed the summary.
if (process.stderr.isTTY) console.log(summary);
if (failed.length) console.log(`failed (details in data/acm_crawl.log):\n${failed.join("\n")}`);
await pool.end();
