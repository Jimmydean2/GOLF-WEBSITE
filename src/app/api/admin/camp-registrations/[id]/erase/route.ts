import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { getRegistrationSnapshot } from "@/lib/campDb";
import { eraseFamily } from "@/lib/privacyData";
import { logError } from "@/lib/safeLog";

// POST /api/admin/camp-registrations/[id]/erase    body: { confirmReference, removePayerName? }
// Erases one family's personal details now (a family asked, or a duplicate/test registration
// should go). It cannot be undone, so it needs login, a recent password check, and the
// registration's own reference typed back. A registration that still holds spots is cancelled
// first (the places go back to other families); the family is not emailed. The accounting record
// stays. See src/lib/privacyData.ts for exactly what is erased.
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
    // an empty body fails the reference check below
  }

  try {
    const registration = await getRegistrationSnapshot(id);
    if (!registration) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    if (String(body.confirmReference ?? "").trim().toUpperCase() !== registration.reference.toUpperCase()) {
      return NextResponse.json({ error: "Type the registration's reference exactly to confirm. Nothing was changed." }, { status: 400 });
    }
    const result = await eraseFamily(id, { removePayerName: body.removePayerName === true, why: "erased from the dashboard" });
    if (!result.ok) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    return NextResponse.json({ success: true, alreadyErased: result.alreadyErased, releasedWeekIds: result.releasedWeekIds });
  } catch (err) {
    logError("Erasing a family's details failed:", err);
    return NextResponse.json({ error: "Could not erase this registration. Nothing was lost; please try again." }, { status: 502 });
  }
}
