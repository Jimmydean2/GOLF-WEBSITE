import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { dispatchDueAlerts } from "@/lib/alerts";

// GET /api/cron/payment-review
// The scheduled check: releases unreported reservations past their 12-hour hold, and sends
// the administrators' alerts and the parents' release notices that are due. Safe to call as
// often as you like; each alert is sent once. It does nothing to a reported payment except
// alert about it: nothing here ever releases or confirms one.
//
// Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token). It is NOT scheduled by
// anything in this repository: no vercel.json cron is configured, so nothing runs until you
// choose a schedule (a paid plan allows frequent runs; the free plan allows one a day).
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

  try {
    const summary = await dispatchDueAlerts({ dashboardUrl: new URL("/admin/camp-rosters", request.url).toString() });
    return NextResponse.json({
      ok: true,
      released: summary.released.length,
      alertsSent: summary.alerts.length,
      parentNotices: summary.parentNotices.length,
      failures: summary.failures,
      skipped: summary.skipped ?? null,
    });
  } catch (err) {
    console.error("Scheduled payment review failed:", err);
    return NextResponse.json({ error: "The scheduled check failed." }, { status: 502 });
  }
}
