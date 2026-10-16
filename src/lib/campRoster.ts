import ExcelJS from "exceljs";
import { business, juniorCamps, locations } from "./content";
import { getCampWeeks, getWeekRoster } from "./campDb";

// Server-only. Builds the printable Junior Camp roster workbook straight
// from live registration data — one sheet per camp week, at least 30 rows each
// (more if you have authorized a bigger week, up to 33), auto-filled with
// whoever has actually registered. See /admin/camp-rosters and BOOKING_SETUP.md.
//
// Two profiles. "full" is the complete working roster (health notes, emergency contacts, both
// phone numbers). "signin" is a sign-in sheet that leaves out the health notes and emergency
// details and only says whether a medical note exists, for a sheet that will lie on a table or be
// handed to a helper. Both are labelled confidential.

const FOREST = "FF1F4A34";
const FOREST_DARK = "FF143324";
const GOLD_DEEP = "FF8A6423";
const CREAM_DARK = "FFF3EAD4";
const INK = "FF1B1B16";
const INK_SOFT = "FF4A463C";
const WHITE = "FFFFFFFF";
const BORDER_COLOR = "FFC9BD9A";
const FLAG = "FF9B2C2C";

// The standard week size, and the minimum number of numbered rows on a printed sheet. A week
// the administrator has authorized above 30 gets its extra rows too, so no registered child
// can ever be missing from the printout.
const MAX_CAMPERS = 30;

export type RosterProfile = "full" | "signin";
export const ROSTER_PROFILES: readonly RosterProfile[] = ["full", "signin"];

type ColumnKey =
  | "n"
  | "childName"
  | "childAge"
  | "parentName"
  | "primaryPhone"
  | "secondaryPhone"
  | "emergencyContact"
  | "emergencyPhone"
  | "healthInfo"
  | "medicalNoteOnFile"
  | "paid"
  | "checkedIn";

type Column = { key: ColumnKey; header: string; width: number; center?: boolean; wrap?: boolean; profiles: RosterProfile[] };

// The "full" layout is exactly what was printed before profiles existed (column positions
// included): # B..K.
const COLUMNS: Column[] = [
  { key: "n", header: "#", width: 4, center: true, profiles: ["full", "signin"] },
  { key: "childName", header: "Child's Full Name", width: 24, profiles: ["full", "signin"] },
  { key: "childAge", header: "Age", width: 6, center: true, profiles: ["full", "signin"] },
  { key: "parentName", header: "Parent / Guardian Name", width: 24, profiles: ["full", "signin"] },
  { key: "primaryPhone", header: "Parent Phone", width: 15, profiles: ["full", "signin"] },
  { key: "secondaryPhone", header: "Secondary Phone", width: 15, profiles: ["full"] },
  { key: "emergencyContact", header: "Emergency Contact (Name & Relationship)", width: 32, profiles: ["full"] },
  { key: "emergencyPhone", header: "Emergency Phone", width: 15, profiles: ["full"] },
  { key: "healthInfo", header: "Allergies / Medical Notes", width: 32, wrap: true, profiles: ["full"] },
  { key: "medicalNoteOnFile", header: "Medical note on file (Y/N)", width: 14, center: true, profiles: ["signin"] },
  { key: "paid", header: "Paid (Y/N)", width: 10, center: true, profiles: ["full", "signin"] },
  { key: "checkedIn", header: "Checked In", width: 14, center: true, profiles: ["full", "signin"] },
];
const columnsFor = (profile: RosterProfile) => COLUMNS.filter((c) => c.profiles.includes(profile));

export type RosterRow = {
  spotId: string;
  childName: string;
  childAge: string;
  parentName: string;
  primaryPhone: string;
  secondaryPhone: string;
  parentEmail: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyContact: string;
  emergencyPhone: string;
  healthInfo: string;
  medicalNoteOnFile: "Y" | "N";
  reference: string;
  paid: "Y" | "N";
  /** What the owner may rely on: Paid, or one of the two unpaid states. */
  paymentStatus: string;
  checkedIn: "Y" | "N";
  checkedInAt: string | null;
};

