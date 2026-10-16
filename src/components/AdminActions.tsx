"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// Shared plumbing for the admin screens: one place that calls the admin API and, when the
// server says a payment action needs a recent password check, asks for the password in a
// dialog and retries the action once. Used by the review queue, the search results and the
// week editor.

export type AdminResponse = { ok: boolean; status: number; data: Record<string, unknown> };
type CallAdmin = (url: string, body?: unknown, method?: string) => Promise<AdminResponse>;

const AdminCallContext = createContext<CallAdmin | null>(null);

export function useAdminCall(): CallAdmin {
  const call = useContext(AdminCallContext);
  if (!call) throw new Error("useAdminCall must be used inside <AdminActionsProvider>.");
  return call;
}

async function rawCall(url: string, body: unknown, method: string): Promise<AdminResponse> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export function AdminActionsProvider({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const askForPassword = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPassword("");
        setError("");
        setAsking(true);
      }),
    []
  );

  const callAdmin = useCallback<CallAdmin>(
    async (url, body, method = "POST") => {
      let result = await rawCall(url, body, method);
      if (result.status === 403 && result.data.code === "reauth_required") {
        const confirmed = await askForPassword();
        if (!confirmed) return { ok: false, status: 403, data: { error: "Password check cancelled. Nothing was changed." } };
        result = await rawCall(url, body, method);
      }
      return result;
    },
    [askForPassword]
  );

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await rawCall("/api/admin/reauth", { password }, "POST");
    setBusy(false);
    if (result.ok) {
      setAsking(false);
      resolver.current?.(true);
    } else {
      setError(String(result.data.error ?? "Could not check the password."));
    }
  }

  function cancel() {
    setAsking(false);
    resolver.current?.(false);
  }

  return (
    <AdminCallContext.Provider value={callAdmin}>
      {children}
      {asking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <form
            onSubmit={submitPassword}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reauth-title"
            className="w-full max-w-sm rounded-2xl border border-gold/30 bg-cream p-6 shadow-xl"
          >
            <h2 id="reauth-title" className="font-display text-lg font-semibold text-forest">
              Confirm your password
            </h2>
            <p className="mt-1 text-sm text-ink-soft">Payment actions need your password again. This only happens every 15 minutes.</p>
            <input
              type="password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Admin password"
              className="mt-4 w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-flag">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={cancel} className="cursor-pointer text-sm font-semibold text-ink-soft hover:text-forest">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="cursor-pointer rounded-full bg-forest px-5 py-2 text-sm font-semibold text-cream disabled:opacity-60"
              >
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminCallContext.Provider>
  );
}
