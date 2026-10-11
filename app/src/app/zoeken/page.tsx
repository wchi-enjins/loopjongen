"use client";

import { useEffect, useMemo, useState } from "react";
import useDialog from "@/components/Dialog";

type LawHit = { id: string; title: string; type: string; authority: string; areas: string[]; validFrom: string; url: string };
type LawItem =
  | { kind: "heading"; level: number; text: string }
  | { kind: "article"; label: string; title: string; text: string; url: string };
type Law = { id: string; title: string; validFrom: string; url: string; items: LawItem[] };
type RulingHit = {
  ecli: string;
  title: string;
  summary: string;
  decided: string;
  published: string;
  type: string;
  areas: string[];
  procedures: string[];
  references: string[];
  url: string;
};
type Ruling = {
  ecli: string;
  court: string;
  decided: string;
  published: string;
  caseNumbers: string[];
  type: string;
  procedures: string[];
  areas: string[];
  summary: string;
  body: string;
  url: string;
  sourceUrl: string;
};

type Mode = "wetten" | "rechtspraak" | "saved";
type Conv = { id: string; title: string };
/** A law or ruling text saved as a chat document; externalId makes re-adding update the same document. */
type ChatDoc = { filename: string; text: string; externalId: string; source: "wetgeving" | "rechtspraak" };
type AddFn = (doc: ChatDoc) => void;
type Saved = { id: string; external_id: string; title: string; text: string; source: ChatDoc["source"]; created_at: string };
/** Save button; shows a check when externalId is already saved. */
type SaveProps = { onSave: AddFn; savedIds: Set<string> };

const MAX_CHAT_DOC_CHARS = 120_000; // chat context budget, see api/conversations/[id]/messages

const articleText = (a: Extract<LawItem, { kind: "article" }>) =>
  `${a.label}${a.title ? ` – ${a.title}` : ""}\nBron: ${a.url}\n\n${a.text}`;

function AddButton({ onClick, label = "+ Aan chat toevoegen" }: { onClick: () => void; label?: string }) {
  return (
    <button className="link" style={{ fontSize: 13 }} onClick={onClick}>
      {label}
    </button>
  );
}

function SaveButton({ doc, onSave, savedIds }: SaveProps & { doc: ChatDoc }) {
  return savedIds.has(doc.externalId) ? (
    <span className="muted" style={{ fontSize: 13 }}>✓ Opgeslagen</span>
  ) : (
    <AddButton onClick={() => onSave(doc)} label="Opslaan" />
  );
}
const ECLI = /^ECLI:[A-Z]{2}:[A-Z0-9]{1,7}:\d{4}:[A-Z0-9.]{1,25}$/i;

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / 20);
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>← Vorige</button>
      <span>
        Pagina {page} van {pages.toLocaleString("nl-NL")}
      </span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Volgende →</button>
    </div>
  );
}

