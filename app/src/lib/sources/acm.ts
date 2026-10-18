/**
 * ACM (acm.nl): no API, so plain HTML. Search: the site's own search page (/nl/zoeken?text=); it sends rapid
 * searches to /nl/system/403, so at most one live search per 5 s and, once throttled, a title search over the
 * sitemap for 10 minutes. Full text: the publication page (<main>) plus its decision PDFs.
 */
import type { FullDoc, SourceDoc } from ".";
import { fetchOk, htmlText, mainHtml, pdfText, searchSitemap, slugTitle } from "./web";

const BASE = "https://www.acm.nl";
const PUB = "/nl/publicaties/";
const MAX_PDFS = 8;
let lastLive = 0;
let blockedUntil = 0;

/** Result cards of a /nl/zoeken page. */
export function parseResults(html: string): SourceDoc[] {
  return html.split('class="m-card ').slice(1).flatMap((card) => {
    const a = card.match(/<a href="(\/nl\/publicaties\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) return [];
    const excerpt = card.match(/search-api-excerpt[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    return [{
      source: "acm" as const,
      id: a[1].slice(PUB.length),
      title: htmlText(a[2]),
      date: card.match(/<span>(\d{2}-\d{2}-\d{4})<\/span>/)?.[1] ?? "",
      url: BASE + a[1],
      snippet: htmlText(excerpt).slice(0, 300),
    }];
  });
}

export async function search(q: string): Promise<SourceDoc[]> {
  const now = Date.now();
  if (now > blockedUntil && now - lastLive > 5_000) {
    lastLive = now;
    try {
      const p = new URLSearchParams({ text: q.slice(0, 128) });
      return parseResults(await (await fetchOk(`${BASE}/nl/zoeken?${p}`, { redirect: "manual" })).text());
    } catch {
      blockedUntil = Date.now() + 10 * 60_000;
    }
  }
  const hits = await searchSitemap(`${BASE}/sitemap.xml`, (u) => u.startsWith(BASE + PUB), q);
  return hits.map((e) => ({ source: "acm", id: e.url.slice(BASE.length + PUB.length), title: slugTitle(e.slug), date: e.lastmod.slice(0, 10), url: e.url, snippet: "" }));
}

/** idOrUrl: the path after /nl/publicaties/ (usually a slug) or the acm.nl url. pdfs=false skips the decision PDFs (faster, page text only). */
export async function get(idOrUrl: string, pdfs = true): Promise<FullDoc> {
  const url = idOrUrl.startsWith(`${BASE}/`) ? idOrUrl : `${BASE}${PUB}${encodeURI(idOrUrl)}`;
  const html = await (await fetchOk(url)).text();
  const main = mainHtml(html);
  let text = htmlText(main);
  if (pdfs) {
    // Relative /system/files/documents links are the decisions under "Documenten"; absolute ones are general guides.
    const links = [...new Set([...main.matchAll(/href="(\/system\/files\/documents\/[^"]+\.pdf)"/g)].map((m) => BASE + m[1]))].slice(0, MAX_PDFS);
    const texts = await Promise.all(links.map((l) => pdfText(l).catch(() => "")));
    text += links.map((l, i) => (texts[i] ? `\n\n--- ${l} ---\n${texts[i]}` : "")).join("");
  }
  return {
    title: htmlText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""),
    url,
    date: main.match(/<time datetime="(\d{4}-\d{2}-\d{2})/)?.[1] ?? text.match(/Publicatiedatum\s+(\d{2}-\d{2}-\d{4})/)?.[1] ?? "",
    text,
  };
}
