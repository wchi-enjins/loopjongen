/** Read a streamed text response, calling onText with the accumulated text. */
export async function readStream(res: Response, onText: (text: string) => void): Promise<string> {
  if (!res.body) throw new Error("Geen antwoord ontvangen");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return text;
}