export type WeekRoster = {
  id: string;
  label: string;
  startDate: string; // ISO date of the Monday, the week's id
  capacity: number; // this week's limit right now (30 unless raised by an administrator)
  rows: RosterRow[];
};

// "None", "n/a", "Aucun" and the like are an answer, not a medical note.
const NO_NOTE = /^(none|n\/a|na|nil|no|nothing|nothing to report|aucun|aucune|non|rien|néant|neant|-+|\.+)$/i;
export function hasMedicalNote(text: string): boolean {
  const trimmed = text.trim().replace(/[.!\s]+$/g, "");
  return trimmed !== "" && !NO_NOTE.test(trimmed);
}

export function paymentStatusText(status: string): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "payment_reported":
      return "Payment reported, not yet verified";
    case "pending_payment":
      return "Awaiting payment";
    default:
      return status;
  }
}

// Postgres (src/lib/campDb.ts) is the authoritative source — the same
// data the capacity counter is built from, so a roster for a week that's
// hit 30 confirmed children always contains exactly those 30, no matter
// what Google Sheets (an optional, off-by-default copy) happens to show.
export async function getCampRosterData(onlyWeekId?: string): Promise<WeekRoster[]> {
  const weekRosters: WeekRoster[] = [];
  const capacityById = new Map((await getCampWeeks()).map((w) => [w.id, w.maxCapacity]));
  for (const week of juniorCamps.weeks) {
    if (onlyWeekId && week.id !== onlyWeekId) continue;
    const spots = await getWeekRoster(week.id);
    const rows: RosterRow[] = spots
      .filter((s) => s.status !== "cancelled")
      .sort((a, b) => a.childName.localeCompare(b.childName))
      .map((s) => ({
        spotId: s.spotId,
        childName: s.childName,
        childAge: s.age,
        parentName: s.parentName,
        primaryPhone: s.primaryPhone,
        secondaryPhone: s.secondaryPhone,
        parentEmail: s.email,
        emergencyName: s.emergencyName,
        emergencyRelationship: s.emergencyRelationship,
        emergencyContact: s.emergencyRelationship ? `${s.emergencyName} (${s.emergencyRelationship})` : s.emergencyName,
        emergencyPhone: s.emergencyPhone,
        healthInfo: s.healthInfo,
        medicalNoteOnFile: hasMedicalNote(s.healthInfo) ? "Y" : "N",
        reference: s.reference,
        paid: s.status === "paid" ? "Y" : "N",
        paymentStatus: paymentStatusText(s.status),
        checkedIn: s.checkedInAt ? "Y" : "N",
        checkedInAt: s.checkedInAt,
      }));
    weekRosters.push({ id: week.id, label: week.label, startDate: week.id, capacity: capacityById.get(week.id) ?? MAX_CAMPERS, rows });
  }
  return weekRosters;
}

function border(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin", color: { argb: BORDER_COLOR } },
    left: { style: "thin", color: { argb: BORDER_COLOR } },
    bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    right: { style: "thin", color: { argb: BORDER_COLOR } },
  };
}

const CONFIDENTIAL_SHEET_NOTE =
  "CONFIDENTIAL: contains children's personal information. Keep it on site, out of sight of other families, and shred printouts when the week is over. Pulled live from online registrations. Add walk-ins or phone/email sign-ups in the blank rows below.";
const CONFIDENTIAL_SIGNIN_NOTE =
  "CONFIDENTIAL sign-in sheet: contains children's names and parents' phone numbers. Health and emergency details are NOT on this sheet (it only says whether a medical note exists): look them up in the full roster. Shred printouts when the week is over. Add walk-ins in the blank rows below.";

