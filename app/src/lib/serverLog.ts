/** In-memory ring buffer of server console output and request errors, attached to feedback. */
export type ServerLogEntry = { at: string; level: string; text: string };

// On globalThis: instrumentation.ts and route handlers can be separate module instances.
const g = globalThis as unknown as { serverLogs?: ServerLogEntry[] };
export const serverLogs = (g.serverLogs ??= []);

// ponytail: in-memory, per process, lost on restart; persist to a table if older logs are needed.
export function pushServerLog(level: string, args: unknown[]) {
  const text = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : safeJson(a)))
    .join(" ")
    // Never keep API keys that end up in an error message.
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…");
  serverLogs.push({ at: new Date().toISOString(), level, text: text.slice(0, 4000) });
  if (serverLogs.length > 300) serverLogs.shift();
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
