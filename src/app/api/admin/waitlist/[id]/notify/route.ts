import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { notifyWaitlistEntry } from "@/lib/waitlist";
import { processOutbox } from "@/lib/outbox";
import { siteOrigin } from "@/lib/siteUrl";
import { logError } from "@/lib/safeLog";

// POST /api/admin/waitlist/[id]/notify
// Tells ONE family that a place may have opened. Allowed only while that week really has room and
// is open, and the family does not already hold a place. It holds nothing and books nothing: the
// email says so, and the family registers the usual way, first come, first served.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const result = await notifyWaitlistEntry(id);
    if (!result.ok) {
      const messages: Record<string, [number, string]> = {
        not_found: [404, "That family is no longer on the list."],
        week_full: [409, "That week is full right now, so there is nothing to tell them. Nothing was sent."],
        week_closed: [409, "That week is closed. Reopen it first if you want to take registrations. Nothing was sent."],
        already_registered: [409, "That family already holds a place this week, so there is nothing to tell them. Nothing was sent."],
        too_many: [409, "That family has already been emailed three times. Nothing was sent."],
        too_soon: [409, "That family was emailed less than 12 hours ago. Nothing was sent."],
      };
      const [status, error] = messages[result.reason];
      return NextResponse.json({ error, code: result.reason }, { status });
    }
    const origin = siteOrigin(request.url);
    after(() => processOutbox({ waitlistEntryId: id, origin }).catch((err) => logError("Sending the waiting-list email failed (it stays queued):", err)));
    return NextResponse.json({ success: true, notifiedCount: result.notifiedCount });
  } catch (err) {
    logError("Waiting-list notice failed:", err);
    return NextResponse.json({ error: "Could not send. Nothing was changed." }, { status: 502 });
  }
}
