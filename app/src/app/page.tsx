"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Chevron from "@/components/chevron";
import useDialog from "@/components/dialog";
import Markdown from "@/components/markdown";
import { readStream } from "@/lib/stream";
import { ANALYSIS_PROMPTS } from "@/lib/prompts";
import { CHAT_MODELS, DEFAULT_EFFORT, DEFAULT_LAW_SEARCH, EFFORTS, LAW_SEARCHES, pickEffort, pickLawSearch, pickModel, supportsEffort, type Effort, type LawSearch } from "@/lib/models";

type Conv = { id: string; title: string; updated_at: string; document_count: number };
type Msg = { id?: string; role: "user" | "assistant"; content: string };
type DocRef = { id: string; filename: string };
/** model/effort/law_search: this chat's choice; null = server default. */
type Detail = { id: string; title: string; model?: string | null; effort?: string | null; law_search?: string | null; customer_id?: string | null; messages: Msg[]; documents: DocRef[] };

// id = localStorage key; "anthropic-api-key" is also read by components/generator.tsx.
const KEYS = [
  { id: "anthropic-api-key", label: "Claude: AI-chat, documentanalyses en Genereren", href: "https://platform.claude.com/settings/keys", placeholder: "sk-ant-…" },
];

export default function ChatPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [current, setCurrent] = useState<Detail | null>(null);
  const [allDocs, setAllDocs] = useState<DocRef[]>([]);
  const [showDocs, setShowDocs] = useState(false);
  const [showList, setShowList] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const { dialog, confirm, prompt } = useDialog();
  const [model, setModel] = useState<string>("claude-opus-5-5");
  const [effort, setEffort] = useState<Effort>(DEFAULT_EFFORT);
  const [lawSearch, setLawSearch] = useState<LawSearch>(DEFAULT_LAW_SEARCH);
  // model/effort: the default for new chats (last pick, from localStorage). newChoice stays empty until
  // the user picks one, so new chats keep the server default (ANTHROPIC_MODEL) until then.
  const newChoice = useRef<{ model?: string; effort?: Effort; lawSearch?: LawSearch }>({});
  // Ref so send() always sees the current key without being recreated.
  const keysRef = useRef<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setNotice(null);
  }, [current?.id]);

  async function toggleSelecting() {
    setSelecting((s) => !s);
    setSelected(new Set());
    setNotice(null);
    const res = await fetch("/api/customers");
    if (res.ok) setCustomers(await res.json());
  }

  function toggleMessage(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function addToCustomer() {
    const res = await fetch(`/api/customers/${customerId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: [...selected] }),
    });
    if (!res.ok) return setError((await res.json()).error ?? "Toevoegen mislukt");
    const name = customers.find((c) => c.id === customerId)?.name;
    setNotice(`${selected.size} bericht(en) gekoppeld aan ${name}.`);
    setSelected(new Set());
  }

  function saveKey(id: string, k: string) {
    keysRef.current = { ...keysRef.current, [id]: k.trim() };
    setKeys((s) => ({ ...s, [id]: k }));
    try {
      if (k.trim()) localStorage.setItem(id, k.trim());
      else localStorage.removeItem(id);
    } catch {}
  }

  // Shown in the selector: the open chat's own choice, or the default for a new chat.
  const shownModel = current ? (pickModel(current.model) ?? "claude-opus-5-5") : model;
  const shownEffort = current ? (pickEffort(current.effort) ?? DEFAULT_EFFORT) : effort;
  const shownLawSearch = current ? (pickLawSearch(current.law_search) ?? DEFAULT_LAW_SEARCH) : lawSearch;

  function saveModel(m: string, e: Effort) {
    newChoice.current = { ...newChoice.current, model: m, effort: e };
    setModel(m);
    setEffort(e);
    if (current) {
      setCurrent({ ...current, model: m, effort: e });
      fetch(`/api/conversations/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, effort: e }),
      });
    }
    try {
      localStorage.setItem("chat-model", m);
      localStorage.setItem("chat-effort", e);
    } catch {}
  }

  function saveLawSearch(l: LawSearch) {
    newChoice.current = { ...newChoice.current, lawSearch: l };
    setLawSearch(l);
    if (current) {
      setCurrent({ ...current, law_search: l });
      fetch(`/api/conversations/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lawSearch: l }),
      });
    }
    try {
      localStorage.setItem("chat-law-search", l);
    } catch {}
  }

  // Declared before the effect below so the key is loaded before an auto-started analysis.
  useEffect(() => {
    try {
      for (const k of KEYS) keysRef.current[k.id] = localStorage.getItem(k.id) ?? "";
      setKeys({ ...keysRef.current });
      const m = CHAT_MODELS.find((x) => x.id === localStorage.getItem("chat-model"))?.id;
      const e = EFFORTS.find((x) => x === localStorage.getItem("chat-effort"));
      if (m) setModel(m);
      if (e) setEffort(e);
      if (m && e) newChoice.current = { model: m, effort: e };
      const l = pickLawSearch(localStorage.getItem("chat-law-search"));
      if (l) {
        setLawSearch(l);
        newChoice.current = { ...newChoice.current, lawSearch: l };
      }
    } catch {}
  }, []);

  const loadConvs = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConvs(await res.json());
  }, []);

  const open = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return setError("Gesprek kon niet worden geladen.");
    setCurrent(await res.json());
    setError(null);
    window.history.replaceState(null, "", `/?c=${id}`);
  }, []);

  const send = useCallback(
    async (text: string, conv: Detail) => {
      if (!text.trim()) return;
      setBusy(true);
      setError(null);
      setInput("");
      setCurrent({ ...conv, messages: [...conv.messages, { role: "user", content: text }] });
      setStreaming("");
      try {
        const res = await fetch(`/api/conversations/${conv.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(keysRef.current["anthropic-api-key"] ? { "x-anthropic-key": keysRef.current["anthropic-api-key"] } : {}) },
          body: JSON.stringify({ content: text }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Verzenden mislukt");
        await readStream(res, setStreaming);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verzenden mislukt");
      } finally {
        setStreaming(null);
        setBusy(false);
        await open(conv.id);
        loadConvs();
      }
    },
    [open, loadConvs],
  );

  useEffect(() => {
    loadConvs();
    fetch("/api/documents")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAllDocs);
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCustomers);
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (!c) return;
    fetch(`/api/conversations/${c}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Detail | null) => {
        if (!d) return;
        setCurrent(d);
        const analyse = params.get("analyse");
        const preset = ANALYSIS_PROMPTS.find((p) => p.label === analyse);
        if (preset && d.messages.length === 0 && !autoStarted.current) {
          autoStarted.current = true;
          window.history.replaceState(null, "", `/?c=${c}`);
          send(preset.prompt, d);
        }
      });
  }, [loadConvs, send]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [current?.messages.length, streaming]);

  async function newConv(): Promise<Detail> {
    const res = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newChoice.current) });
    const c = await res.json();
    const detail: Detail = { id: c.id, title: c.title, model: c.model, effort: c.effort, law_search: c.law_search, messages: [], documents: [] };
    setCurrent(detail);
    window.history.replaceState(null, "", `/?c=${c.id}`);
    loadConvs();
    return detail;
  }

  async function submit() {
    if (!input.trim() || busy) return;
    const conv = current ?? (await newConv());
    send(input, conv);
  }

  async function remove(id: string) {
    // Warn when messages from this chat are linked to customers: deleting the chat removes those links.
    const res = await fetch(`/api/conversations/${id}`);
    const linked: { name: string; count: number }[] = res.ok ? ((await res.json()).linkedCustomers ?? []) : [];
    const message = (
      <>
        Gesprek verwijderen?
        {linked.length > 0 && (
          <>
            {" "}Dit gesprek bevat{" "}
            {linked.map((l, i) => (
              <span key={l.name}>
                {i > 0 && ", "}
                {l.count} bericht{l.count === 1 ? "" : "en"} gekoppeld aan <strong>{l.name}</strong>
              </span>
            ))}
            . Die koppeling{linked.length === 1 && linked[0].count === 1 ? " verdwijnt" : "en verdwijnen"} ook.
          </>
        )}
      </>
    );
    if (!(await confirm(message, "Verwijderen"))) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (current?.id === id) {
      setCurrent(null);
      window.history.replaceState(null, "", "/");
    }
    loadConvs();
  }

  async function rename(c: Conv) {
    const wanted = (await prompt("Nieuwe titel", c.title))?.trim();
    if (!wanted || wanted === c.title) return;
    const res = await fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: wanted }),
    });
    // The server adds " (2)" etc. when the title is already taken.
    const { title } = (await res.json()) as { title: string };
    if (current?.id === c.id) setCurrent({ ...current, title });
    loadConvs();
  }

  /** Customer whose details, documents and linked messages the AI gets as context in this chat. */
  async function setChatCustomer(customerId: string) {
    const conv = current ?? (await newConv());
    setCurrent({ ...conv, customer_id: customerId || null });
    await fetch(`/api/conversations/${conv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customerId || null }),
    });
  }

  async function toggleDoc(doc: DocRef) {
    const conv = current ?? (await newConv());
    const has = conv.documents.some((d) => d.id === doc.id);
    const documents = has ? conv.documents.filter((d) => d.id !== doc.id) : [...conv.documents, doc];
    setCurrent({ ...conv, documents });
    await fetch(`/api/conversations/${conv.id}/documents`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: documents.map((d) => d.id) }),
    });
    loadConvs();
  }

  return (
    <div className="split">
      <aside className="stack">
        <div className="row">
          <button className="primary grow" onClick={() => { newConv(); setShowList(false); }}>
            + Nieuw gesprek
          </button>
          <button className="mobile-only" onClick={() => setShowList((s) => !s)}>
            Gesprekken ({convs.length})<Chevron open={showList} />
          </button>
        </div>
        <div className={`box conv-panel ${showList ? "open" : ""}`} style={{ padding: 0, maxHeight: "calc(100dvh - 150px)", overflowY: "auto" }}>
          {convs.length === 0 && <p className="muted" style={{ padding: 8, margin: 0 }}>Nog geen gesprekken.</p>}
          <ul className="list conv-list">
            {convs.map((c) => (
              <li key={c.id} className={current?.id === c.id ? "active" : ""}>
                <button className="item" onClick={() => { open(c.id); setShowList(false); }} title={c.title}>
                  {c.title}
                  {c.document_count > 0 && ` (${c.document_count} doc.)`}
                </button>
                <button className="link" style={{ padding: "0 4px" }} onClick={() => rename(c)} aria-label="Hernoemen" title="Hernoemen">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M11 2l3 3-8 8H3v-3z" />
                  </svg>
                </button>
                <button className="link" style={{ padding: "0 8px" }} onClick={() => remove(c.id)} aria-label="Verwijderen">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M3 3l10 10M13 3L3 13" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="chat">
        <div className="chat-bar">
          <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.title ?? "Nieuw gesprek"}
          </strong>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => setShowModel((s) => !s)}>
              {CHAT_MODELS.find((m) => m.id === shownModel)?.label.replace(/^Claude | \(.*\)$/g, "")}
              {supportsEffort(shownModel) && ` · ${shownEffort}`}<Chevron open={showModel} />
            </button>
            <select
              style={{ width: "auto" }}
              aria-label="Wetgeving zoeken"
              title="Hoe de AI vóór elk antwoord de relevante wetsartikelen opzoekt (B: volledige tekst, standaard)"
              value={shownLawSearch}
              onChange={(e) => saveLawSearch(e.target.value as LawSearch)}
              disabled={busy}
            >
              {LAW_SEARCHES.map((l) => (
                <option key={l.id} value={l.id}>
                  Wetgeving: {l.label}
                </option>
              ))}
            </select>
            <button onClick={() => setShowKey((s) => !s)}>
              API-sleutels{KEYS.some((k) => keys[k.id]?.trim()) ? " ✓" : ""}<Chevron open={showKey} />
            </button>
            <button onClick={() => setShowDocs((s) => !s)}>
              Documenten ({current?.documents.length ?? 0})<Chevron open={showDocs} />
            </button>
            {customers.length > 0 && (
              <select
                style={{ width: "auto", maxWidth: 200 }}
                aria-label="Klant als context"
                title="Klantgegevens, gekoppelde documenten en berichten als context voor de AI"
                value={current?.customer_id ?? ""}
                onChange={(e) => setChatCustomer(e.target.value)}
                disabled={busy}
              >
                <option value="">Geen klant</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    Klant: {c.name}
                  </option>
                ))}
              </select>
            )}
            {!!current?.messages.length && (
              <button className={selecting ? "primary" : ""} onClick={toggleSelecting} disabled={busy}>
                {selecting ? "Klaar" : "Selecteren"}
              </button>
            )}
          </div>
          {showModel && (
            <div className="row" style={{ marginTop: 8, fontSize: 14 }}>
              <label className="row" style={{ margin: 0 }}>
                Model
                <select style={{ width: "auto" }} value={shownModel} onChange={(e) => saveModel(e.target.value, shownEffort)}>
                  {CHAT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row" style={{ margin: 0 }}>
                Effort
                <select style={{ width: "auto" }} value={shownEffort} disabled={!supportsEffort(shownModel)} onChange={(e) => saveModel(shownModel, e.target.value as Effort)}>
                  {EFFORTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {showKey && (
            <div style={{ marginTop: 8, fontSize: 14 }}>
              <p className="muted">
                Gebruik uw eigen API-sleutels; het gebruik wordt dan op uw eigen account gefactureerd. Uw sleutels worden
                niet op onze systemen opgeslagen, alleen bij u.
              </p>
              {KEYS.map((k) => (
                <div key={k.id} style={{ marginBottom: 8 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="grow">{k.label}</span>
                    <a href={k.href} target="_blank" rel="noreferrer">
                      Sleutel aanmaken ↗
                    </a>
                  </div>
                  <div className="row">
                    <input
                      className="grow"
                      type="password"
                      autoComplete="off"
                      placeholder={k.placeholder}
                      aria-label={`Eigen API-sleutel ${k.label}`}
                      value={keys[k.id] ?? ""}
                      onChange={(e) => saveKey(k.id, e.target.value)}
                    />
                    <button onClick={() => saveKey(k.id, "")} disabled={!keys[k.id]}>
                      Wissen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {current && current.documents.length > 0 && !showDocs && (
            <div style={{ marginTop: 6 }}>
              {current.documents.map((d) => (
                <span key={d.id} className="tag">
                  {d.filename}
                </span>
              ))}
            </div>
          )}
          {showDocs && (
            <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
              {allDocs.length === 0 && (
                <p className="muted">
                  Geen documenten. Upload eerst via <a href="/documenten">Documenten</a>.
                </p>
              )}
              {current && (
                <p style={{ margin: "0 0 6px", fontSize: 14 }}>
                  <a href={`/zoeken?gesprek=${current.id}`}>Wet of uitspraak zoeken en toevoegen →</a>
                </p>
              )}
              {allDocs.map((d) => (
                <label key={d.id} className="row" style={{ margin: 0, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={current?.documents.some((x) => x.id === d.id) ?? false}
                    onChange={() => toggleDoc(d)}
                  />
                  {d.filename}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className={`messages${selecting ? " selecting" : ""}`}>
          {!current?.messages.length && streaming === null && (
            <div className="muted">
              <p>Stel een vraag over Nederlands recht, of koppel documenten om deze te laten analyseren.</p>
              {current && current.documents.length > 0 && (
                <div className="row">
                  {ANALYSIS_PROMPTS.map((p) => (
                    <button key={p.label} onClick={() => send(p.prompt, current)} disabled={busy}>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {current?.messages.map((m, i) => (
            <div
              key={m.id ?? i}
              className={`msg ${m.role}${m.id && selected.has(m.id) ? " selected" : ""}`}
              onClick={selecting && m.id ? () => toggleMessage(m.id!) : undefined}
            >
              <div className="msg-role">
                {selecting && m.id && (
                  <input
                    type="checkbox"
                    style={{ width: "auto", margin: "0 6px 0 0", verticalAlign: "middle" }}
                    aria-label="Bericht selecteren"
                    checked={selected.has(m.id)}
                    onChange={() => toggleMessage(m.id!)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {m.role === "user" ? "U" : "AI"}
                {m.role === "assistant" && (
                  <button
                    className="link msg-copy"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(m.content).then(() => {
                        setCopied(i);
                        setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
                      });
                    }}
                  >
                    {copied === i ? "Gekopieerd" : "Kopiëren"}
                  </button>
                )}
              </div>
              <div className="msg-body">{m.role === "user" ? m.content : <Markdown>{m.content}</Markdown>}</div>
            </div>
          ))}
          {streaming !== null && (
            <div className="msg assistant">
              <div className="msg-role">AI</div>
              <div className="msg-body">{streaming ? <Markdown>{streaming}</Markdown> : <span className="muted">Bezig…</span>}</div>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div ref={bottom} />
        </div>

        {selecting && (
          <div className="select-bar row">
            <span className="grow">
              {notice ?? `${selected.size} bericht(en) geselecteerd. Klik op berichten om ze te selecteren.`}
            </span>
            {customers.length === 0 ? (
              <span className="muted">
                Nog geen klanten; maak er een aan via <a href="/klanten">Klanten</a>.
              </span>
            ) : (
              <>
                <select style={{ width: "auto", maxWidth: 240 }} value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Klant">
                  <option value="">Kies klant…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="primary" onClick={addToCustomer} disabled={!selected.size || !customerId}>
                  Toevoegen aan klant
                </button>
              </>
            )}
          </div>
        )}

        <div className="composer">
          <textarea
            className="grow"
            rows={2}
            placeholder="Typ uw vraag. Enter = versturen, Shift+Enter = nieuwe regel."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // isComposing: Enter that confirms an IME/dead-key composition shouldn't send.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className="primary" onClick={submit} disabled={busy || !input.trim()}>
            Verstuur
          </button>
        </div>
      </section>
      {dialog}
    </div>
  );
}
