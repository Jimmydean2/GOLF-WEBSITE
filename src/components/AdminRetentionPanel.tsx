"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminCall } from "./AdminActions";
import { INPUT } from "./AdminRegistrationActions";

// "Season clean-up": after the camp weeks are over, families' sensitive details (children's dates
// of birth, health information, emergency contacts, phone numbers, emails) are erased once the
// retention period has passed. Quiet when nothing is due; the button appears only when something is.

type Status = { retentionDays: number; due: number; blocked: { reference: string; status: string; lastWeekEnded: string }[] };

export default function AdminRetentionPanel() {
  const call = useAdminCall();
  const [status, setStatus] = useState<Status | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await call("/api/admin/retention", undefined, "GET");
    if (result.ok) setStatus(result.data as unknown as Status);
  }, [call]);

  useEffect(() => {
    // Loaded once when the page opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!status) return null;
  const nothing = status.due === 0 && status.blocked.length === 0;

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await call("/api/admin/retention", { confirm: typed }, "POST");
    setBusy(false);
    if (result.ok && result.data.success) {
      setMessage(`Done: ${result.data.anonymized} families' personal details erased` + (Number(result.data.purgedWaitlist) > 0 ? `, ${result.data.purgedWaitlist} finished waiting-list request(s) deleted.` : "."));
      setTyped("");
      void load();
    } else {
      setMessage(String(result.data.error ?? "The clean-up did not run."));
    }
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-cream p-4 text-sm" aria-label="Season clean-up">
      <p className="font-display text-base font-semibold text-forest">Privacy: season clean-up</p>
      {nothing ? (
        <p className="mt-1 text-ink-soft">
          Nothing is due. {status.retentionDays} days after a family&apos;s last camp week, their children&apos;s dates of birth, health information,
          emergency contacts, phone numbers and emails are erased; the accounting record stays.
        </p>
      ) : (
        <>
          {status.due > 0 && (
            <p className="mt-1 text-ink">
              <strong>{status.due}</strong> families&apos; last camp week ended more than {status.retentionDays} days ago. Their sensitive details are due
              to be erased (the accounting record stays).
            </p>
          )}
          {status.blocked.length > 0 && (
            <p className="mt-1 text-ink-soft">
              {status.blocked.length} more are past the date but have an unresolved payment ({status.blocked.slice(0, 5).map((b) => b.reference).join(", ")}
              {status.blocked.length > 5 ? ", …" : ""}). Resolve or release them first; they are never erased automatically.
            </p>
          )}
          {status.due > 0 && (
            <form onSubmit={run} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm font-medium text-ink">
                Type CLEAN UP to confirm
                <input className={`${INPUT} mt-1 w-40`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
              <button type="submit" disabled={busy || typed.trim() !== "CLEAN UP"} className="cursor-pointer rounded-full bg-flag px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? "Cleaning up…" : "Erase them now"}
              </button>
            </form>
          )}
        </>
      )}
      {message && (
        <p role="status" className="mt-2 font-medium text-forest">
          {message}
        </p>
      )}
    </div>
  );
}
