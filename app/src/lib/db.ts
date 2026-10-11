import { Pool } from "pg";

const globalForDb = globalThis as unknown as { pool?: Pool; schemaReady?: Promise<void> };

export const pool =
  globalForDb.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://legal:legal@localhost:5432/legal" });
globalForDb.pool = pool;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL,
  text text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'upload',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Granola note id for imported meetings; unique so a re-import updates the same document.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS external_id text UNIQUE;
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Nieuw gesprek',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Per-chat Claude model and effort; NULL = server default (ANTHROPIC_MODEL, DEFAULT_EFFORT).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS model text, ADD COLUMN IF NOT EXISTS effort text;
-- Per-chat law search before each answer (a | b | c, lib/models LAW_SEARCHES); NULL = DEFAULT_LAW_SEARCH.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS law_search text;
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
CREATE TABLE IF NOT EXISTS conversation_documents (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, document_id)
);
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Extra customer details from the "Klant toevoegen" form.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS kvk text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
-- Customer whose data is chat context (details, linked documents and messages); NULL = none.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
-- Granola MCP login (OAuth client, tokens, PKCE verifier, state) as key/value rows.
CREATE TABLE IF NOT EXISTS granola_auth (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
-- Chat messages linked to a customer: references only, the content stays in messages.
CREATE TABLE IF NOT EXISTS customer_messages (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, message_id)
);
-- Documents linked to a customer (from /documenten).
CREATE TABLE IF NOT EXISTS customer_documents (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, document_id)
);
-- In-app feedback (blue dot); snapshot = page content, console log and the open chat/document at submit time.
CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  page text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Law articles and rulings saved on /zoeken; external_id (wet:… / ecli:…) makes re-saving update the same row.
CREATE TABLE IF NOT EXISTS saved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  title text NOT NULL,
  text text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- App settings from /instellingen, one JSON value per key (template_clauses: { templateId: { clauseKey: text } }).
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
-- Saved drafts on /genereren: form values plus manual/AI edits (override), optionally linked to a customer.
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  template_id text NOT NULL,
  title text NOT NULL,
  field_values jsonb NOT NULL,
  override text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function db() {
  globalForDb.schemaReady ??= pool.query(SCHEMA).then(() => undefined);
  try {
    await globalForDb.schemaReady;
  } catch (err) {
    globalForDb.schemaReady = undefined;
    throw err;
  }
  return pool;
}

export const NEW_CHAT_TITLE = "Nieuw gesprek";

/**
 * First free chat title, like a file manager: "Titel", "Titel (2)", "Titel (3)", ...
 * exceptId: the chat being renamed, so it doesn't clash with itself.
 * ponytail: no lock, two chats created at the same moment can still get the same title.
 */
export async function uniqueTitle(pool: Pool, title: string, exceptId?: string) {
  const base = title.replace(/ \(\d+\)$/, "");
  const { rows } = await pool.query(`SELECT title FROM conversations WHERE left(title, length($1)) = $1 AND id IS DISTINCT FROM $2::uuid`, [
    base,
    exceptId ?? null,
  ]);
  const taken = new Set(rows.map((r: { title: string }) => r.title));
  if (!taken.has(title)) return title;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
