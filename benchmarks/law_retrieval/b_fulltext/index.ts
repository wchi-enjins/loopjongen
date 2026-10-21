/**
 * Approach B, step 1: (re)build the Postgres full-text index bwb_article from the local BWB files
 * (data/bwb/manifest.json + data/bwb/xml). One row per article (long ones split in chunks); laws
 * without article text are indexed as label '' chunks of their full text.
 *
 *   node --no-warnings --import ./benchmarks/law_retrieval/resolve_ts.mjs benchmarks/law_retrieval/b_fulltext/index.ts [--limit <n>]
 *
 * DATABASE_URL defaults to the dev database (postgres://legal:legal@localhost:5433/legal).
 * Only touches table bwb_article and its indexes.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { parseLaw } from "../../../app/src/lib/wetten.ts";
import { flatten, parseOrdered, tidy } from "../../../app/src/lib/xml.ts";

type Entry = { id: string; title: string; type: string; authority: string; areas: string[]; validFrom: string; file: string };
type Row = [string, string, string, string, string[], string, string, string, string, string];

const dir = new URL(".", import.meta.url);
const XML_DIR = new URL("../../../data/bwb/xml/", dir);
const { entries } = JSON.parse(readFileSync(new URL("../../../data/bwb/manifest.json", dir), "utf8")) as { entries: Entry[] };
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : entries.length;

const require = createRequire(new URL("../../../app/package.json", dir));
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://legal:legal@localhost:5433/legal" });

const CHUNK = 8000; // chars; keeps every tsvector far below Postgres' 1 MB limit
const BATCH = 500;
const COLS = ["law_id", "law_title", "law_type", "authority", "areas", "label", "article_title", "path", "text", "url"];
const SKIP = new Set(["meta-data", "bwb-wijzigingen", "bwb-inputbestand", "redactionele-correcties"]);
const BLOCKS = new Set(["al", "li", "lid", "lijst", "kop", "tussenkop", "row", "table", "artikel", "bijlage", "aanhef", "considerans.al"]);

// Same as normLabel in c_catalog/search.ts, so the evaluator compares consistently.
const normLabel = (label: string) => label.replace(/^(artikel|art\.)\s*/i, "").trim().replace(/\.$/, "");

/** Split on line breaks into pieces of at most CHUNK chars (hard cut for a single overlong line). */
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let line of text.split("\n")) {
    while (line.length > CHUNK) {
      if (cur) out.push(cur), (cur = "");
      out.push(line.slice(0, CHUNK));
      line = line.slice(CHUNK);
    }
    if (cur && cur.length + line.length + 1 > CHUNK) out.push(cur), (cur = "");
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

function rowsFor(e: Entry, xml: string): Row[] {
  const law = (label: string, title: string, path: string, text: string, url: string): Row =>
    [e.id, e.title, e.type, e.authority, e.areas, label, title, path, text.replace(/\0/g, ""), url];
  const items = parseLaw(xml, e.id, e.validFrom);
  const rows: Row[] = [];
  const trail: string[] = [];
  for (const it of items) {
    if (it.kind === "heading") {
      trail.length = it.level - 1;
      trail.push(it.text);
    } else if (it.text) {
      for (const c of chunks(it.text)) rows.push(law(normLabel(it.label), it.title, trail.filter(Boolean).join(" > "), c, it.url));
    }
  }
  if (rows.length) return rows;
  // No article text (e.g. a beleidsregel that keeps everything in a bijlage): index the whole document.
  const text = tidy(flatten(parseOrdered(xml), BLOCKS, SKIP));
  return chunks(text).map((c) => law("", "", "", c, `https://wetten.overheid.nl/${e.id}/${e.validFrom}`));
}

async function insert(rows: Row[]) {
  const values = rows.map((_, i) => `(${COLS.map((_, j) => `$${i * COLS.length + j + 1}`).join(",")})`).join(",");
  await db.query(`INSERT INTO bwb_article (${COLS.join(",")}) VALUES ${values}`, rows.flat());
}

const t0 = Date.now();
await db.connect();
await db.query("DROP TABLE IF EXISTS bwb_article");
await db.query(`CREATE TABLE bwb_article (
  law_id text NOT NULL, law_title text NOT NULL, law_type text NOT NULL, authority text NOT NULL, areas text[] NOT NULL,
  label text NOT NULL, article_title text NOT NULL, path text NOT NULL, text text NOT NULL, url text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('dutch', law_title), 'A') ||
    setweight(to_tsvector('dutch', path || ' ' || article_title), 'B') ||
    setweight(to_tsvector('dutch', text), 'C')
  ) STORED)`);

let laws = 0, rowCount = 0, noArticles = 0, missing = 0;
const failures: string[] = [];
let buf: Row[] = [];
let pending: Promise<void> = Promise.resolve();
// Parse the next files while the previous batch is inserted (one insert in flight at a time).
const flush = async () => {
  await pending;
  pending = insert(buf);
  buf = [];
};

for (const e of entries.slice(0, limit)) {
  const file = new URL(e.file, XML_DIR);
  if (!existsSync(file)) {
    missing++;
    console.log(`missing ${e.id}`);
    continue;
  }
  try {
    const rows = rowsFor(e, readFileSync(file, "utf8"));
    if (rows.every((r) => r[5] === "")) noArticles++;
    rowCount += rows.length;
    buf.push(...rows);
  } catch (err) {
    failures.push(e.id);
    console.log(`parse failed ${e.id}: ${(err as Error).message}`);
  }
  if (buf.length >= BATCH) await flush();
  if (++laws % 1000 === 0) console.log(`${laws} laws, ${rowCount} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (buf.length) await flush();
await pending;

console.log("creating indexes...");
await db.query("CREATE INDEX bwb_article_tsv ON bwb_article USING gin (tsv)");
await db.query("CREATE INDEX bwb_article_law_id ON bwb_article (law_id)");
await db.query("ANALYZE bwb_article");
const { rows: size } = await db.query("SELECT pg_size_pretty(pg_total_relation_size('bwb_article')) AS s");
await db.end();

console.log(`done: ${laws} laws, ${rowCount} rows, ${noArticles} laws indexed as chunks (no article text), ${missing} missing files, ${failures.length} parse failures${failures.length ? ` (${failures.join(", ")})` : ""}`);
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s, table size ${size[0].s}`);
