// Shared by the chat UI and the messages route; the route only accepts these ids.
export const CHAT_MODELS = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 (meest capabel)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (snelst)" },
] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = "low";

/** Validated model/effort from untrusted input; undefined = not given or not allowed. */
export const pickModel = (v: unknown) => CHAT_MODELS.find((m) => m.id === v)?.id;
export const pickEffort = (v: unknown) => EFFORTS.find((e) => e === v);

/** Haiku 4.5 rejects output_config.effort and the server-side fallback beta. */
export const supportsEffort = (model: string) => model !== "claude-haiku-4-5";

// How the chat looks up law articles before each answer (lib/lawsearch, compared in benchmarks/law_retrieval).
export const LAW_SEARCHES = [
  { id: "b", label: "B · volledige tekst" },
  { id: "a", label: "A · live zoeken" },
  { id: "c", label: "C · titelcatalogus" },
] as const;
export type LawSearch = (typeof LAW_SEARCHES)[number]["id"];
export const DEFAULT_LAW_SEARCH: LawSearch = "b";
export const pickLawSearch = (v: unknown) => LAW_SEARCHES.find((s) => s.id === v)?.id;