function LawView({ law, onBack, onAdd, onSave, savedIds }: { law: Law; onBack: () => void; onAdd: AddFn } & SaveProps) {
  const [q, setQ] = useState("");
  const { dialog, confirm } = useDialog();
  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return law.items;
    const nr = term.replace(/^(art\.?|artikel)\s*/, "");
    return law.items.filter(
      (i) => i.kind === "article" && (i.label.toLowerCase() === `artikel ${nr}` || i.text.toLowerCase().includes(term) || i.title.toLowerCase().includes(term)),
    );
  }, [law, q]);
  const count = law.items.filter((i) => i.kind === "article").length;
  const header = `${law.title} (${law.id}), geldend vanaf ${law.validFrom}`;

  const articles = items.filter((i) => i.kind === "article");
  const term = q.trim();
  const visibleDoc: ChatDoc = {
    filename: term ? `${law.title} – selectie '${term}' (${articles.length} art.)` : law.title,
    text: `${header}\n${law.url}\n\n${articles.map((a) => articleText(a)).join("\n\n")}`,
    externalId: term ? `wet:${law.id}:zoek:${term.toLowerCase()}` : `wet:${law.id}`,
    source: "wetgeving",
  };
  const articleDoc = (i: Extract<LawItem, { kind: "article" }>): ChatDoc => ({
    filename: `${law.title} – ${i.label}`,
    text: `${header}\n\n${articleText(i)}`,
    externalId: `wet:${law.id}:${i.label}`,
    source: "wetgeving",
  });

  async function addVisible() {
    const { length } = visibleDoc.text;
    if (
      length > MAX_CHAT_DOC_CHARS &&
      !(await confirm(`Deze tekst is ${length.toLocaleString("nl-NL")} tekens; de chat gebruikt maximaal ${MAX_CHAT_DOC_CHARS.toLocaleString("nl-NL")} tekens aan documenten en kort de rest in. Zoek eventueel eerst op artikelnummer. Toch toevoegen?`, "Toevoegen"))
    )
      return;
    onAdd(visibleDoc);
  }

  return (
    <div>
      <button onClick={onBack}>← Terug naar resultaten</button>
      <h2>{law.title}</h2>
      <p className="muted">
        {law.id} · geldend vanaf {law.validFrom} · {count} artikelen ·{" "}
        <a href={law.url} target="_blank" rel="noreferrer">
          wetten.overheid.nl ↗
        </a>{" "}
        · <AddButton onClick={addVisible} label={term ? `+ ${articles.length} gevonden artikel(en) aan chat toevoegen` : "+ Hele regeling aan chat toevoegen"} />{" "}
        · <SaveButton doc={visibleDoc} onSave={onSave} savedIds={savedIds} />
      </p>
      <input placeholder="Zoek in deze regeling: artikelnummer (bijv. 652) of tekst" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && <p className="muted">{items.length} artikel(en) gevonden.</p>}
      <div>
        {items.map((i, idx) =>
          i.kind === "heading" ? (
            <div key={idx} className={`law-h${i.level}`} style={{ fontWeight: 700, marginTop: 16 }}>
              {i.text}
            </div>
          ) : (
            <div key={idx} className="article">
              <div className="row">
                <strong className="grow">
                  {i.label}
                  {i.title && ` – ${i.title}`}
                </strong>
                <AddButton onClick={() => onAdd(articleDoc(i))} />
                <SaveButton doc={articleDoc(i)} onSave={onSave} savedIds={savedIds} />
                <a href={i.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  bron ↗
                </a>
              </div>
              <div className="pre">{i.text}</div>
            </div>
          ),
        )}
      </div>
      {dialog}
    </div>
  );
}

