import { NEW_CHAT_TITLE, db, uniqueTitle } from "@/lib/db";
import { CHAT_MODEL, LEGAL_SYSTEM_PROMPT, anthropic } from "@/lib/ai";
import { lawContext } from "@/lib/lawsearch";
import { DEFAULT_EFFORT, DEFAULT_LAW_SEARCH, pickEffort, pickLawSearch, pickModel, supportsEffort } from "@/lib/models";

const MAX_DOC_CHARS = 120_000;
// ponytail: linked customer messages beyond this are cut off (oldest first); summarise them if customers grow large.
const MAX_CUSTOMER_CHARS = 40_000;
// Images Claude can read directly; the API rejects larger images or other formats.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
type Doc = { filename: string; mime: string; text: string; data: Buffer | null };
const isImage = (d: Doc) => (IMAGE_TYPES as readonly string[]).includes(d.mime);

export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const { id } = await ctx.params;
  const { content } = (await req.json()) as { content: string };
  const userKey = req.headers.get("x-anthropic-key")?.trim();
  if (!content?.trim()) return Response.json({ error: "Leeg bericht" }, { status: 400 });

  const pool = await db();
  const conv = await pool.query(`SELECT title, model, effort, law_search, customer_id FROM conversations WHERE id = $1`, [id]).catch(() => null);
  if (!conv?.rows[0]) return Response.json({ error: "Gesprek niet gevonden" }, { status: 404 });
  const model = pickModel(conv.rows[0].model) ?? CHAT_MODEL;
  const effort = pickEffort(conv.rows[0].effort) ?? DEFAULT_EFFORT;
  const lawSearch = pickLawSearch(conv.rows[0].law_search) ?? DEFAULT_LAW_SEARCH;

  await pool.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [id, content]);
  // Untitled chat ("Nieuw gesprek" or "Nieuw gesprek (2)"): name it after the first message.
  if (conv.rows[0].title.replace(/ \(\d+\)$/, "") === NEW_CHAT_TITLE) {
    const title = await uniqueTitle(pool, content.replace(/\s+/g, " ").trim().slice(0, 80), id);
    await pool.query(`UPDATE conversations SET title = $2 WHERE id = $1`, [id, title]);
  }

  const history = await pool.query(`SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [id]);
  const customerId: string | null = conv.rows[0].customer_id;
  // The chat's own documents plus those linked to the chat's customer.
  const docs = await pool.query(
    `SELECT d.filename, d.mime, d.text, CASE WHEN d.mime LIKE 'image/%' THEN d.data END AS data
       FROM documents d
      WHERE d.id IN (SELECT document_id FROM conversation_documents WHERE conversation_id = $1
                     UNION SELECT document_id FROM customer_documents WHERE customer_id = $2)`,
    [id, customerId],
  );
  const customerContext = customerId ? await customerBlock(pool, customerId, id) : "";

  let budget = MAX_DOC_CHARS;
  const images = (docs.rows as Doc[]).filter((d) => isImage(d) && d.data && d.data.length <= MAX_IMAGE_BYTES);
  const docContext = (docs.rows as Doc[])
    .map((d) => {
      const text = images.includes(d)
        ? "[Afbeelding: meegestuurd in het eerste bericht van het gesprek]"
        : d.text || (isImage(d) ? "[Afbeelding te groot om mee te sturen (max. 5 MB)]" : "[Geen tekst geëxtraheerd uit dit bestand]");
      const slice = text.slice(0, Math.max(0, budget));
      budget -= slice.length;
      const cut = slice.length < text.length ? "\n[... document ingekort ...]" : "";
      return `<document naam="${d.filename}">\n${slice}${cut}\n</document>`;
    })
    .join("\n\n");

  let system = LEGAL_SYSTEM_PROMPT;
  if (customerContext) system += `\n\nDit gesprek gaat over de volgende klant:\n\n${customerContext}`;
  if (docContext) system += `\n\nDe gebruiker heeft de volgende documenten bijgevoegd:\n\n${docContext}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let answer = "";
      try {
        const send = (text: string) => {
          answer += text;
          controller.enqueue(encoder.encode(text));
        };
        // Look up the law articles for this question first (and the previous one, for follow-ups); the
        // answer then cites them and ends with links. A failed search does not block the answer.
        // ponytail: blocks the first token for the search time (~8 s for B); stream a status line if that bothers users.
        let law = { block: "", sources: "" };
        let lawError = "";
        const question = history.rows.filter((m: { role: string }) => m.role === "user").slice(-2).map((m: { content: string }) => m.content).join("\n\n").slice(-4000);
        try {
          law = await lawContext(lawSearch, question, anthropic(userKey));
        } catch (err) {
          lawError = err instanceof Error ? err.message : "onbekend";
        }
        const fullSystem = law.block
          ? `${system}\n\nBij deze vraag zijn de volgende geldende wetsartikelen uit het Basiswettenbestand (wetten.overheid.nl) gezocht. Gebruik ze als bron waar ze relevant zijn en verwijs naar regeling en artikel. Zeg het als ze de vraag niet (volledig) beantwoorden; noem dan geen artikelnummers die je niet zeker weet.\n\n<wetgeving>\n${law.block}\n</wetgeving>`
          : system;
        // Effort sets thinking depth (thinking can't be disabled on Opus 5.5). On a safety
        // refusal the API retries server-side on Anthropic's recommended fallback model.
        const stream = anthropic(userKey).beta.messages.stream({
          model,
          max_tokens: 64000,
          ...(supportsEffort(model) && {
            output_config: { effort },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          }),
          system: fullSystem,
          // Attached images go in front of the first message, so the prefix stays the same every turn.
          messages: history.rows.map((m: { role: "user" | "assistant"; content: string }, i: number) => ({
            role: m.role,
            content:
              i === 0 && images.length
                ? [
                    ...images.map((d) => ({
                      type: "image" as const,
                      source: { type: "base64" as const, media_type: d.mime as (typeof IMAGE_TYPES)[number], data: d.data!.toString("base64") },
                    })),
                    { type: "text" as const, text: m.content },
                  ]
                : m.content,
          })),
        });
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "fallback" && answer) {
            send("\n\n[Overgeschakeld naar ander model]\n\n");
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send(event.delta.text);
          }
        }
        if ((await stream.finalMessage()).stop_reason === "refusal") send("\n\n[Het model heeft dit verzoek geweigerd.]");
        if (law.sources) send(`\n\n---\n**Gezochte wetgeving (aanpak ${lawSearch.toUpperCase()}):**\n${law.sources}`);
        else if (lawError) send(`\n\n---\n_Wetgeving zoeken (aanpak ${lawSearch.toUpperCase()}) mislukt: ${lawError}_`);
      } catch (err) {
        const msg = `\n\n[Fout bij AI-verzoek: ${err instanceof Error ? err.message : "onbekend"}]`;
        answer += msg;
        controller.enqueue(encoder.encode(msg));
      } finally {
        if (answer) {
          await pool.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [id, answer]);
        }
        await pool.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [id]);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "x-ai-model": model, ...(supportsEffort(model) && { "x-ai-effort": effort }), "x-law-search": lawSearch },
  });
}

