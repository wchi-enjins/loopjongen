import { CHAT_MODEL, anthropic } from "@/lib/ai";
import { draftingContext } from "@/lib/drafting";
import { DEFAULT_EFFORT } from "@/lib/models";

const SYSTEM = `Je bent een Nederlandse juridisch opsteller. Je ontvangt een conceptdocument in een eenvoudige opmaak en aanvullende feiten of instructies.
Herschrijf het volledige document zodat de feiten en instructies zijn verwerkt, naar Nederlands recht.
Regels:
- Behoud exact de opmaak: "# " voor de titel, "## " voor kopjes, lege regel tussen alinea's, regels die beginnen met "SIGN:" ongewijzigd laten qua structuur.
- Verwijder geen wettelijk vereiste bepalingen (zoals de bedenktermijn of opzegtermijnen) tenzij de instructie dat uitdrukkelijk vraagt.
- Onbekende gegevens markeer je met [vierkante haken].
- De gebruiker is jurist en beslist zelf wat juridisch aanvaardbaar is: verwerk de instructies altijd. Toets ze aan de vereisten en de geldende wettekst hieronder; is een instructie daarmee waarschijnlijk in strijd, zet dan direct na de betreffende bepaling een waarschuwing tussen vierkante haken, bijv. [Let op: een proeftijd is bij deze duur nietig (art. 7:652 lid 6 BW)].
- Geef alleen het document terug, zonder toelichting of codeblokken.`;

export async function POST(req: Request) {
  const { markup, instructions, templateId } = (await req.json()) as { markup: string; instructions: string; templateId?: string };
  if (!markup?.trim() || !instructions?.trim()) return Response.json({ error: "Document en instructies zijn vereist" }, { status: 400 });
  const userKey = req.headers.get("x-anthropic-key")?.trim();

  // Start the request before streaming, so key/credit/rate-limit errors come back as a JSON error instead of replacing the draft.
  let completion;
  try {
    const context = await draftingContext(templateId);
    completion = await anthropic(userKey).messages.create({
      model: CHAT_MODEL,
      max_tokens: 64000,
      stream: true,
      output_config: { effort: DEFAULT_EFFORT },
      system: context ? `${SYSTEM}\n\n${context}` : SYSTEM,
      messages: [
        { role: "user", content: `CONCEPTDOCUMENT:\n\n${markup}\n\nAANVULLENDE FEITEN / INSTRUCTIES:\n\n${instructions}` },
      ],
    });
  } catch (err) {
    return Response.json({ error: `AI-verzoek mislukt: ${err instanceof Error ? err.message : "onbekend"}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of completion) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") controller.enqueue(encoder.encode(event.delta.text));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n[Fout bij AI-verzoek: ${err instanceof Error ? err.message : "onbekend"}]`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "x-ai-model": CHAT_MODEL, "x-ai-effort": DEFAULT_EFFORT },
  });
}
