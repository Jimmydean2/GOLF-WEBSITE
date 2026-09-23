import { google, calendar_v3 } from "googleapis";
import { getGoogleAuth, isGoogleServiceAccountConfigured } from "./googleAuth";
import { LESSON_BUFFER_MINUTES, TIMEZONE } from "./lessonSlots";

// Server-only. Reads/writes Coach James's personal Google Calendar via the
// shared service account (see googleAuth.ts). The calendar must be shared
// with that service account's email, with "Make changes to events" access.
// See BOOKING_SETUP.md.

export function isGoogleCalendarConfigured(): boolean {
  return isGoogleServiceAccountConfigured() && Boolean(process.env.GOOGLE_CALENDAR_ID);
}

function getCalendarClient() {
  return google.calendar({ version: "v3", auth: getGoogleAuth() });
}

export type BusyInterval = { start: string; end: string };

export async function getBusyIntervals(timeMinISO: string, timeMaxISO: string): Promise<BusyInterval[]> {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID!;

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone: TIMEZONE,
      items: [{ id: calendarId }],
    },
  });

  const busy = data.calendars?.[calendarId]?.busy ?? [];
  return busy
    .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
    .map((b) => ({ start: b.start, end: b.end }));
}

export async function createLessonEvent(params: {
  start: Date;
  end: Date;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  recurringWeeks?: number;
}): Promise<void> {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID!;

  const requestBody: calendar_v3.Schema$Event = {
    summary: `Golf Lesson — ${params.firstName} ${params.lastName}`,
    description: [
      `Phone: ${params.phone}`,
      `Email: ${params.email}`,
      `${LESSON_BUFFER_MINUTES}-minute buffer after this lesson before the next booking.`,
      params.recurringWeeks ? `Recurring weekly for ${params.recurringWeeks} weeks.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: params.start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: params.end.toISOString(), timeZone: TIMEZONE },
  };

  if (params.recurringWeeks && params.recurringWeeks > 1) {
    requestBody.recurrence = [`RRULE:FREQ=WEEKLY;COUNT=${params.recurringWeeks}`];
  }

  await calendar.events.insert({ calendarId, requestBody });
}