/** Customer details, linked document names and linked chat messages (not from this chat) as a text block. */
async function customerBlock(pool: Awaited<ReturnType<typeof db>>, customerId: string, conversationId: string) {
  const c = await pool.query(
    `SELECT name, email, phone, company, address, postal_code, city, kvk, notes, created_at FROM customers WHERE id = $1`,
    [customerId],
  );
  if (!c.rows[0]) return "";
  const { name, email, phone, company, address, postal_code, city, kvk, notes, created_at } = c.rows[0];
  const fullAddress = [address, [postal_code, city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const docs = await pool.query(
    `SELECT d.filename FROM customer_documents cd JOIN documents d ON d.id = cd.document_id WHERE cd.customer_id = $1 ORDER BY d.filename`,
    [customerId],
  );
  const msgs = await pool.query(
    `SELECT m.role, m.content, m.created_at, c.title FROM customer_messages cm
       JOIN messages m ON m.id = cm.message_id JOIN conversations c ON c.id = m.conversation_id
      WHERE cm.customer_id = $1 AND m.conversation_id <> $2 ORDER BY m.created_at`,
    [customerId, conversationId],
  );
  let messages = msgs.rows
    .map((m) => `[${m.title}] ${m.role === "user" ? "Gebruiker" : "AI"} (${new Date(m.created_at).toLocaleDateString("nl-NL")}):\n${m.content}`)
    .join("\n\n");
  if (messages.length > MAX_CUSTOMER_CHARS) messages = `[... oudere berichten weggelaten ...]\n${messages.slice(-MAX_CUSTOMER_CHARS)}`;
  return [
    `<klant naam="${name}">`,
    `E-mail: ${email || "onbekend"}`,
    `Telefoon: ${phone || "onbekend"}`,
    `Organisatie: ${company || "onbekend"}`,
    `Adres: ${fullAddress || "onbekend"}`,
    `KvK-nummer: ${kvk || "onbekend"}`,
    ...(notes ? [`Notities:\n${notes}`] : []),
    `Klant sinds: ${new Date(created_at).toLocaleDateString("nl-NL")}`,
    `Gekoppelde documenten: ${docs.rows.map((d) => d.filename).join(", ") || "geen"} (inhoud staat bij de bijgevoegde documenten)`,
    `Gekoppelde chatberichten uit andere gesprekken:\n${messages || "geen"}`,
    `</klant>`,
  ].join("\n");
}
