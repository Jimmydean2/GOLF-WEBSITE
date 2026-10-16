import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { confirmRegistrationPayment } from "@/lib/campDb";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildParentConfirmationEmail } from "@/lib/campEmailTemplates";
import { juniorCamps } from "@/lib/content";

const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

// POST /api/admin/camp-registrations/[id]/confirm
// The ONLY way a registration becomes "paid". It needs the owner's admin
// login, a POST (so no email link, link preview, or scanner can trigger it),
// and an explicit statement that the deposit is visible in the bank account.
// If the registration was released, its spots are re-reserved first with a
// capacity check; if any week is now full or closed nothing is changed and the
// owner is told why. Idempotent: confirming twice is harmless and sends no
// second email.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // handled by the verifiedDeposit check below
  }
  if (body.verifiedDeposit !== true) {
    return NextResponse.json(
      { error: "Please confirm that you can see this deposit in your bank account." },
      { status: 400 }
    );
  }
  const depositNote = typeof body.depositNote === "string" ? body.depositNote.slice(0, 500) : undefined;

  let result;
  try {
    result = await confirmRegistrationPayment(id, { depositNote });
  } catch (err) {
    console.error("Admin confirm payment failed:", err);
    return NextResponse.json({ error: "Could not confirm this payment. Nothing was changed." }, { status: 502 });
  }

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return NextResponse.json({ error: "Registration not found." }, { status: 404 });
      case "refunded":
        return NextResponse.json({ error: "This registration was refunded, so it can't be confirmed." }, { status: 409 });
      case "no_spots":
        return NextResponse.json(
          { error: "This registration has no spots to confirm. Nothing was changed." },
          { status: 409 }
        );
      case "weeks_full":
        return NextResponse.json(
          {
            error: `This registration was released and ${result.fullWeekIds.map(weekLabel).join(", ")} is now full, so its spots can't be restored. Nothing was changed — free a spot or raise the week's capacity, then try again.`,
          },
          { status: 409 }
        );
      case "weeks_closed":
        return NextResponse.json(
          {
            error: `This registration was released and ${result.closedWeekIds.map(weekLabel).join(", ")} is now closed, so its spots can't be restored. Nothing was changed — reopen the week, then try again.`,
          },
          { status: 409 }
        );
    }
  }

  let emailSent = false;
  if (!result.alreadyPaid && isEmailConfigured()) {
    try {
      const { subject, html, text } = buildParentConfirmationEmail(result.registration);
      await sendEmail({ to: result.registration.email, subject, html, text });
      emailSent = true;
    } catch (err) {
      // The payment is already safely recorded — never undo it over an email
      // problem. The dashboard's "Resend confirmation" button can retry.
      console.error("Failed to send parent confirmation email:", err);
    }
  }

  return NextResponse.json({
    success: true,
    alreadyPaid: result.alreadyPaid,
    reinstatedWeekIds: result.reinstatedWeekIds,
    emailSent,
  });
}
