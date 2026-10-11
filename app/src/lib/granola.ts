// Granola via its MCP server (https://docs.granola.ai/help-center/sharing/integrations/mcp).
// Login is OAuth in the browser (dynamic client registration, PKCE): no API key needed.
// Recording happens in the Granola desktop/mobile app; this only reads finished notes.
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { db } from "@/lib/db";

const SERVER = new URL("https://mcp.granola.ai/mcp");
export const APP_URL = process.env.APP_URL || "http://localhost:3000";

export class NotConnectedError extends Error {
  constructor() {
    super("Niet verbonden met Granola.");
  }
}

// One Granola login for the whole app (no auth in this MVP), stored as key/value rows.
async function load<T>(key: string): Promise<T | undefined> {
  const { rows } = await (await db()).query(`SELECT value FROM granola_auth WHERE key = $1`, [key]);
  return rows[0]?.value;
}
async function save(key: string, value: unknown) {
  await (await db()).query(
    `INSERT INTO granola_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, JSON.stringify(value)],
  );
}
async function remove(...keys: string[]) {
  await (await db()).query(`DELETE FROM granola_auth WHERE key = ANY($1)`, [keys]);
}

class DbOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  get redirectUrl() {
    return `${APP_URL}/api/granola/callback`;
  }
  get clientMetadata() {
    return {
      client_name: "Loopjongen",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  async state() {
    const state = randomBytes(16).toString("hex");
    await save("state", state);
    return state;
  }
  clientInformation() {
    return load<OAuthClientInformationMixed>("client");
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    return save("client", info);
  }
  tokens() {
    return load<OAuthTokens>("tokens");
  }
  saveTokens(tokens: OAuthTokens) {
    return save("tokens", tokens);
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    return save("verifier", verifier);
  }
  async codeVerifier() {
    const v = await load<string>("verifier");
    if (!v) throw new Error("Inlogsessie verlopen; verbind opnieuw.");
    return v;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") await remove("client", "tokens", "verifier");
    else if (scope !== "discovery") await remove(scope);
  }
}

/** Start the browser login. Returns the Granola login URL, or null when already connected. */
export async function startLogin(): Promise<URL | null> {
  const provider = new DbOAuthProvider();
  const result = await auth(provider, { serverUrl: SERVER });
  return result === "REDIRECT" ? provider.authorizationUrl! : null;
}

/** Finish the login with the code Granola sends back to /api/granola/callback. */
export async function finishLogin(code: string, state: string | null) {
  const expected = await load<string>("state");
  if (!expected || state !== expected) throw new Error("Ongeldige inlogstatus; probeer opnieuw te verbinden.");
  await remove("state");
  await auth(new DbOAuthProvider(), { serverUrl: SERVER, authorizationCode: code });
  await remove("verifier");
}

export async function logout() {
  await remove("client", "tokens", "verifier", "state");
}

/** Run fn with a connected MCP client; throws NotConnectedError when a (new) login is needed. */
export async function withGranola<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  if (!(await load("tokens"))) throw new NotConnectedError();
  const client = new Client({ name: "loopjongen", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(SERVER, { authProvider: new DbOAuthProvider() }));
    return await fn(client);
  } catch (err) {
    if (err instanceof UnauthorizedError) throw new NotConnectedError();
    throw err;
  } finally {
    await client.close().catch(() => {});
  }
}

/** Text content of a tool result (Granola tools return text). */
export async function callText(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (res.isError) throw new Error(text || `Granola-tool ${name} mislukt`);
  return text;
}

// Granola tools return a data preamble followed by XML-like <meetings_data> (or JSON for transcripts).
const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "");
const section = (body: string, name: string) => decode(body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();

export type GranolaMeeting = { id: string; title: string; date: string; participants: string; body: string };

export function parseMeetings(text: string): GranolaMeeting[] {
  return [...text.matchAll(/<meeting (.*?)>([\s\S]*?)<\/meeting>/g)].map(([, tag, body]) => ({
    id: attr(tag, "id"),
    title: attr(tag, "title") || "Zonder titel",
    date: attr(tag, "date"),
    participants: section(body, "known_participants"),
    body,
  }));
}

/** Notes (private notes + AI summary) and, when the plan allows it, the transcript, as one Markdown document. */
export async function exportMeeting(client: Client, id: string) {
  const [m] = parseMeetings(await callText(client, "get_meetings", { meeting_ids: [id] }));
  if (!m) throw new Error("Opname niet gevonden in Granola.");
  // ponytail: transcripts are paid-plan only; on free plans the export just has the notes.
  const transcript = await callText(client, "get_meeting_transcript", { meeting_id: id })
    .then((t) => (JSON.parse(t.slice(t.indexOf("{"))).transcript as string) ?? "")
    .catch(() => "");
  const parts = [
    `# ${m.title}`,
    `Datum: ${m.date}`,
    m.participants && `Deelnemers:\n${m.participants}`,
    section(m.body, "private_notes") && `## Eigen notities\n\n${section(m.body, "private_notes")}`,
    section(m.body, "summary") && `## Samenvatting\n\n${section(m.body, "summary").replace(/^#/gm, "###")}`,
    transcript && `## Transcript\n\n${transcript}`,
  ];
  return { title: m.title, markdown: parts.filter(Boolean).join("\n\n") + "\n" };
}
