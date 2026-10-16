import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { getAuditLog } from "@/lib/campDb";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  try {
    const entries = await getAuditLog(200);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("Admin audit log read failed:", err);
    return NextResponse.json({ error: "Could not load the audit log." }, { status: 502 });
  }
}
