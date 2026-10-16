"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminCall } from "./AdminActions";
import { formatMontreal } from "@/lib/payment";

// The owner's view of the optional waiting list for full weeks. Nobody on it holds a place, and
// nothing here assigns one. The only things the owner can do: email a family that a place MAY have
// opened (only while that week really has room), or take a family off the list.

type Entry = {
  id: string;
  parentName: string;
  email: string;
  phone: string;
  placesWanted: number;
  language: "en" | "fr";
  status: "waiting" | "notified";
  joinedAt: string;
  notifiedAt: string | null;
  notifiedCount: number;
  alreadyRegistered: boolean;
};
type Week = { weekId: string; label: string; taken: number; max: number; remaining: number; isOpen: boolean; entries: Entry[] };

const BTN = "cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-forest hover:border-forest disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminWaitlist() {
  const call = useAdminCall();
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState<{ id: string; what: "notify" | "remove" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await call("/api/admin/waitlist", undefined, "GET");
    if (result.ok) {
      setWeeks(result.data.weeks as Week[]);
      setEnabled(result.data.enabled === true);
      setError("");
    } else {
      setError(String(result.data.error ?? "Could not load the waiting list."));
    }
  }, [call]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    window.addEventListener("camp-admin-changed", load);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("camp-admin-changed", load);
    };
  }, [load]);

  async function act(id: string, what: "notify" | "remove") {
    setBusy(true);
    const result = await call(`/api/admin/waitlist/${id}/${what}`, {});
    setBusy(false);
    setAsking(null);
    if (result.ok && result.data.success) {
      setMessage(what === "notify" ? "Sent. The email says a place may be open and that nothing is held for them." : "Removed from the list.");
    } else {
      setMessage(String(result.data.error ?? "That did not work. Nothing was changed."));
    }
    load();
  }

  if (weeks === null) return error ? <p className="mt-10 text-sm text-flag">{error}</p> : null;
  const total = weeks.reduce((sum, w) => sum + w.entries.length, 0);
  if (total === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-gold/30 bg-cream p-6">
        <h2 className="font-display text-lg font-semibold text-forest">Waiting list</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {enabled
            ? "Nobody is on a waiting list. Families can join one from the camp page only when a week is full."
            : "The waiting list is switched off, so families are not offered it. To offer it, set WAITLIST_ENABLED=true (see docs/ROSTERS_CONFIRMING_AND_WAITLIST.md)."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-2xl border border-gold/30 bg-cream p-6">
      <h2 className="font-display text-lg font-semibold text-forest">Waiting list</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {!enabled && <strong className="text-flag">Switched off: families are not being offered the list. </strong>}
        {total} request{total === 1 ? "" : "s"}. <strong>Nobody on this list holds a place.</strong> Emailing a family tells them a place may be
        open; it does not reserve anything, and places stay first come, first served through the registration form. You can only email
        a family while its week has room.
      </p>
      {message && (
        <p role="status" className="mt-3 text-sm font-medium text-forest">
          {message}
        </p>
      )}
      <div className="mt-4 space-y-6">
        {weeks.map((week) => (
          <div key={week.weekId}>
            <h3 className="font-display text-base font-semibold text-forest">
              {week.label}{" "}
              <span className={`text-xs font-semibold ${week.remaining > 0 && week.isOpen ? "text-forest" : "text-ink-soft"}`}>
                {week.remaining > 0 ? `${week.remaining} place${week.remaining === 1 ? "" : "s"} free now (${week.taken} of ${week.max})` : `full (${week.taken} of ${week.max})`}
                {!week.isOpen ? " · closed" : ""}
              </span>
            </h3>
            <ol className="mt-2 space-y-2">
              {week.entries.map((entry, i) => {
                const canEmail = week.remaining > 0 && week.isOpen && !entry.alreadyRegistered && entry.notifiedCount < 3;
                return (
                  <li key={entry.id} className="rounded-xl border border-gold/20 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-ink">
                        #{i + 1} {entry.parentName}
                        {entry.language === "fr" && <span className="ml-2 rounded-full bg-forest/10 px-2 py-0.5 text-xs font-semibold text-forest">Français</span>}
                      </p>
                      <p className="text-xs text-ink-soft">
                        wants {entry.placesWanted} place{entry.placesWanted === 1 ? "" : "s"} · joined {formatMontreal(entry.joinedAt)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">
                      {entry.email}
                      {entry.phone && ` · ${entry.phone}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      {entry.alreadyRegistered
                        ? "Already holds a place this week."
                        : entry.notifiedCount > 0
                          ? `Emailed ${entry.notifiedCount}× (last ${formatMontreal(entry.notifiedAt!)}).`
                          : "Not emailed yet."}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {asking?.id === entry.id ? (
                        <>
                          <span className="text-xs text-ink-soft">
                            {asking.what === "notify" ? "Email this family that a place may be open?" : "Remove this family and erase their request?"}
                          </span>
                          <button type="button" disabled={busy} onClick={() => act(entry.id, asking.what)} className={BTN}>
                            {busy ? "Working…" : asking.what === "notify" ? "Yes, send" : "Yes, remove"}
                          </button>
                          <button type="button" disabled={busy} onClick={() => setAsking(null)} className={BTN}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={!canEmail}
                            title={canEmail ? undefined : week.remaining === 0 ? "This week is full right now" : entry.alreadyRegistered ? "Already holds a place" : "Not available"}
                            onClick={() => setAsking({ id: entry.id, what: "notify" })}
                            className={BTN}
                          >
                            Email: a place may be open
                          </button>
                          <button type="button" onClick={() => setAsking({ id: entry.id, what: "remove" })} className={BTN}>
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
