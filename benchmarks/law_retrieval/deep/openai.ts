/**
 * Minimal OpenAI Responses API adapter for deep search (no SDK, plain fetch). It takes the Anthropic-style params that
 * call() in search.ts builds and returns an Anthropic-shaped message (text and tool_use blocks, usage, stop_reason), so
 * the pipeline runs unchanged. The raw output items are kept in an extra "openai_items" block and replayed on the next
 * turn, so reasoning carries over between turns of the search loop.
 */
const API = "https://api.openai.com/v1/responses";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
  return body;
}

export async function openaiMessage(params: Record<string, any>, model: string, effort: string) {
  const input: any[] = [];
  for (const m of params.messages) {
    if (typeof m.content === "string") {
      input.push({ role: m.role, content: m.content });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "openai_items") input.push(...b.items);
      else if (b.type === "tool_result") input.push({ type: "function_call_output", call_id: b.tool_use_id, output: String(b.content) });
      else if (b.type === "text" && m.role === "user") input.push({ role: "user", content: b.text });
    }
  }
  const format = params.output_config?.format;
  // Background mode plus polling: long reasoning calls would otherwise hit fetch's header timeout.
  let res = await api("", {
    method: "POST",
    body: JSON.stringify({
      model,
      instructions: params.system,
      input,
      max_output_tokens: params.max_tokens,
      reasoning: { effort },
      background: true,
      ...(params.tools && { tools: params.tools.map((t: any) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema, strict: false })) }),
      ...(format && { text: { format: { type: "json_schema", name: "output", schema: format.schema, strict: true } } }),
    }),
  });
  while (res.status === "queued" || res.status === "in_progress") {
    await new Promise((r) => setTimeout(r, 2000));
    res = await api(`/${res.id}`);
  }
  if (res.status === "failed") throw new Error(`OpenAI response failed: ${res.error?.message ?? res.id}`);

  const content: any[] = [{ type: "openai_items", items: res.output }];
  for (const item of res.output) {
    if (item.type === "message")
      for (const c of item.content) if (c.type === "output_text") content.push({ type: "text", text: c.text });
    if (item.type === "function_call") content.push({ type: "tool_use", id: item.call_id, name: item.name, input: JSON.parse(item.arguments || "{}") });
  }
  const reason = res.incomplete_details?.reason;
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    content,
    stop_reason: reason === "max_output_tokens" ? "max_tokens" : reason === "content_filter" ? "refusal" : content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    usage: { input_tokens: (res.usage?.input_tokens ?? 0) - cached, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: res.usage?.output_tokens ?? 0 },
  };
}
