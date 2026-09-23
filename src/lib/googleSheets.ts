import { google } from "googleapis";

// Server-only. Reads/writes the "ClinicSignups" tab of a Google Sheet via a
// service account. See GOOGLE_SHEETS_SETUP.md for how to configure this.
//
// Sheet header row (row 1): Timestamp | First Name | Last Name | Email | Phone | Cohort | Message

const SHEET_TAB = "ClinicSignups";
const SHEET_RANGE = `${SHEET_TAB}!A:G`;

export type ClinicSignupRow = {
  timestamp: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cohort: string;
  message: string;
};

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
      process.env.GOOGLE_SHEETS_PRIVATE_KEY &&
      process.env.GOOGLE_SHEETS_SHEET_ID
  );
}

function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Google Sheets credentials are not configured.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function getClinicSignups(): Promise<ClinicSignupRow[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID!;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SHEET_RANGE,
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
    range: SHEET_RANGE,
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
