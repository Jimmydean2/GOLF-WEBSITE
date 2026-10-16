import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { reauthenticate } from "@/lib/adminSessions";
import { clientIp } from "@/lib/rateLimit";

// "Confirm your password to continue": refreshes the session's recent-password check so
// payment actions are allowed for the next 15 minutes. Shares the login lockout.
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = await reauthenticate({
    sessionId: guard.session.id,
    password: String(body.password ?? ""),
    ip: clientIp(request),
  });
  if (!result.ok) {
    if (result.reason === "locked") {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);
      return NextResponse.json(
        { error: `Too many incorrect attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    }
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  return NextResponse.json({ success: true });
}
