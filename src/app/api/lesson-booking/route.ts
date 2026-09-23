import { NextResponse } from "next/server";
import { createLessonEvent, getBusyIntervals, isGoogleCalendarConfigured } from "@/lib/googleCalendar";
import { appendLessonBooking, isGoogleSheetsConfigured } from "@/lib/googleSheets";
import {
  formatDateLabel,
  formatDateLongLabel,
  formatTimeLabel,
  isValidSlotStart,
  LESSON_MINUTES,
  MIN_NOTICE_HOURS,
  RECURRING_WEEK_OPTIONS,
} from "@/lib/lessonSlots";

export async function POST(request: Request) {
  if (!isGoogleCalendarConfigured() || !isGoogleSheetsConfigured()) {
    return NextResponse.json(
      { error: "Online booking isn't set up yet. Please call or email instead." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const startRaw = String(body.start ?? "").trim();

  if (!firstName || !lastName || !email || !phone || !startRaw) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime()) || !isValidSlotStart(start)) {
    return NextResponse.json({ error: "That time isn't a valid lesson slot." }, { status: 400 });
  }

  const cutoff = new Date(Date.now() + MIN_NOTICE_HOURS * 60 * 60 * 1000);
  if (start.getTime() < cutoff.getTime()) {
    return NextResponse.json(
      {
        error: `Lessons need at least ${MIN_NOTICE_HOURS} hours' notice. For sooner, please call or text directly.`,
      },
      { status: 400 }
    );
  }

  let recurringWeeks: number | undefined;
  if (body.recurringWeeks !== undefined && body.recurringWeeks !== null && body.recurringWeeks !== "") {
    const n = Number(body.recurringWeeks);
    if (!RECURRING_WEEK_OPTIONS.includes(n)) {
      return NextResponse.json({ error: "Invalid recurring option." }, { status: 400 });
    }
    recurringWeeks = n;
  }

  const end = new Date(start.getTime() + LESSON_MINUTES * 60_000);

  try {
    const busy = await getBusyIntervals(start.toISOString(), end.toISOString());
    const conflict = busy.some((b) => {
      const busyStart = new Date(b.start).getTime();
      const busyEnd = new Date(b.end).getTime();
      return start.getTime() < busyEnd && end.getTime() > busyStart;
    });
    if (conflict) {
      return NextResponse.json(
        { error: "That time was just booked by someone else. Please pick another." },
        { status: 409 }
      );
    }

    await createLessonEvent({ start, end, firstName, lastName, phone, email, recurringWeeks });

    await appendLessonBooking({
      firstName,
      lastName,
      email,
      phone,
      lessonDate: formatDateLongLabel(start),
      lessonTime: formatTimeLabel(start),
      recurring: recurringWeeks ? `Weekly × ${recurringWeeks}` : "No",
    });

    const occurrences = recurringWeeks ?? 1;
    const bookedDates: string[] = [];
    for (let i = 0; i < occurrences; i++) {
      const occurrence = new Date(start.getTime() + i * 7 * 24 * 60 * 60_000);
      bookedDates.push(formatDateLabel(occurrence));
    }

    return NextResponse.json({ success: true, bookedDates, lessonTime: formatTimeLabel(start) });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong booking your lesson. Please try again or contact us directly." },
      { status: 502 }
    );
  }
}
