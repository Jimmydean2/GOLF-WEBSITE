"use client";

import { FormEvent, useEffect, useState } from "react";
import { business, groupClinics, type ClinicCohortId } from "@/lib/content";

type Status = "idle" | "sending" | "success" | "error";

type CapacityInfo = { taken: number; max: number; remaining: number; full: boolean };
type CapacityState = {
  loading: boolean;
  configured: boolean;
  cohorts: Partial<Record<ClinicCohortId, CapacityInfo>>;
};

export default function ClinicSignupForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCohort, setSelectedCohort] = useState<ClinicCohortId | null>(null);
  const [capacity, setCapacity] = useState<CapacityState>({
    loading: true,
    configured: false,
    cohorts: {},
  });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/clinic-capacity")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setCapacity({
          loading: false,
          configured: Boolean(data.configured),
          cohorts: data.cohorts ?? {},
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCapacity({ loading: false, configured: false, cohorts: {} });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!capacity.loading && !capacity.configured) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="text-ink-soft">
          Online sign-up is being finalized. In the meantime, reserve your
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

    if (!selectedCohort) {
      setStatus("error");
      setErrorMessage("Please pick a clinic series above.");
      return;
    }

    setStatus("sending");
    setErrorMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/clinic-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: formData.get("firstName"),
          lastName: formData.get("lastName"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          cohort: selectedCohort,
          message: formData.get("message"),
        }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        setStatus("success");
        form.reset();
        setSelectedCohort(null);
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
        <p className="font-display text-xl font-semibold text-forest">
          You&apos;re on the list!
        </p>
        <p className="mt-2 text-ink-soft">
          Coach James has been notified and will follow up to confirm your spot and
          collect payment.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-gold/30 bg-cream p-8">
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-ink">
          Which clinic series would you like to join?
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {groupClinics.cohorts.map((cohort) => {
            const info = capacity.cohorts[cohort.id];
            const full = info?.full ?? false;
            const selected = selectedCohort === cohort.id;

            return (
              <button
                key={cohort.id}
                type="button"
                disabled={full}
                onClick={() => setSelectedCohort(cohort.id)}
                aria-pressed={selected}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  full
                    ? "cursor-not-allowed border-gold/20 bg-cream-dark opacity-60"
                    : selected
                      ? "cursor-pointer border-forest bg-forest text-cream"
                      : "cursor-pointer border-gold/40 bg-white hover:border-forest"
                }`}
              >
                <span className="font-display text-base font-semibold">{cohort.month}</span>
                <span className={`mt-1 block text-xs ${selected ? "text-cream/80" : "text-ink-soft"}`}>
                  {capacity.loading || !info
                    ? "Checking availability…"
                    : full
                      ? "Full"
                      : `${info.remaining} of ${info.max} spots left`}
                </span>
                {!capacity.loading && info && !full && info.remaining <= 3 && (
                  <span
                    className={`mt-1 block text-xs font-semibold ${
                      selected ? "text-gold-light" : "text-flag"
                    }`}
                  >
                    Filling up — reserve your spot now!
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" name="firstName" type="text" required />
        <Field label="Last name" name="lastName" type="text" required />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone number" name="phone" type="tel" required />
        <Field label="Email" name="email" type="email" required />
      </div>

      <div>
        <label htmlFor="message" className="mb-1 block text-sm font-medium text-ink">
          Anything else Coach James should know? (optional)
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Reserve My Spot"}
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
