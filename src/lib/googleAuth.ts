import { google } from "googleapis";

// Server-only. One shared service account powers both the Google Sheets
// (client data bank) and Google Calendar (lesson booking) integrations.
// See BOOKING_SETUP.md for how a client sets this up.

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.events",
];

export function isGoogleServiceAccountConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

export function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error("Google service account credentials are not configured.");
  }

  return new google.auth.JWT({ email, key, scopes: SCOPES });
}
