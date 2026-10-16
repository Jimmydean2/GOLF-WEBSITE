import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { confirmRegistrationPayment } from "@/lib/campDb";
import { isEmailConfigured } from "@/lib/email";
import { processOutbox } from "@/lib/outbox";
import { siteOrigin } from "@/lib/siteUrl";
import { juniorCamps } from "@/lib/content";
import { formatCents } from "@/lib/pricing";

const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

// "436.91" or "436" -> cents. Anything else is refused rather than guessed at.
function parseDollars(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

// POST /api/admin/camp-registrations/[id]/confirm
// The ONLY way a registration becomes "paid". It needs the administrator's login, a recent
// password check, a POST from this site, and a verification record: the amount received
// (must equal the amount due), the deposit date and time, and either the reference or a
// documented name/amount/time match. A parent's report never reaches this. If the
// registration was released, its spots are re-reserved first with a capacity check; if any
// week is now full or closed nothing is changed. Idempotent.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (body.verifiedDeposit !== true) {
    return NextResponse.json(
      { error: "Please confirm that you can see this deposit in your bank account." },
      { status: 400 }
    );
  }
  const amountReceivedCents = parseDollars(body.amountReceived);
  if (amountReceivedCents === null) {
    return NextResponse.json({ error: "Enter the amount you received, for example 436.91." }, { status: 400 });
  }
  const depositAt = new Date(String(body.depositAt ?? ""));
  if (Number.isNaN(depositAt.getTime())) {
    return NextResponse.json({ error: "Enter the date and time the deposit arrived." }, { status: 400 });
  }
  const method = body.method === "name_amount_time" ? "name_amount_time" : "reference_matched";

  let result;
  try {
    result = await confirmRegistrationPayment(id, {
      amountReceivedCents,
      depositAt,
      method,
      referenceEntered: typeof body.referenceEntered === "string" ? body.referenceEntered : undefined,
      bankConfirmationNumber: typeof body.bankConfirmationNumber === "string" ? body.bankConfirmationNumber : undefined,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
    });
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
        return NextResponse.json({ error: "This registration has no spots to confirm. Nothing was changed." }, { status: 409 });
      case "invalid_input":
        return NextResponse.json({ error: result.message ?? "Please check the details and try again." }, { status: 400 });
      case "amount_mismatch":
        return NextResponse.json(
          {
            error: `The amount received ($${formatCents(result.receivedCents)}) doesn't match the amount due ($${formatCents(result.expectedCents)}). Nothing was changed. Contact the parent about the difference.`,
          },
          { status: 409 }
        );
      case "reference_mismatch":
        return NextResponse.json(
          { error: "That reference doesn't match this registration. Check it against the bank message. Nothing was changed." },
          { status: 409 }
        );
      case "deposit_in_future":
        return NextResponse.json({ error: "The deposit time is in the future. Check the date and time." }, { status: 400 });
      case "deposit_before_reservation":
        return NextResponse.json(
          { error: "That deposit is dated before this reservation was made, so it can't be payment for it. Check the date." },
          { status: 409 }
        );
      case "confirmation_number_in_use":
        return NextResponse.json(
          { error: "That bank confirmation number is already attached to another registration." },
          { status: 409 }
        );
      case "weeks_full":
        return NextResponse.json(
          {
            error: `This registration was released and ${result.fullWeekIds.map(weekLabel).join(", ")} is now full, so its spots can't be restored. Nothing was changed.${
              result.paidOnTime ? " This family paid before their hold ended, so resolve this one first." : ""
            } Your options: refund them by e-Transfer, offer another week, or authorize an extra spot for that week.`,
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

  // The confirmation email was recorded in the same transaction as the payment, so it cannot
  // be lost. Send it now, after the response; if that fails it stays queued and is retried,
  // and the dashboard's email box says so.
  if (!result.alreadyPaid) {
    const origin = siteOrigin(request.url);
    after(() =>
      processOutbox({ registrationId: id, origin }).catch((err) => console.error("Sending the confirmation email failed (it stays queued):", err))
    );
  }

  return NextResponse.json({
    success: true,
    alreadyPaid: result.alreadyPaid,
    reinstatedWeekIds: result.reinstatedWeekIds,
    paidOnTime: result.paidOnTime,
    emailQueued: !result.alreadyPaid,
    emailConfigured: isEmailConfigured(),
  });
}
