"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { business, juniorCamps, locations, type CampWeekId } from "@/lib/content";

const CAMP_WEEK_IDS = new Set(juniorCamps.weeks.map((week) => week.id));

type Status = "idle" | "sending" | "success" | "error";

type WeekInfo = { taken: number; max: number; remaining: number; full: boolean };
type CapacityState = {
  loading: boolean;
  configured: boolean;
  weeks: Partial<Record<CampWeekId, WeekInfo>>;
};

export default function CampRegistrationForm() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [submittedWeekCount, setSubmittedWeekCount] = useState(0);
  const [codeOfConductAccepted, setCodeOfConductAccepted] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [capacity, setCapacity] = useState<CapacityState>({
    loading: true,
    configured: false,
    weeks: {},
  });

  // A week picked via URL (from the overview tiles) seeds the picker; the
  // shopper can then add or remove weeks freely — one form, any number of
  // weeks, info entered only once.
  const [selectedWeeks, setSelectedWeeks] = useState<Set<CampWeekId>>(() => {
    const requested = searchParams.get("week");
    const seed = new Set<CampWeekId>();
    if (requested && CAMP_WEEK_IDS.has(requested as CampWeekId)) {
      seed.add(requested as CampWeekId);
    }
    return seed;
  });

  // Filter out any selected week that capacity has since revealed is full
  // (e.g. it filled up between page load and now) without an extra effect.
  const effectiveWeeks = Array.from(selectedWeeks).filter((id) => !capacity.weeks[id]?.full);
  const weekCount = effectiveWeeks.length;
  const totalPrice = weekCount * juniorCamps.pricePerWeek;

  function toggleWeek(weekId: CampWeekId) {
    setSelectedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/camp-capacity")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setCapacity({
          loading: false,
          configured: Boolean(data.configured),
          weeks: data.weeks ?? {},
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCapacity({ loading: false, configured: false, weeks: {} });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!capacity.loading && !capacity.configured) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="text-ink-soft">
          Online registration is being finalized. In the meantime, reserve a
          spot by calling or emailing directly:
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (weekCount === 0) {
      setStatus("error");
      setErrorMessage("Please pick at least one camp week above.");
      return;
    }
    if (!codeOfConductAccepted || !consentAccepted) {
      setStatus("error");
      setErrorMessage("Please accept the code of conduct and information consent below.");
      return;
    }

    setStatus("sending");
    setErrorMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/camp-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentName: formData.get("parentName"),
          email: formData.get("email"),
          primaryPhone: formData.get("primaryPhone"),
          secondaryPhone: formData.get("secondaryPhone"),
          childName: formData.get("childName"),
          dateOfBirth: formData.get("dateOfBirth"),
          childAge: formData.get("childAge"),
          healthInfo: formData.get("healthInfo"),
          emergencyName: formData.get("emergencyName"),
          emergencyRelationship: formData.get("emergencyRelationship"),
          emergencyPhone: formData.get("emergencyPhone"),
          weeks: effectiveWeeks,
          codeOfConductAccepted,
          consentAccepted,
        }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        setStatus("success");
        setSubmittedWeekCount(weekCount);
        form.reset();
        setSelectedWeeks(new Set());
        setCodeOfConductAccepted(false);
        setConsentAccepted(false);
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
    const submittedTotal = submittedWeekCount * juniorCamps.pricePerWeek;
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="font-display text-xl font-semibold text-forest">
          Registration received!
        </p>
        <p className="mt-2 text-ink-soft">
          A spot is being held for your child for every week you selected.
          Coach James will review availability and reach out to confirm and
          arrange payment &mdash; spots are only secured once payment is
          received in full.
        </p>
        <p className="mt-4 rounded-xl bg-cream-dark px-4 py-3 font-display text-base font-semibold text-forest">
          Total due: {submittedWeekCount} week{submittedWeekCount === 1 ? "" : "s"} &times; $
          {juniorCamps.pricePerWeek} = ${submittedTotal} {juniorCamps.priceNote}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-2xl border border-gold/30 bg-cream p-8">
      <div>
        <h3 className="font-display text-lg font-semibold text-forest">
          Section 1 &mdash; Parent &amp; Child Information
        </h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="Parent/guardian full name" name="parentName" type="text" required />
          <Field label="Email address" name="email" type="email" required />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Primary phone" name="primaryPhone" type="tel" required />
          <Field label="Secondary phone (optional)" name="secondaryPhone" type="tel" />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Child's full name" name="childName" type="text" required />
          <Field label="Child's age" name="childAge" type="text" required />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Date of birth" name="dateOfBirth" type="date" required />
        </div>
        <div className="mt-5">
          <label htmlFor="healthInfo" className="mb-1 block text-sm font-medium text-ink">
            Health &amp; medical information (allergies, medical conditions, medication)
          </label>
          <textarea
            id="healthInfo"
            name="healthInfo"
            required
            rows={3}
            className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
          />
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <h3 className="font-display text-lg font-semibold text-forest">
          Section 2 &mdash; Emergency Contact Information
        </h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="Emergency contact name" name="emergencyName" type="text" required />
          <Field label="Relationship (mother, father, aunt, uncle, etc.)" name="emergencyRelationship" type="text" required />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Emergency contact phone" name="emergencyPhone" type="tel" required />
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <h3 className="font-display text-lg font-semibold text-forest">Section 3 &mdash; Camp Week(s)</h3>
        <p className="mt-1 text-sm text-ink-soft">
          {juniorCamps.hoursLabel} &mdash; {juniorCamps.hours}, at {locations[juniorCamps.venue].name}.
        </p>
        <p className="text-sm text-ink-soft">{juniorCamps.scheduleNote}</p>
        <p className="mt-2 text-sm font-semibold text-forest">
          Select as many weeks as you&apos;d like &mdash; you only need to fill out your information once.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {juniorCamps.weeks.map((week) => {
            const info = capacity.weeks[week.id];
            const full = info?.full ?? false;
            const selected = effectiveWeeks.includes(week.id);

            return (
              <button
                key={week.id}
                type="button"
                disabled={full}
                onClick={() => toggleWeek(week.id)}
                aria-pressed={selected}
                className={`relative rounded-xl border-2 p-4 text-left transition-colors ${
                  full
                    ? "cursor-not-allowed border-gold/20 bg-cream-dark opacity-60"
                    : selected
                      ? "cursor-pointer border-forest bg-forest text-cream"
                      : "cursor-pointer border-gold/40 bg-white hover:border-forest"
                }`}
              >
                {selected && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-xs font-bold text-ink">
                    ✓
                  </span>
                )}
                <span className="font-display text-base font-semibold pr-6">{week.label}</span>
                <span className={`mt-1 block text-xs ${selected ? "text-cream/80" : "text-ink-soft"}`}>
                  {capacity.loading || !info
                    ? "Checking availability…"
                    : full
                      ? "Full"
                      : `${info.remaining} of ${info.max} spots left`}
                </span>
                {!capacity.loading && info && !full && info.remaining <= 5 && (
                  <span
                    className={`mt-1 block text-xs font-semibold ${
                      selected ? "text-gold-light" : "text-flag"
                    }`}
                  >
                    Filling up — register now!
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-cream-dark p-5">
        <p className="font-display text-base font-semibold text-forest">
          {weekCount > 0
            ? `${weekCount} week${weekCount === 1 ? "" : "s"} selected — $${totalPrice} ${juniorCamps.priceNote}`
            : `$${juniorCamps.pricePerWeek} ${juniorCamps.priceNote} per week`}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Reservations are made on a first-come, first-served basis. Camps fill up quickly.
          Availability and pricing subject to change. Certain conditions may apply.
        </p>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={codeOfConductAccepted}
            onChange={(e) => setCodeOfConductAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 flex-none rounded border-gold/40 text-forest focus:ring-forest"
          />
          <span className="text-sm text-ink-soft">
            I understand that my child is expected to follow program rules and
            demonstrate respectful behavior at all times. I acknowledge that
            the program reserves the right to send my child home if these
            expectations are not met, and that this registration will not be
            considered valid unless this acknowledgment is accepted.
          </span>
        </label>
      </div>

      <div className="rounded-xl border border-gold/30 bg-white p-5">
        <h4 className="font-display text-base font-semibold text-forest">Method of Payment</h4>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft">
          <li>
            Once the registration form has been received, Coach James will
            review availability and contact you to confirm whether a space
            can be offered.
          </li>
          <li>If a spot is confirmed, payment must be made in full to secure registration.</li>
          <li>
            For payment details, please contact Coach James at{" "}
            <a href={`mailto:${business.email}`} className="font-semibold text-forest hover:underline">
              {business.email}
            </a>{" "}
            or{" "}
            <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
              {business.phone}
            </a>
            .
          </li>
          <li>Cancellations are subject to a ${juniorCamps.cancellationFee} administrative fee.</li>
          <li>No payments to {locations[juniorCamps.venue].name} will be accepted.</li>
        </ul>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={consentAccepted}
          onChange={(e) => setConsentAccepted(e.target.checked)}
          className="mt-1 h-4 w-4 flex-none rounded border-gold/40 text-forest focus:ring-forest"
        />
        <span className="text-sm text-ink-soft">
          By submitting the registration form you agree that information may
          be disclosed to {business.name} for the purpose of administering
          the junior golf camps. All information is confidential and shall
          not be shared without permission.
        </span>
      </label>

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Register Now"}
      </button>

      {status === "error" && (
        <p role="alert" className="text-sm text-flag">
          {errorMessage || `Something went wrong. Please try again, or contact ${business.phone} directly.`}
        </p>
      )}
    </form>
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
