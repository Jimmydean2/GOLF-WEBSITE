import { NextResponse, after } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { getCampWeeks } from "@/lib/campDb";
import { maybeDispatchFromTraffic } from "@/lib/alerts";

// Capacity now comes from Postgres (the authoritative store — see
// src/lib/campDb.ts), not Google Sheets. Price-per-week and open/closed
// state are included here too, since both are admin-configurable in the
// database rather than hardcoded.
export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ configured: false, weeks: {} });
  }

  try {
    // Reading capacity also releases any 12-hour hold that has ended, so the numbers are
    // always current. As a fallback for when no scheduled job is running, site traffic also
    // triggers due administrator alerts (at most every 5 minutes, de-duplicated).
    const campWeeks = await getCampWeeks();
    const dashboardUrl = new URL("/admin/camp-rosters", request.url).toString();
    after(() => maybeDispatchFromTraffic(dashboardUrl).catch((err) => console.error("Alert dispatch failed:", err)));

    const weeks: Record<
      string,
      { taken: number; max: number; remaining: number; full: boolean; priceCents: number; isOpen: boolean }
    > = {};
    for (const week of campWeeks) {
      const remaining = Math.max(week.maxCapacity - week.takenCount, 0);
      weeks[week.id] = {
        taken: week.takenCount,
        max: week.maxCapacity,
        remaining,
        full: remaining === 0 || !week.isOpen,
        priceCents: week.priceCents,
        isOpen: week.isOpen,
      };
    }

    return NextResponse.json({ configured: true, weeks });
  } catch (err) {
    console.error("Failed to read camp capacity:", err);
    return NextResponse.json(
      { configured: true, weeks: {}, error: "Could not read capacity right now." },
      { status: 502 }
    );
  }
}
