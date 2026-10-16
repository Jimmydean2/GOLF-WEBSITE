import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { buildCampRosterWorkbook } from "@/lib/campRoster";
import { recordAudit } from "@/lib/campDb";
import { isDatabaseConfigured } from "@/lib/db";
import { isRosterProfile, isRosterWeek, buildRosterCsv, rosterFilename } from "@/lib/rosterExport";
import { logError } from "@/lib/safeLog";

// POST /api/admin/camp-rosters/download   { format: "xlsx" | "csv", week: "all" | <week id>, profile: "full" | "signin" }
//
// The roster is the children's names, parents' phone numbers and (in the full version) health
// notes and emergency contacts, so a download needs the same things any sensitive action does:
// the administrator's login, a recent password check, and a request from this site (a plain
// link would skip the password check, which is why this is not a GET any more). The file is
// never cached, is named CONFIDENTIAL, and each download is written to the audit log: what,
// which week, how many rows. The log holds no personal details.
//
// Built from the Postgres registrations, never from Google Sheets.
export async function POST(request: Request) {
  const guard = await requireAdmin(request, { fresh: true });
  if (!guard.ok) return guard.response;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { format, week, profile } = body;
  if (format !== "xlsx" && format !== "csv") return NextResponse.json({ error: "Choose Excel or CSV." }, { status: 400 });
  if (!isRosterWeek(week)) return NextResponse.json({ error: "Choose a camp week, or all weeks." }, { status: 400 });
  if (!isRosterProfile(profile)) return NextResponse.json({ error: "Choose the full roster or the sign-in sheet." }, { status: 400 });

  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };

  try {
    if (format === "csv") {
      const result = await buildRosterCsv({ weekId: week, profile });
      await recordAudit("roster_download", week, { format, profile, weeks: result.weekCount, rows: result.rowCount }, "roster");
      return new NextResponse(result.csv, {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        },
      });
    }

    const workbook = await buildCampRosterWorkbook({ weekId: week === "all" ? undefined : week, profile });
    const buffer = await workbook.xlsx.writeBuffer();
    // Rows are counted from the sheets themselves: every row with a child's name.
    let rows = 0;
    workbook.eachSheet((sheet) => {
      if (sheet.name === "Read Me First") return;
      for (let r = 8; r <= sheet.rowCount; r++) if (sheet.getRow(r).getCell(2).value) rows++;
    });
    await recordAudit("roster_download", week, { format, profile, weeks: workbook.worksheets.length - 1, rows }, "roster");
    return new NextResponse(buffer, {
      headers: {
        ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${rosterFilename("xlsx", week, profile)}"`,
      },
    });
  } catch (err) {
    logError("Failed to build the camp roster download:", err);
    return NextResponse.json({ error: "Could not generate the roster right now. Please try again." }, { status: 502 });
  }
}
