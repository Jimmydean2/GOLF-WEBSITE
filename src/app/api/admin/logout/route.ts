import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, getAdminSessionToken } from "@/lib/adminAuth";
import { revokeSession } from "@/lib/adminSessions";
import { isDatabaseConfigured } from "@/lib/db";

// Ends this session on the server (it can't be reused even if the cookie was copied),
// then clears the cookie. The logout button is a plain form POST, so this answers with a
// redirect back to the login page.
export async function POST(request: Request) {
  if (isDatabaseConfigured()) {
    const token = await getAdminSessionToken();
    if (token) await revokeSession(token).catch(() => {});
  }
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.delete(ADMIN_COOKIE_NAME);
  return response;
}
