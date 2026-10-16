"use client";

import { useState } from "react";
import type { RegistrationDetail } from "@/lib/campDb";
import { calculateTotal, formatCents } from "@/lib/pricing";

type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  details: unknown;
  createdAt: string;
};

function statusLabel(r: RegistrationDetail): string {
  switch (r.status) {
    case "pending_payment":
      return r.paymentReportedAt ? "Awaiting payment (parent reported sending it)" : "Awaiting payment";
    case "paid":
      return "Confirmed";
    case "cancelled":
      return r.releaseReason === "expired_unpaid" ? "Released (payment window ended)" : "Cancelled / released";
    case "refunded":
      return "Refunded";
    default:
      return r.status;
  }
}

export default function AdminCampTools() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrationDetail[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  async function loadResults() {
    const res = await fetch(`/api/admin/camp-registrations/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data.results ?? []);
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setMessage("");
    try {
      await loadResults();
    } catch {
      setMessage("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  // Confirming payment is the owner's call, made only after seeing the
  // deposit in their bank account. A released registration has its spots
  // re-reserved first (with a capacity check) — if the week has filled up the
  // server refuses and says so, and nothing changes.
  async function confirmPayment(r: RegistrationDetail) {
    const names = r.children.map((c) => c.fullName).join(", ");
    const total = formatCents(calculateTotal(r.totalPriceCents).totalCents);
    const released = r.status === "cancelled";
    const ok = confirm(
      `${released ? "This registration was released. Confirming will take its spot(s) back, if there is still room.\n\n" : ""}` +
        `Can you see a deposit of $${total} for ${names} in your bank account?\n\nOnly click OK if you can see it.`
    );
    if (!ok) return;
    const depositNote = prompt("Optional note for the log (e.g. the time the deposit arrived):", "") ?? "";
    try {
      const res = await fetch(`/api/admin/camp-registrations/${r.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifiedDeposit: true, depositNote }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const emailNote = data.alreadyPaid
          ? "It was already confirmed."
          : data.emailSent
            ? "The parent was emailed their confirmation."
            : "No email was sent — use Resend confirmation once email is connected.";
        const restored = data.reinstatedWeekIds?.length ? ` Spots restored: ${data.reinstatedWeekIds.join(", ")}.` : "";
        setMessage(`Payment confirmed.${restored} ${emailNote}`);
        await loadResults();
      } else {
        setMessage(data.error || "Could not confirm this payment. Nothing was changed.");
      }
    } catch {
      setMessage("Could not confirm this payment. Nothing was changed.");
    }
  }

  async function reinstate(r: RegistrationDetail) {
    if (!confirm("Take this registration's spot(s) back and return it to Awaiting payment?")) return;
    try {
      const res = await fetch(`/api/admin/camp-registrations/${r.id}/reinstate`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage(`Reinstated. Spots restored: ${data.reinstatedWeekIds.join(", ")}.`);
        await loadResults();
      } else {
        setMessage(data.error || "Could not reinstate this registration. Nothing was changed.");
      }
    } catch {
      setMessage("Could not reinstate this registration. Nothing was changed.");
    }
  }

  async function cancelRegistration(id: string) {
    if (!confirm("Cancel this registration and release its spot(s) back to availability?")) return;
    const reason = prompt("Reason for cancelling (shown in the audit log):", "") ?? "";
    try {
      const res = await fetch(`/api/admin/camp-registrations/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage(`Cancelled. Released: ${data.releasedWeekIds.join(", ") || "no spots (already cancelled)"}.`);
        await loadResults();
      } else {
        setMessage(data.error || "Could not cancel this registration.");
      }
    } catch {
      setMessage("Could not cancel this registration.");
    }
  }

  async function resendEmail(id: string, target: "coach" | "parent") {
    try {
      const res = await fetch(`/api/admin/camp-registrations/${id}/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      setMessage(res.ok && data.success ? "Email resent." : data.error || "Could not resend the email.");
    } catch {
      setMessage("Could not resend the email.");
    }
  }

  async function loadAuditLog() {
    setLoadingAudit(true);
    try {
      const res = await fetch("/api/admin/audit-log");
      const data = await res.json();
      setAuditEntries(data.entries ?? []);
    } catch {
      setMessage("Could not load the audit log.");
    } finally {
      setLoadingAudit(false);
    }
  }

  return (
    <div className="mt-10 space-y-8">
      <div className="rounded-2xl border border-gold/30 bg-cream p-6">
        <h2 className="font-display text-lg font-semibold text-forest">Find a Registration</h2>
        <form onSubmit={runSearch} className="mt-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Child's name, parent's name, or email"
            className="flex-1 rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
          />
          <button
            type="submit"
            disabled={searching}
            className="cursor-pointer rounded-lg bg-forest px-5 py-2.5 text-sm font-semibold text-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {message && <p className="mt-3 text-sm font-medium text-forest">{message}</p>}

        {results.length > 0 && (
          <ul className="mt-4 space-y-3">
            {results.map((r) => (
              <li key={r.id} className="rounded-xl border border-gold/20 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">
                      {r.children.map((c) => c.fullName).join(", ")}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Parent: {r.parentName} ({r.email}, {r.primaryPhone})
                    </p>
                    <p className="text-sm text-ink-soft">
                      Weeks: {r.weekIds.join(", ") || "none held"}
                      {r.status === "cancelled" && r.allWeekIds.length > 0 && <> (released: {r.allWeekIds.join(", ")})</>}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Status: <span className="font-semibold">{statusLabel(r)}</span> &middot; Total: $
                      {formatCents(calculateTotal(r.totalPriceCents).totalCents)} incl. tax
                    </p>
                    {r.paymentReportedAt && r.status === "pending_payment" && (
                      <p className="text-sm font-medium text-forest">
                        Parent says they sent the e-Transfer ({new Date(r.paymentReportedAt).toLocaleString()}) — not
                        confirmed until you see the deposit.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {(r.status === "pending_payment" || r.status === "cancelled") && (
                      <button
                        type="button"
                        onClick={() => confirmPayment(r)}
                        className="cursor-pointer rounded-full bg-forest px-3 py-1 text-xs font-semibold text-cream hover:bg-forest/90"
                      >
                        {r.status === "cancelled" ? "Reinstate & confirm payment" : "Confirm payment received"}
                      </button>
                    )}
                    {r.status === "cancelled" && (
                      <button
                        type="button"
                        onClick={() => reinstate(r)}
                        className="cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-forest hover:border-forest"
                      >
                        Reinstate (awaiting payment)
                      </button>
                    )}
                    {r.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => cancelRegistration(r.id)}
                        className="cursor-pointer rounded-full border border-flag/40 px-3 py-1 text-xs font-semibold text-flag hover:bg-flag/10"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => resendEmail(r.id, "coach")}
                      className="cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-forest hover:border-forest"
                    >
                      Resend notification
                    </button>
                    {r.status === "paid" && (
                      <button
                        type="button"
                        onClick={() => resendEmail(r.id, "parent")}
                        className="cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-forest hover:border-forest"
                      >
                        Resend confirmation
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-gold/30 bg-cream p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-forest">Admin Activity Log</h2>
          <button
            type="button"
            onClick={loadAuditLog}
            disabled={loadingAudit}
            className="cursor-pointer text-sm font-semibold text-forest hover:underline disabled:opacity-60"
          >
            {loadingAudit ? "Loading…" : auditEntries ? "Refresh" : "Load log"}
          </button>
        </div>
        {auditEntries && (
          <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-gold/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-cream-dark text-ink-soft">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-ink-soft">
                      No admin actions recorded yet.
                    </td>
                  </tr>
                ) : (
                  auditEntries.map((entry) => (
                    <tr key={entry.id} className="border-t border-gold/10">
                      <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-ink">{entry.action}</td>
                      <td className="px-3 py-2 text-ink-soft">
                        {entry.targetType}: {entry.targetId.slice(0, 8)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
