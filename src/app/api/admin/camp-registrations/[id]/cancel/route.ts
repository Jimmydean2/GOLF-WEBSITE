import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { cancelRegistration } from "@/lib/campDb";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // reason is optional — an empty body is fine
  }
  const reason = String(body.reason ?? "").trim() || "Cancelled by admin";

  try {
    const result = await cancelRegistration(id, reason);
    if (!result.ok) {
      return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, releasedWeekIds: result.releasedWeekIds });
  } catch (err) {
    console.error("Admin cancel registration failed:", err);
    return NextResponse.json({ error: "Could not cancel this registration. Please try again." }, { status: 502 });
  }
}
