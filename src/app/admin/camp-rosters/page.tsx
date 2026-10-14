import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Container from "@/components/Container";
import { business } from "@/lib/content";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { getCampRosterData } from "@/lib/campRoster";
import { isGoogleSheetsConfigured } from "@/lib/googleSheets";

export const metadata: Metadata = {
  title: `Camp Rosters | ${business.name}`,
};

// Reads the admin session cookie and live registration data per request —
// must never be statically cached.
export const dynamic = "force-dynamic";

export default async function AdminCampRostersPage() {
  if (!(await isAdminRequestAuthenticated())) {
    redirect("/admin/login?next=/admin/camp-rosters");
  }

  const configured = isGoogleSheetsConfigured();
  const weekRosters = configured ? await getCampRosterData() : [];
  const totalRegistered = weekRosters.reduce((sum, w) => sum + w.rows.length, 0);

  return (
    <div className="py-16 sm:py-24">
      <Container className="max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">Admin</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-forest">
              Junior Camp Rosters
            </h1>
          </div>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="cursor-pointer text-sm font-semibold text-ink-soft hover:text-forest"
            >
              Log out
            </button>
          </form>
        </div>

        {!configured ? (
          <div className="mt-8 rounded-2xl border border-gold/30 bg-cream p-8 text-center">
            <p className="text-ink-soft">
              Registrations aren&apos;t connected yet, so there&apos;s nothing to pull a live
              roster from. Once your Google Sheet is set up (see BOOKING_SETUP.md), rosters
              will populate here automatically.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-4 text-ink-soft">
              {totalRegistered} camper{totalRegistered === 1 ? "" : "s"} registered across all
              weeks. Download the full workbook below &mdash; one print-ready sheet per week,
              auto-filled with every registration, always current.
            </p>

            <a
              href="/api/admin/camp-rosters/download"
              className="mt-6 inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-r from-gold-light via-gold to-gold-deep px-6 py-3 text-sm font-semibold text-ink shadow-md shadow-black/20 transition-all hover:shadow-lg hover:shadow-gold-deep/30"
            >
              Download Roster Workbook (.xlsx)
            </a>

            <div className="mt-10 overflow-hidden rounded-2xl border border-gold/30">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-cream-dark text-ink-soft">
                    <th className="px-4 py-3 font-semibold">Week</th>
                    <th className="px-4 py-3 font-semibold">Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRosters.map((w) => (
                    <tr key={w.id} className="border-t border-gold/20">
                      <td className="px-4 py-3 text-ink">{w.label}</td>
                      <td className="px-4 py-3 text-ink">{w.rows.length} of 30</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm font-semibold text-forest hover:underline">
            &larr; Back to the site
          </Link>
        </div>
      </Container>
    </div>
  );
}