function buildWeekSheet(wb: ExcelJS.Workbook, tabName: string, weekRoster: WeekRoster, profile: RosterProfile) {
  const columns = columnsFor(profile);
  const ws = wb.addWorksheet(tabName, {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  const lastCol = columns.length;
  const lastColLetter = ws.getColumn(lastCol).letter;
  const venue = locations[juniorCamps.venue];

  ws.mergeCells(`A1:${lastColLetter}1`);
  ws.getCell("A1").value = "James Dean Golf — Junior Camp Roster";
  ws.getCell("A1").font = { name: "Arial", size: 16, bold: true, color: { argb: FOREST } };
  ws.getRow(1).height = 24;

  ws.mergeCells(`A2:${lastColLetter}2`);
  ws.getCell("A2").value = `Week: ${weekRoster.label}`;
  ws.getCell("A2").font = { name: "Arial", size: 11, bold: true, color: { argb: INK } };

  ws.mergeCells(`A3:${lastColLetter}3`);
  ws.getCell("A3").value =
    `${juniorCamps.hours}  ·  ${venue.name}, ${venue.address}  ·  Max ${weekRoster.capacity} campers`;
  ws.getCell("A3").font = { name: "Arial", size: 9, italic: true, color: { argb: INK_SOFT } };

  ws.mergeCells(`A4:${lastColLetter}4`);
  ws.getCell("A4").value = `Registered: ${weekRoster.rows.length} of ${weekRoster.capacity}`;
  ws.getCell("A4").font = { name: "Arial", size: 10, bold: true, color: { argb: FOREST_DARK } };

  ws.mergeCells(`A5:${lastColLetter}5`);
  ws.getCell("A5").value = profile === "signin" ? CONFIDENTIAL_SIGNIN_NOTE : CONFIDENTIAL_SHEET_NOTE;
  ws.getCell("A5").font = { name: "Arial", size: 9, bold: true, italic: true, color: { argb: FLAG } };
  ws.getCell("A5").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(5).height = 36;

  const headerRowIndex = 7;
  const headerRow = ws.getRow(headerRowIndex);
  columns.forEach((column, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = column.header;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOREST } };
    cell.alignment = { horizontal: column.center ? "center" : "left", vertical: "middle", wrapText: true };
    border(cell);
  });

  const firstDataRow = headerRowIndex + 1;
  const rowCount = Math.max(MAX_CAMPERS, weekRoster.capacity, weekRoster.rows.length);
  for (let i = 0; i < rowCount; i++) {
    const rowIndex = firstDataRow + i;
    const row = ws.getRow(rowIndex);
    const registrant = weekRoster.rows[i];
    const fillColor = i % 2 ? CREAM_DARK : WHITE;

    const values: Record<ColumnKey, string | number> = {
      n: i + 1,
      childName: registrant?.childName ?? "",
      childAge: registrant?.childAge ?? "",
      parentName: registrant?.parentName ?? "",
      primaryPhone: registrant?.primaryPhone ?? "",
      secondaryPhone: registrant?.secondaryPhone ?? "",
      emergencyContact: registrant?.emergencyContact ?? "",
      emergencyPhone: registrant?.emergencyPhone ?? "",
      healthInfo: registrant?.healthInfo ?? "",
      medicalNoteOnFile: registrant?.medicalNoteOnFile ?? "",
      paid: registrant?.paid ?? "",
      checkedIn: registrant?.checkedIn ?? "",
    };

    columns.forEach((column, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = values[column.key];
      cell.font = { name: "Arial", size: 10, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.alignment = { horizontal: column.center ? "center" : "left", vertical: "middle", wrapText: Boolean(column.wrap) };
      border(cell);
    });
  }

  columns.forEach((column, i) => {
    ws.getColumn(i + 1).width = column.width;
  });

  ws.views = [{ state: "frozen", ySplit: headerRowIndex, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `1:${headerRowIndex}`;
}

function buildCoverSheet(wb: ExcelJS.Workbook, weekRosters: WeekRoster[], profile: RosterProfile) {
  const ws = wb.addWorksheet("Read Me First", {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "portrait" },
  });
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 100;

  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = "Junior Camp Rosters — James Dean Golf";
  ws.getCell("A1").font = { name: "Arial", size: 18, bold: true, color: { argb: FOREST } };
  ws.getRow(1).height = 28;

  const generatedAt = new Date().toLocaleString("en-CA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Toronto",
  });

  const totalRegistered = weekRosters.reduce((sum, w) => sum + w.rows.length, 0);
  const oneWeek = weekRosters.length === 1;

  const sections: [string, string][] = [
    [
      "CONFIDENTIAL",
      profile === "signin"
        ? "This workbook contains children's names, ages and their parents' phone numbers. Keep it on a device you control, show it only to the people running the camp, and shred printouts when the week is over. Every download is recorded."
        : "This workbook contains children's names and ages, health notes, emergency contacts and their parents' phone numbers. Keep it on a device you control, show it only to the people running the camp, and shred printouts when the week is over. Every download is recorded. If you only need a sheet for check-in, download the sign-in version instead: it leaves out the health and emergency details.",
    ],
    [
      "Generated",
      `${generatedAt} — pulled live from the registration database. Re-download any time for the latest sign-ups.`,
    ],
    [
      "What this is",
      oneWeek
        ? `A print-ready sign-in sheet for one camp week (${weekRosters[0].label}), with at least 30 numbered rows (more for a week you have authorized above 30).`
        : "One print-ready sign-in sheet per camp week (10 tabs below), each with at least 30 numbered rows (more for a week you have authorized above 30). Hand the right tab to whoever is working that week.",
    ],
    [
      "How to use a week's tab",
      profile === "signin"
        ? "Each row is one camper, already filled in from the registration form where one exists: child's name, age, parent/guardian and phone. “Medical note on file” says Y when the family wrote a health or allergy note (look it up in the full roster). The “Paid” column shows Y once you've confirmed that registration's payment from the admin dashboard, after seeing the deposit in your bank account. Add any walk-in or phone/email sign-ups in the blank rows."
        : "Each row is one camper, already filled in from the registration form where one exists: child's name, age, parent/guardian, both phone numbers, emergency contact, and allergy/medical notes. The “Paid” column shows Y once you've confirmed that registration's payment from the admin dashboard, after seeing the deposit in your bank account. Add any walk-in or phone/email sign-ups in the blank rows.",
    ],
    [
      "Printing",
      "Each tab is already set to landscape and fit-to-page, with the header row repeating on every printed page.",
    ],
  ];

  let row = 3;
  for (const [heading, body] of sections) {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = heading;
    ws.getCell(`A${row}`).font = { name: "Arial", size: 12, bold: true, color: { argb: heading === "CONFIDENTIAL" ? FLAG : FOREST_DARK } };
    row += 1;

    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = body;
    ws.getCell(`A${row}`).font = { name: "Arial", size: 10.5, color: { argb: INK } };
    ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = heading === "CONFIDENTIAL" ? 62 : 48;
    row += 2;
  }

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = `Total registered ${oneWeek ? "for this week" : "across all weeks"}: ${totalRegistered}`;
  ws.getCell(`A${row}`).font = { name: "Arial", size: 12, bold: true, color: { argb: FOREST_DARK } };
  row += 2;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = oneWeek ? "This week" : "Per week";
  ws.getCell(`A${row}`).font = { name: "Arial", size: 12, bold: true, color: { argb: FOREST_DARK } };
  row += 1;

  for (const w of weekRosters) {
    ws.getCell(`A${row}`).value = "•";
    ws.getCell(`A${row}`).font = { name: "Arial", size: 10, color: { argb: GOLD_DEEP } };
    const cell = ws.getCell(`B${row}`);
    cell.value = `${w.label} — ${w.rows.length} of ${w.capacity}`;
    cell.font = { name: "Arial", size: 10, color: { argb: INK } };
    row += 1;
  }
}

// The sheet tab for a week, e.g. "Jun 21-25", comes from the season calendar.
function tabName(weekId: string): string {
  return juniorCamps.weeks.find((w) => w.id === weekId)?.shortLabel ?? weekId;
}

// With no options: every week, full details (what the dashboard has always offered). A week id
// gives just that week; "signin" leaves out the health and emergency details.
export async function buildCampRosterWorkbook(options: { weekId?: string; profile?: RosterProfile } = {}): Promise<ExcelJS.Workbook> {
  const profile = options.profile ?? "full";
  const weekRosters = await getCampRosterData(options.weekId);

  const wb = new ExcelJS.Workbook();
  wb.creator = business.name;
  wb.created = new Date();

  buildCoverSheet(wb, weekRosters, profile);
  for (const weekRoster of weekRosters) {
    buildWeekSheet(wb, tabName(weekRoster.id), weekRoster, profile);
  }

  return wb;
}
