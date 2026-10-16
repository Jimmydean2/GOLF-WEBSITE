import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { getSchedulerHealth } from "@/lib/scheduledCheck";

export const dynamic = "force-dynamic";

// GET /api/health/scheduler
// For an optional uptime monitor (a free one that emails or texts you when a page stops
// answering with 200): 200 while the scheduled check has run in the last 20 minutes, 503 when
// it has not, so a silently stopped scheduler is noticed. It reveals nothing but that, and
// changes nothing.
export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ status: "not_configured" }, { status: 503 });
  try {
    const health = await getSchedulerHealth();
    return NextResponse.json(
      { status: health.status, minutesSinceLastRun: health.minutesSinceLastRun },
      { status: health.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
