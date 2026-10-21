"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useDialog from "@/components/dialog";

type Meeting = { id: string; title: string; date: string; document_id: string | null };
type Status = { connected: boolean; account?: string; meetings: Meeting[] };

export default function RecordingsPage() {
  const router = useRouter();
  const { dialog, confirm } = useDialog();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const res = await fetch("/api/granola");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Granola niet bereikbaar");
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Granola niet bereikbaar");
      setStatus({ connected: false, meetings: [] });
    }
  }, []);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      setError(err);
      window.history.replaceState(null, "", "/recordings");
    }
    load();
  }, [load]);

  async function disconnect() {
    if (!(await confirm("Verbinding met Granola verbreken?", "Verbreken"))) return;
    await fetch("/api/granola", { method: "DELETE" });
    load();
  }

  async function importMeeting(m: Meeting): Promise<string | null> {
    setBusy(m.id);
    setError(null);
    try {
      const res = await fetch(`/api/granola/${encodeURIComponent(m.id)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import mislukt");
      setStatus((s) => s && { ...s, meetings: s.meetings.map((x) => (x.id === m.id ? { ...x, document_id: data.id } : x)) });
      return data.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import mislukt");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function openInChat(m: Meeting) {
    const docId = m.document_id ?? (await importMeeting(m));
    if (!docId) return;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: m.title, documentIds: [docId] }),
    });
    router.push(`/?c=${(await res.json()).id}`);
  }

  return (
    <>
      <div className="page-head">
        <h1>Recordings</h1>
        <p>
          Opnames uit <a href="https://www.granola.ai" target="_blank" rel="noreferrer">Granola</a>. Neem de bespreking op in de
          Granola-app; importeer daarna notities en transcript als document voor de AI-chat.
        </p>
      </div>

      {error && <div className="error">{error}</div>}
      {!status && <p className="muted">Laden…</p>}

      {status && !status.connected && (
        <div className="box">
          <p style={{ marginTop: 0 }}>Log in bij Granola om uw opnames hier te tonen. Er is geen API-sleutel nodig.</p>
          <a className="btn primary" href="/api/granola/connect">
            Verbind met Granola
          </a>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <span className="grow muted pre">Verbonden met Granola{status.account ? `: ${status.account}` : ""}</span>
            <button onClick={load}>Vernieuwen</button>
            <button onClick={disconnect}>Ontkoppelen</button>
          </div>
          {status.meetings.length === 0 && <p className="notice">Geen opnames gevonden.</p>}
          {status.meetings.length > 0 && (
            <div className="box">
              {status.meetings.map((m) => (
                <div key={m.id} className="hit row">
                  <div className="grow">
                    <div className="hit-title">{m.title}</div>
                    <small className="muted">
                      {m.date}
                      {m.document_id && " · geïmporteerd"}
                    </small>
                  </div>
                  {m.document_id && (
                    <a className="btn" href={`/documenten?d=${m.document_id}`}>
                      Bekijk
                    </a>
                  )}
                  <button onClick={() => importMeeting(m)} disabled={busy !== null}>
                    {busy === m.id ? "Importeren…" : m.document_id ? "Opnieuw importeren" : "Importeer"}
                  </button>
                  <button className="primary" onClick={() => openInChat(m)} disabled={busy !== null}>
                    Chat →
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {dialog}
    </>
  );
}
