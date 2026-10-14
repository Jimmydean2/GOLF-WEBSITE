import { NextResponse } from "next/server";
import { isAdminRequestAuthenticated } from "@/lib/adminAuth";
import { buildCampRosterWorkbook } from "@/lib/campRoster";
import { isGoogleSheetsConfigured } from "@/lib/googleSheets";

export async function GET() {
  if (!(await isAdminRequestAuthenticated())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  if (!isGoogleSheetsConfigured()) {
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
    console.error("Failed to build camp roster workbook:", err);
    return NextResponse.json(
      { error: "Could not generate the roster right now. Please try again." },
      { status: 502 }
    );
  }
}
