import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { recordAudit } from "@/lib/campDb";
import { applyRetention, previewRetention } from "@/lib/privacyData";
import { logError } from "@/lib/safeLog";

// The clean-up after the season. GET shows who is due (counts and references, no personal
// details). POST does it: it needs login, a recent password check, and the words CLEAN UP typed
// back. It overwrites personal details of families whose last camp week ended more than the
// retention period ago and keeps the accounting record. A registration with an unresolved payment
// is never touched. See src/lib/privacyData.ts.
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  try {
    const plan = await previewRetention();
    return NextResponse.json({
      retentionDays: plan.retentionDays,
      due: plan.due.length,
      blocked: plan.blocked.map((b) => ({ reference: b.reference, status: b.status, lastWeekEnded: b.lastWeekEnded })),
    });
  } catch (err) {
    logError("Reading the retention plan failed:", err);
    return NextResponse.json({ error: "Could not read the clean-up status." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // fails the confirmation below
  }
  if (String(body.confirm ?? "").trim() !== "CLEAN UP") {
    return NextResponse.json({ error: "Type CLEAN UP to confirm. Nothing was changed." }, { status: 400 });
  }
  try {
    const result = await applyRetention();
    await recordAudit("retention_cleanup", "season", { anonymized: result.anonymized, blocked: result.blocked, waitlistDeleted: result.purgedWaitlist }, "season");
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    logError("The season clean-up failed:", err);
    return NextResponse.json({ error: "The clean-up stopped part-way. Nothing already erased is lost; run it again." }, { status: 502 });
  }
}
