import { juniorCamps } from "./content";
import { getCampRosterData, type RosterProfile, type RosterRow, type WeekRoster } from "./campRoster";

// Server-only. The roster as a CSV file: the owner's own copy of who is coming, readable by
// Excel and Google Sheets, kept deliberately plain so it still opens in ten years.
//
// What makes it safe to hand around:
//   * a cell that starts with = + - @ (or a tab or return) gets a leading apostrophe, so nothing a
//     parent typed can run as a formula in a spreadsheet; a phone number starting with + is
//     therefore shown as text, as typed;
//   * a byte-order mark, so Excel reads accents correctly; CRLF line ends; every field that has a
//     comma, a quote or a line break is quoted;
//   * the "signin" profile leaves out the health notes, emergency contact, second phone, email and
//     reference, and only says whether a medical note exists.

export { ROSTER_PROFILES, type RosterProfile } from "./campRoster";

export function isRosterProfile(value: unknown): value is RosterProfile {
  return value === "full" || value === "signin";
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// The byte-order mark Excel needs to read accents as UTF-8 (written as a code, so no invisible character sits in this file).
const BOM = String.fromCharCode(0xfeff);

export function rowsToCsv(rows: unknown[][]): string {
  return `${BOM}${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

type CsvColumn = { header: string; value: (row: RosterRow, week: WeekRoster, n: number) => string };

const WEEK: CsvColumn = { header: "Week", value: (_r, w) => w.label };
const WEEK_START: CsvColumn = { header: "Week start", value: (_r, w) => w.startDate };
const NUMBER: CsvColumn = { header: "#", value: (_r, _w, n) => String(n) };
const CHILD: CsvColumn = { header: "Child's full name", value: (r) => r.childName };
const AGE: CsvColumn = { header: "Age", value: (r) => r.childAge };
const PARENT: CsvColumn = { header: "Parent / guardian", value: (r) => r.parentName };
const PHONE: CsvColumn = { header: "Parent phone", value: (r) => r.primaryPhone };
const STATUS: CsvColumn = { header: "Payment status", value: (r) => r.paymentStatus };
const CHECKED_IN: CsvColumn = { header: "Checked in", value: (r) => r.checkedIn };

const CSV_COLUMNS: Record<RosterProfile, CsvColumn[]> = {
  full: [
    WEEK,
    WEEK_START,
    NUMBER,
    CHILD,
    AGE,
    PARENT,
    PHONE,
    { header: "Secondary phone", value: (r) => r.secondaryPhone },
    { header: "Parent email", value: (r) => r.parentEmail },
    { header: "Emergency contact", value: (r) => r.emergencyName },
    { header: "Relationship", value: (r) => r.emergencyRelationship },
    { header: "Emergency phone", value: (r) => r.emergencyPhone },
    { header: "Allergies / medical notes", value: (r) => r.healthInfo },
    STATUS,
    { header: "Reference", value: (r) => r.reference },
    CHECKED_IN,
  ],
  signin: [WEEK, WEEK_START, NUMBER, CHILD, AGE, PARENT, PHONE, { header: "Medical note on file", value: (r) => r.medicalNoteOnFile }, STATUS, CHECKED_IN],
};

export function rosterFilename(extension: "csv" | "xlsx", weekId: string, profile: RosterProfile, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const which = weekId === "all" ? "all-weeks" : weekId;
  return `CONFIDENTIAL-Junior-Camp-Roster-${which}-${profile}-${day}.${extension}`;
}

// A week id the owner may ask for: "all", or one of the season's weeks.
export function isRosterWeek(value: unknown): value is string {
  return typeof value === "string" && (value === "all" || juniorCamps.weeks.some((w) => w.id === value));
}

export async function buildRosterCsv(opts: { weekId: string; profile: RosterProfile; now?: Date }): Promise<{ filename: string; csv: string; rowCount: number; weekCount: number }> {
  if (!isRosterWeek(opts.weekId)) throw new Error("Unknown week.");
  const weeks = await getCampRosterData(opts.weekId === "all" ? undefined : opts.weekId);
  const columns = CSV_COLUMNS[opts.profile];
  const records: string[][] = [columns.map((c) => c.header)];
  let rowCount = 0;
  for (const week of weeks) {
    week.rows.forEach((row, i) => {
      records.push(columns.map((c) => c.value(row, week, i + 1)));
      rowCount++;
    });
  }
  return { filename: rosterFilename("csv", opts.weekId, opts.profile, opts.now), csv: rowsToCsv(records), rowCount, weekCount: weeks.length };
}
