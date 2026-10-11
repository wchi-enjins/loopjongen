"use client";

import { useEffect, useState } from "react";
import { placeholders, TEMPLATES, type TemplateSettings } from "@/lib/templates";

export default function SettingsPage() {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [settings, setSettings] = useState<TemplateSettings>({ clauses: {}, defaults: {}, extras: {} });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const custom = settings.clauses[templateId] ?? {};
  const firm = settings.defaults[templateId] ?? {};
  const extras = settings.extras[templateId] ?? [];
  const allPlaceholders = [...new Set(Object.values(template.clauses ?? {}).flatMap((c) => placeholders(c.text)))];

  useEffect(() => {
    fetch("/api/settings/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((v) => {
        setSettings(v);
        setLoaded(true);
      })
      .catch(() => setMessage("Instellingen konden niet worden geladen."));
  }, []);

  /** Sets (or with null removes) one entry of a settings part for the selected template. */
  function update<K extends keyof TemplateSettings>(part: K, next: TemplateSettings[K][string]) {
    setMessage(null);
    setSettings((all) => ({ ...all, [part]: { ...all[part], [templateId]: next } }));
  }
  const setClause = (key: string, text: string | null) => {
    const next = { ...custom };
    if (text === null) delete next[key];
    else next[key] = text;
    update("clauses", next);
  };
  const setDefault = (name: string, value: string) => update("defaults", { ...firm, [name]: value });
  const setExtra = (i: number, patch: Partial<{ title: string; text: string }> | null) =>
    update("extras", patch === null ? extras.filter((_, j) => j !== i) : extras.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error();
      setSettings(await res.json());
      setMessage("Opgeslagen. Nieuwe documenten op Genereren gebruiken deze instellingen.");
    } catch {
      setMessage("Opslaan mislukt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">Pas de standaardteksten van de artikelen aan. Velden zoals {"{{salaris}}"} worden automatisch ingevuld.</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="tpl" style={{ margin: 0 }}>
          <strong>Documentsoort</strong>
        </label>
        <select id="tpl" className="grow" style={{ maxWidth: 480 }} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      <h3>Standaardwaarden</h3>
      <p className="muted" style={{ fontSize: 13 }}>Vooraf ingevulde waarden op Genereren, bijv. uw eigen kantoorgegevens. Leeg = de standaard van het sjabloon.</p>
      {template.groups.map((g) => (
        <fieldset key={`${templateId}:${g.title}`}>
          <legend>{g.title}</legend>
          {g.fields.map((f) => (
            <label key={f.name} htmlFor={`d-${f.name}`}>
              <span>{f.label}</span>
              {f.type === "select" ? (
                <select id={`d-${f.name}`} value={firm[f.name] ?? ""} onChange={(e) => setDefault(f.name, e.target.value)} disabled={!loaded}>
                  <option value="">Standaard ({f.options?.find((o) => o.value === (f.default ?? ""))?.label ?? "leeg"})</option>
                  {f.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea id={`d-${f.name}`} rows={2} value={firm[f.name] ?? ""} placeholder={f.default} onChange={(e) => setDefault(f.name, e.target.value)} disabled={!loaded} />
              ) : (
                <input
                  id={`d-${f.name}`}
                  type={f.type === "number" ? "number" : f.type}
                  step={f.type === "number" ? "any" : undefined}
                  value={firm[f.name] ?? ""}
                  placeholder={f.default}
                  onChange={(e) => setDefault(f.name, e.target.value)}
                  disabled={!loaded}
                />
              )}
            </label>
          ))}
        </fieldset>
      ))}

      <h3>Eigen standaardbepalingen</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Worden aan elk document van deze soort toegevoegd, vóór het slotartikel. Beschikbare velden: {allPlaceholders.map((f) => `{{${f}}}`).join(", ") || "geen"}.
      </p>
      {extras.map((e, i) => (
        <fieldset key={`${templateId}:extra:${i}`}>
          <legend>Eigen bepaling {i + 1}</legend>
          <label>
            <span>Kop</span>
            <input value={e.title} onChange={(ev) => setExtra(i, { title: ev.target.value })} placeholder="bijv. Thuiswerken" />
          </label>
          <label>
            <span>Tekst</span>
            <textarea rows={4} value={e.text} onChange={(ev) => setExtra(i, { text: ev.target.value })} />
          </label>
          <button onClick={() => setExtra(i, null)} style={{ marginBottom: 8 }}>Verwijderen</button>
        </fieldset>
      ))}
      <button onClick={() => update("extras", [...extras, { title: "", text: "" }])} disabled={!loaded} style={{ marginBottom: 16 }}>
        Bepaling toevoegen
      </button>

      <h3>Standaardteksten</h3>
      {Object.entries(template.clauses ?? {}).map(([key, def]) => {
        const changed = custom[key] !== undefined && custom[key] !== def.text;
        const fields = placeholders(def.text);
        return (
          <fieldset key={`${templateId}:${key}`}>
            <legend>
              {def.label}
              {changed && " (aangepast)"}
            </legend>
            <textarea rows={4} value={custom[key] ?? def.text} onChange={(e) => setClause(key, e.target.value)} disabled={!loaded} aria-label={def.label} />
            <div className="row" style={{ margin: "6px 0 8px", justifyContent: "space-between" }}>
              <small className="muted">{fields.length ? `Velden: ${fields.map((f) => `{{${f}}}`).join(", ")}` : "Geen velden"}</small>
              {changed && <button onClick={() => setClause(key, null)}>Herstel standaard</button>}
            </div>
          </fieldset>
        );
      })}

      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "12px 0" }}>
        <button className="primary" onClick={save} disabled={!loaded || busy}>
          {busy ? "Bezig…" : "Opslaan"}
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </>
  );
}
