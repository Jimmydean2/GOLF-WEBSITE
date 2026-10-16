import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { cancelRegistration } from "@/lib/campDb";

// POST /api/admin/camp-registrations/[id]/cancel
// The administrator's Release: frees the spots. With { notReceived: true } it is recorded
// as "payment not received" (and, for a reported claim, counts as a strike against that
// contact); otherwise it is a plain cancellation. Needs login and a recent password check.
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
    // reason is optional: an empty body is fine
  }
  const notReceived = body.notReceived === true;
  const reason =
    String(body.reason ?? "").trim() || (notReceived ? "Payment not received" : "Cancelled by admin");

  try {
    const result = await cancelRegistration(id, reason, { releaseReason: notReceived ? "not_received" : "owner_cancelled" });
    if (!result.ok) {
      return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, releasedWeekIds: result.releasedWeekIds });
  } catch (err) {
    console.error("Admin release registration failed:", err);
    return NextResponse.json({ error: "Could not release this registration. Please try again." }, { status: 502 });
  }
}
