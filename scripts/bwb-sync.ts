/**
 * Polite BWB download: lists the regulations in force today via SRU and saves each
 * toestand XML to data/bwb/xml/, plus data/bwb/manifest.json with the metadata.
 *
 *   node scripts/bwb-sync.ts [--limit 1000] [--concurrency 3]
 *
 * Re-runs skip files already on disk (a toestand URL never changes content).
 * Backs off on 429/5xx (honours Retry-After); other errors are logged and skipped.
 */
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { XMLParser } = require("fast-xml-parser");

const SRU = "https://zoekservice.overheid.nl/sru/Search";
const HEADERS = { Accept: "application/xml", "User-Agent": "loopjongen-bwb/1.0 (+wesselchi123@gmail.com)" };
const GAP_MS = 250; // pause per worker between requests

const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
const LIMIT = num("--limit", Infinity);
const CONCURRENCY = num("--concurrency", 3);

const OUT = new URL("../data/bwb/", import.meta.url);
const XML_DIR = new URL("xml/", OUT);
mkdirSync(XML_DIR, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parser = new XMLParser({ removeNSPrefix: true, isArray: (name: string) => ["record", "rechtsgebied", "overheidsdomein"].includes(name) });
const text = (v: any) => String(typeof v === "object" && v !== null ? v["#text"] ?? "" : v ?? "");

async function get(url: string, tries = 6): Promise<string> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: HEADERS }).catch((e: Error) => e);
    if (res instanceof Response && res.ok) return res.text();
    const status = res instanceof Response ? res.status : res.message;
    const retryable = !(res instanceof Response) || res.status === 429 || res.status >= 500;
    if (!retryable || i + 1 >= tries) throw new Error(`${status} ${url}`);
    const retryAfter = res instanceof Response ? Number(res.headers.get("retry-after")) : 0;
    const wait = retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** i;
    console.warn(`  ${status}, retrying in ${wait / 1000}s: ${url}`);
    await sleep(wait);
  }
}

type Entry = {
  id: string;
  title: string;
  type: string;
  authority: string;
  areas: string[];
  domains: string[];
  validFrom: string;
  modified: string;
  xmlUrl: string;
  file: string;
};

async function list(): Promise<Entry[]> {
  const out = new Map<string, Entry>();
  for (let start = 1; out.size < LIMIT; ) {
    const p = new URLSearchParams({
      operation: "searchRetrieve",
      version: "2.0",
      "x-connection": "BWB",
      startRecord: String(start),
      maximumRecords: String(Math.min(1000, LIMIT - out.size)),
      query: `overheidbwb.geldigheidsdatum==${today}`,
    });
    const r = parser.parse(await get(`${SRU}?${p}`)).searchRetrieveResponse;
    for (const rec of r?.records?.record ?? []) {
      const gzd = rec.recordData.gzd;
      const { owmskern: kern, bwbipm: ipm = {} } = gzd.originalData.meta;
      const xmlUrl = text(gzd.enrichedData?.locatie_toestand);
      if (!xmlUrl) continue;
      const file = xmlUrl.split("/").pop()!;
      out.set(file, {
        id: text(kern.identifier),
        title: text(kern.title),
        type: text(kern.type),
        authority: text(kern.authority),
        areas: (ipm.rechtsgebied ?? []).map(text),
        domains: (ipm.overheidsdomein ?? []).map(text),
        validFrom: text(ipm.geldigheidsperiode_startdatum),
        modified: text(kern.modified),
        xmlUrl,
        file,
      });
    }
    console.log(`listed ${out.size} / ${r?.numberOfRecords}`);
    if (!r?.nextRecordPosition) break;
    start = Number(r.nextRecordPosition);
    await sleep(GAP_MS);
  }
  return [...out.values()].slice(0, LIMIT);
}

const t0 = Date.now();
const entries = await list();
writeFileSync(new URL("manifest.json", OUT), JSON.stringify({ date: today, entries }, null, 1));

let done = 0, skipped = 0, bytes = 0;
const failed: string[] = [];
const queue = [...entries];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let e; (e = queue.shift()); ) {
      const path = new URL(e.file, XML_DIR);
      if (existsSync(path)) {
        skipped++;
        bytes += statSync(path).size;
        continue;
      }
      try {
        const xml = await get(e.xmlUrl);
        writeFileSync(new URL(e.file + ".tmp", XML_DIR), xml);
        renameSync(new URL(e.file + ".tmp", XML_DIR), path);
        bytes += Buffer.byteLength(xml);
        if (++done % 100 === 0) console.log(`downloaded ${done} (${(bytes / 1e6).toFixed(0)} MB)`);
      } catch (err) {
        failed.push(`${e.id}: ${(err as Error).message}`);
      }
      await sleep(GAP_MS);
    }
  }),
);

const secs = (Date.now() - t0) / 1000;
console.log(
  `\n${entries.length} listed, ${done} downloaded, ${skipped} already on disk, ${failed.length} failed, ` +
    `${(bytes / 1e6).toFixed(1)} MB, ${secs.toFixed(0)}s`,
);
if (failed.length) console.log("failed:\n" + failed.join("\n"));
