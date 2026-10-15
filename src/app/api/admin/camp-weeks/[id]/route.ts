import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { adjustWeekCapacity, setWeekOpen, setWeekPrice } from "@/lib/campDb";

// Admin-only. Lets the operator change a week's capacity, price, or
// open/closed state without a code change or redeploy. Every change is
// written to admin_audit_log by the campDb functions themselves.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
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
      if (!Number.isInteger(maxCapacity) || maxCapacity <= 0) {
        return NextResponse.json({ error: "Capacity must be a positive whole number." }, { status: 400 });
      }
      const result = await adjustWeekCapacity(id, maxCapacity);
      if (!result.ok) {
        return NextResponse.json(
          {
            error: `Can't set capacity below ${result.takenCount} — that's how many children are already registered for this week.`,
          },
          { status: 409 }
        );
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
