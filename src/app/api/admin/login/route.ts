import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, adminSessionToken, checkAdminPassword, isAdminConfigured } from "@/lib/adminAuth";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Admin access isn't set up yet." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const password = String(body.password ?? "");
  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE_NAME, adminSessionToken()!, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return response;
}
