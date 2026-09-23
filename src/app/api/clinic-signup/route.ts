import { NextResponse } from "next/server";
import { groupClinics, type ClinicCohortId } from "@/lib/content";
import { appendClinicSignup, getClinicSignups, isGoogleSheetsConfigured } from "@/lib/googleSheets";

const VALID_COHORTS = groupClinics.cohorts.map((c) => c.id);

export async function POST(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Online sign-up isn't set up yet. Please call or email instead." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const cohort = String(body.cohort ?? "").trim() as ClinicCohortId;
  const message = String(body.message ?? "").trim();

  if (!firstName || !lastName || !email || !phone || !cohort) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  if (!VALID_COHORTS.includes(cohort)) {
    return NextResponse.json({ error: "Please pick a valid clinic series." }, { status: 400 });
  }

  try {
    const existing = await getClinicSignups();
    const takenCount = existing.filter((s) => s.cohort === cohort).length;

    if (takenCount >= groupClinics.maxParticipants) {
      return NextResponse.json(
        { error: "That clinic series is full. Please pick another one or contact us directly." },
        { status: 409 }
      );
    }

    await appendClinicSignup({ firstName, lastName, email, phone, cohort, message });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong submitting your spot. Please try again or contact us directly." },
      { status: 502 }
    );
  }
}
