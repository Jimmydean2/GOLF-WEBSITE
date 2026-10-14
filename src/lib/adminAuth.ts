import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// Server-only. Gates the /admin area (currently just the camp roster
// download) behind a single shared password, set as ADMIN_PASSWORD. No
// user accounts — this is a one-person tool for Coach James.

export const ADMIN_COOKIE_NAME = "jdg_admin_session";

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  return safeEqual(password, expected);
}

// The cookie never stores the raw password — just a hash of it, so the
// session token itself is useless outside this app.
export function adminSessionToken(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return createHash("sha256").update(password).digest("hex");
}

export async function isAdminRequestAuthenticated(): Promise<boolean> {
  const expected = adminSessionToken();
  if (!expected) return false;
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return false;
  return safeEqual(token, expected);
}
