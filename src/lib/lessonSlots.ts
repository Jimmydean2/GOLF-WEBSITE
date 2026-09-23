// Pure lesson-scheduling rules, shared by the availability/booking API
// routes (server) and the booking calendar UI (client). No Node-only APIs.
//
// Availability: Monday-Friday, 9:00 AM - 4:00 PM, Montreal time.
// Lessons are 50 minutes; slots start every 50 minutes so the last one
// still finishes by 4:00 PM. Saturdays are the group clinic, handled
// separately on /clinics.

import { utcToZonedParts, zonedTimeToUtc } from "./timezone";

export const TIMEZONE = "America/Toronto";
export const LESSON_MINUTES = 50;
export const MIN_NOTICE_HOURS = 24;
export const RECURRING_WEEK_OPTIONS = [2, 4, 6, 8, 12];

export const SLOT_STARTS: [number, number][] = [
  [9, 0],
  [9, 50],
  [10, 40],
  [11, 30],
  [12, 20],
  [13, 10],
  [14, 0],
  [14, 50],
];

export function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

export function isWeekday(year: number, month: number, day: number): boolean {
  const dow = dayOfWeek(year, month, day);
  return dow >= 1 && dow <= 5;
}

export function slotsForDate(year: number, month: number, day: number): { start: Date; end: Date }[] {
  return SLOT_STARTS.map(([hour, minute]) => {
    const start = zonedTimeToUtc(year, month, day, hour, minute, TIMEZONE);
    const end = new Date(start.getTime() + LESSON_MINUTES * 60_000);
    return { start, end };
  });
}

export function isValidSlotStart(date: Date): boolean {
  const { year, month, day, hour, minute, second } = utcToZonedParts(date, TIMEZONE);
  if (second !== 0) return false;
  if (!isWeekday(year, month, day)) return false;
  return SLOT_STARTS.some(([h, m]) => h === hour && m === minute);
}

export function formatTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateLongLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}
