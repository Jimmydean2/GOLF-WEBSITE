import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { getPaymentQueue } from "@/lib/campDb";

// The administrators' review queue: reported payments (most overdue first), unreported
// holds, and recent releases. Reading it also releases any 12-hour hold that has ended.
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }
  try {
    return NextResponse.json(await getPaymentQueue(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Payment queue read failed:", err);
    return NextResponse.json({ error: "Could not load the review queue." }, { status: 502 });
  }
}
