"use client";

import { FormEvent, useState } from "react";
import { business, groupClinics, web3FormsAccessKey } from "@/lib/content";

type Status = "idle" | "sending" | "success" | "error";

export default function ClinicSignupForm() {
  const [status, setStatus] = useState<Status>("idle");

  if (!web3FormsAccessKey) {
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
    setStatus("sending");
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.append("access_key", web3FormsAccessKey);
    formData.append("subject", `New Group Clinic sign-up — ${business.name}`);

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
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
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-gold/30 bg-cream p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" name="name" type="text" required />
        <Field label="Phone number" name="phone" type="tel" required />
      </div>
      <Field label="Email" name="email" type="email" required />

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">
          Which clinic(s) are you interested in?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {groupClinics.clinics.map((clinic) => (
            <label key={clinic.number} className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                name="clinics"
                value={`Clinic ${clinic.number}: ${clinic.title}`}
                className="h-5 w-5 rounded border-gold/50 text-forest focus:ring-forest"
              />
              Clinic {clinic.number}: {clinic.title}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
            <input
              type="checkbox"
              name="clinics"
              value="All 4 clinics"
              className="h-5 w-5 rounded border-gold/50 text-forest focus:ring-forest"
            />
            All {groupClinics.sessionsCount} clinics (${groupClinics.pricePerPerson})
          </label>
        </div>
      </fieldset>

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
          Something went wrong sending your request. Please try again, or
          contact {business.phone} directly.
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
