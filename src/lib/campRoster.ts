import ExcelJS from "exceljs";
import { business, juniorCamps, locations } from "./content";
import { getCampRegistrations } from "./googleSheets";

// Server-only. Builds the printable Junior Camp roster workbook straight
// from live registration data — one sheet per camp week, 30 rows each,
// auto-filled with whoever has actually registered. See
// /admin/camp-rosters and BOOKING_SETUP.md.

const FOREST = "FF1F4A34";
const FOREST_DARK = "FF143324";
const GOLD_DEEP = "FF8A6423";
const CREAM_DARK = "FFF3EAD4";
const INK = "FF1B1B16";
const INK_SOFT = "FF4A463C";
const WHITE = "FFFFFFFF";
const BORDER_COLOR = "FFC9BD9A";

const MAX_CAMPERS = 30;

const HEADERS = [
  "#",
  "Child's Full Name",
  "Age",
  "Parent / Guardian Name",
  "Parent Phone",
  "Secondary Phone",
  "Emergency Contact (Name & Relationship)",
  "Emergency Phone",
  "Allergies / Medical Notes",
  "Paid (Y/N)",
];
const COL_WIDTHS = [4, 24, 6, 24, 15, 15, 32, 15, 32, 10];

export type RosterRow = {
  childName: string;
  childAge: string;
  parentName: string;
  primaryPhone: string;
  secondaryPhone: string;
  emergencyContact: string;
  emergencyPhone: string;
  healthInfo: string;
  paid: "Y" | "N";
};

export type WeekRoster = {
  id: string;
  label: string;
  rows: RosterRow[];
};

export async function getCampRosterData(): Promise<WeekRoster[]> {
  const registrations = await getCampRegistrations();

  return juniorCamps.weeks.map((week) => {
    const rows: RosterRow[] = registrations
      .filter((r) => r.weeks.split(",").map((w) => w.trim()).includes(week.id))
      .map((r) => ({
        childName: r.childName,
        childAge: r.childAge,
        parentName: r.parentName,
        primaryPhone: r.primaryPhone,
        secondaryPhone: r.secondaryPhone,
        emergencyContact: r.emergencyRelationship
          ? `${r.emergencyName} (${r.emergencyRelationship})`
          : r.emergencyName,
        emergencyPhone: r.emergencyPhone,
        healthInfo: r.healthInfo,
        paid: r.paid === "Yes" ? "Y" : "N",
      }));
    return { id: week.id, label: week.label, rows };
  });
}

function border(ws: ExcelJS.Worksheet, cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin", color: { argb: BORDER_COLOR } },
    left: { style: "thin", color: { argb: BORDER_COLOR } },
    bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    right: { style: "thin", color: { argb: BORDER_COLOR } },
  };
}

