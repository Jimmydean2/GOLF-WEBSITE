import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { reinstateRegistration } from "@/lib/campDb";
import { juniorCamps } from "@/lib/content";

const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

// POST /api/admin/camp-registrations/[id]/reinstate
// Takes a released registration's spots back and returns it to "Awaiting
// payment" — without confirming payment. The spots are re-reserved
// all-or-nothing with a capacity check; if any week is full or closed nothing
// changes. A reinstated reservation has no expiry: only the owner releases it.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let result;
  try {
    result = await reinstateRegistration(id);
  } catch (err) {
    console.error("Admin reinstate failed:", err);
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
      case "weeks_full":
        return NextResponse.json(
          {
            error: `${result.fullWeekIds.map(weekLabel).join(", ")} is now full, so this registration's spots can't be restored. Nothing was changed.`,
          },
          { status: 409 }
        );
      case "weeks_closed":
        return NextResponse.json(
          {
            error: `${result.closedWeekIds.map(weekLabel).join(", ")} is now closed, so this registration's spots can't be restored. Nothing was changed — reopen the week first.`,
          },
          { status: 409 }
        );
    }
  }

  return NextResponse.json({ success: true, reinstatedWeekIds: result.reinstatedWeekIds });
}
