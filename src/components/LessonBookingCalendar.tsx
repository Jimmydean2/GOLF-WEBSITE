"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { business } from "@/lib/content";
import { LESSON_MINUTES, MIN_NOTICE_HOURS, RECURRING_WEEK_OPTIONS } from "@/lib/lessonSlots";

type Slot = { start: string; label: string };
type AvailabilityState = {
  configured: boolean;
  days: Record<string, Slot[]>;
};
type Status = "idle" | "sending" | "success" | "error";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_MONTHS_AHEAD = 6;

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function buildWeeks(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default function LessonBookingCalendar() {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [availability, setAvailability] = useState<AvailabilityState>({
    configured: false,
    days: {},
  });
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [recurringWeeks, setRecurringWeeks] = useState<number | "">("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [bookedDates, setBookedDates] = useState<string[]>([]);
  const [bookedTime, setBookedTime] = useState("");

  const currentMonthKey = monthKey(viewYear, viewMonth);
  const loading = loadedMonthKey !== currentMonthKey;

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/lesson-availability?month=${currentMonthKey}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setAvailability({
          configured: Boolean(data.configured),
          days: data.days ?? {},
        });
        setLoadedMonthKey(currentMonthKey);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailability({ configured: false, days: {} });
        setLoadedMonthKey(currentMonthKey);
      });

    return () => {
      cancelled = true;
    };
  }, [currentMonthKey]);

  if (!loading && !availability.configured) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="text-ink-soft">
          Online booking is being finalized. In the meantime, reach out directly and
          we&apos;ll find a time that works.
        </p>
        <div className="mt-4 flex flex-col items-center gap-1">
          <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
            {business.phone}
          </a>
          <a href={`mailto:${business.email}`} className="font-semibold text-forest hover:underline">
            {business.email}
          </a>
        </div>
      </div>
    );
  }

  const weeks = buildWeeks(viewYear, viewMonth);
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const monthsAhead = (viewYear - today.getFullYear()) * 12 + (viewMonth - today.getMonth());
  const slotsForSelectedDate = selectedDate ? availability.days[selectedDate] ?? [] : [];

  function goPrevMonth() {
    if (isCurrentMonth) return;
    setSelectedDate(null);
    setSelectedSlot(null);
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }

  function goNextMonth() {
    if (monthsAhead >= MAX_MONTHS_AHEAD) return;
    setSelectedDate(null);
    setSelectedSlot(null);
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) {
      setStatus("error");
      setErrorMessage("Please pick a day and time above.");
      return;
    }

    setStatus("sending");
    setErrorMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/lesson-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: selectedSlot.start,
          firstName: formData.get("firstName"),
          lastName: formData.get("lastName"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          recurringWeeks: recurringWeeks || undefined,
        }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        setStatus("success");
        setBookedDates(result.bookedDates ?? []);
        setBookedTime(result.lessonTime ?? selectedSlot.label);
        form.reset();
        setSelectedDate(null);
        setSelectedSlot(null);
        setRecurringWeeks("");
      } else {
        setStatus("error");
        setErrorMessage(result.error || "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="font-display text-xl font-semibold text-forest">You&apos;re booked!</p>
        <p className="mt-2 text-ink-soft">
          {bookedDates.length > 1
            ? `Your weekly lesson is confirmed at ${bookedTime} on:`
            : `Your lesson is confirmed for ${bookedDates[0]} at ${bookedTime}.`}
        </p>
        {bookedDates.length > 1 && (
          <ul className="mx-auto mt-3 max-w-xs space-y-1 text-sm text-ink-soft">
            {bookedDates.map((d) => (
              <li key={d}>
                {d} &mdash; {bookedTime}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-ink-soft">
          Added straight to Coach James&apos;s calendar &mdash; see you then!
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-6 cursor-pointer text-sm font-semibold text-forest hover:underline"
        >
          Book another lesson
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gold/30 bg-cream p-6 sm:p-8">
      <div className="grid gap-8 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              disabled={isCurrentMonth}
              aria-label="Previous month"
              className="cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-sm font-semibold text-forest disabled:cursor-not-allowed disabled:opacity-30"
            >
              &larr;
            </button>
            <p className="font-display text-lg font-semibold text-forest">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </p>
            <button
              type="button"
              onClick={goNextMonth}
              disabled={monthsAhead >= MAX_MONTHS_AHEAD}
              aria-label="Next month"
              className="cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-sm font-semibold text-forest disabled:cursor-not-allowed disabled:opacity-30"
            >
              &rarr;
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-ink-soft">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i}>{label}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {weeks.flat().map((date, i) => {
              if (!date) return <div key={i} />;
              const key = dateKey(date);
              const hasSlots = Boolean(availability.days[key]?.length);
              const isSelected = selectedDate === key;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!hasSlots}
                  onClick={() => {
                    setSelectedDate(key);
                    setSelectedSlot(null);
                  }}
                  className={`aspect-square rounded-lg text-sm transition-colors ${
                    !hasSlots
                      ? "cursor-not-allowed text-ink-soft/30"
                      : isSelected
                        ? "cursor-pointer border border-forest bg-forest font-semibold text-cream"
                        : "cursor-pointer border border-gold/30 bg-white font-medium text-ink hover:border-forest"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          {loading && <p className="mt-2 text-xs text-ink-soft">Checking availability&hellip;</p>}
        </div>

        <div className="sm:w-56">
          <p className="mb-3 text-sm font-medium text-ink">
            {selectedDate ? "Choose a time" : "Pick a day"}
            <span className="ml-1 font-normal text-ink-soft">({LESSON_MINUTES}-minute lesson)</span>
          </p>
          <div className="flex flex-col gap-2">
            {slotsForSelectedDate.map((slot) => (
              <button
                key={slot.start}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-left text-sm font-medium transition-colors ${
                  selectedSlot?.start === slot.start
                    ? "border-forest bg-forest text-cream"
                    : "border-gold/40 bg-white text-ink hover:border-forest"
                }`}
              >
                {slot.label}
              </button>
            ))}
            {selectedDate && slotsForSelectedDate.length === 0 && (
              <p className="text-sm text-ink-soft">No times left this day.</p>
            )}
          </div>
        </div>
      </div>

      {selectedSlot && (
        <form onSubmit={handleSubmit} className="mt-8 space-y-6 border-t border-gold/20 pt-6">
          <div>
            <label htmlFor="recurringWeeks" className="mb-1 block text-sm font-medium text-ink">
              How often?
            </label>
            <select
              id="recurringWeeks"
              value={recurringWeeks}
              onChange={(e) => setRecurringWeeks(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest sm:w-auto"
            >
              <option value="">Just this one lesson</option>
              {RECURRING_WEEK_OPTIONS.map((weeks) => (
                <option key={weeks} value={weeks}>
                  Weekly for {weeks} weeks
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="First name" name="firstName" type="text" required />
            <Field label="Last name" name="lastName" type="text" required />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Phone number" name="phone" type="tel" required />
            <Field label="Email" name="email" type="email" required />
          </div>

          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "sending" ? "Booking…" : "Confirm Booking"}
          </button>

          {status === "error" && (
            <p role="alert" className="text-sm text-flag">
              {errorMessage || `Something went wrong. Please try again, or contact ${business.phone} directly.`}
            </p>
          )}
        </form>
      )}

      <p className="mt-6 text-center text-xs text-ink-soft">
        Bookings need at least {MIN_NOTICE_HOURS} hours&apos; notice. Need something sooner?{" "}
        <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
          Call or text directly
        </a>
        .
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  required,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
      />
    </div>
  );
}
