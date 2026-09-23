import { google } from "googleapis";
import { getGoogleAuth, isGoogleServiceAccountConfigured } from "./googleAuth";

// Server-only. Reads/writes tabs of a Google Sheet via the shared service
// account. This is the client "data bank" for both clinic sign-ups and
// individual lesson bookings. See BOOKING_SETUP.md.
//
// ClinicSignups tab header (row 1): Timestamp | First Name | Last Name | Email | Phone | Cohort | Message
// LessonBookings tab header (row 1): Timestamp | First Name | Last Name | Email | Phone | Lesson Date | Lesson Time | Recurring

const CLINIC_SHEET_TAB = "ClinicSignups";
const CLINIC_SHEET_RANGE = `${CLINIC_SHEET_TAB}!A:G`;
const LESSON_SHEET_TAB = "LessonBookings";
const LESSON_SHEET_RANGE = `${LESSON_SHEET_TAB}!A:H`;

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
