import { searchRulings, type Sort } from "@/lib/rechtspraak";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const sort: Sort = url.searchParams.get("sort") === "date" ? "date" : "relevance";
  if (!q) return Response.json({ total: 0, hits: [] });
  try {
    return Response.json(await searchRulings(q, page, sort));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Zoeken mislukt" }, { status: 502 });
  }
}
