"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { business, juniorCamps, type CampWeekId } from "@/lib/content";
import { calculateTotal } from "@/lib/pricing";
import { formatMontrealLong, getMessages, privacyPath } from "@/lib/i18n";
import { RETENTION_DAYS } from "@/lib/privacy";
import { weekLabel } from "@/lib/season";
import type { Lang } from "@/lib/lang";
import type { RegistrationWindow } from "@/lib/registrationWindow";
import Rich from "@/components/Rich";

const CAMP_WEEK_IDS = new Set(juniorCamps.weeks.map((week) => week.id));

type Status = "idle" | "sending" | "success" | "error";

type WeekInfo = { taken: number; max: number; remaining: number; full: boolean; priceCents: number; waitlistable?: boolean };
type CapacityState = {
  loading: boolean;
  configured: boolean;
  weeks: Partial<Record<CampWeekId, WeekInfo>>;
  // Open, not yet announced, or opening at a set moment — the same answer the endpoint enforces.
  registration: RegistrationWindow | null;
  serverNow: string | null;
};

type ChildEntry = { key: string; fullName: string; dateOfBirth: string; age: string; healthInfo: string };

function newChild(): ChildEntry {
  return { key: crypto.randomUUID(), fullName: "", dateOfBirth: "", age: "", healthInfo: "" };
}

