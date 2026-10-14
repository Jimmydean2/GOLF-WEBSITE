// Pure lesson-scheduling rules, shared by the availability/booking API
// routes (server) and the booking calendar UI (client). No Node-only APIs.
//
// Availability: Monday-Friday, 9:00 AM - 4:00 PM, Montreal time. Each
// lesson is a full 50-minute calendar block. Offered start times are
// computed dynamically: starting from 9:00 AM, every half-hour mark
// (9:00, 9:30, 10:00, ...) is offered as a candidate start time, as long
// as its 50-minute lesson plus the 10-minute buffer after it doesn't run
// into another busy period on the calendar — so once a time is actually
// booked, the half-hour marks that would overlap its lesson+buffer stop
// being offered, but any that are still clear stay available. Saturdays
// are the group clinic, handled separately on /clinics.

import { utcToZonedParts, zonedTimeToUtc } from "./timezone";

export const TIMEZONE = "America/Toronto";
export const LESSON_MINUTES = 50;
export const LESSON_BUFFER_MINUTES = 10;
export const SLOT_STEP_MINUTES = 30;
export const MIN_NOTICE_HOURS = 24;
export const RECURRING_WEEK_OPTIONS = [2, 4, 6, 8, 12];

export const WINDOW_START: [number, number] = [9, 0];
export const WINDOW_END: [number, number] = [16, 0];

export function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

export function isWeekday(year: number, month: number, day: number): boolean {
  const dow = dayOfWeek(year, month, day);
  return dow >= 1 && dow <= 5;
}

export type BusyInterval = { start: Date; end: Date };

export function generateAvailableSlots(
  year: number,
  month: number,
  day: number,
  busyIntervals: BusyInterval[]
): { start: Date; end: Date }[] {
  const windowStart = zonedTimeToUtc(year, month, day, WINDOW_START[0], WINDOW_START[1], TIMEZONE).getTime();
  const windowEnd = zonedTimeToUtc(year, month, day, WINDOW_END[0], WINDOW_END[1], TIMEZONE).getTime();
  const lessonMs = LESSON_MINUTES * 60_000;
  const bufferMs = LESSON_BUFFER_MINUTES * 60_000;
  const stepMs = SLOT_STEP_MINUTES * 60_000;
  const sortedBusy = [...busyIntervals].sort((a, b) => a.start.getTime() - b.start.getTime());

  const results: { start: Date; end: Date }[] = [];
  let cursor = windowStart;

  while (cursor + lessonMs <= windowEnd) {
    const slotStart = cursor;
    const slotEnd = cursor + lessonMs;
    const conflict = sortedBusy.find(
      (b) => slotStart < b.end.getTime() + bufferMs && slotEnd > b.start.getTime()
    );

    if (!conflict) {
      results.push({ start: new Date(slotStart), end: new Date(slotEnd) });
      cursor += stepMs;
    } else {
      // Jump ahead to the next half-hour mark at or after this conflict's
      // buffer clears, rather than re-checking every mark still inside it.
      const resumeAt = conflict.end.getTime() + bufferMs;
      cursor = windowStart + Math.ceil((resumeAt - windowStart) / stepMs) * stepMs;
    }
  }

  return results;
}

export function isValidSlotStart(date: Date): boolean {
  const { year, month, day, hour, minute, second } = utcToZonedParts(date, TIMEZONE);
  if (second !== 0) return false;
  if (!isWeekday(year, month, day)) return false;

  const startMinutes = hour * 60 + minute;
  const windowStartMinutes = WINDOW_START[0] * 60 + WINDOW_START[1];
  const windowEndMinutes = WINDOW_END[0] * 60 + WINDOW_END[1];
  if (startMinutes < windowStartMinutes || startMinutes + LESSON_MINUTES > windowEndMinutes) return false;

  // Keep booked times on the half-hour grid the availability list offers,
  // rather than arbitrary minutes.
  return (startMinutes - windowStartMinutes) % SLOT_STEP_MINUTES === 0;
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
