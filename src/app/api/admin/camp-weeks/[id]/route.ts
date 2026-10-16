import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import {
  adjustWeekCapacity,
  authorizeWeekCapacity,
  CAPACITY_CEILING,
  CAPACITY_STANDARD,
  setWeekOpen,
  setWeekPrice,
} from "@/lib/campDb";

// Admin-only. Lets the operator change a week's capacity, price, or open/closed state
// without a code change or redeploy. Every change is written to admin_audit_log.
//
// Capacity is 30 or fewer as a matter of course. Raising a week to 31, 32 or 33 is an
// authorization: it needs authorizationReason (10+ characters, why this week needs it) and
// is recorded; the database refuses anything above 33, and any raise above 30 without the
// record. Needs a recent password check.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    if (body.maxCapacity !== undefined) {
      const maxCapacity = Number(body.maxCapacity);
      if (!Number.isInteger(maxCapacity) || maxCapacity <= 0 || maxCapacity > CAPACITY_CEILING) {
        return NextResponse.json(
          { error: `Capacity must be a whole number from 1 to ${CAPACITY_CEILING}.` },
          { status: 400 }
        );
      }
      if (maxCapacity > CAPACITY_STANDARD) {
        const result = await authorizeWeekCapacity(id, maxCapacity, String(body.authorizationReason ?? ""));
        if (!result.ok) {
          if (result.reason === "unknown_week") return NextResponse.json({ error: "Week not found." }, { status: 404 });
          return NextResponse.json({ error: result.message }, { status: 400 });
        }
      } else {
        const result = await adjustWeekCapacity(id, maxCapacity);
        if (!result.ok) {
          if (result.reason === "below_taken") {
            return NextResponse.json(
              {
                error: `Can't set capacity below ${result.takenCount}: that's how many children are already registered for this week.`,
              },
              { status: 409 }
            );
          }
          return NextResponse.json({ error: "That capacity needs an authorization." }, { status: 400 });
        }
      }
    }

    if (body.priceCents !== undefined) {
      const priceCents = Number(body.priceCents);
      if (!Number.isInteger(priceCents) || priceCents < 0) {
        return NextResponse.json({ error: "Price must be a non-negative whole number of cents." }, { status: 400 });
      }
      await setWeekPrice(id, priceCents);
    }

    if (body.isOpen !== undefined) {
      await setWeekOpen(id, Boolean(body.isOpen));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin adjust camp week failed:", err);
    return NextResponse.json({ error: "Could not update this week. Please try again." }, { status: 502 });
  }
}
