"use client";

import { useEffect, useState } from "react";
import { toJpeg } from "html-to-image";

type LogEntry = { at: string; level: string; text: string };
type NetEntry = { at: string; method: string; url: string; status: number | null; ms: number; aiModel?: string; aiEffort?: string; error?: string };

// Per tab, sent with the feedback: last console warnings/errors, uncaught errors and fetch calls.
const logs: LogEntry[] = [];
const network: NetEntry[] = [];
const loadedAt = Date.now();
let capturing = false;

function capture() {
  if (capturing) return;
  capturing = true;
  const push = (level: string, args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : safeJson(a))).join(" ");
    logs.push({ at: new Date().toISOString(), level, text: text.slice(0, 2000) });
    if (logs.length > 100) logs.shift();
  };
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => push("uncaught", [e.error ?? e.message]));
  window.addEventListener("unhandledrejection", (e) => push("unhandledrejection", [e.reason]));

  // Method, URL, status, timing and the AI model per call. No request headers or bodies (API keys).
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const started = performance.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const entry: NetEntry = { at: new Date().toISOString(), method, url, status: null, ms: 0 };
    network.push(entry);
    if (network.length > 100) network.shift();
    try {
      const res = await origFetch(input, init);
      entry.status = res.status;
      entry.ms = Math.round(performance.now() - started);
      entry.aiModel = res.headers.get("x-ai-model") ?? undefined;
      entry.aiEffort = res.headers.get("x-ai-effort") ?? undefined;
      if (!res.ok) entry.error = (await res.clone().text().catch(() => "")).slice(0, 1000);
      return res;
    } catch (err) {
      entry.ms = Math.round(performance.now() - started);
      entry.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  };
}

/** Everything typed or chosen in the page's form fields, with their labels (textarea values aren't in innerText). */
function formState() {
  const main = document.querySelector("main");
  if (!main) return [];
  return [...main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
    .filter((el) => !(el instanceof HTMLInputElement && ["password", "hidden", "file"].includes(el.type)))
    .map((el) => {
      const label =
        el.labels?.[0]?.innerText.trim() || el.getAttribute("aria-label") || el.closest("fieldset")?.querySelector("legend")?.innerText.trim() || el.getAttribute("placeholder") || el.name || el.id;
      const checkable = el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type);
      return {
        label: label?.slice(0, 200) ?? "",
        type: el instanceof HTMLSelectElement ? "select" : el instanceof HTMLTextAreaElement ? "textarea" : el.type,
        value: el instanceof HTMLSelectElement ? `${el.value} (${el.selectedOptions[0]?.text ?? ""})` : el.value.slice(0, 20_000),
        ...(checkable && { checked: (el as HTMLInputElement).checked }),
        ...(el.disabled && { disabled: true }),
      };
    });
}

/** JPEG of what's visible in the window, without the feedback widget. */
async function screenshot() {
  try {
    // ponytail: html-to-image re-renders the DOM, so inner scroll areas show from their top; use getDisplayMedia if exact pixels matter.
    return await toJpeg(document.body, {
      quality: 0.7,
      pixelRatio: 1,
      width: innerWidth,
      height: innerHeight,
      backgroundColor: "#fff",
      style: { transform: `translate(${-scrollX}px, ${-scrollY}px)` },
      filter: (node) => !(node instanceof HTMLElement && node.classList.contains("feedback")),
    });
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function snapshot() {
  const prefs: Record<string, string | null> = {};
  try {
    // All localStorage except secrets: API keys are never included.
    for (const k of Object.keys(localStorage)) if (!/key|token|secret/i.test(k)) prefs[k] = localStorage.getItem(k)?.slice(0, 2000) ?? null;
  } catch {}
  return {
    url: location.href,
    title: document.title,
    at: new Date().toISOString(),
    secondsOnPage: Math.round((Date.now() - loadedAt) / 1000),
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio },
    screen: { width: screen.width, height: screen.height },
    prefs,
    // ponytail: page text capped at 200k chars; store a DOM/HTML snapshot if text isn't enough.
    content: (document.querySelector("main")?.innerText ?? "").slice(0, 200_000),
    form: formState(),
    logs: [...logs],
    network: [...network],
    screenshot: await screenshot(),
  };
}

export default function Feedback() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(capture, []);

  async function submit() {
    if (!message.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, snapshot: await snapshot() }),
      });
      if (!res.ok) throw new Error();
      setMessage("");
      setStatus("Bedankt, uw feedback is opgeslagen.");
    } catch {
      setStatus("Versturen mislukt, probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feedback no-print">
      {open && (
        <div className="feedback-panel box" role="dialog" aria-label="Feedback">
          <strong>Feedback</strong>
          <textarea
            rows={4}
            autoFocus
            placeholder="Wat ging er goed of mis? Een momentopname van deze pagina wordt meegestuurd."
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setStatus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <small className="muted">{status}</small>
            <button className="primary" onClick={submit} disabled={busy || !message.trim()}>
              {busy ? "Bezig…" : "Versturen"}
            </button>
          </div>
        </div>
      )}
      <button className="feedback-dot" onClick={() => setOpen((o) => !o)} aria-label={open ? "Feedback sluiten" : "Feedback geven"} aria-expanded={open} />
    </div>
  );
}
