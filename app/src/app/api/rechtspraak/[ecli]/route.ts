import { ECLI_RE, getRuling } from "@/lib/rechtspraak";

export async function GET(_req: Request, ctx: RouteContext<"/api/rechtspraak/[ecli]">) {
  const ecli = decodeURIComponent((await ctx.params).ecli).toUpperCase();
  if (!ECLI_RE.test(ecli)) return Response.json({ error: "Ongeldig ECLI-nummer" }, { status: 400 });
  try {
    return Response.json(await getRuling(ecli));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Ophalen mislukt" }, { status: 502 });
  }
}
