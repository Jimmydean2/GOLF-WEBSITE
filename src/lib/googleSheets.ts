import { google } from "googleapis";
import { getGoogleAuth, isGoogleServiceAccountConfigured } from "./googleAuth";

// Server-only. Reads/writes tabs of a Google Sheet via the shared service
// account. This is the client "data bank" for both clinic sign-ups and
// individual lesson bookings. See BOOKING_SETUP.md.
//
// ClinicSignups tab header (row 1): Timestamp | First Name | Last Name | Email | Phone | Cohort | Message
// LessonBookings tab header (row 1): Timestamp | First Name | Last Name | Email | Phone | Lesson Date | Lesson Time | Recurring
// CampRegistrations tab header (row 1): Timestamp | Parent Name | Email | Primary Phone | Secondary Phone |
//   Child Name | Date of Birth | Child Age | Health/Medical Info | Emergency Contact Name |
//   Emergency Contact Relationship | Emergency Contact Phone | Weeks | Code of Conduct Accepted |
//   Consent Accepted | Registration ID | Paid | Paid At | Confirm Token
//
// "Weeks" holds one or more week IDs separated by commas (e.g. "jul06,jul13") —
// a parent can register one child for multiple weeks in a single submission,
// filling out their info only once. Capacity and paid-status are still
// resolved per week vs. per registration row (see /api/camp-capacity and
// markCampRegistrationPaid below).

const CLINIC_SHEET_TAB = "ClinicSignups";
const CLINIC_SHEET_RANGE = `${CLINIC_SHEET_TAB}!A:G`;
const LESSON_SHEET_TAB = "LessonBookings";
const LESSON_SHEET_RANGE = `${LESSON_SHEET_TAB}!A:H`;
const CAMP_SHEET_TAB = "CampRegistrations";
const CAMP_SHEET_RANGE = `${CAMP_SHEET_TAB}!A:S`;

export type ClinicSignupRow = {
  timestamp: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cohort: string;
  message: string;
};

export type LessonBookingRow = {
  timestamp: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  lessonDate: string;
  lessonTime: string;
  recurring: string;
};

export type CampRegistrationRow = {
  timestamp: string;
  parentName: string;
  email: string;
  primaryPhone: string;
  secondaryPhone: string;
  childName: string;
  dateOfBirth: string;
  childAge: string;
  healthInfo: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  weeks: string;
  codeOfConductAccepted: string;
  consentAccepted: string;
  id: string;
  paid: string;
  paidAt: string;
  confirmToken: string;
};

export function isGoogleSheetsConfigured(): boolean {
  return isGoogleServiceAccountConfigured() && Boolean(process.env.GOOGLE_SHEETS_SHEET_ID);
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

export async function getClinicSignups(): Promise<ClinicSignupRow[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: CLINIC_SHEET_RANGE,
  });

  const rows = data.values ?? [];
  // Skip the header row.
  return rows.slice(1).map((row) => ({
    timestamp: row[0] ?? "",
    firstName: row[1] ?? "",
    lastName: row[2] ?? "",
    email: row[3] ?? "",
    phone: row[4] ?? "",
    cohort: row[5] ?? "",
    message: row[6] ?? "",
  }));
}

export async function appendClinicSignup(entry: Omit<ClinicSignupRow, "timestamp">): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: CLINIC_SHEET_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          entry.firstName,
          entry.lastName,
          entry.email,
          entry.phone,
          entry.cohort,
          entry.message,
        ],
      ],
    },
  });
}

export async function appendLessonBooking(entry: Omit<LessonBookingRow, "timestamp">): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: LESSON_SHEET_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          entry.firstName,
          entry.lastName,
          entry.email,
          entry.phone,
          entry.lessonDate,
          entry.lessonTime,
          entry.recurring,
        ],
      ],
    },
  });
}

function mapCampRow(row: string[]): CampRegistrationRow {
  return {
    timestamp: row[0] ?? "",
    parentName: row[1] ?? "",
    email: row[2] ?? "",
    primaryPhone: row[3] ?? "",
    secondaryPhone: row[4] ?? "",
    childName: row[5] ?? "",
    dateOfBirth: row[6] ?? "",
    childAge: row[7] ?? "",
    healthInfo: row[8] ?? "",
    emergencyName: row[9] ?? "",
    emergencyRelationship: row[10] ?? "",
    emergencyPhone: row[11] ?? "",
    weeks: row[12] ?? "",
    codeOfConductAccepted: row[13] ?? "",
    consentAccepted: row[14] ?? "",
    id: row[15] ?? "",
    paid: row[16] ?? "",
    paidAt: row[17] ?? "",
    confirmToken: row[18] ?? "",
  };
}

export async function getCampRegistrations(): Promise<CampRegistrationRow[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: CAMP_SHEET_RANGE,
  });

  const rows = data.values ?? [];
  // Skip the header row.
  return rows.slice(1).map(mapCampRow);
}

export async function appendCampRegistration(
  entry: Omit<CampRegistrationRow, "timestamp" | "paid" | "paidAt">
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: CAMP_SHEET_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          entry.parentName,
          entry.email,
          entry.primaryPhone,
          entry.secondaryPhone,
          entry.childName,
          entry.dateOfBirth,
          entry.childAge,
          entry.healthInfo,
          entry.emergencyName,
          entry.emergencyRelationship,
          entry.emergencyPhone,
          entry.weeks,
          entry.codeOfConductAccepted,
          entry.consentAccepted,
          entry.id,
          "No",
          "",
          entry.confirmToken,
        ],
      ],
    },
  });
}

// Looks up a registration by its ID + confirm token (from the "Mark as
// Paid" link in the coach's notification email), and — unless it's already
// been marked paid — writes "Yes" + a timestamp into the Paid/Paid At
// columns. Returns null if the id/token pair doesn't match any row (an
// invalid or tampered link).
export async function markCampRegistrationPaid(
  id: string,
  token: string
): Promise<{ row: CampRegistrationRow; alreadyPaid: boolean } | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: CAMP_SHEET_RANGE,
  });

  const rows = data.values ?? [];
  const dataRows = rows.slice(1);
  const index = dataRows.findIndex((row) => row[15] === id && row[18] === token);
  if (index === -1) return null;

  const row = dataRows[index];
  if (row[16] === "Yes") {
    return { row: mapCampRow(row), alreadyPaid: true };
  }

  const sheetRowNumber = index + 2; // +1 for the header row, +1 to convert to 1-indexed
  const paidAt = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${CAMP_SHEET_TAB}!Q${sheetRowNumber}:R${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [["Yes", paidAt]] },
  });

  row[16] = "Yes";
  row[17] = paidAt;
  return { row: mapCampRow(row), alreadyPaid: false };
}
