import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { buildCampRosterWorkbook } from "@/lib/campRoster";
import { isDatabaseConfigured } from "@/lib/db";
import { logError } from "@/lib/safeLog";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  // The roster is built from the Postgres registrations (not Google Sheets).
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  try {
    const workbook = await buildCampRosterWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Junior-Camp-Rosters-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    logError("Failed to build camp roster workbook:", err);
    return NextResponse.json(
      { error: "Could not generate the roster right now. Please try again." },
      { status: 502 }
    );
  }
}
