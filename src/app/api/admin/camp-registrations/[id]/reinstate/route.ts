import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { reinstateRegistration } from "@/lib/campDb";
import { juniorCamps } from "@/lib/content";
import { logError } from "@/lib/safeLog";

const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

// POST /api/admin/camp-registrations/[id]/reinstate
// Takes a released registration's spots back WITHOUT confirming payment, with a fresh
// bounded clock (a new 12-hour hold, or a new 48-hour review if the parent had reported).
// All-or-nothing with a capacity check; at most 2 reinstatements per registration. To
// restore a spot for a deposit you have verified, use Confirm payment instead.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let result;
  try {
    result = await reinstateRegistration(id);
  } catch (err) {
    logError("Admin reinstate failed:", err);
    return NextResponse.json({ error: "Could not reinstate this registration. Nothing was changed." }, { status: 502 });
  }

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return NextResponse.json({ error: "Registration not found." }, { status: 404 });
      case "not_released":
        return NextResponse.json({ error: "Only a released registration can be reinstated." }, { status: 409 });
      case "no_spots":
        return NextResponse.json({ error: "This registration has no spots to restore." }, { status: 409 });
      case "too_many_reinstatements":
        return NextResponse.json(
          { error: "This registration has already been reinstated twice. Confirm it with a verified deposit, or leave it released." },
          { status: 409 }
        );
      case "weeks_full":
        return NextResponse.json(
          { error: `${result.fullWeekIds.map(weekLabel).join(", ")} is now full, so this registration's spots can't be restored. Nothing was changed.` },
          { status: 409 }
        );
      case "weeks_closed":
        return NextResponse.json(
          { error: `${result.closedWeekIds.map(weekLabel).join(", ")} is now closed, so this registration's spots can't be restored. Nothing was changed. Reopen the week first.` },
          { status: 409 }
        );
    }
  }

  return NextResponse.json({ success: true, reinstatedWeekIds: result.reinstatedWeekIds });
}