function buildWeekSheet(wb: ExcelJS.Workbook, tabName: string, weekRoster: WeekRoster) {
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

  const lastCol = HEADERS.length;
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
    `${juniorCamps.hours}  ·  ${venue.name}, ${venue.address}  ·  Max ${MAX_CAMPERS} campers`;
  ws.getCell("A3").font = { name: "Arial", size: 9, italic: true, color: { argb: INK_SOFT } };

  ws.mergeCells(`A4:${lastColLetter}4`);
  ws.getCell("A4").value = `Registered: ${weekRoster.rows.length} of ${MAX_CAMPERS}`;
  ws.getCell("A4").font = { name: "Arial", size: 10, bold: true, color: { argb: FOREST_DARK } };

  ws.mergeCells(`A5:${lastColLetter}5`);
  ws.getCell("A5").value =
    "Pulled live from online registrations. Add walk-ins or phone/email sign-ups in the blank rows below.";
  ws.getCell("A5").font = { name: "Arial", size: 9, italic: true, color: { argb: INK_SOFT } };
  ws.getCell("A5").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(5).height = 22;

  const headerRowIndex = 7;
  const headerRow = ws.getRow(headerRowIndex);
  HEADERS.forEach((header, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = header;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOREST } };
    cell.alignment = { horizontal: [1, 3, 10].includes(i + 1) ? "center" : "left", vertical: "middle", wrapText: true };
    border(ws, cell);
  });

  const firstDataRow = headerRowIndex + 1;
  for (let i = 0; i < MAX_CAMPERS; i++) {
    const rowIndex = firstDataRow + i;
    const row = ws.getRow(rowIndex);
    const registrant = weekRoster.rows[i];
    const fillColor = i % 2 ? CREAM_DARK : WHITE;

    const values = [
      i + 1,
      registrant?.childName ?? "",
      registrant?.childAge ?? "",
      registrant?.parentName ?? "",
      registrant?.primaryPhone ?? "",
      registrant?.secondaryPhone ?? "",
      registrant?.emergencyContact ?? "",
      registrant?.emergencyPhone ?? "",
      registrant?.healthInfo ?? "",
      registrant?.paid ?? "",
    ];

    values.forEach((value, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = value;
      cell.font = { name: "Arial", size: 10, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.alignment = {
        horizontal: [1, 3, 10].includes(colIdx + 1) ? "center" : "left",
        vertical: "middle",
        wrapText: colIdx + 1 === 9,
      };
      border(ws, cell);
    });
  }

  COL_WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });

  ws.views = [{ state: "frozen", ySplit: headerRowIndex, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `1:${headerRowIndex}`;
}

function buildCoverSheet(wb: ExcelJS.Workbook, weekRosters: WeekRoster[]) {
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

  const sections: [string, string][] = [
    [
      "Generated",
      `${generatedAt} — pulled live from the CampRegistrations sheet. Re-download any time for the latest sign-ups.`,
    ],
    [
      "What this is",
      "One print-ready sign-in sheet per camp week (10 tabs below), each sized for the 30-camper cap. Hand the right tab to whoever is working that week.",
    ],
    [
      "How to use a week's tab",
      "Each row is one camper, already filled in from the registration form where one exists: child's name, age, parent/guardian, both phone numbers, emergency contact, and allergy/medical notes. The “Paid” column shows Y once you've clicked “Mark as Paid” in that registration's notification email. Add any walk-in or phone/email sign-ups in the blank rows.",
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
    ws.getCell(`A${row}`).font = { name: "Arial", size: 12, bold: true, color: { argb: FOREST_DARK } };
    row += 1;

    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = body;
    ws.getCell(`A${row}`).font = { name: "Arial", size: 10.5, color: { argb: INK } };
    ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = 48;
    row += 2;
  }

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = `Total registered across all weeks: ${totalRegistered}`;
  ws.getCell(`A${row}`).font = { name: "Arial", size: 12, bold: true, color: { argb: FOREST_DARK } };
  row += 2;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "Per week";
  ws.getCell(`A${row}`).font = { name: "Arial", size: 12, bold: true, color: { argb: FOREST_DARK } };
  row += 1;

  for (const w of weekRosters) {
    ws.getCell(`A${row}`).value = "•";
    ws.getCell(`A${row}`).font = { name: "Arial", size: 10, color: { argb: GOLD_DEEP } };
    const cell = ws.getCell(`B${row}`);
    cell.value = `${w.label} — ${w.rows.length} of ${MAX_CAMPERS}`;
    cell.font = { name: "Arial", size: 10, color: { argb: INK } };
    row += 1;
  }
}

const TAB_NAMES: Record<string, string> = {
  jun22: "Jun 22-26",
  jun29: "Jun 29-Jul 3",
  jul06: "Jul 6-9",
  jul13: "Jul 13-16",
  jul20: "Jul 20-23",
  jul27: "Jul 27-30",
  aug03: "Aug 3-6",
  aug10: "Aug 10-13",
  aug17: "Aug 17-20",
  aug24: "Aug 24-27",
};

export async function buildCampRosterWorkbook(): Promise<ExcelJS.Workbook> {
  const weekRosters = await getCampRosterData();

  const wb = new ExcelJS.Workbook();
  wb.creator = business.name;
  wb.created = new Date();

  buildCoverSheet(wb, weekRosters);
  for (const weekRoster of weekRosters) {
    buildWeekSheet(wb, TAB_NAMES[weekRoster.id] ?? weekRoster.id, weekRoster);
  }

  return wb;
}
