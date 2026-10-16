import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { recordAudit } from "@/lib/campDb";
import { exportFamilyData } from "@/lib/privacyData";
import { logError } from "@/lib/safeLog";

// POST /api/admin/camp-registrations/[id]/export
// A family asks to see what we hold about them (or wants a copy): everything the system holds
// about one registration, as a file the owner can send them. Personal data, so it needs login
// AND a recent password check, and the download is recorded in the audit log.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  try {
    const data = await exportFamilyData(id);
    if (!data) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    await recordAudit("export_family_data", id, {});
    return NextResponse.json({ success: true, data });
  } catch (err) {
    logError("Exporting a family's data failed:", err);
    return NextResponse.json({ error: "Could not prepare the file. Please try again." }, { status: 502 });
  }
}
