"use client";

import { useEffect, useRef, useState } from "react";
import Chevron from "@/components/chevron";
import Markdown from "@/components/markdown";

type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  postal_code: string;
  city: string;
  kvk: string;
  notes: string;
  created_at: string;
};
type LinkedDoc = {
  id: string;
  filename: string;
  size: number;
  created_at: string;
};
type LinkedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  conversation_id: string;
  conversation_title: string;
};

/** Linked messages grouped per chat (source), in the order the API returns them. */
function bySource(messages: LinkedMessage[]) {
  const groups = new Map<string, LinkedMessage[]>();
  for (const m of messages) groups.set(m.conversation_id, [...(groups.get(m.conversation_id) ?? []), m]);
  return [...groups.values()];
}

/** Organisation, address, KvK and notes; nothing when none are filled in. */
function CustomerInfo({ c }: { c: Customer }) {
  const address = [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lines = [c.company && `Organisatie: ${c.company}`, address && `Adres: ${address}`, c.kvk && `KvK: ${c.kvk}`].filter(Boolean);
  if (!lines.length && !c.notes) return null;
  return (
    <div style={{ fontSize: 14, margin: "4px 0 8px" }}>
      {lines.length > 0 && <div className="muted">{lines.join(" · ")}</div>}
      {c.notes && (
        <div className="pre" style={{ marginTop: 4 }}>
          {c.notes}
        </div>
      )}
    </div>
  );
}

const when = (d: string) =>
  new Date(d).toLocaleString("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [messages, setMessages] = useState<LinkedMessage[] | null>(null); // null = loading
  const [docs, setDocs] = useState<LinkedDoc[]>([]);
  const addDialog = useRef<HTMLDialogElement>(null);

  async function load() {
    const res = await fetch("/api/customers");
    if (res.ok) setCustomers(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  /** Opens the customer's details below its card; clicking the open card closes it. */
  async function select(c: Customer) {
    if (selected?.id === c.id) return setSelected(null);
    setSelected(c);
    setMessages(null);
    setDocs([]);
    const [m, d] = await Promise.all([fetch(`/api/customers/${c.id}/messages`), fetch(`/api/customers/${c.id}/documents`)]);
    if (d.ok) setDocs(await d.json());
    setMessages(m.ok ? await m.json() : []);
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!res.ok) return setError((await res.json()).error ?? "Opslaan mislukt");
    form.reset();
    addDialog.current?.close();
    load();
  }

  return (
    <>
      <div className="page-head row">
        <h1 className="grow" style={{ margin: 0 }}>
          Klanten
        </h1>
        <button
          className="primary"
          onClick={() => {
            setError(null);
            addDialog.current?.showModal();
          }}
        >
          + Klant toevoegen
        </button>
      </div>
      {/* Native <dialog>: Esc closes it, focus stays inside. */}
      <dialog ref={addDialog} className="confirm customer-form">
        <form onSubmit={create}>
          <h3 style={{ marginTop: 0 }}>Nieuwe klant</h3>
          <label>
            <span>Naam *</span>
            <input name="name" required autoFocus />
          </label>
          <label>
            <span>Organisatie</span>
            <input name="company" />
          </label>
          <div className="form-pair">
            <label>
              <span>E-mail</span>
              <input name="email" type="email" />
            </label>
            <label>
              <span>Telefoon</span>
              <input name="phone" type="tel" />
            </label>
          </div>
          <label>
            <span>Adres</span>
            <input name="address" placeholder="Straat en huisnummer" />
          </label>
          <div className="form-pair">
            <label>
              <span>Postcode</span>
              <input name="postal_code" />
            </label>
            <label>
              <span>Plaats</span>
              <input name="city" />
            </label>
          </div>
          <label>
            <span>KvK-nummer</span>
            <input name="kvk" inputMode="numeric" />
          </label>
          <label>
            <span>Notities</span>
            <textarea name="notes" rows={3} />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="confirm-actions">
            <button type="button" onClick={() => addDialog.current?.close()}>
              Annuleren
            </button>
            <button className="primary" type="submit">
              Klant toevoegen
            </button>
          </div>
        </form>
      </dialog>
      <div>
        <div className="box" style={{ padding: 0 }}>
          {customers.length === 0 && (
            <p className="muted" style={{ padding: 16, margin: 0 }}>
              Nog geen klanten.
            </p>
          )}
          <ul className="list customer-list">
            {customers.map((c) => {
              const open = selected?.id === c.id;
              return (
                <li key={c.id}>
                  <button className="customer-head" aria-expanded={open} onClick={() => select(c)}>
                    <span className="grow">
                      <span style={{ display: "block" }}>{c.name}</span>
                      <small className="muted">
                        {[c.email, c.phone, `klant sinds ${new Date(c.created_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <Chevron open={open} />
                  </button>
                  {open && (
                    <div className="customer-details">
                      <CustomerInfo c={c} />
                      {docs.length > 0 && (
                        <details className="source">
                          <summary>
                            <span className="grow">
                              <strong style={{ display: "block" }}>Documenten</strong>
                              <small className="muted">
                                {docs.length} document
                                {docs.length === 1 ? "" : "en"}
                              </small>
                            </span>
                            <Chevron />
                          </summary>
                          <div className="source-body">
                            {docs.map((d) => (
                              <div key={d.id} className="hit row">
                                <a className="grow" href={`/documenten?d=${d.id}`} style={{ overflowWrap: "anywhere" }}>
                                  {d.filename}
                                </a>
                                <small className="muted">{new Date(d.created_at).toLocaleDateString("nl-NL")}</small>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      <h3 style={{ marginTop: 16 }}>Gekoppelde chatberichten</h3>
                      {messages === null && (
                        <p className="muted" style={{ margin: 0 }}>
                          Laden…
                        </p>
                      )}
                      {messages?.length === 0 && (
                        <p className="muted" style={{ margin: 0 }}>
                          Nog geen berichten. Selecteer berichten in de AI-chat via &quot;Selecteren&quot;.
                        </p>
                      )}
                      {messages &&
                        bySource(messages).map((group) => (
                          <details key={group[0].conversation_id} className="source">
                            <summary>
                              <span className="grow">
                                <strong style={{ display: "block" }}>{group[0].conversation_title}</strong>
                                <small className="muted">
                                  {group.length} bericht
                                  {group.length === 1 ? "" : "en"} · laatst {when(group[group.length - 1].created_at)}
                                </small>
                              </span>
                              <a href={`/?c=${group[0].conversation_id}`} onClick={(e) => e.stopPropagation()}>
                                Open gesprek →
                              </a>
                              <Chevron />
                            </summary>
                            <div className="source-body">
                              {group.map((m) => (
                                <div key={m.id} className="hit">
                                  <small className="muted">
                                    {m.role === "user" ? "U" : "AI"} · {when(m.created_at)}
                                  </small>
                                  {m.role === "user" ? <div className="pre">{m.content}</div> : <Markdown>{m.content}</Markdown>}
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
