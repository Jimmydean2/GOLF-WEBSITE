import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { markSpotCheckedIn } from "@/lib/campDb";

export async function POST(request: Request, { params }: { params: Promise<{ spotId: string }> }) {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { spotId } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // default to checking in
  }
  const checkedIn = body.checkedIn !== false;

  try {
    await markSpotCheckedIn(spotId, checkedIn);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin check-in failed:", err);
    return NextResponse.json({ error: "Could not update check-in status. Please try again." }, { status: 502 });
  }
}
