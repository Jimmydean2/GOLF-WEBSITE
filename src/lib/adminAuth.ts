import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "./db";
import { rateLimit } from "./rateLimit";
import { isSameOriginRequest } from "./requestGuards";
import { getSessionByToken, isFresh, SESSION_MAX_HOURS, type AdminSession } from "./adminSessions";

// Server-only. Gates the /admin area and every admin API route. This is the Next.js side
// (cookies, responses); the session and lockout logic is in adminSessions.ts.

export const ADMIN_COOKIE_NAME = "jdg_admin_session";
export { isAdminConfigured } from "./adminSessions";

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_HOURS * 60 * 60,
  };
}

export async function getAdminSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ADMIN_COOKIE_NAME)?.value ?? null;
}

export async function getAdminSession(): Promise<(AdminSession & { token: string }) | null> {
  if (!isDatabaseConfigured()) return null;
  const token = await getAdminSessionToken();
  if (!token) return null;
  const session = await getSessionByToken(token);
  return session ? { ...session, token } : null;
}

export async function isAdminRequestAuthenticated(): Promise<boolean> {
  return (await getAdminSession()) !== null;
}

export type AdminGuard = { ok: true; session: AdminSession & { token: string } } | { ok: false; response: NextResponse };

// The check every admin API route starts with:
//   * a live session (random token, not revoked, not expired or idle);
//   * for anything that changes data, the request must come from this site's own pages;
//   * a per-session request limit;
//   * with { fresh: true } (payment actions), a password check within the last 15 minutes.
//
// evaluateAdminRequest holds the whole decision and takes the session token as an argument,
// so the automated tests can exercise it directly; requireAdmin just reads the cookie first.
export async function evaluateAdminRequest(
  request: Request,
  token: string | null,
  opts: { fresh?: boolean } = {}
): Promise<AdminGuard> {
  const found = isDatabaseConfigured() && token ? await getSessionByToken(token) : null;
  if (!found || !token) {
    return { ok: false, response: NextResponse.json({ error: "Not authorized." }, { status: 401 }) };
  }
  const session = { ...found, token };
  const readOnly = request.method === "GET" || request.method === "HEAD";
  if (!readOnly && !isSameOriginRequest(request)) {
    return { ok: false, response: NextResponse.json({ error: "Request blocked." }, { status: 403 }) };
  }
  const limit = await rateLimit("admin-api", session.id, 120, 60);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      ),
    };
  }
  if (opts.fresh && !isFresh(session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Please confirm your password to continue.", code: "reauth_required" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, session };
}

export async function requireAdmin(request: Request, opts: { fresh?: boolean } = {}): Promise<AdminGuard> {
  return evaluateAdminRequest(request, await getAdminSessionToken(), opts);
}