function RulingView({ r, onBack, onAdd, onSave, savedIds }: { r: Ruling; onBack: () => void; onAdd: AddFn } & SaveProps) {
  const meta: [string, string][] = [
    ["Instantie", r.court],
    ["Datum uitspraak", r.decided],
    ["Datum publicatie", r.published],
    ["Zaaknummer", r.caseNumbers.join(", ")],
    ["Soort", r.type],
    ["Procedure", r.procedures.join(", ")],
    ["Rechtsgebied", r.areas.join(", ")],
  ];
  const doc: ChatDoc = {
      filename: `${r.ecli}${r.court ? ` (${r.court})` : ""}`,
      text: [
        r.ecli,
        ...meta.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
        `Bron: ${r.url}`,
        r.summary && `Inhoudsindicatie:\n${r.summary}`,
        `${r.type || "Tekst"}:\n${r.body || "Geen volledige tekst beschikbaar."}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      externalId: `ecli:${r.ecli}`,
      source: "rechtspraak",
  };
  return (
    <div>
      <button onClick={onBack}>← Terug naar resultaten</button>
      <h2>{r.ecli}</h2>
      <table className="md" style={{ fontSize: 14 }}>
        <tbody>
          {meta
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <tr key={k}>
                <th style={{ textAlign: "left", paddingRight: 12, verticalAlign: "top" }}>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p>
        <a href={r.url} target="_blank" rel="noreferrer">
          uitspraken.rechtspraak.nl ↗
        </a>{" "}
        ·{" "}
        <a href={r.sourceUrl} target="_blank" rel="noreferrer">
          open data (XML) ↗
        </a>{" "}
        · <AddButton onClick={() => onAdd(doc)} label="+ Uitspraak aan chat toevoegen" />{" "}
        · <SaveButton doc={doc} onSave={onSave} savedIds={savedIds} />
      </p>
      {r.summary && (
        <div className="box" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Inhoudsindicatie</h3>
          <div className="pre">{r.summary}</div>
        </div>
      )}
      <h3>{r.type || "Tekst"}</h3>
      <div className="pre">{r.body || "Geen volledige tekst beschikbaar."}</div>
    </div>
  );
}

export default function SearchPage() {
  const [mode, setMode] = useState<Mode>("wetten");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"relevance" | "date">("relevance");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [laws, setLaws] = useState<{ total: number; hits: LawHit[] } | null>(null);
  const [rulings, setRulings] = useState<{ total: number; hits: RulingHit[] } | null>(null);
  const [law, setLaw] = useState<Law | null>(null);
  const [ruling, setRuling] = useState<Ruling | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [chatId, setChatId] = useState("new");
  const [added, setAdded] = useState<{ text: string; id: string } | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const savedIds = useMemo(() => new Set(saved.map((s) => s.external_id)), [saved]);

  async function save(doc: ChatDoc) {
    setError(null);
    const res = await fetch("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Opslaan mislukt");
    const item = (await res.json()) as Saved;
    setSaved((list) => [item, ...list.filter((s) => s.id !== item.id)]);
  }

  async function unsave(id: string) {
    await fetch(`/api/saved/${id}`, { method: "DELETE" });
    setSaved((list) => list.filter((s) => s.id !== id));
  }

  async function addToChat(doc: ChatDoc) {
    setError(null);
    setAdded(null);
    try {
      let id = chatId;
      if (id === "new") {
        const res = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) throw new Error("Gesprek aanmaken mislukt");
        const conv = (await res.json()) as Conv;
        id = conv.id;
        setConvs((c) => [conv, ...c]);
        setChatId(id);
      }
      const res = await fetch(`/api/conversations/${id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Toevoegen mislukt");
      const title = convs.find((c) => c.id === id)?.title ?? "Nieuw gesprek";
      setAdded({ text: `'${doc.filename}' is toegevoegd aan het gesprek '${title}'.`, id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toevoegen mislukt");
    }
  }

  async function get<T>(url: string): Promise<T | null> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ophalen mislukt");
      return data as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ophalen mislukt");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function openLaw(id: string) {
    const l = await get<Law>(`/api/wetten/${id}`);
    if (l) {
      setLaw(l);
      window.scrollTo(0, 0);
    }
  }

  async function openRuling(ecli: string) {
    const r = await get<Ruling>(`/api/rechtspraak/${encodeURIComponent(ecli)}`);
    if (r) {
      setRuling(r);
      window.scrollTo(0, 0);
    }
  }

  async function search(p = 1, m = mode, s = sort) {
    const term = q.trim();
    if (!term) return;
    setPage(p);
    setLaw(null);
    setRuling(null);
    if (m === "rechtspraak" && ECLI.test(term)) return openRuling(term.toUpperCase());
    if (m === "wetten") {
      setLaws(await get(`/api/wetten?q=${encodeURIComponent(term)}&page=${p}`));
    } else {
      setRulings(await get(`/api/rechtspraak?q=${encodeURIComponent(term)}&page=${p}&sort=${s}`));
    }
  }

  useEffect(() => {
    fetch("/api/saved")
      .then((r) => (r.ok ? r.json() : []))
      .then(setSaved);
    const params = new URLSearchParams(window.location.search);
    const m = params.get("bron");
    if (m === "rechtspraak" || m === "wetten") setMode(m);
    const wanted = params.get("gesprek"); // set by the chat's "Wet of uitspraak zoeken" link
    fetch("/api/conversations")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Conv[]) => {
        setConvs(list);
        const pick = list.find((c) => c.id === wanted) ?? list[0];
        if (pick) setChatId(pick.id);
      });
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Wetten & rechtspraak</h1>
        <p>
          Bronnen: geldende regelgeving via{" "}
          <a href="https://wetten.overheid.nl" target="_blank" rel="noreferrer">wetten.overheid.nl</a> (Basiswettenbestand, KOOP) en
          gepubliceerde uitspraken via{" "}
          <a href="https://www.rechtspraak.nl/Uitspraken" target="_blank" rel="noreferrer">rechtspraak.nl</a>.
        </p>
      </div>

      <div className="tabs">
        {(["wetten", "rechtspraak", "saved"] as Mode[]).map((m) => (
          <button
            key={m}
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              setLaw(null);
              setRuling(null);
              setError(null);
            }}
          >
            {m === "wetten" ? "Wet- en regelgeving" : m === "rechtspraak" ? "Jurisprudentie" : `Saved (${saved.length})`}
          </button>
        ))}
      </div>

      {!law && !ruling && mode !== "saved" && (
        <form
          className="row"
          style={{ marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            search(1);
          }}
        >
          <input
            className="grow"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              mode === "wetten"
                ? "Titel of afkorting, bijv. 'Arbeidstijdenwet', 'BW 7', 'Awb' of BWB-id 'BWBR0005290'"
                : "Zoektermen of ECLI-nummer, bijv. 'slapend dienstverband' of 'ECLI:NL:HR:2019:1734'"
            }
          />
          {mode === "rechtspraak" && (
            <select
              style={{ width: "auto" }}
              value={sort}
              onChange={(e) => {
                const s = e.target.value as "relevance" | "date";
                setSort(s);
                if (rulings) search(1, mode, s);
              }}
            >
              <option value="relevance">Relevantie</option>
              <option value="date">Datum uitspraak (nieuwste eerst)</option>
            </select>
          )}
          <button className="primary" type="submit" disabled={loading || !q.trim()}>
            {loading ? "Zoeken…" : "Zoeken"}
          </button>
        </form>
      )}

      {(law || ruling || mode === "saved") && (
        <div className="row" style={{ marginBottom: 12 }}>
          <label htmlFor="chat" style={{ margin: 0 }}>
            <strong>Toevoegen aan gesprek</strong>
          </label>
          <select id="chat" className="grow" style={{ maxWidth: 480 }} value={chatId} onChange={(e) => setChatId(e.target.value)}>
            <option value="new">+ Nieuw gesprek</option>
            {convs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {added && (
        <div className="notice" style={{ marginBottom: 12 }}>
          {added.text} <a href={`/?c=${added.id}`}>Naar het gesprek →</a>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {loading && (law || ruling) && <p className="muted">Laden…</p>}

      {law && <LawView law={law} onBack={() => setLaw(null)} onAdd={addToChat} onSave={save} savedIds={savedIds} />}
      {ruling && <RulingView r={ruling} onBack={() => setRuling(null)} onAdd={addToChat} onSave={save} savedIds={savedIds} />}

      {!law && !ruling && mode === "saved" && (
        <div className="box">
          {saved.length === 0 && <p className="muted">Nog niets opgeslagen. Gebruik &lsquo;Opslaan&rsquo; bij een artikel, regeling of uitspraak.</p>}
          {saved.map((s) => (
            <details key={s.id} className="hit">
              <summary className="row">
                <strong className="grow">{s.title}</strong>
                <span className="tag">{s.source === "rechtspraak" ? "Jurisprudentie" : "Wetgeving"}</span>
                {/* preventDefault: clicking these buttons should not open/close the item */}
                <span className="row" onClick={(e) => e.preventDefault()}>
                  <AddButton onClick={() => addToChat({ filename: s.title, text: s.text, externalId: s.external_id, source: s.source })} />
                  <button className="link" style={{ fontSize: 13 }} onClick={() => unsave(s.id)}>
                    Verwijderen
                  </button>
                </span>
              </summary>
              <div className="pre" style={{ marginTop: 8 }}>{s.text}</div>
            </details>
          ))}
        </div>
      )}

      {!law && !ruling && mode === "wetten" && laws && (
        <div className="box">
          <p className="muted">{laws.total.toLocaleString("nl-NL")} geldende regeling(en) gevonden op titel.</p>
          {laws.hits.map((h) => (
            <div key={h.id} className="hit">
              <div className="row">
                <button className="link hit-title grow" style={{ textAlign: "left" }} onClick={() => openLaw(h.id)}>
                  {h.title}
                </button>
                <a href={h.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  bron ↗
                </a>
              </div>
              <small className="muted">
                {h.id} · {h.type} · {h.authority} · geldend vanaf {h.validFrom}
              </small>
              <div>
                {h.areas.map((a) => (
                  <span key={a} className="tag">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <Pager page={page} total={laws.total} onPage={(p) => search(p)} />
        </div>
      )}

      {!law && !ruling && mode === "rechtspraak" && rulings && (
        <div className="box">
          <p className="muted">{rulings.total.toLocaleString("nl-NL")} uitspraak/uitspraken gevonden.</p>
          {rulings.hits.map((h) => (
            <div key={h.ecli} className="hit">
              <div className="row">
                <button className="link hit-title grow" style={{ textAlign: "left" }} onClick={() => openRuling(h.ecli)}>
                  {h.ecli}
                </button>
                <a href={h.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  bron ↗
                </a>
              </div>
              <div>{h.title}</div>
              <small className="muted">
                {h.type} · uitspraak {h.decided} · publicatie {h.published}
                {h.areas.length > 0 && ` · ${h.areas.join(", ")}`}
                {h.references.length > 0 && ` · vindplaats: ${h.references.join(", ")}`}
              </small>
              {h.summary && <p style={{ margin: "4px 0 0" }}>{h.summary}</p>}
            </div>
          ))}
          <Pager page={page} total={rulings.total} onPage={(p) => search(p)} />
        </div>
      )}
    </>
  );
}
