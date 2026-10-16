import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, requireAdmin } from "@/lib/adminAuth";
import { revokeAllSessions } from "@/lib/adminSessions";

// "Log out everywhere": ends every admin session, this one included. Use it if a phone is
// lost or a session might have been seen by someone else. Needs a recent password check.
export async function POST(request: Request) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;
  const count = await revokeAllSessions();
  const response = NextResponse.json({ success: true, sessionsEnded: count });
  response.cookies.delete(ADMIN_COOKIE_NAME);
  return response;
}
