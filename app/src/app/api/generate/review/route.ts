import { CHAT_MODEL, anthropic } from "@/lib/ai";
import { draftingContext } from "@/lib/drafting";
import { DEFAULT_EFFORT } from "@/lib/models";

const SYSTEM = `Je bent een Nederlandse advocaat die een conceptdocument controleert vóór ondertekening.
Toets het document aan de vereisten en de geldende wettekst hieronder, en aan de signalen uit het invulformulier.
Meld alleen concrete problemen: ontbrekende of onjuiste verplichte bepalingen, strijd met dwingend recht, onjuiste bedragen of termijnen, tegenstrijdigheden en open [vierkante haken].
Noem per probleem kort wat er mis is en het artikel waarop het berust. Verzin geen problemen; meld niets wat wel in orde is.`;

const SCHEMA = {
  type: "object",
  properties: { issues: { type: "array", items: { type: "string" } } },
  required: ["issues"],
  additionalProperties: false,
};

/** AI check of the final draft (after manual or AI edits) against the template's rules and the cited law. */
export async function POST(req: Request) {
  const { markup, templateId, checks } = (await req.json()) as { markup?: string; templateId?: string; checks?: string[] };
  if (!markup?.trim()) return Response.json({ error: "Document is vereist" }, { status: 400 });
  const userKey = req.headers.get("x-anthropic-key")?.trim();
  const context = await draftingContext(templateId);
  const signals = Array.isArray(checks) && checks.length ? checks.map((c) => `- ${String(c)}`).join("\n") : "geen";
  try {
    const msg = await anthropic(userKey).messages.create({
      model: CHAT_MODEL,
      max_tokens: 16000,
      output_config: { effort: DEFAULT_EFFORT, format: { type: "json_schema", schema: SCHEMA } },
      system: context ? `${SYSTEM}\n\n${context}` : SYSTEM,
      messages: [{ role: "user", content: `SIGNALEN UIT HET FORMULIER:\n${signals}\n\nCONCEPTDOCUMENT:\n\n${markup}` }],
    });
    if (msg.stop_reason === "refusal") return Response.json({ error: "De AI heeft de controle geweigerd." }, { status: 502 });
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const { issues } = JSON.parse(text) as { issues: string[] };
    return Response.json({ issues }, { headers: { "x-ai-model": CHAT_MODEL, "x-ai-effort": DEFAULT_EFFORT } });
  } catch (err) {
    return Response.json({ error: `AI-controle mislukt: ${err instanceof Error ? err.message : "onbekend"}` }, { status: 502 });
  }
}
