"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useDialog from "@/components/dialog";
import { defaults, type Field, type Template, type TemplateSettings, type Values } from "@/lib/templates";
import { readStream } from "@/lib/stream";

function Paper({ markup }: { markup: string }) {
  const blocks = markup.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="paper">
      {blocks.map((raw, i) => {
        const b = raw.trim();
        if (!b) return null;
        if (b.startsWith("# ")) return <h1 key={i}>{b.slice(2)}</h1>;
        if (b.startsWith("## ")) return <h2 key={i}>{b.slice(3)}</h2>;
        if (b.startsWith("SIGN:"))
          return (
            <div key={i} className="sign">
              {b
                .slice(5)
                .split("||")
                .map((c, j) => {
                  const [role, ...rest] = c.trim().split("\n");
                  return (
                    <div key={j}>
                      <strong>{role}</strong>
                      <div className="line">{rest.join("\n")}</div>
                    </div>
                  );
                })}
            </div>
          );
        return <p key={i}>{b}</p>;
      })}
    </div>
  );
}

function FieldInput({ f, value, values, onChange }: { f: Field; value: string; values: Values; onChange: (v: string) => void }) {
  const common = { id: f.name, value, placeholder: f.placeholder, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <label htmlFor={f.name}>
      <span>
        {f.label}
        {f.required && " *"}
      </span>
      {f.type === "select" ? (
        <select {...common}>
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {f.discouraged?.(o.value, values) && " – afgeraden"}
            </option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea rows={3} {...common} />
      ) : (
        <input type={f.type === "number" ? "number" : f.type} step={f.type === "number" ? "any" : undefined} {...common} />
      )}
      {f.required && !value.trim() && <small className="field-missing">Dit veld is verplicht.</small>}
    </label>
  );
}

/** The user's own Claude key from the chat's API-sleutels panel, if set. */
function keyHeader(): Record<string, string> {
  try {
    const key = localStorage.getItem("anthropic-api-key");
    return key ? { "x-anthropic-key": key } : {};
  } catch {
    return {};
  }
}

type Customer = { id: string; name: string; company: string; address: string; postal_code: string; city: string; kvk: string };
type DraftRow = { id: string; title: string; template_id: string; customer_name: string | null; updated_at: string };

/** Party groups a customer can be filled into: groups with a "<prefix>_naam" field. */
const partiesOf = (t: Template) =>
  t.groups.flatMap((g) => {
    const naam = g.fields.find((f) => f.name.endsWith("_naam"));
    return naam ? [{ prefix: naam.name.slice(0, -"_naam".length), title: g.title }] : [];
  });

