/**
 * Kifid uitsprakenregister: the site's own public JSON endpoint (unofficial, undocumented, may change). One call gives
 * search hits with the full ruling text (pdfContent); statementLink is the PDF used as url.
 */
import type { FullDoc, SourceDoc } from ".";
import { fetchOk, htmlText } from "./web";

const API = "https://www.kifid.nl/api/Search/SearchDecision/"; // trailing slash, else a 301
type Item = { title: string; defendant: string; date: number | string; summary: string; statementLink: string; authority: string; category: string; pdfContent: string };

async function query(searchTerm: string, pageSize = 10): Promise<Item[]> {
  const p = new URLSearchParams({ searchTerm, page: "1", pageSize: String(pageSize), sort: "relevance" });
  const data = await (await fetchOk(`${API}?${p}`)).json();
  return data?.decision?.decisionItemsList ?? [];
}

// .NET ticks: 100 ns since 0001-01-01.
const tickDate = (t: number | string) => (Number(t) ? new Date((Number(t) - 621355968000000000) / 10000).toISOString().slice(0, 10) : "");
const slugOf = (link: string) => link.split("/").pop()!.replace(/\.pdf$/, "");
const titleOf = (i: Item) => [i.title, i.defendant].filter(Boolean).join(", ");

export async function search(q: string): Promise<SourceDoc[]> {
  return (await query(q)).map((i) => ({
    source: "kifid",
    id: slugOf(i.statementLink),
    title: titleOf(i),
    date: tickDate(i.date),
    url: i.statementLink,
    snippet: `${[i.authority, i.category].filter(Boolean).join(", ")}: ${htmlText(i.summary ?? "")}`.slice(0, 300),
  }));
}

/** idOrUrl: the PDF slug ("uitspraak-2026-0304-bindend"), its url, or a ruling number ("2026-0304"). */
export async function get(idOrUrl: string): Promise<FullDoc> {
  const slug = slugOf(idOrUrl);
  const nr = slug.match(/\d{4}-\d{3,4}/)?.[0] ?? slug;
  const items = await query(nr, 20);
  const i = items.find((x) => slugOf(x.statementLink) === slug) ?? items.find((x) => x.title.includes(nr));
  if (!i) throw new Error(`Kifid-uitspraak ${idOrUrl} niet gevonden`);
  return { title: titleOf(i), url: i.statementLink, date: tickDate(i.date), text: i.pdfContent ?? "" };
}
