// Evidence for docs/GOOGLE_AUDIT_AND_RECONCILIATION.md (finding F1). Run with:
//   npx tsx docs/design/evidence/legacy-freebusy-errors.mjs
//
// It calls the EXISTING getBusyIntervals() (src/lib/googleCalendar.ts) with a SIMULATED Google answer.
// Nothing is sent to Google: the Calendar client is replaced by a fake before the module is used, and
// the credentials below are made up. It shows what today's code concludes when Google reports a
// problem with the calendar instead of a list of busy times.

process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL = "fake@example.invalid";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "not-a-real-key";
process.env.GOOGLE_CALENDAR_ID = "owner@example.invalid";

import { google } from "googleapis";

const answers = {
  "a normal answer with one busy period": { calendars: { "owner@example.invalid": { busy: [{ start: "2027-03-01T14:00:00Z", end: "2027-03-01T15:00:00Z" }] } } },
  "Google says the calendar was not found / not shared (documented 'errors' list)": { calendars: { "owner@example.invalid": { errors: [{ domain: "global", reason: "notFound" }], busy: [] } } },
  "Google reports an internal error for the calendar": { calendars: { "owner@example.invalid": { errors: [{ domain: "global", reason: "internalError" }] } } },
  "an answer that does not mention the calendar at all": { calendars: {} },
};

const real = google.calendar;
let current = null;
google.calendar = () => ({ freebusy: { query: async () => ({ data: current }) } });

const { getBusyIntervals } = await import("../../../src/lib/googleCalendar.ts");
for (const [label, data] of Object.entries(answers)) {
  current = data;
  const busy = await getBusyIntervals("2027-03-01T13:00:00Z", "2027-03-01T22:00:00Z");
  console.log(`${label}\n   -> today's code returns ${busy.length} busy period(s); ${busy.length === 0 ? "every time that day is treated as FREE" : "the busy period is respected"}`);
}
google.calendar = real;
