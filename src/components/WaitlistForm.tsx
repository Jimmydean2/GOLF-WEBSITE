"use client";

import { FormEvent, useEffect, useState } from "react";
import { juniorCamps } from "@/lib/content";
import { getMessages, privacyPath } from "@/lib/i18n";
import { weekLabel } from "@/lib/season";
import type { Lang } from "@/lib/lang";

// The optional waiting list for full weeks. It appears only when registration is open and at least
// one week is full. Joining it does not register a child or hold a place, and the page says so
// before, during and after (and so does the email).

type Capacity = { loading: boolean; open: boolean; fullWeekIds: string[] };
type Status = "idle" | "sending" | "done" | "error";

const INPUT =
  "w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest";

export default function WaitlistForm({ lang }: { lang: Lang }) {
  const m = getMessages(lang);
  const w = m.waitlist;
  const [capacity, setCapacity] = useState<Capacity>({ loading: true, open: false, fullWeekIds: [] });
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [doneMessage, setDoneMessage] = useState("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/camp-capacity")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const weeks = (data.weeks ?? {}) as Record<string, { waitlistable?: boolean }>;
        setCapacity({
          loading: false,
          open: data.registration?.state === "open" && Boolean(data.configured),
          fullWeekIds: juniorCamps.weeks.filter((week) => weeks[week.id]?.waitlistable).map((week) => week.id),
        });
      })
      .catch(() => {
        if (!cancelled) setCapacity({ loading: false, open: false, fullWeekIds: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Nothing to show until registration is open and a week is actually full.
  if (capacity.loading || !capacity.open || capacity.fullWeekIds.length === 0) return null;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const weeks = capacity.fullWeekIds.filter((id) => picked.has(id));
    if (weeks.length === 0 || !consent) {
      setStatus("error");
      setError(!consent && weeks.length > 0 ? w.errors.consent : w.errors.missing);
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/camp-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentName: String(form.get("parentName") ?? ""),
          email: String(form.get("email") ?? ""),
          phone: String(form.get("phone") ?? ""),
          placesWanted: Number(form.get("placesWanted") ?? 1),
          weeks,
          consentAccepted: consent,
          language: lang,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setDoneMessage(String(data.message ?? ""));
        setStatus("done");
        return;
      }
      setError(String(data.error ?? w.errors.tryAgain));
      setStatus("error");
    } catch {
      setError(w.errors.tryAgain);
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <section id="waitlist" className="scroll-mt-28 rounded-2xl border border-gold/30 bg-cream p-6 text-center" aria-live="polite">
        <h3 className="font-display text-xl font-semibold text-forest">{w.doneHeading}</h3>
        <p className="mt-2 text-ink-soft">{doneMessage}</p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setPicked(new Set());
            setConsent(false);
          }}
          className="mt-4 cursor-pointer text-sm font-semibold text-forest underline underline-offset-2"
        >
          {w.again}
        </button>
      </section>
    );
  }

  return (
    <section id="waitlist" className="scroll-mt-28 rounded-2xl border border-gold/30 bg-cream p-6">
      <h3 className="font-display text-xl font-semibold text-forest">{w.heading}</h3>
      <p className="mt-2 text-sm text-ink-soft">{w.intro}</p>
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <fieldset>
          <legend className="text-sm font-medium text-ink">{w.weeksLegend}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {capacity.fullWeekIds.map((id) => {
              const week = juniorCamps.weeks.find((x) => x.id === id)!;
              return (
                <label key={id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gold/40 bg-white px-3 py-2 text-sm text-ink">
                  <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} />
                  <span>{weekLabel(week, lang)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink">
            {w.name}
            <input name="parentName" required maxLength={120} autoComplete="name" className={`${INPUT} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-ink">
            {w.email}
            <input name="email" type="email" required maxLength={254} autoComplete="email" className={`${INPUT} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-ink">
            {w.phone}
            <input name="phone" type="tel" maxLength={40} autoComplete="tel" className={`${INPUT} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-ink">
            {w.places}
            <select name="placesWanted" defaultValue="1" className={`${INPUT} mt-1`}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-3 text-sm text-ink-soft">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>
            {w.consentBefore}
            <a href={privacyPath(lang)} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-forest">
              {w.consentLink}
            </a>
            .
          </span>
        </label>
        {status === "error" && (
          <p role="alert" className="text-sm font-medium text-flag">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "sending" ? w.sending : w.submit}
        </button>
      </form>
    </section>
  );
}
