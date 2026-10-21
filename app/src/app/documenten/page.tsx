"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useDialog from "@/components/dialog";
import { ANALYSIS_PROMPTS } from "@/lib/prompts";

type Doc = { id: string; filename: string; mime: string; size: number; source: string; text_length: number; created_at: string };
type DocDetail = Doc & { text: string };

const ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg";

function size(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1048576).toFixed(1)} MB`;
}

const isDocx = (d: Doc) => d.filename.toLowerCase().endsWith(".docx");
const isPdf = (d: Doc) => d.mime === "application/pdf" || d.filename.toLowerCase().endsWith(".pdf");
const isImage = (d: Doc) => d.mime.startsWith("image/");

export default function DocumentsPage() {
  const router = useRouter();
  const { dialog, confirm } = useDialog();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<DocDetail | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "text">("preview");
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleSelecting() {
    setSelecting((s) => !s);
    setPicked(new Set());
    setNotice(null);
    const res = await fetch("/api/customers");
    if (res.ok) setCustomers(await res.json());
  }

  function togglePick(id: string) {
    setNotice(null);
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function linkToCustomer() {
    const res = await fetch(`/api/customers/${customerId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: [...picked] }),
    });
    if (!res.ok) return setError((await res.json()).error ?? "Koppelen mislukt");
    setNotice(`${picked.size} document(en) gekoppeld aan ${customers.find((c) => c.id === customerId)?.name}.`);
    setPicked(new Set());
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (res.ok) setDocs(await res.json());
  }, []);

  const select = useCallback(async (id: string) => {
    setHtml(null);
    const res = await fetch(`/api/documents/${id}`);
    if (!res.ok) return setError("Document kon niet worden geladen.");
    const d: DocDetail = await res.json();
    setSelected(d);
    setTab(isPdf(d) || isImage(d) || isDocx(d) ? "preview" : "text");
    if (isDocx(d)) {
      const h = await fetch(`/api/documents/${id}/html`);
      if (h.ok) setHtml((await h.json()).html);
    }
    window.history.replaceState(null, "", `/documenten?d=${id}`);
  }, []);

  useEffect(() => {
    load();
    const d = new URLSearchParams(window.location.search).get("d");
    if (d) select(d);
  }, [load, select]);

  async function upload(files: FileList | File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload mislukt");
      await load();
      if (data[0]) select(data[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function remove(d: Doc) {
    if (!(await confirm(`${d.filename} verwijderen?`, "Verwijderen"))) return;
    await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
    setSelected(null);
    window.history.replaceState(null, "", "/documenten");
    load();
  }

  async function analyse(d: Doc, label: string) {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${label}: ${d.filename}`, documentIds: [d.id] }),
    });
    const conv = await res.json();
    router.push(`/?c=${conv.id}&analyse=${encodeURIComponent(label)}`);
  }

  async function openInChat(d: Doc) {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: d.filename, documentIds: [d.id] }),
    });
    router.push(`/?c=${(await res.json()).id}`);
  }

  const shown = docs.filter((d) => d.filename.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <h1>Documenten</h1>
        <p>PDF, DOCX, TXT en afbeeldingen, max. 25 MB per bestand. Tekst wordt geëxtraheerd voor analyse in de AI-chat.</p>
      </div>
      <div className="split">
        <aside className="stack">
          <label
            className={`drop ${over ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              upload(e.dataTransfer.files);
            }}
            style={{ cursor: "pointer", margin: 0 }}
          >
            <input type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && upload(e.target.files)} />
            {uploading ? "Bezig met uploaden…" : "Sleep bestanden hierheen of klik om te uploaden"}
          </label>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <input className="grow" placeholder="Filter op bestandsnaam" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className={selecting ? "primary" : ""} onClick={toggleSelecting}>
              {selecting ? "Klaar" : "Selecteren"}
            </button>
          </div>
          {selecting && (
            <div className="box stack" style={{ fontSize: 14 }}>
              <span>{notice ?? `${picked.size} document(en) geselecteerd. Klik op documenten om ze te selecteren.`}</span>
              {customers.length === 0 ? (
                <span className="muted">
                  Nog geen klanten; maak er een aan via <a href="/klanten">Klanten</a>.
                </span>
              ) : (
                <div className="row">
                  <select className="grow" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Klant">
                    <option value="">Kies klant…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button className="primary" onClick={linkToCustomer} disabled={!picked.size || !customerId}>
                    Koppelen aan klant
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="box" style={{ padding: 0, maxHeight: "60vh", overflowY: "auto" }}>
            {shown.length === 0 && <p className="muted" style={{ padding: 8, margin: 0 }}>Geen documenten.</p>}
            <ul className="list doc-list">
              {shown.map((d) => (
                <li
                  key={d.id}
                  className={(selecting ? picked.has(d.id) : selected?.id === d.id) ? "active" : ""}
                  onClick={() => (selecting ? togglePick(d.id) : select(d.id))}
                >
                  <div style={{ overflowWrap: "anywhere" }}>
                    {selecting && (
                      <input
                        type="checkbox"
                        style={{ width: "auto", margin: "0 6px 0 0", verticalAlign: "middle" }}
                        aria-label={`${d.filename} selecteren`}
                        checked={picked.has(d.id)}
                        onChange={() => togglePick(d.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {d.filename}
                  </div>
                  <small className="muted">
                    {size(d.size)} · {new Date(d.created_at).toLocaleDateString("nl-NL")}
                    {d.source === "generated" && " · gegenereerd"}
                    {(d.source === "wetgeving" || d.source === "rechtspraak") && ` · ${d.source}`}
                    {d.text_length === 0 && " · geen tekst"}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section>
          {!selected && <div className="box muted">Selecteer of upload een document.</div>}
          {selected && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <h2 className="grow" style={{ margin: 0, overflowWrap: "anywhere" }}>
                  {selected.filename}
                </h2>
                <a className="btn" href={`/api/documents/${selected.id}/file?download`}>
                  Downloaden
                </a>
                <button onClick={() => remove(selected)}>Verwijderen</button>
              </div>
              <div className="box" style={{ marginBottom: 12 }}>
                <div className="row">
                  <strong>Analyseren in AI-chat:</strong>
                  {ANALYSIS_PROMPTS.map((p) => (
                    <button key={p.label} onClick={() => analyse(selected, p.label)} disabled={!selected.text && !isImage(selected)}>
                      {p.label}
                    </button>
                  ))}
                  <button onClick={() => openInChat(selected)} disabled={!selected.text && !isImage(selected)}>
                    Eigen vraag →
                  </button>
                </div>
                {!selected.text && !isImage(selected) && (
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    Geen tekst gevonden (bijv. een gescande PDF). Analyse is niet mogelijk.
                  </p>
                )}
              </div>
              <div className="tabs">
                <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
                  Voorbeeld
                </button>
                <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>
                  Geëxtraheerde tekst ({selected.text.length.toLocaleString("nl-NL")} tekens)
                </button>
              </div>
              <div className="preview">
                {tab === "text" && <div className="text pre mono">{selected.text || "Geen tekst."}</div>}
                {tab === "preview" && isPdf(selected) && (
                  <iframe src={`/api/documents/${selected.id}/file`} title={selected.filename} />
                )}
                {tab === "preview" && isImage(selected) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/documents/${selected.id}/file`} alt={selected.filename} />
                )}
                {tab === "preview" && isDocx(selected) && (
                  <div className="docx-html md" dangerouslySetInnerHTML={{ __html: html ?? "Laden…" }} />
                )}
                {tab === "preview" && !isPdf(selected) && !isImage(selected) && !isDocx(selected) && (
                  <div className="text pre">{selected.text}</div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      {dialog}
    </>
  );
}
