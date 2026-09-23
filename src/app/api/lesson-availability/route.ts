import { NextResponse } from "next/server";
import { getBusyIntervals, isGoogleCalendarConfigured } from "@/lib/googleCalendar";
import { formatTimeLabel, isWeekday, MIN_NOTICE_HOURS, slotsForDate } from "@/lib/lessonSlots";

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

  const candidateDays: { dateKey: string; slots: { start: Date; end: Date }[] }[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (!isWeekday(year, month, day)) continue;
    const slots = slotsForDate(year, month, day).filter((s) => s.start.getTime() >= cutoff.getTime());
    if (slots.length > 0) {
      candidateDays.push({
        dateKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        slots,
      });
    }
  }

  if (candidateDays.length === 0) {
    return NextResponse.json({ configured: true, days: {} });
  }

  const rangeStart = candidateDays[0].slots[0].start;
  const lastDay = candidateDays[candidateDays.length - 1];
  const rangeEnd = lastDay.slots[lastDay.slots.length - 1].end;

  try {
    const busy = await getBusyIntervals(rangeStart.toISOString(), rangeEnd.toISOString());

    const days: Record<string, { start: string; label: string }[]> = {};
    for (const candidate of candidateDays) {
      const free = candidate.slots.filter((slot) => {
        return !busy.some((b) => {
          const busyStart = new Date(b.start).getTime();
          const busyEnd = new Date(b.end).getTime();
          return slot.start.getTime() < busyEnd && slot.end.getTime() > busyStart;
        });
      });
      if (free.length > 0) {
        days[candidate.dateKey] = free.map((s) => ({
          start: s.start.toISOString(),
          label: formatTimeLabel(s.start),
        }));
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
