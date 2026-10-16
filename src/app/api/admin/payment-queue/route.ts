import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { getPaymentQueue } from "@/lib/campDb";
import { getEmailHealth } from "@/lib/outbox";
import { getSchedulerHealth, maybeRunFromTraffic } from "@/lib/scheduledCheck";
import { siteOrigin } from "@/lib/siteUrl";
import { logError } from "@/lib/safeLog";

// The administrators' review queue: reported payments (most overdue first), unreported
// holds, and recent releases, plus whether the automatic check is running and whether emails
// are getting out. Reading it also releases any 12-hour hold that has ended, and if the
// automatic check has gone quiet, opening the queue starts one.
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }
  try {
    const [queue, scheduler, email] = await Promise.all([getPaymentQueue(), getSchedulerHealth(), getEmailHealth()]);
    if (scheduler.status !== "ok") {
      const origin = siteOrigin(request.url);
      after(() => maybeRunFromTraffic(origin, { source: "manual" }).catch((err) => logError("Scheduled check from the dashboard failed:", err)));
    }
    return NextResponse.json({ ...queue, health: { scheduler, email } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logError("Payment queue read failed:", err);
    return NextResponse.json({ error: "Could not load the review queue." }, { status: 502 });
  }
}
