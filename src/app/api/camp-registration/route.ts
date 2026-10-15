import { NextResponse } from "next/server";
import { business, juniorCamps, type CampWeekId } from "@/lib/content";
import { isDatabaseConfigured } from "@/lib/db";
import { getRegistrationById, reserveRegistration, type ReserveChildInput } from "@/lib/campDb";
import { appendCampRegistration, isGoogleSheetsConfigured } from "@/lib/googleSheets";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildCoachNotificationEmail } from "@/lib/campEmailTemplates";
import { isValidEmail } from "@/lib/validation";

const VALID_WEEKS = juniorCamps.weeks.map((w) => w.id);
const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

function parseChild(raw: unknown): ReserveChildInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fullName = String(r.fullName ?? "").trim();
  const dateOfBirth = String(r.dateOfBirth ?? "").trim();
  const age = String(r.age ?? "").trim();
  const healthInfo = String(r.healthInfo ?? "").trim();
  if (!fullName || !dateOfBirth || !age || !healthInfo) return null;
  return { fullName, dateOfBirth, age, healthInfo };
}

export async function POST(request: Request) {
  // Postgres is the authoritative store for capacity and registrations —
  // see src/lib/campDb.ts for why Google Sheets alone can't safely
  // enforce "never more than 30." Sheets below is a best-effort,
  // non-authoritative reporting copy only.
  if (!isDatabaseConfigured()) {
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

  const idempotencyKey = String(body.idempotencyKey ?? "").trim();
  const parentName = String(body.parentName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const primaryPhone = String(body.primaryPhone ?? "").trim();
  const secondaryPhone = String(body.secondaryPhone ?? "").trim();
  const emergencyName = String(body.emergencyName ?? "").trim();
  const emergencyRelationship = String(body.emergencyRelationship ?? "").trim();
  const emergencyPhone = String(body.emergencyPhone ?? "").trim();
  const weeksInput = Array.isArray(body.weeks) ? body.weeks : [];
  const weekIds = Array.from(new Set(weeksInput.map((w) => String(w).trim()).filter(Boolean))) as CampWeekId[];
  const codeOfConductAccepted = body.codeOfConductAccepted === true;
  const consentAccepted = body.consentAccepted === true;
  const childrenInput = Array.isArray(body.children) ? body.children : [];
  const children = childrenInput.map(parseChild);

  if (!idempotencyKey) {
    return NextResponse.json({ error: "Invalid request (missing idempotency key)." }, { status: 400 });
  }

  if (
    !parentName ||
    !email ||
    !primaryPhone ||
    !emergencyName ||
    !emergencyRelationship ||
    !emergencyPhone ||
    weekIds.length === 0 ||
    children.length === 0 ||
    children.some((c) => c === null)
  ) {
    return NextResponse.json(
      { error: "Please fill in all required fields, add at least one child, and pick at least one camp week." },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (!codeOfConductAccepted || !consentAccepted) {
    return NextResponse.json(
      { error: "Please accept the code of conduct and information consent to continue." },
      { status: 400 }
    );
  }

  if (weekIds.some((w) => !VALID_WEEKS.includes(w))) {
    return NextResponse.json({ error: "Please pick valid camp weeks." }, { status: 400 });
  }

  try {
    const result = await reserveRegistration({
      idempotencyKey,
      parentName,
      email,
      primaryPhone,
      secondaryPhone,
      emergencyName,
      emergencyRelationship,
      emergencyPhone,
      codeOfConductAccepted,
      consentAccepted,
      children: children as ReserveChildInput[],
      weekIds,
    });

    if (!result.ok) {
      if (result.reason === "weeks_full") {
        return NextResponse.json(
          {
            error: `These weeks just filled up: ${result.fullWeekIds.map(weekLabel).join(", ")}. Please remove them and try again.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: `These weeks aren't available: ${result.unavailableWeekIds.map(weekLabel).join(", ")}. Please remove them and try again.`,
        },
        { status: 409 }
      );
    }

    // A duplicate submission (double-click, retried request) returns the
    // same already-created registration — nothing further to send again.
    if (result.alreadyExisted) {
      return NextResponse.json({ success: true });
    }

    // Google Sheets is a secondary reporting copy, not the source of
    // truth — never let a failure here undo or fail the real
    // (already-committed) registration.
    if (isGoogleSheetsConfigured()) {
      try {
        for (const child of children as ReserveChildInput[]) {
          await appendCampRegistration({
            parentName,
            email,
            primaryPhone,
            secondaryPhone,
            childName: child.fullName,
            dateOfBirth: child.dateOfBirth,
            childAge: child.age,
            healthInfo: child.healthInfo,
            emergencyName,
            emergencyRelationship,
            emergencyPhone,
            weeks: weekIds.join(","),
            codeOfConductAccepted: "Yes",
            consentAccepted: "Yes",
            id: result.registrationId,
            confirmToken: result.confirmToken,
          });
        }
      } catch (err) {
        console.error("Failed to sync camp registration to Google Sheets (non-fatal):", err);
      }
    }

    if (isEmailConfigured()) {
      try {
        const registration = await getRegistrationById(result.registrationId);
        if (registration) {
          const confirmUrl = new URL("/api/camp-registration/confirm", request.url);
          confirmUrl.searchParams.set("id", result.registrationId);
          confirmUrl.searchParams.set("token", result.confirmToken);

          const { subject, html, text } = buildCoachNotificationEmail(registration, confirmUrl.toString());
          await sendEmail({ to: business.email, subject, html, text });
        }
      } catch (err) {
        // Don't fail the registration if the notification email can't send —
        // it's already safely committed in the database either way, and an
        // admin can resend the notification from the dashboard.
        console.error("Failed to send camp registration notification email:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Camp registration failed:", err);
    return NextResponse.json(
      { error: "Something went wrong submitting your registration. Please try again or contact us directly." },
      { status: 502 }
    );
  }
}
