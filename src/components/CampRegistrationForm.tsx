"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { business, juniorCamps, locations, type CampWeekId } from "@/lib/content";
import { calculateTotal, formatCents } from "@/lib/pricing";

const CAMP_WEEK_IDS = new Set(juniorCamps.weeks.map((week) => week.id));

type Status = "idle" | "sending" | "success" | "error";

type WeekInfo = { taken: number; max: number; remaining: number; full: boolean; priceCents: number };
type CapacityState = {
  loading: boolean;
  configured: boolean;
  weeks: Partial<Record<CampWeekId, WeekInfo>>;
};

type ChildEntry = { key: string; fullName: string; dateOfBirth: string; age: string; healthInfo: string };

function newChild(): ChildEntry {
  return { key: crypto.randomUUID(), fullName: "", dateOfBirth: "", age: "", healthInfo: "" };
}

export default function CampRegistrationForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [submittedWeekCount, setSubmittedWeekCount] = useState(0);
  const [submittedChildCount, setSubmittedChildCount] = useState(0);
  const [submittedTotalCents, setSubmittedTotalCents] = useState(0);
  const [codeOfConductAccepted, setCodeOfConductAccepted] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [children, setChildren] = useState<ChildEntry[]>([newChild()]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [capacity, setCapacity] = useState<CapacityState>({
    loading: true,
    configured: false,
    weeks: {},
  });

  // A week picked via URL (from the overview tiles) seeds the picker; the
  // shopper can then add or remove weeks freely — one form, any number of
  // weeks, info entered only once.
  const [selectedWeeks, setSelectedWeeks] = useState<Set<CampWeekId>>(() => new Set());

  // The tiles above link to this same page with a new ?week= value, which
  // Next's router treats as an in-place update rather than a remount — so
  // a plain useState initializer only ever catches the week present on the
  // very first load. Comparing against the last-seen param during render
  // (React's documented pattern for adjusting state on a prop change) also
  // catches a tile tap after the form is already mounted, which is the
  // normal case since both live on this one page.
  const requestedWeek = searchParams.get("week");
  const [seededWeek, setSeededWeek] = useState<string | null>(null);
  if (requestedWeek !== seededWeek) {
    setSeededWeek(requestedWeek);
    if (requestedWeek && CAMP_WEEK_IDS.has(requestedWeek as CampWeekId)) {
      setSelectedWeeks((prev) => {
        if (prev.has(requestedWeek as CampWeekId)) return prev;
        const next = new Set(prev);
        next.add(requestedWeek as CampWeekId);
        return next;
      });
    }
  }

  // Filter out any selected week that capacity has since revealed is full
  // (e.g. it filled up between page load and now) without an extra effect.
  const effectiveWeeks = Array.from(selectedWeeks).filter((id) => !capacity.weeks[id]?.full);
  const weekCount = effectiveWeeks.length;
  const subtotalCents = effectiveWeeks.reduce((sum, id) => {
    const price = capacity.weeks[id]?.priceCents ?? juniorCamps.pricePerWeek * 100;
    return sum + price * children.length;
  }, 0);
  const priceBreakdown = calculateTotal(subtotalCents);

  function toggleWeek(weekId: CampWeekId) {
    setSelectedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  }

  function addChild() {
    setChildren((prev) => [...prev, newChild()]);
  }
  function removeChild(key: string) {
    setChildren((prev) => (prev.length > 1 ? prev.filter((c) => c.key !== key) : prev));
  }
  function updateChild(key: string, field: keyof Omit<ChildEntry, "key">, value: string) {
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
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
    if (children.some((c) => !c.fullName.trim() || !c.dateOfBirth.trim() || !c.age.trim() || !c.healthInfo.trim())) {
      setStatus("error");
      setErrorMessage("Please fill in every field for each child.");
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
          idempotencyKey,
          parentName: formData.get("parentName"),
          email: formData.get("email"),
          primaryPhone: formData.get("primaryPhone"),
          secondaryPhone: formData.get("secondaryPhone"),
          emergencyName: formData.get("emergencyName"),
          emergencyRelationship: formData.get("emergencyRelationship"),
          emergencyPhone: formData.get("emergencyPhone"),
          weeks: effectiveWeeks,
          children: children.map((c) => ({
            fullName: c.fullName,
            dateOfBirth: c.dateOfBirth,
            age: c.age,
            healthInfo: c.healthInfo,
          })),
          codeOfConductAccepted,
          consentAccepted,
        }),
      });
      const result = await response.json();

      if (response.ok && result.success && typeof result.statusPath === "string") {
        // Straight to their private payment page: reference, instructions, and the
        // "I've Sent My Payment" button. No account to create.
        router.push(result.statusPath);
        return;
      }
      if (response.ok && result.success) {
        setStatus("success");
        setSubmittedWeekCount(weekCount);
        setSubmittedChildCount(children.length);
        setSubmittedTotalCents(priceBreakdown.totalCents);
        form.reset();
        setSelectedWeeks(new Set());
        setChildren([newChild()]);
        setCodeOfConductAccepted(false);
        setConsentAccepted(false);
        // A fresh key for the next registration this visitor might submit —
        // reusing the old one would otherwise look like a retry of the
        // submission that just succeeded.
        setIdempotencyKey(crypto.randomUUID());
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
          Registration received!
        </p>
        <p className="mt-2 text-ink-soft">
          A spot is being held for {submittedChildCount === 1 ? "your child" : `each of your ${submittedChildCount} children`} for every week you selected.
          Please check your email for your payment instructions and reference &mdash; spots are only secured once
          payment is received in full.
        </p>
        <p className="mt-4 rounded-xl bg-cream-dark px-4 py-3 font-display text-base font-semibold text-forest">
          Total due: {submittedChildCount} child{submittedChildCount === 1 ? "" : "ren"} &times; {submittedWeekCount} week{submittedWeekCount === 1 ? "" : "s"} = ${formatCents(submittedTotalCents)} (tax included)
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-2xl border border-gold/30 bg-cream p-8">
      <div>
        <h3 className="font-display text-lg font-semibold text-forest">
          Section 1 &mdash; Parent/Guardian Information
        </h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="Parent/guardian full name" name="parentName" type="text" required />
          <Field label="Email address" name="email" type="email" required />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Primary phone" name="primaryPhone" type="tel" required />
          <Field label="Secondary phone (optional)" name="secondaryPhone" type="tel" />
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-forest">
            Section 2 &mdash; Child{children.length === 1 ? "" : "ren"}
          </h3>
          <button
            type="button"
            onClick={addChild}
            className="cursor-pointer rounded-full border border-gold/40 px-3 py-1.5 text-xs font-semibold text-forest hover:border-forest"
          >
            + Add another child
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Register siblings together &mdash; add each child below, and the weeks you pick further down apply to all of them.
        </p>
        <div className="mt-4 space-y-5">
          {children.map((child, index) => (
            <div key={child.key} className="rounded-xl border border-gold/30 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-display text-sm font-semibold text-forest">Child {index + 1}</p>
                {children.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeChild(child.key)}
                    aria-label={`Remove child ${index + 1}`}
                    className="cursor-pointer text-xs font-semibold text-ink-soft hover:text-flag"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <ChildField
                  label="Child's full name"
                  value={child.fullName}
                  onChange={(v) => updateChild(child.key, "fullName", v)}
                  type="text"
                />
                <ChildField
                  label="Child's age"
                  value={child.age}
                  onChange={(v) => updateChild(child.key, "age", v)}
                  type="text"
                />
              </div>
              <div className="mt-4">
                <ChildField
                  label="Date of birth"
                  value={child.dateOfBirth}
                  onChange={(v) => updateChild(child.key, "dateOfBirth", v)}
                  type="date"
                />
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-ink">
                  Health &amp; medical information (allergies, medical conditions, medication)
                </label>
                <textarea
                  value={child.healthInfo}
                  onChange={(e) => updateChild(child.key, "healthInfo", e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <h3 className="font-display text-lg font-semibold text-forest">
          Section 3 &mdash; Emergency Contact Information
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
        <h3 className="font-display text-lg font-semibold text-forest">Section 4 &mdash; Camp Week(s)</h3>
        <p className="mt-1 text-sm text-ink-soft">
          {juniorCamps.hoursLabel} &mdash; {juniorCamps.hours}, at {locations[juniorCamps.venue].name}.
        </p>
        <p className="text-sm text-ink-soft">{juniorCamps.scheduleNote}</p>
        <p className="mt-2 text-sm font-semibold text-forest">
          Select as many weeks as you&apos;d like &mdash; they apply to every child above.
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
                    Filling up fast — don&apos;t wait!
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-cream-dark p-5">
        {weekCount > 0 ? (
          <>
            <p className="font-display text-base font-semibold text-forest">
              {children.length} child{children.length === 1 ? "" : "ren"} &times; {weekCount} week{weekCount === 1 ? "" : "s"}
            </p>
            <dl className="mt-2 space-y-1 text-sm text-ink-soft">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>${formatCents(priceBreakdown.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>GST (5%)</dt>
                <dd>${formatCents(priceBreakdown.gstCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>QST (9.975%)</dt>
                <dd>${formatCents(priceBreakdown.qstCents)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-forest">
                <dt>Total</dt>
                <dd>${formatCents(priceBreakdown.totalCents)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="font-display text-base font-semibold text-forest">
            ${juniorCamps.pricePerWeek} + tax per child, per week
          </p>
        )}
        <p className="mt-2 text-sm text-ink-soft">
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
            Registering holds your spot right away. On the next screen (and by email) you&apos;ll get your unique reference and
            the Interac e-Transfer instructions.
          </li>
          <li>
            Send your e-Transfer within 12 hours to keep your spot, then tap <strong>&ldquo;I&apos;ve Sent My Payment.&rdquo;</strong> No
            account and no screenshots needed.
          </li>
          <li>Your spot is confirmed once we verify the payment in our bank account.</li>
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

function ChildField({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required
        className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
      />
    </div>
  );
}
