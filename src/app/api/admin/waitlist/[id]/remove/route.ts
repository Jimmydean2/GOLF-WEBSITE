import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { removeWaitlistEntry } from "@/lib/waitlist";
import { logError } from "@/lib/safeLog";

// POST /api/admin/waitlist/[id]/remove: takes a family off the list and erases their entry.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const removed = await removeWaitlistEntry(id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "That family is no longer on the list." }, { status: 404 });
  } catch (err) {
    logError("Removing a waiting-list entry failed:", err);
    return NextResponse.json({ error: "Could not remove. Nothing was changed." }, { status: 502 });
  }
}
