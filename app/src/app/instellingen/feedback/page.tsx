"use client";

import { useEffect, useMemo, useState } from "react";

type Item = { id: string; message: string; page: string; created_at: string };
type Sort = { by: "date" | "message"; desc: boolean };

export default function FeedbackPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ by: "date", desc: true });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = !!items?.length && picked.size === items.length;

  function pick(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/feedback")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setItems)
      .catch(() => setError("Feedback kon niet worden geladen."));
  }, []);

  const sorted = useMemo(() => {
    const list = [...(items ?? [])];
    list.sort((a, b) => (sort.by === "date" ? a.created_at.localeCompare(b.created_at) : a.message.localeCompare(b.message, "nl")));
    return sort.desc ? list.reverse() : list;
  }, [items, sort]);

  function toggle(by: Sort["by"]) {
    setSort((s) => ({ by, desc: s.by === by ? !s.desc : by === "date" }));
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, ids: [...picked] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Download mislukt");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `feedback-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download mislukt");
    } finally {
      setBusy(false);
    }
  }

  const arrow = (by: Sort["by"]) => (sort.by === by ? (sort.desc ? " ↓" : " ↑") : "");

  return (
    <>
      <p className="muted">Feedback via de blauwe stip. Selecteer feedback (of alles via het vakje bovenaan) en download die, inclusief momentopnames (pagina-inhoud, log, open chat of document), met de pincode.</p>

      <form
        className="row"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          download();
        }}
      >
        <input
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="Pincode"
          aria-label="Pincode"
          style={{ width: 120 }}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <button type="submit" className="primary" disabled={busy || pin.length !== 4 || !picked.size}>
          {busy ? "Bezig…" : all ? "Download alle feedback (.json)" : `Download ${picked.size} geselecteerd (.json)`}
        </button>
      </form>

      {error && <div className="error">{error}</div>}
      {items && !items.length && <p className="muted">Nog geen feedback.</p>}
      {!!items?.length && (
        <table className="feedback-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  aria-label="Alles selecteren"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = picked.size > 0 && !all;
                  }}
                  onChange={() => setPicked(all ? new Set() : new Set(items.map((f) => f.id)))}
                />
              </th>
              <th>
                <button className="link" onClick={() => toggle("date")}>Datum{arrow("date")}</button>
              </th>
              <th>
                <button className="link" onClick={() => toggle("message")}>Feedback{arrow("message")}</button>
              </th>
              <th>Pagina</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={f.id} onClick={() => pick(f.id)} style={{ cursor: "pointer" }}>
                <td>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    aria-label="Feedback selecteren"
                    checked={picked.has(f.id)}
                    onChange={() => pick(f.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="nowrap">{new Date(f.created_at).toLocaleString("nl-NL")}</td>
                <td style={{ whiteSpace: "pre-wrap" }}>{f.message}</td>
                <td className="mono">{f.page}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
