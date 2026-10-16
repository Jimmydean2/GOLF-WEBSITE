import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { grantReviewExtension } from "@/lib/campDb";

// POST /api/admin/camp-registrations/[id]/extend
// A time-limited extension of the verification review, for example when the bank shows the
// transfer as pending. Needs login, a recent password check, a note, and a length within the
// cap. Counted, logged, and limited per registration; it never releases or confirms anything.
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

  try {
    const result = await grantReviewExtension(id, { hours: Number(body.hours), note: String(body.note ?? "") });
    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
          return NextResponse.json({ error: "Registration not found." }, { status: 404 });
        case "not_reported":
          return NextResponse.json({ error: "Only a registration with a reported payment can be extended." }, { status: 409 });
        case "too_many_extensions":
          return NextResponse.json(
            { error: "This registration has used all its extensions. Confirm it, or release it as payment not received." },
            { status: 409 }
          );
        case "invalid_input":
          return NextResponse.json({ error: result.message ?? "Check the details and try again." }, { status: 400 });
      }
    }
    return NextResponse.json({ success: true, reviewDueAt: result.reviewDueAt, extensionsLeft: result.extensionsLeft });
  } catch (err) {
    console.error("Admin extension failed:", err);
    return NextResponse.json({ error: "Could not extend the review. Nothing was changed." }, { status: 502 });
  }
}