export default function Generator({ templates, title, intro }: { templates: Template[]; title: string; intro?: string }) {
  const [templateId, setTemplateId] = useState(templates[0].id);
  const { dialog, confirm } = useDialog();
  const template = templates.find((t) => t.id === templateId)!;
  const [valuesById, setValuesById] = useState<Record<string, Values>>({});
  const [settings, setSettings] = useState<TemplateSettings>({ clauses: {}, defaults: {}, extras: {} });
  const values = valuesById[templateId] ?? defaults(template, settings.defaults[templateId]);
  const [override, setOverride] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; link?: string } | null>(null);
  const [review, setReview] = useState<{ markup: string; issues: string[] } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const parties = partiesOf(template);
  const [party, setParty] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftId, setDraftId] = useState("");

  useEffect(() => {
    // Settings from /instellingen (clause texts, firm defaults, own clauses); without them the built-in defaults are used.
    fetch("/api/settings/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setSettings(s))
      .catch(() => {});
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCustomers)
      .catch(() => {});
    loadDrafts();
  }, []);
  const rendered = useMemo(
    () => template.render(values, settings.clauses[template.id], settings.extras[template.id]),
    [template, values, settings],
  );
  const markup = override ?? rendered;

  function set(name: string, v: string) {
    setValuesById((all) => ({ ...all, [templateId]: { ...values, [name]: v } }));
  }

  async function choose(id: string) {
    if (override && !(await confirm("Handmatige of AI-wijzigingen gaan verloren. Doorgaan?", "Doorgaan"))) return;
    setTemplateId(id);
    setOverride(null);
    setEditing(false);
    setMessage(null);
    setDraftId("");
    setParty("");
  }

  /** Fills the chosen party's name, address, KvK and representative from the customer. */
  function fillCustomer() {
    const c = customers.find((x) => x.id === customerId);
    const prefix = party || parties[0]?.prefix;
    if (!c || !prefix) return;
    const names = new Set(template.groups.flatMap((g) => g.fields.map((f) => f.name)));
    const filled: Values = {
      naam: c.company || c.name,
      adres: [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      kvk: c.kvk,
      vertegenwoordiger: c.company ? c.name : "",
    };
    const next = { ...values };
    for (const [k, v] of Object.entries(filled)) if (names.has(`${prefix}_${k}`) && v) next[`${prefix}_${k}`] = v;
    setValuesById((all) => ({ ...all, [templateId]: next }));
  }

  async function loadDrafts() {
    const res = await fetch("/api/drafts").catch(() => null);
    if (res?.ok) setDrafts(await res.json());
  }

  async function openDraft(id: string) {
    if (!id) return setDraftId("");
    if (override && !(await confirm("Handmatige of AI-wijzigingen gaan verloren. Doorgaan?", "Doorgaan"))) return;
    const res = await fetch(`/api/drafts/${id}`);
    if (!res.ok) return setMessage({ text: "Concept kon niet worden geladen." });
    const d = (await res.json()) as { id: string; template_id: string; customer_id: string | null; values: Values; override: string | null };
    const t = templates.find((x) => x.id === d.template_id);
    if (!t) return setMessage({ text: "Dit concept hoort bij een ander sjabloon." });
    setTemplateId(t.id);
    setValuesById((all) => ({ ...all, [t.id]: { ...defaults(t, settings.defaults[t.id]), ...d.values } }));
    setOverride(d.override);
    setCustomerId(d.customer_id ?? "");
    setDraftId(d.id);
    setEditing(false);
    setMessage(null);
  }

  async function saveDraft() {
    setMessage(null);
    const res = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: draftId || undefined, templateId, title: filename, values, override, customerId: customerId || null }),
    });
    const data = await res.json();
    if (!res.ok) return setMessage({ text: data.error ?? "Concept opslaan mislukt" });
    setDraftId(data.id);
    setMessage({ text: `Concept "${data.title}" opgeslagen.` });
    loadDrafts();
  }

  async function deleteDraft() {
    if (!draftId || !(await confirm("Dit opgeslagen concept verwijderen?", "Verwijderen"))) return;
    await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
    setDraftId("");
    loadDrafts();
  }

  async function refine() {
    setAiBusy(true);
    setMessage(null);
    const base = markup;
    try {
      const res = await fetch("/api/generate/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeader() },
        body: JSON.stringify({ markup: base, instructions, templateId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "AI-verzoek mislukt");
      const text = await readStream(res, (t) => setOverride(t));
      const failed = text.lastIndexOf("[Fout bij AI-verzoek:"); // error mid-stream: keep the previous draft
      if (failed >= 0) throw new Error(text.slice(failed + 1, -1));
    } catch (e) {
      setOverride(base === rendered ? null : base);
      setMessage({ text: e instanceof Error ? e.message : "AI-verzoek mislukt" });
    } finally {
      setAiBusy(false);
    }
  }

  async function check() {
    setReviewBusy(true);
    setMessage(null);
    const reviewed = markup;
    try {
      const res = await fetch("/api/generate/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeader() },
        body: JSON.stringify({ markup: reviewed, templateId, checks: template.checks(values) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI-controle mislukt");
      setReview({ markup: reviewed, issues: data.issues });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "AI-controle mislukt" });
    } finally {
      setReviewBusy(false);
    }
  }

  const filename = `${template.title} ${values.wn_naam || values.hr_naam || values.p2_naam || values.gm_naam || values.deb_naam || values.org_naam || ""}`.trim();

  async function exportDocx(save: boolean) {
    setMessage(null);
    const res = await fetch("/api/generate/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markup, filename, save }),
    });
    if (!res.ok) return setMessage({ text: "Export mislukt" });
    if (save) {
      const { id, filename: name } = await res.json();
      setMessage({ text: `Opgeslagen als ${name}.`, link: `/documenten?d=${id}` });
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-head no-print">
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>

      {templates.length > 1 && <div className="row no-print" style={{ marginBottom: 16 }}>
        <label htmlFor="tpl" style={{ margin: 0 }}>
          <strong>Documentsoort</strong>
        </label>
        <select id="tpl" className="grow" style={{ maxWidth: 480 }} value={templateId} onChange={(e) => choose(e.target.value)}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>}

      <div className="row no-print" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <label htmlFor="klant" style={{ margin: 0 }}>
          <strong>Klant</strong>
        </label>
        <select id="klant" style={{ maxWidth: 260 }} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">— geen —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company ? `${c.company} (${c.name})` : c.name}
            </option>
          ))}
        </select>
        {parties.length > 0 && (
          <>
            <select aria-label="Invullen als" style={{ maxWidth: 220 }} value={party || parties[0].prefix} onChange={(e) => setParty(e.target.value)}>
              {parties.map((p) => (
                <option key={p.prefix} value={p.prefix}>
                  invullen als {p.title}
                </option>
              ))}
            </select>
            <button onClick={fillCustomer} disabled={!customerId}>Invullen</button>
          </>
        )}
        <label htmlFor="concept" style={{ margin: "0 0 0 16px" }}>
          <strong>Concept</strong>
        </label>
        <select id="concept" style={{ maxWidth: 320 }} value={draftId} onChange={(e) => openDraft(e.target.value)}>
          <option value="">— nieuw —</option>
          {drafts
            .filter((d) => templates.some((t) => t.id === d.template_id))
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.customer_name ? ` · ${d.customer_name}` : ""} · {new Date(d.updated_at).toLocaleDateString("nl-NL")}
              </option>
            ))}
        </select>
        <button onClick={saveDraft}>{draftId ? "Concept bijwerken" : "Concept opslaan"}</button>
        {draftId && <button onClick={deleteDraft}>Verwijderen</button>}
      </div>

      <div className="split-wide">
        <section className="no-print">
          {template.groups.map((g) => {
            const fields = (
              <fieldset key={g.title}>
                <legend>{g.title}</legend>
                {g.fields
                  .filter((f) => !f.showIf || f.showIf(values))
                  .map((f) => (
                    <FieldInput key={f.name} f={f} value={values[f.name] ?? ""} values={values} onChange={(v) => set(f.name, v)} />
                  ))}
              </fieldset>
            );
            return g.advanced ? (
              <details key={g.title} style={{ marginBottom: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>{g.title}</summary>
                {fields}
              </details>
            ) : (
              fields
            );
          })}
          <div className="box">
            <h3 style={{ marginTop: 0 }}>Bronnen</h3>
            <ul className="checks">
              {template.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <p className="muted no-print" style={{ marginTop: 0 }}>{template.description}</p>
          <div className="row no-print" style={{ marginBottom: 8 }}>
            <button onClick={() => exportDocx(false)} disabled={aiBusy}>Download .docx</button>
            <button onClick={() => exportDocx(true)} disabled={aiBusy}>Opslaan in Documenten</button>
            <button onClick={() => window.print()} disabled={aiBusy}>Afdrukken / PDF</button>
            <button onClick={() => setEditing((e) => !e)} disabled={aiBusy}>{editing ? "Voorbeeld" : "Tekst bewerken"}</button>
            <button onClick={check} disabled={aiBusy || reviewBusy}>{reviewBusy ? "Controleren…" : "Controleer concept"}</button>
          </div>
          {message && (
            <div className="notice no-print" style={{ marginBottom: 8 }}>
              {message.text} {message.link && <Link href={message.link}>Bekijk in Documenten →</Link>}
            </div>
          )}

          {review?.markup === markup && (
            <div className="box no-print" style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>Controle</h3>
              {review.issues.length ? (
                <ul className="checks">
                  {review.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: 0 }}>Geen problemen gevonden.</p>
              )}
            </div>
          )}

          <div className="box no-print" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Aanvullende feiten verwerken met AI</h3>
            <textarea
              rows={3}
              placeholder="bijv. Werknemer krijgt een leaseauto en een reiskostenvergoeding van € 0,23 per km. Voeg een thuiswerkregeling toe."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onKeyDown={(e) => {
                // Same as the chat: Enter sends, Shift+Enter is a new line.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!aiBusy && instructions.trim()) refine();
                }
              }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={refine} disabled={aiBusy || !instructions.trim()}>
                {aiBusy ? "Bezig…" : "Verwerk in concept"}
              </button>
              {override !== null && !aiBusy && (
                <button onClick={() => setOverride(null)}>Herstel naar sjabloon</button>
              )}
            </div>
            {template.rules?.length ? (
              <details style={{ marginTop: 12, fontSize: 13 }}>
                <summary style={{ cursor: "pointer" }}>Juridische vereisten die de AI meekrijgt ({template.rules.length})</summary>
                <ul className="checks" style={{ marginTop: 8 }}>
                  {template.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="muted" style={{ margin: "8px 0 0" }}>Daarnaast de geldende tekst van de bronartikelen ({template.sources.filter((s) => s.url.includes("artikel=")).map((s) => s.label).join(", ")}).</p>
              </details>
            ) : null}
          </div>

          {override !== null && !aiBusy && (
            <p className="notice no-print" style={{ marginBottom: 8 }}>
              Het concept bevat handmatige of AI-wijzigingen. Wijzigingen in het formulier worden pas zichtbaar na &quot;Herstel naar sjabloon&quot;.
            </p>
          )}
          {editing ? (
            <textarea
              className="mono"
              style={{ minHeight: "70vh" }}
              value={markup}
              onChange={(e) => setOverride(e.target.value)}
            />
          ) : (
            <Paper markup={markup} />
          )}
          <p className="muted no-print" style={{ fontSize: 13, marginTop: 8 }}>
            Concept op basis van een standaardsjabloon. Controleer de inhoud op de concrete situatie en actuele wetgeving vóór ondertekening.
          </p>
        </section>
      </div>
      {dialog}
    </>
  );
}
