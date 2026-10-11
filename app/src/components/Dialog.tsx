"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Ask = { message: ReactNode; confirmLabel: string; input?: string; resolve: (v: string | null) => void };

/**
 * In-app replacement for window.confirm/prompt. Render `dialog` once in the component, then
 * `if (!(await confirm("…"))) return;` or `const v = await prompt("…", "default");`.
 * Native <dialog>: focus trap and Esc come for free.
 */
export default function useDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (ask && !d?.open) {
      d?.showModal();
      // showModal() focuses the first button (Annuleren); focus the input or the confirm button so Enter confirms.
      d?.querySelector<HTMLElement>("input, button[type=submit]")?.focus();
    }
    if (!ask && d?.open) d.close();
  }, [ask]);

  function open(message: ReactNode, confirmLabel: string, input?: string) {
    setValue(input ?? "");
    return new Promise<string | null>((resolve) => setAsk({ message, confirmLabel, input, resolve }));
  }

  function finish(ok: boolean) {
    ask?.resolve(ok ? value : null);
    setAsk(null);
  }

  const dialog = (
    <dialog
      ref={ref}
      className="confirm"
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      // Click on the backdrop (outside the box) cancels.
      onClick={(e) => e.target === e.currentTarget && finish(false)}
    >
      {ask && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            finish(true);
          }}
        >
          <p>{ask.message}</p>
          {ask.input !== undefined && <input value={value} onChange={(e) => setValue(e.target.value)} />}
          <div className="confirm-actions">
            <button type="button" onClick={() => finish(false)}>
              Annuleren
            </button>
            <button type="submit" className="primary">
              {ask.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );

  return {
    dialog,
    confirm: async (message: ReactNode, confirmLabel = "OK") => (await open(message, confirmLabel)) !== null,
    prompt: (message: string, defaultValue = "", confirmLabel = "Opslaan") => open(message, confirmLabel, defaultValue),
  };
}
