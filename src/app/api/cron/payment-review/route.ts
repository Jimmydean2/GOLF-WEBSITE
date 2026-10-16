import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { runScheduledCheck } from "@/lib/scheduledCheck";
import { siteOrigin } from "@/lib/siteUrl";

// How long the platform may let one run take. A run stops starting new work after about 25
// seconds, and every mail connection has its own timeout, so this is a ceiling, not a target.
export const maxDuration = 60;

// GET /api/cron/payment-review
// The scheduled check (see src/lib/scheduledCheck.ts): releases reservations whose 12-hour hold
// ended with no payment report, queues reminders, sends the administrators' alerts and every
// email waiting in the outbox. Safe to call as often as you like, even at once; nothing is
// done or sent twice. It never releases, confirms or changes a payment a parent has reported.
//
// Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token; any other scheduler can
// send the same header). It is NOT scheduled by anything in this repository: no vercel.json
// cron is configured, so nothing calls it until you choose a scheduler (docs/SCHEDULING.md).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "The scheduled check isn't set up." }, { status: 503 });
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const summary = await runScheduledCheck({ source: "cron", origin: siteOrigin(request.url) });
  // A failed run is a failed request, so a scheduler that reports failures (GitHub Actions,
  // for one) tells the owner.
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
}
