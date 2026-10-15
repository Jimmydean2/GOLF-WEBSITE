import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { searchRegistrations } from "@/lib/campDb";

// Server-side authorized — the session cookie is re-checked here
// independently of any admin page, not just hidden behind a client-side
// password screen.
export async function GET(request: Request) {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchRegistrations(q);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("Admin registration search failed:", err);
    return NextResponse.json({ error: "Search failed. Please try again." }, { status: 502 });
  }
}
