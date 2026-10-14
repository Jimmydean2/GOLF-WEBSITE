import { NextResponse } from "next/server";
import { juniorCamps } from "@/lib/content";
import { getCampRegistrations, isGoogleSheetsConfigured } from "@/lib/googleSheets";

export async function GET() {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, weeks: {} });
  }

  try {
    const registrations = await getCampRegistrations();

    const weeks: Record<string, { taken: number; max: number; remaining: number; full: boolean }> = {};
    for (const week of juniorCamps.weeks) {
      const taken = registrations.filter((r) => r.weeks.split(",").includes(week.id)).length;
      const remaining = Math.max(juniorCamps.maxPerWeek - taken, 0);
      weeks[week.id] = {
        taken,
        max: juniorCamps.maxPerWeek,
        remaining,
        full: remaining === 0,
      };
    }

    return NextResponse.json({ configured: true, weeks });
  } catch {
    return NextResponse.json(
      { configured: true, weeks: {}, error: "Could not read capacity right now." },
      { status: 502 }
    );
  }
}
