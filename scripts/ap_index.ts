/**
 * Builds the full-text table ap_doc from the AP crawl in data/ap/ (scripts/ap_crawl.sh): one row per live page
 * (documenten, actueel, themas) with its page text and the text of its PDFs. Searched by app/src/lib/sources/ap.ts.
 * Reads local files only, so it never contacts autoriteitpersoonsgegevens.nl; rerun it after each crawl.
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs scripts/ap_index.ts [--all]
 *
 * Pages whose row already holds the text for their lastmod are skipped; --all rebuilds every row. Rows of pages that
 * are gone (404/410) or no longer crawled are deleted. One line per page goes to data/ap_index.log.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { pool } from "../app/src/lib/db.ts";
import { extractText } from "../app/src/lib/extract.ts";
import { joinPdfs } from "../app/src/lib/sources/acm.ts";
import { decode, htmlText, mainHtml, slugTitle } from "../app/src/lib/sources/web.ts";

const BASE = "https://www.autoriteitpersoonsgegevens.nl";
const ALL = process.argv.includes("--all");
// tsvector holds at most 1 MB; very long texts are indexed on their first 400k characters (stored in full), as acm_doc.
const TSV_CHARS = 400_000;
// ponytail: the few PDFs above this are huge Woo bundles (up to 504 MB, mostly scans); index them when OCR is added.
const MAX_PDF_BYTES = 50e6;

const DIR = fileURLToPath(new URL("../data/ap/", import.meta.url));
const LOG = fileURLToPath(new URL("../data/ap_index.log", import.meta.url));
function log(line: string) {
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  if (!process.stderr.isTTY) console.log(line);
}

/** Same as bar() in scripts/acm_crawl.ts: the progress line from CLAUDE.md, with the last EVENTS problems in red under it. */
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
    process.stderr.write(`${drawn > 1 ? `\x1b[${drawn - 1}A` : ""}\r${lines.map((l) => `\x1b[2K${l}`).join("\n")}`);
    drawn = lines.length;
  };
  const timer = setInterval(draw, 1000);
  draw();
  return {
    tick: (ok = true) => (ok ? done++ : failed++, done + failed === total || draw()),
    event: (line: string) => {
      log(line);
      events.push(`${new Date().toLocaleTimeString("nl-NL")} ${line}`);
      if (events.length > EVENTS) events.shift();
      draw();
    },
    stop: () => (clearInterval(timer), draw(), process.stderr.isTTY && process.stderr.write("\n")),
  };
}

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DUTCH_DATE = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join("|")}) (\\d{4})\\b`);

/** Title, date (YYYY-MM-DD: the page's <time>, else the first Dutch date in its text) and <main> text of an AP page. */
function parsePage(html: string) {
  const pageText = htmlText(mainHtml(html)).replaceAll("\0", "");
  const d = pageText.match(DUTCH_DATE);
  return {
    title: decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? ""),
    date:
      html.match(/<time datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ??
      (d ? `${d[3]}-${String(MONTHS.indexOf(d[2]) + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}` : ""),
    pageText,
  };
}

await pool.query(`CREATE TABLE IF NOT EXISTS ap_doc (
  id text PRIMARY KEY, -- path after the domain, e.g. documenten/besluit-boete-as-watson-kruidvat
  url text NOT NULL, section text NOT NULL, title text NOT NULL, date text NOT NULL DEFAULT '', lastmod text NOT NULL,
  page_text text, pdf_text text,
  crawled text, -- the lastmod the stored text belongs to
  crawl_ms integer, requests integer, -- time and requests of the page's download (from data/ap/done.tsv)
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('dutch', title), 'A') ||
    setweight(to_tsvector('dutch', left(coalesce(page_text, '') || ' ' || coalesce(pdf_text, ''), ${TSV_CHARS})), 'C')
  ) STORED)`);
await pool.query(`CREATE INDEX IF NOT EXISTS ap_doc_tsv ON ap_doc USING gin (tsv)`);

// done.tsv: url, lastmod, status, pdf links (space separated), crawl_ms, requests (the last two missing on the first rows).
const live = readFileSync(join(DIR, "done.tsv"), "utf8")
  .trim()
  .split("\n")
  .map((l) => l.split("\t"))
  .filter((c) => c[2] === "200")
  .map(([url, lastmod, , links, ms, req]) => {
    const id = url.slice(BASE.length + 1);
    return { id, url, lastmod, links: links ? links.split(" ") : [], ms: ms ? Number(ms) : null, req: req ? Number(req) : null, slug: id.replaceAll("/", "_") };
  });

const t0 = Date.now();
const removed = await pool.query(`DELETE FROM ap_doc WHERE NOT (id = ANY($1))`, [live.map((p) => p.id)]);
const built = new Map((await pool.query<{ id: string; crawled: string }>(`SELECT id, crawled FROM ap_doc`)).rows.map((r) => [r.id, r.crawled]));
const todo = live.filter((p) => ALL || built.get(p.id) !== p.lastmod);
log(`indexing ${todo.length} of ${live.length} live pages${removed.rowCount ? `, ${removed.rowCount} gone rows removed` : ""}`);

let pdfCount = 0, chars = 0, skipped = 0;
const progress = bar(todo.length, "pages");
for (const p of todo) {
  const t = Date.now();
  try {
    const page = parsePage(readFileSync(join(DIR, "html", `${p.slug}.html`), "utf8"));
    const texts: string[] = [];
    for (const [i] of p.links.entries()) {
      const file = join(DIR, "pdf", `${p.slug}-${i + 1}.pdf`);
      if (!existsSync(file)) texts.push("");
      else if (statSync(file).size > MAX_PDF_BYTES) {
        skipped++;
        progress.event(`pdf skipped (${Math.round(statSync(file).size / 1e6)} MB): ${p.links[i]}`);
        texts.push("");
      } else texts.push(await extractText(readFileSync(file), "application/pdf", "doc.pdf").catch(() => ""));
    }
    // Some PDFs extract with NUL bytes, which Postgres text refuses.
    const pdfText = joinPdfs(p.links, texts).replaceAll("\0", "");
    await pool.query(
      `INSERT INTO ap_doc (id, url, section, title, date, lastmod, page_text, pdf_text, crawled, crawl_ms, requests)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6, $9, $10)
       ON CONFLICT (id) DO UPDATE SET url = $2, section = $3, title = $4, date = $5, lastmod = $6, page_text = $7, pdf_text = $8,
         crawled = $6, crawl_ms = $9, requests = $10`,
      [p.id, p.url, p.id.split("/")[0], page.title || slugTitle(p.id.split("/").pop()!), page.date, p.lastmod, page.pageText, pdfText, p.ms, p.req],
    );
    const n = texts.filter(Boolean).length;
    pdfCount += n;
    chars += page.pageText.length + pdfText.length;
    log(`${p.id.slice(0, 80)}: ${n}/${p.links.length} pdf, ${page.pageText.length + pdfText.length} chars, ${((Date.now() - t) / 1000).toFixed(1)}s`);
    progress.tick();
  } catch (err) {
    progress.event(`failed ${p.id}: ${(err as Error).message}`);
    progress.tick(false);
  }
}
progress.stop();

const { rows } = await pool.query(`SELECT count(*) AS n, pg_size_pretty(pg_total_relation_size('ap_doc')) AS size FROM ap_doc`);
const summary = `${todo.length} indexed (${pdfCount} pdfs, ${(chars / 1e6).toFixed(1)}M chars, ${skipped} pdfs skipped as too large), ${((Date.now() - t0) / 60000).toFixed(1)} min; ap_doc: ${rows[0].n} rows, ${rows[0].size}`;
log(summary);
if (process.stderr.isTTY) console.log(summary);
await pool.end();
