import { randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { business, juniorCamps, type CampWeekId } from "@/lib/content";
import { appendCampRegistration, getCampRegistrations, isGoogleSheetsConfigured } from "@/lib/googleSheets";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildCoachNotificationEmail } from "@/lib/campEmailTemplates";

const VALID_WEEKS = juniorCamps.weeks.map((w) => w.id);

export async function POST(request: Request) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Online registration isn't set up yet. Please call or email instead." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parentName = String(body.parentName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const primaryPhone = String(body.primaryPhone ?? "").trim();
  const secondaryPhone = String(body.secondaryPhone ?? "").trim();
  const childName = String(body.childName ?? "").trim();
  const dateOfBirth = String(body.dateOfBirth ?? "").trim();
  const childAge = String(body.childAge ?? "").trim();
  const healthInfo = String(body.healthInfo ?? "").trim();
  const emergencyName = String(body.emergencyName ?? "").trim();
  const emergencyRelationship = String(body.emergencyRelationship ?? "").trim();
  const emergencyPhone = String(body.emergencyPhone ?? "").trim();
  const week = String(body.week ?? "").trim() as CampWeekId;
  const codeOfConductAccepted = body.codeOfConductAccepted === true;
  const consentAccepted = body.consentAccepted === true;

  if (
    !parentName ||
    !email ||
    !primaryPhone ||
    !childName ||
    !dateOfBirth ||
    !childAge ||
    !healthInfo ||
    !emergencyName ||
    !emergencyRelationship ||
    !emergencyPhone ||
    !week
  ) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  if (!codeOfConductAccepted || !consentAccepted) {
    return NextResponse.json(
      { error: "Please accept the code of conduct and information consent to continue." },
      { status: 400 }
    );
  }

  if (!VALID_WEEKS.includes(week)) {
    return NextResponse.json({ error: "Please pick a valid camp week." }, { status: 400 });
  }

  try {
    const existing = await getCampRegistrations();
    const takenCount = existing.filter((r) => r.week === week).length;

    if (takenCount >= juniorCamps.maxPerWeek) {
      return NextResponse.json(
        { error: "That week is full. Please pick another one or contact us directly." },
        { status: 409 }
      );
    }

    const id = randomUUID();
    const confirmToken = randomBytes(24).toString("hex");

    await appendCampRegistration({
      parentName,
      email,
      primaryPhone,
      secondaryPhone,
      childName,
      dateOfBirth,
      childAge,
      healthInfo,
      emergencyName,
      emergencyRelationship,
      emergencyPhone,
      week,
      codeOfConductAccepted: "Yes",
      consentAccepted: "Yes",
      id,
      confirmToken,
    });

    if (isEmailConfigured()) {
      try {
        const confirmUrl = new URL("/api/camp-registration/confirm", request.url);
        confirmUrl.searchParams.set("id", id);
        confirmUrl.searchParams.set("token", confirmToken);

        const { subject, html, text } = buildCoachNotificationEmail(
          {
            timestamp: "",
            parentName,
            email,
            primaryPhone,
            secondaryPhone,
            childName,
            dateOfBirth,
            childAge,
            healthInfo,
            emergencyName,
            emergencyRelationship,
            emergencyPhone,
            week,
            codeOfConductAccepted: "Yes",
            consentAccepted: "Yes",
            id,
            paid: "No",
            paidAt: "",
            confirmToken,
          },
          confirmUrl.toString()
        );

        await sendEmail({ to: business.email, subject, html, text });
      } catch (err) {
        // Don't fail the registration if the notification email can't send —
        // it's already safely saved in the sheet either way.
        console.error("Failed to send camp registration notification email:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong submitting your registration. Please try again or contact us directly." },
      { status: 502 }
    );
  }
}
