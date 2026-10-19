/** Shared helpers for the sources that only have a website (ACM, AP): polite fetch, HTML/PDF to text, sitemap search. */
import { setDefaultResultOrder } from "node:dns";
import { extractText } from "../extract";

// acm.nl's IPv6 address often times out on connect (UND_ERR_CONNECT_TIMEOUT); its IPv4 address answers. Process-wide.
setDefaultResultOrder("ipv4first");
import { HEADERS } from "../wetten";
import { tidy } from "../xml";

// robots.txt Crawl-delay per host: requests to it are spaced this far apart.
// ponytail: per process; the app and a crawl running at the same time each keep it, so together they go twice as fast.
const CRAWL_DELAY: Record<string, number> = { "www.acm.nl": 10_000 };
const nextSlot = new Map<string, number>();

async function waitTurn(host: string) {
  const gap = CRAWL_DELAY[host];
  if (!gap) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** fetch with our User-Agent and a timeout, so a slow source never hangs the chat; throws on non-2xx. */
export async function fetchOk(url: string, init: RequestInit = {}) {
  await waitTurn(new URL(url).host);
  const res = await fetch(url, { ...init, headers: { "User-Agent": HEADERS["User-Agent"] }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} gaf status ${res.status}`);
  return res;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, "0x"))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** Plain text of an HTML fragment: block ends become newlines; scripts, styles, menus and forms are dropped. */
export const htmlText = (html: string) =>
  tidy(
    decode(
      html
        .replace(/<(script|style|svg|nav|form|noscript)\b[\s\S]*?<\/\1>/gi, "")
        .replace(/<(br|\/p|\/h\d|\/li|\/div|\/tr|\/dt|\/dd)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    ),
  );

export const mainHtml = (html: string) => html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;

export async function pdfText(url: string) {
  return extractText(Buffer.from(await (await fetchOk(url)).arrayBuffer()), "application/pdf", "doc.pdf");
}

type Entry = { url: string; slug: string; lastmod: string };
const DAY = 24 * 3600_000;
const sitemaps = new Map<string, { at: number; entries: Promise<Entry[]> }>();

/** All urls in a sitemap index (cached for a day), filtered by `keep`. */
export function sitemap(index: string, keep: (url: string) => boolean) {
  const hit = sitemaps.get(index);
  if (hit && Date.now() - hit.at < DAY) return hit.entries;
  const entries = (async () => {
    const pages = [...(await (await fetchOk(index)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]));
    const xmls = await Promise.all(pages.map(async (p) => (await fetchOk(p)).text()));
    return xmls.flatMap((x) =>
      x.split("<url>").slice(1).flatMap((u) => {
        const url = decode(u.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "");
        if (!keep(url)) return [];
        return [{ url, slug: url.split("/").pop()!, lastmod: u.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "" }];
      }),
    );
  })();
  entries.catch(() => sitemaps.delete(index));
  sitemaps.set(index, { at: Date.now(), entries });
  return entries;
}

const STOP = new Set(
  "een het van voor over naar door deze die dat wat welke zijn heeft hebben wordt worden bij aan met als ook niet nog hun ons onze per acm kifid".split(" "),
);
/** Query words without stopwords, cut to 5 letters as a crude stem (nepkortingen ~ nepkorting, cookies ~ cookiewalls). */
const terms = (q: string) => [
  ...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5))),
];

/**
 * Keyword search over the url slugs of a sitemap: at least half the query words must start a word in the slug, most matches
 * first, then newest. Slugs on these sites are the page titles, so this finds decisions by title.
 * ponytail: titles only, no body text; build a local full-text index from the sitemap pages if recall falls short.
 */
export async function searchSitemap(index: string, keep: (url: string) => boolean, q: string, limit = 10) {
  const qs = terms(q);
  if (!qs.length) return [];
  return (await sitemap(index, keep))
    .map((e) => ({ e, score: qs.filter((t) => `-${e.slug.toLowerCase()}`.includes(`-${t}`)).length }))
    .filter((x) => x.score >= Math.ceil(qs.length / 2))
    .sort((a, b) => b.score - a.score || b.e.lastmod.localeCompare(a.e.lastmod))
    .slice(0, limit)
    .map((x) => x.e);
}

export const slugTitle = (slug: string) => decodeURIComponent(slug).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
