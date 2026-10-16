"use client";

import { useState } from "react";
import { useAdminDownload } from "./AdminActions";

// The owner's roster downloads: Excel or CSV, one week or all, the full roster or a sign-in
// sheet. The files hold children's names and parents' phone numbers, and the full version also
// health notes and emergency contacts, so this asks for the password (when it is due), says so
// on screen, and every download is recorded by the server.

export type RosterWeekOption = { id: string; label: string; count: number };

const SELECT =
  "mt-1 w-full rounded-lg border border-gold/40 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest";

export default function AdminRosterDownloads({ weeks }: { weeks: RosterWeekOption[] }) {
  const download = useAdminDownload();
  const [week, setWeek] = useState("all");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [profile, setProfile] = useState<"full" | "signin">("full");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function go(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    const outcome = await download("/api/admin/camp-rosters/download", { format, week, profile }, `roster.${format}`);
    setBusy(false);
    setResult(outcome);
  }

  const total = weeks.reduce((sum, w) => sum + w.count, 0);

  return (
    <form onSubmit={go} className="mt-6 rounded-2xl border border-gold/30 bg-cream p-6" aria-labelledby="roster-downloads-title">
      <h2 id="roster-downloads-title" className="font-display text-lg font-semibold text-forest">
        Download rosters
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        {total} camper{total === 1 ? "" : "s"} registered across all weeks. Always built live from the database, so each download is current.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-ink">
          Which week
          <select className={SELECT} value={week} onChange={(e) => setWeek(e.target.value)}>
            <option value="all">All weeks</option>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} ({w.count})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          File type
          <select className={SELECT} value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")}>
            <option value="xlsx">Excel workbook (.xlsx), print-ready</option>
            <option value="csv">CSV (.csv), plain list for any spreadsheet</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          What it includes
          <select className={SELECT} value={profile} onChange={(e) => setProfile(e.target.value as "full" | "signin")}>
            <option value="full">Full roster: health notes and emergency contacts</option>
            <option value="signin">Sign-in sheet: no health or emergency details</option>
          </select>
        </label>
      </div>

      <p className="mt-4 rounded-lg border border-flag/30 bg-flag/5 p-3 text-xs text-ink-soft">
        <strong className="text-flag">Confidential.</strong> These files contain children&apos;s names and parents&apos; phone numbers
        {profile === "full" ? ", health notes and emergency contacts" : ""}. Save them only to a device you control, do not send them by
        email, and delete or shred them when the week is over. The sign-in sheet is the one to print for a table or a helper. Every
        download is recorded in the activity log.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-r from-gold-light via-gold to-gold-deep px-6 py-3 text-sm font-semibold text-ink shadow-md shadow-black/20 transition-all hover:shadow-lg hover:shadow-gold-deep/30 disabled:opacity-60"
        >
          {busy ? "Preparing…" : `Download ${format === "xlsx" ? "Excel workbook" : "CSV"}`}
        </button>
        {result && (
          <p role="status" className={`text-sm font-medium ${result.ok ? "text-forest" : "text-flag"}`}>
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}
