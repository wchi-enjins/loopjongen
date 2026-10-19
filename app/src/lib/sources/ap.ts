/**
 * Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl): no API, and robots.txt disallows the site's /search,
 * so search is a title search over the sitemap (documenten, actueel, themas; NL only). Full text: the page (<main>)
 * plus its PDF (the decision itself).
 */
import type { FullDoc, SourceDoc } from ".";
import { decode, fetchOk, htmlText, mainHtml, pdfText, searchSitemap, slugTitle } from "./web";

const BASE = "https://www.autoriteitpersoonsgegevens.nl";
const KEEP = /^https:\/\/www\.autoriteitpersoonsgegevens\.nl\/(documenten|actueel|themas)\//;
const DUTCH_DATE = /\b\d{1,2} (januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december) \d{4}\b/;

export async function search(q: string): Promise<SourceDoc[]> {
  const hits = await searchSitemap(`${BASE}/sitemap.xml`, (u) => KEEP.test(u), q);
  return hits.map((e) => ({ source: "ap", id: e.url.slice(BASE.length + 1), title: slugTitle(e.slug), date: e.lastmod.slice(0, 10), url: e.url, snippet: "" }));
}

/** idOrUrl: a path such as "documenten/besluit-boete-as-watson-kruidvat" or its full url. */
export async function get(idOrUrl: string, pdfs = true): Promise<FullDoc> {
  const url = idOrUrl.startsWith(`${BASE}/`) ? idOrUrl : `${BASE}/${idOrUrl.replace(/^\/+/, "")}`;
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
