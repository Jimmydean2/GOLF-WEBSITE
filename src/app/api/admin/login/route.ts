import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isAdminConfigured, sessionCookieOptions } from "@/lib/adminAuth";
import { attemptLogin } from "@/lib/adminSessions";
import { isDatabaseConfigured } from "@/lib/db";
import { clientIp } from "@/lib/rateLimit";
import { isSameOriginRequest } from "@/lib/requestGuards";

export async function POST(request: Request) {
  if (!isAdminConfigured() || !isDatabaseConfigured()) {
    return NextResponse.json({ error: "Admin access isn't set up yet." }, { status: 503 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = await attemptLogin({
    password: String(body.password ?? ""),
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? "",
  });

  if (!result.ok) {
    if (result.reason === "not_configured") {
      return NextResponse.json({ error: "Admin access isn't set up yet." }, { status: 503 });
    }
    if (result.reason === "locked") {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);
      return NextResponse.json(
        { error: `Too many incorrect attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    }
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE_NAME, result.token, sessionCookieOptions());
  return response;
}
