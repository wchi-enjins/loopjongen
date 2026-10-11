import { getLaw } from "@/lib/wetten";

export async function GET(_req: Request, ctx: RouteContext<"/api/wetten/[id]">) {
  const { id } = await ctx.params;
  if (!/^BWBR\d{7}$/.test(id)) return Response.json({ error: "Ongeldig BWB-id" }, { status: 400 });
  try {
    return Response.json(await getLaw(id));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Ophalen mislukt" }, { status: 502 });
  }
}
