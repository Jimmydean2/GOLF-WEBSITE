import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { runScheduledCheck } from "@/lib/scheduledCheck";
import { siteOrigin } from "@/lib/siteUrl";

export const maxDuration = 60;

// POST /api/admin/run-check
// "Run the check now": the same scheduled check the cron runs (release unreported holds past
// 12 hours, send alerts and every email waiting), started by the administrator. Handy after
// fixing the mail connection, and for rehearsals. It cannot confirm, release or change any
// payment a parent has reported.
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }
  const summary = await runScheduledCheck({ source: "manual", origin: siteOrigin(request.url) });
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
}
