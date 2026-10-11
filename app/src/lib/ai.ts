import Anthropic from "@anthropic-ai/sdk";

export const CHAT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

let anthropicClient: Anthropic | undefined;

/** userKey: the user's own key from the chat (billed to them); falls back to the server key. */
export function anthropic(userKey?: string | null) {
  if (userKey) return new Anthropic({ apiKey: userKey });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Geen API-sleutel: vul uw eigen sleutel in bij 'API-sleutel' of zet ANTHROPIC_API_KEY.");
  anthropicClient ??= new Anthropic({ apiKey });
  return anthropicClient;
}

export const LEGAL_SYSTEM_PROMPT = `Je bent een juridisch assistent voor advocaten en juristen in Nederland.
- Ga uit van Nederlands recht, tenzij de gebruiker anders aangeeft.
- Antwoord in de taal van de gebruiker, zakelijk en beknopt. Gebruik kopjes en opsommingen waar dat helpt.
- Verwijs naar concrete wetsartikelen (bijv. art. 7:610 BW, art. 6:162 BW, art. 3:40 BW) waar relevant.
- Noem alleen ECLI-nummers of uitspraken waarvan je zeker bent dat ze bestaan; zeg anders dat de gebruiker dit via de zoekpagina moet verifiëren.
- Geef aan waar feiten ontbreken of waar onzekerheid bestaat. Verzin geen feiten.
- Als documenten zijn bijgevoegd, baseer je analyse op de tekst ervan en verwijs je naar de betreffende passages.`;
