"use client";

import { useState } from "react";
import type { RegistrationDetail } from "@/lib/campDb";
import { formatCents } from "@/lib/pricing";
import { formatMontreal } from "@/lib/payment";
import { useAdminCall } from "./AdminActions";
import RegistrationActionButtons from "./AdminRegistrationActions";

type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actor: string;
  details: unknown;
  createdAt: string;
};

function statusLabel(r: RegistrationDetail): string {
  switch (r.status) {
    case "pending_payment":
      return "Awaiting Payment";
    case "payment_reported":
      return r.reviewOverdue ? "Payment Reported — OVERDUE FOR REVIEW" : "Payment Reported — Awaiting Verification";
    case "paid":
      return "Paid — Confirmed";
    case "cancelled":
      return r.releaseReason === "expired_unpaid"
        ? "Released — No Report"
        : r.releaseReason === "not_received"
          ? "Released by Admin — Payment Not Received"
          : "Cancelled";
    case "refunded":
      return "Refunded";
    default:
      return r.status;
  }
}

export default function AdminCampTools() {
  const call = useAdminCall();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistrationDetail[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  async function loadResults() {
    const result = await call(`/api/admin/camp-registrations/search?q=${encodeURIComponent(query)}`, undefined, "GET");
    setResults((result.data.results as RegistrationDetail[]) ?? []);
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

  async function resendEmail(id: string, target: "coach" | "parent") {
    const result = await call(`/api/admin/camp-registrations/${id}/resend-email`, { target });
    setMessage(result.ok && result.data.success ? "Email resent." : String(result.data.error ?? "Could not resend the email."));
  }

  async function loadAuditLog() {
    setLoadingAudit(true);
    try {
      const result = await call("/api/admin/audit-log", undefined, "GET");
      setAuditEntries((result.data.entries as AuditEntry[]) ?? []);
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
            placeholder="Reference, child's name, parent's name, or email"
            aria-label="Search registrations"
            className="min-w-0 flex-1 rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
          />
          <button
            type="submit"
            disabled={searching}
            className="cursor-pointer rounded-lg bg-forest px-5 py-2.5 text-sm font-semibold text-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {message && (
          <p role="status" className="mt-3 text-sm font-medium text-forest">
            {message}
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-4 space-y-3">
            {results.map((r) => (
              <li key={r.id} className="rounded-xl border border-gold/20 bg-white p-4">
                <p className="font-semibold text-ink">
                  <span className="font-display tracking-wider text-forest">{r.reference}</span> &middot; {r.children.map((c) => c.fullName).join(", ")}
                </p>
                <p className="text-sm text-ink-soft">
                  Parent: {r.parentName} ({r.email}, {r.primaryPhone})
                </p>
                <p className="text-sm text-ink-soft">
                  Weeks: {r.weekIds.join(", ") || "none held"}
                  {r.status === "cancelled" && r.allWeekIds.length > 0 && <> (released: {r.allWeekIds.join(", ")})</>}
                </p>
                <p className="text-sm text-ink-soft">
                  Status: <span className="font-semibold">{statusLabel(r)}</span> &middot; Due: ${formatCents(r.amountDueCents)} incl. tax
                </p>
                {r.paymentReportedAt && r.status === "payment_reported" && (
                  <p className="text-sm font-medium text-forest">
                    Parent reported {formatMontreal(r.paymentReportedAt)} — not confirmed until you see the deposit.
                  </p>
                )}
                {r.status === "paid" && r.depositAt && (
                  <p className="text-sm text-ink-soft">
                    Deposit {formatMontreal(r.depositAt)} · {r.paidOnTime ? "paid on time" : "paid after the hold ended"}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <RegistrationActionButtons
                    target={{
                      id: r.id,
                      reference: r.reference,
                      status: r.status,
                      amountDueCents: r.amountDueCents,
                      childNames: r.children.map((c) => c.fullName),
                      extensionCount: r.extensionCount,
                      reinstateCount: r.reinstateCount,
                    }}
                    extensionMax={2}
                    onChanged={(m) => {
                      setMessage(m);
                      loadResults();
                    }}
                  />
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
                  <th className="px-3 py-2 font-semibold">By</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-ink-soft">
                      No admin actions recorded yet.
                    </td>
                  </tr>
                ) : (
                  auditEntries.map((entry) => (
                    <tr key={entry.id} className="border-t border-gold/10">
                      <td className="whitespace-nowrap px-3 py-2 text-ink-soft">{new Date(entry.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-ink">{entry.action}</td>
                      <td className="px-3 py-2 text-ink-soft">{entry.actor}</td>
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
