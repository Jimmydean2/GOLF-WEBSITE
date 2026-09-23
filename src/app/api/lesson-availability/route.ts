import { NextResponse } from "next/server";
import { getBusyIntervals, isGoogleCalendarConfigured } from "@/lib/googleCalendar";
import {
  formatTimeLabel,
  generateAvailableSlots,
  isWeekday,
  MIN_NOTICE_HOURS,
  TIMEZONE,
  WINDOW_END,
  WINDOW_START,
} from "@/lib/lessonSlots";
import { zonedTimeToUtc } from "@/lib/timezone";

export async function GET(request: Request) {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ configured: false, days: {} });
  }

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month"); // "YYYY-MM"

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y;
    month = m - 1;
  }

  const cutoff = new Date(now.getTime() + MIN_NOTICE_HOURS * 60 * 60 * 1000);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekdayDates: { year: number; month: number; day: number }[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (isWeekday(year, month, day)) weekdayDates.push({ year, month, day });
  }

  if (weekdayDates.length === 0) {
    return NextResponse.json({ configured: true, days: {} });
  }

  const first = weekdayDates[0];
  const last = weekdayDates[weekdayDates.length - 1];
  const rangeStart = zonedTimeToUtc(first.year, first.month, first.day, WINDOW_START[0], WINDOW_START[1], TIMEZONE);
  const rangeEnd = zonedTimeToUtc(last.year, last.month, last.day, WINDOW_END[0], WINDOW_END[1], TIMEZONE);

  try {
    const busyRaw = await getBusyIntervals(rangeStart.toISOString(), rangeEnd.toISOString());
    const busy = busyRaw.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));

    const days: Record<string, { start: string; label: string }[]> = {};
    for (const { year: y, month: m, day: d } of weekdayDates) {
      const slots = generateAvailableSlots(y, m, d, busy).filter((s) => s.start.getTime() >= cutoff.getTime());
      if (slots.length > 0) {
        const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        days[dateKey] = slots.map((s) => ({ start: s.start.toISOString(), label: formatTimeLabel(s.start) }));
      }
    }

    return NextResponse.json({ configured: true, days });
  } catch {
    return NextResponse.json(
      { configured: true, days: {}, error: "Could not load availability right now." },
      { status: 502 }
    );
  }
}
