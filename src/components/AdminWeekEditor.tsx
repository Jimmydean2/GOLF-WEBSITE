"use client";

import { useState } from "react";
import { useAdminCall } from "./AdminActions";

type Week = {
  id: string;
  label: string;
  maxCapacity: number;
  takenCount: number;
  priceCents: number;
  isOpen: boolean;
};

export default function AdminWeekEditor({ weeks }: { weeks: Week[] }) {
  const call = useAdminCall();
  const [rows, setRows] = useState(weeks);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function updateLocal(id: string, patch: Partial<Week>) {
    setRows((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  async function save(week: Week) {
    setMessage("");
    // The standard limit is 30. Raising a week to 31, 32 or 33 is an authorization: it
    // needs a reason, which is recorded, and the database refuses anything above 33.
    let authorizationReason: string | undefined;
    if (week.maxCapacity > 30) {
      const reason = window.prompt(
        `Raising ${week.label} to ${week.maxCapacity} children (the standard limit is 30; the most allowed is 33).\n\nWhy does this week need the extra spots? (at least 10 characters, saved in the log)`,
        ""
      );
      if (!reason) {
        setMessage("Capacity was not changed.");
        return;
      }
      authorizationReason = reason;
    }
    setSavingId(week.id);
    try {
      const result = await call(`/api/admin/camp-weeks/${week.id}`, {
        maxCapacity: week.maxCapacity,
        priceCents: week.priceCents,
        isOpen: week.isOpen,
        authorizationReason,
      }, "PATCH");
      setMessage(result.ok && result.data.success ? `Saved ${week.label}.` : String(result.data.error ?? "Could not save."));
    } catch {
      setMessage("Could not save. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mt-10 overflow-x-auto rounded-2xl border border-gold/30">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-cream-dark text-ink-soft">
            <th className="px-4 py-3 font-semibold">Week</th>
            <th className="px-4 py-3 font-semibold">Registered</th>
            <th className="px-4 py-3 font-semibold">Max Capacity</th>
            <th className="px-4 py-3 font-semibold">Price (per child)</th>
            <th className="px-4 py-3 font-semibold">Open</th>
            <th className="px-4 py-3 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="border-t border-gold/20">
              <td className="px-4 py-3 text-ink">{w.label}</td>
              <td className="px-4 py-3 text-ink">
                {w.takenCount} of {w.maxCapacity}
              </td>
              <td className="px-4 py-3">
                <input
                  type="number"
                  min={w.takenCount}
                  max={33}
                  value={w.maxCapacity}
                  onChange={(e) => updateLocal(w.id, { maxCapacity: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-gold/40 bg-white px-2 py-1 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <span className="text-ink-soft">$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={(w.priceCents / 100).toFixed(2)}
                    onChange={(e) => updateLocal(w.id, { priceCents: Math.round(Number(e.target.value) * 100) })}
                    className="w-24 rounded-lg border border-gold/40 bg-white px-2 py-1 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
                  />
                </div>
              </td>
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={w.isOpen}
                  onChange={(e) => updateLocal(w.id, { isOpen: e.target.checked })}
                  className="h-4 w-4 rounded border-gold/40 text-forest focus:ring-forest"
                />
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => save(w)}
                  disabled={savingId === w.id}
                  className="cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-forest hover:border-forest disabled:opacity-60"
                >
                  {savingId === w.id ? "Saving…" : "Save"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message && <p className="px-4 py-3 text-sm font-medium text-forest">{message}</p>}
    </div>
  );
}
