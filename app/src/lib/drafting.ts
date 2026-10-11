import { getLaw } from "@/lib/wetten";
import { GOVERNANCE, TEMPLATES } from "@/lib/templates";

/**
 * Legal context for the AI on /genereren: the template's drafting rules plus the
 * current text of the articles it cites (wetten.overheid.nl, cached per day).
 * Articles that cannot be fetched are skipped; the rules still apply.
 */
export async function draftingContext(templateId: unknown): Promise<string> {
  const t = [...TEMPLATES, ...GOVERNANCE].find((x) => x.id === templateId);
  if (!t) return "";
  const cited = t.sources.flatMap((s) => {
    const m = s.url.match(/jci1\.3:c:(BWBR\d{7})&artikel=([\w.]+)/);
    return m ? [{ label: s.label, id: m[1], nr: m[2] }] : [];
  });
  const laws = new Map(
    await Promise.all(
      [...new Set(cited.map((c) => c.id))].map(async (id) => [id, await getLaw(id).catch(() => null)] as const),
    ),
  );
  const articles = cited.flatMap((c) => {
    const law = laws.get(c.id);
    const a = law?.items.find((i) => i.kind === "article" && i.label === `Artikel ${c.nr}`);
    return a && a.kind === "article" ? [`### ${c.label} (geldend per ${law!.validFrom})\n${a.text}`] : [];
  });
  return [
    `DOCUMENTSOORT: ${t.title}`,
    t.rules?.length ? `VEREISTEN:\n${t.rules.map((r) => `- ${r}`).join("\n")}` : "",
    articles.length ? `GELDENDE WETTEKST (wetten.overheid.nl):\n\n${articles.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
