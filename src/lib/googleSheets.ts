import { google } from "googleapis";
import { getGoogleAuth, isGoogleServiceAccountConfigured } from "./googleAuth";

// Server-only. Reads/writes tabs of a Google Sheet via the shared service
// account. This is the client "data bank" for clinic sign-ups and
// individual lesson bookings — both still authoritative here. Junior Camp
// registrations are different: Postgres (src/lib/campDb.ts) is the
// authoritative store for capacity and registration data, and
// CampRegistrations below is a write-only, best-effort reporting copy —
// nothing ever reads it back to make a capacity or payment decision. See
// BOOKING_SETUP.md.
//
// ClinicSignups tab header (row 1): Timestamp | First Name | Last Name | Email | Phone | Cohort | Message
// LessonBookings tab header (row 1): Timestamp | First Name | Last Name | Email | Phone | Lesson Date | Lesson Time | Recurring
// CampRegistrations tab header (row 1): Timestamp | Parent Name | Email | Primary Phone | Secondary Phone |
//   Child Name | Date of Birth | Child Age | Health/Medical Info | Emergency Contact Name |
//   Emergency Contact Relationship | Emergency Contact Phone | Weeks | Code of Conduct Accepted |
//   Consent Accepted | Registration ID | Paid | Paid At | Reference
//
// "Weeks" holds one or more week IDs separated by commas (e.g. "jul06,jul13").
// One row is appended per child (a family registering 3 kids for a week
// produces 3 rows, all sharing the same Registration ID) — matching how
// the roster and "each child counts as one spot" model work in Postgres.

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
  reference: string;
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
          entry.reference,
        ],
      ],
    },
  });
}
