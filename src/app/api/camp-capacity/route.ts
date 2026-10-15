import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { getCampWeeks } from "@/lib/campDb";

// Capacity now comes from Postgres (the authoritative store — see
// src/lib/campDb.ts), not Google Sheets. Price-per-week and open/closed
// state are included here too, since both are admin-configurable in the
// database rather than hardcoded.
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ configured: false, weeks: {} });
  }

  try {
    const campWeeks = await getCampWeeks();

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
