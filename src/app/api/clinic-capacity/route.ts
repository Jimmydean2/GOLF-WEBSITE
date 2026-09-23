import { NextResponse } from "next/server";
import { groupClinics } from "@/lib/content";
import { getClinicSignups, isGoogleSheetsConfigured } from "@/lib/googleSheets";

export async function GET() {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, cohorts: {} });
  }

  try {
    const signups = await getClinicSignups();

    const cohorts: Record<string, { taken: number; max: number; remaining: number; full: boolean }> = {};
    for (const cohort of groupClinics.cohorts) {
      const taken = signups.filter((s) => s.cohort === cohort.id).length;
      const remaining = Math.max(groupClinics.maxParticipants - taken, 0);
      cohorts[cohort.id] = {
        taken,
        max: groupClinics.maxParticipants,
        remaining,
        full: remaining === 0,
      };
    }

    return NextResponse.json({ configured: true, cohorts });
  } catch {
    return NextResponse.json(
      { configured: true, cohorts: {}, error: "Could not read capacity right now." },
      { status: 502 }
    );
  }
}
