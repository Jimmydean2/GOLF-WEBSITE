import { NextResponse, after } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { getCampWeeks } from "@/lib/campDb";
import { maybeRunFromTraffic } from "@/lib/scheduledCheck";
import { siteOrigin } from "@/lib/siteUrl";
import { logError } from "@/lib/safeLog";
import { registrationWindow } from "@/lib/registrationWindow";

// Capacity now comes from Postgres (the authoritative store — see
// src/lib/campDb.ts), not Google Sheets. Price-per-week and open/closed
// state are included here too, since both are admin-configurable in the
// database rather than hardcoded.
export async function GET(request: Request) {
  // Whether registration is open, not yet announced, or opens at a set moment. The form shows
  // it and the registration endpoint enforces the same answer. serverNow lets a browser with a
  // wrong clock still count down to the right moment.
  const now = new Date();
  const registration = registrationWindow(now);
  const serverNow = now.toISOString();

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ configured: false, weeks: {}, registration, serverNow });
  }

  try {
    // Reading capacity also releases any 12-hour hold that has ended, so the numbers are
    // always current. As a fallback for when no scheduled job is running, site traffic also
    // runs the scheduled check (at most every 5 minutes, de-duplicated).
    const campWeeks = await getCampWeeks();
    const origin = siteOrigin(request.url);
    after(() => maybeRunFromTraffic(origin).catch((err) => logError("Scheduled check from traffic failed:", err)));

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

    return NextResponse.json({ configured: true, weeks, registration, serverNow });
  } catch (err) {
    logError("Failed to read camp capacity:", err);
    return NextResponse.json(
      { configured: true, weeks: {}, registration, serverNow, error: "Could not read capacity right now." },
      { status: 502 }
    );
  }
}
