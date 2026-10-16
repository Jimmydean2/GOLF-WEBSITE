import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { isWaitlistEnabled, listWaitlist } from "@/lib/waitlist";
import { logError } from "@/lib/safeLog";

// GET /api/admin/waitlist: who is waiting for which full week, in the order they joined. Login
// required. Nobody on it holds a place.
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  try {
    return NextResponse.json({ enabled: isWaitlistEnabled(), weeks: await listWaitlist() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logError("Reading the waiting list failed:", err);
    return NextResponse.json({ error: "Could not load the waiting list." }, { status: 502 });
  }
}