export default function CampRegistrationForm({ lang }: { lang: Lang }) {
  const m = getMessages(lang);
  const f = m.form;
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [submittedWeekCount, setSubmittedWeekCount] = useState(0);
  const [submittedChildCount, setSubmittedChildCount] = useState(0);
  const [submittedTotalCents, setSubmittedTotalCents] = useState(0);
  const [codeOfConductAccepted, setCodeOfConductAccepted] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [healthConsentAccepted, setHealthConsentAccepted] = useState(false);
  const [children, setChildren] = useState<ChildEntry[]>([newChild()]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [capacity, setCapacity] = useState<CapacityState>({
    loading: true,
    configured: false,
    weeks: {},
    registration: null,
    serverNow: null,
  });
  const [reloadTick, setReloadTick] = useState(0);

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
          registration: data.registration ?? null,
          serverNow: typeof data.serverNow === "string" ? data.serverNow : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCapacity({ loading: false, configured: false, weeks: {}, registration: null, serverNow: null });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // When registration is about to open, ask again at that moment, so a family who left the page
  // open does not have to refresh. The wait is measured on the server's clock (a wrong clock on
  // the visitor's phone changes nothing) with a few seconds of random spread, so a crowd of open
  // tabs does not ask in the same instant.
  const opensAt = capacity.registration?.state === "opens_later" ? capacity.registration.opensAt : null;
  const serverNow = capacity.serverNow;
  useEffect(() => {
    if (!opensAt || !serverNow) return;
    const wait = Math.max(0, Date.parse(opensAt) - Date.parse(serverNow)) + Math.floor(Math.random() * 4000);
    const timer = setTimeout(() => setReloadTick((n) => n + 1), Math.min(wait, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [opensAt, serverNow]);

  const contactBlock = (
    <div className="mt-4 flex flex-col items-center gap-1">
      <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
        {business.phone}
      </a>
      <a href={`mailto:${business.email}`} className="font-semibold text-forest hover:underline">
        {business.email}
      </a>
    </div>
  );

  if (!capacity.loading && capacity.registration?.state === "not_announced") {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="font-display text-lg font-semibold text-forest">{f.notAnnouncedTitle(juniorCamps.year)}</p>
        <p className="mt-2 text-ink-soft">{f.notAnnouncedBody(juniorCamps.year)}</p>
        {contactBlock}
      </div>
    );
  }

  if (!capacity.loading && !capacity.configured) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="text-ink-soft">{f.notConnected}</p>
        {contactBlock}
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (weekCount === 0) {
      setStatus("error");
      setErrorMessage(f.pickWeekFirst);
      return;
    }
    if (children.some((c) => !c.fullName.trim() || !c.dateOfBirth.trim() || !c.age.trim() || !c.healthInfo.trim())) {
      setStatus("error");
      setErrorMessage(f.fillEveryField);
      return;
    }
    if (!codeOfConductAccepted || !consentAccepted || !healthConsentAccepted) {
      setStatus("error");
      setErrorMessage(f.acceptBoth);
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
          language: lang,
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
          healthConsentAccepted,
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
        setHealthConsentAccepted(false);
        // A fresh key for the next registration this visitor might submit —
        // reusing the old one would otherwise look like a retry of the
        // submission that just succeeded.
        setIdempotencyKey(crypto.randomUUID());
      } else {
        setStatus("error");
        setErrorMessage(result.error || f.somethingWrong);
      }
    } catch {
      setStatus("error");
      setErrorMessage(f.somethingWrong);
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="font-display text-xl font-semibold text-forest">{f.successTitle}</p>
        <p className="mt-2 text-ink-soft">{f.successBody(submittedChildCount)}</p>
        <p className="mt-4 rounded-xl bg-cream-dark px-4 py-3 font-display text-base font-semibold text-forest">
          {f.successTotal(submittedChildCount, submittedWeekCount, submittedTotalCents)}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-2xl border border-gold/30 bg-cream p-8">
      {opensAt && (
        <div role="status" className="rounded-xl border border-gold/40 bg-white p-4 text-sm text-ink-soft">
          <p className="font-semibold text-forest">{f.opensBanner(formatMontrealLong(opensAt, lang))}</p>
          <p className="mt-1">{f.opensBannerBody}</p>
        </div>
      )}
      <div>
        <h3 className="font-display text-lg font-semibold text-forest">{f.section1}</h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label={f.parentName} name="parentName" type="text" required />
          <Field label={f.email} name="email" type="email" required />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label={f.primaryPhone} name="primaryPhone" type="tel" required />
          <Field label={f.secondaryPhone} name="secondaryPhone" type="tel" />
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-forest">{f.section2(children.length)}</h3>
          <button
            type="button"
            onClick={addChild}
            className="cursor-pointer rounded-full border border-gold/40 px-3 py-1.5 text-xs font-semibold text-forest hover:border-forest"
          >
            {f.addChild}
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{f.siblingsHint}</p>
        <div className="mt-4 space-y-5">
          {children.map((child, index) => (
            <div key={child.key} className="rounded-xl border border-gold/30 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-display text-sm font-semibold text-forest">{f.childN(index + 1)}</p>
                {children.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeChild(child.key)}
                    aria-label={f.removeChildAria(index + 1)}
                    className="cursor-pointer text-xs font-semibold text-ink-soft hover:text-flag"
                  >
                    {f.remove}
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <ChildField
                  label={f.childName}
                  value={child.fullName}
                  onChange={(v) => updateChild(child.key, "fullName", v)}
                  type="text"
                />
                <ChildField
                  label={f.childAge}
                  value={child.age}
                  onChange={(v) => updateChild(child.key, "age", v)}
                  type="text"
                />
              </div>
              <div className="mt-4">
                <ChildField
                  label={f.childDob}
                  value={child.dateOfBirth}
                  onChange={(v) => updateChild(child.key, "dateOfBirth", v)}
                  type="date"
                />
              </div>
              <div className="mt-4">
                <label htmlFor={`child-${index}-health`} className="mb-1 block text-sm font-medium text-ink">
                  {f.childHealth}
                </label>
                <textarea
                  id={`child-${index}-health`}
                  aria-describedby={`child-${index}-health-hint`}
                  value={child.healthInfo}
                  onChange={(e) => updateChild(child.key, "healthInfo", e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
                />
                <p id={`child-${index}-health-hint`} className="mt-1 text-xs text-ink-soft">
                  {f.childHealthHint}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <h3 className="font-display text-lg font-semibold text-forest">{f.section3}</h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label={f.emergencyName} name="emergencyName" type="text" required />
          <Field label={f.emergencyRelationship} name="emergencyRelationship" type="text" required />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label={f.emergencyPhone} name="emergencyPhone" type="tel" required />
        </div>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <h3 className="font-display text-lg font-semibold text-forest">{f.section4}</h3>
        <p className="mt-1 text-sm text-ink-soft">{f.hoursLine(m.info.hoursLabel, m.info.hours)}</p>
        <p className="text-sm text-ink-soft">{m.info.scheduleNote}</p>
        <p className="mt-2 text-sm font-semibold text-forest">{f.pickWeeksHint}</p>
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
                <span className="font-display text-base font-semibold pr-6">{weekLabel(week, lang)}</span>
                <span className={`mt-1 block text-xs ${selected ? "text-cream/80" : "text-ink-soft"}`}>
                  {capacity.loading || !info ? m.week.checking : full ? (info.waitlistable ? m.week.fullWaitlist : m.week.full) : m.week.spotsLeft(info.remaining, info.max)}
                </span>
                {week.note && (
                  <span className={`mt-1 block text-xs ${selected ? "text-cream/80" : "text-ink-soft"}`}>{week.note[lang]}</span>
                )}
                {!capacity.loading && info && !full && info.remaining <= 5 && (
                  <span className={`mt-1 block text-xs font-semibold ${selected ? "text-gold-light" : "text-flag"}`}>
                    {m.week.fillingUp}
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
            <p className="font-display text-base font-semibold text-forest">{f.childrenTimesWeeks(children.length, weekCount)}</p>
            <dl className="mt-2 space-y-1 text-sm text-ink-soft">
              <div className="flex justify-between">
                <dt>{f.subtotal}</dt>
                <dd>{f.money(priceBreakdown.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{f.gst}</dt>
                <dd>{f.money(priceBreakdown.gstCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{f.qst}</dt>
                <dd>{f.money(priceBreakdown.qstCents)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-forest">
                <dt>{f.total}</dt>
                <dd>{f.money(priceBreakdown.totalCents)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="font-display text-base font-semibold text-forest">{f.priceFrom(juniorCamps.pricePerWeek)}</p>
        )}
        <p className="mt-2 text-sm text-ink-soft">{f.firstComeNote}</p>
      </div>

      <div className="border-t border-gold/20 pt-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={codeOfConductAccepted}
            onChange={(e) => setCodeOfConductAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 flex-none rounded border-gold/40 text-forest focus:ring-forest"
          />
          <span className="text-sm text-ink-soft">{f.conductConsent}</span>
        </label>
      </div>

      <div className="rounded-xl border border-gold/30 bg-white p-5">
        <h4 className="font-display text-base font-semibold text-forest">{f.paymentTitle}</h4>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft">
          <li>{f.payHold}</li>
          <li>
            <Rich text={f.paySend(m.report.button)} />
          </li>
          <li>{f.payConfirm}</li>
          <li>{f.payCancelFee}</li>
          <li>{f.payNotVenue}</li>
        </ul>
      </div>

      <div className="rounded-xl border border-gold/30 bg-white p-5">
        <h4 className="font-display text-base font-semibold text-forest">{m.consent.panelTitle}</h4>
        <p className="mt-2 text-sm text-ink-soft">{m.consent.panel(RETENTION_DAYS)}</p>
      </div>

      <div className="space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(e) => setConsentAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 flex-none rounded border-gold/40 text-forest focus:ring-forest"
          />
          <span className="text-sm text-ink-soft">
            {m.consent.privacyBefore}
            <a href={privacyPath(lang)} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest underline underline-offset-2">
              {m.consent.privacyLink}
            </a>
            {m.consent.privacyAfter}
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={healthConsentAccepted}
            onChange={(e) => setHealthConsentAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 flex-none rounded border-gold/40 text-forest focus:ring-forest"
          />
          <span className="text-sm text-ink-soft">{m.consent.health}</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={status === "sending" || opensAt !== null}
        className="w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? f.sending : opensAt ? f.notOpenYet : f.submit}
      </button>

      {status === "error" && (
        <p role="alert" className="text-sm text-flag">
          {errorMessage || f.errorFallback}
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
  // useId is the same on the server and in the browser, which a random value would not be.
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required
        className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
      />
    </div>
  );
}
