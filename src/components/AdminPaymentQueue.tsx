"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminCall } from "./AdminActions";
import RegistrationActionButtons from "./AdminRegistrationActions";
import { formatMontreal } from "@/lib/payment";
import { formatCents } from "@/lib/pricing";
import { juniorCamps } from "@/lib/content";
import type { PaymentQueue, QueueItem } from "@/lib/campDb";
import type { EmailHealth } from "@/lib/outbox";
import type { SchedulerHealth } from "@/lib/scheduledCheck";

// The administrators' review queue: the first thing on the admin page. Reported payments
// come first, most overdue at the top, because a reported payment holds a spot until an
// administrator acts. Refreshes itself every 30 seconds.

const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

function Card({ item, tone, children }: { item: QueueItem; tone: "overdue" | "normal"; children: React.ReactNode }) {
  return (
    <li className={`rounded-xl border p-4 ${tone === "overdue" ? "border-flag bg-flag/5" : "border-gold/30 bg-white"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink">
          <span className="font-display tracking-wider text-forest">{item.reference}</span> &middot; {item.childNames.join(", ")}
        </p>
        <p className="text-sm font-semibold text-ink">${formatCents(item.amountDueCents)}</p>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {item.parentName} &middot;{" "}
        <a className="font-semibold text-forest hover:underline" href={`tel:${item.primaryPhone}`}>
          {item.primaryPhone}
        </a>{" "}
        &middot; {item.email}
        {item.language === "fr" && <span className="ml-2 rounded-full bg-forest px-2 py-0.5 text-xs font-semibold text-cream">Français</span>}
      </p>
      <p className="mt-1 text-sm text-ink-soft">{(item.weekIds.length ? item.weekIds : []).map(weekLabel).join(" · ")}</p>
      {children}
    </li>
  );
}


type Health = { scheduler: SchedulerHealth; email: EmailHealth };

const minutesText = (m: number | null) => (m === null ? "never" : m < 1 ? "just now" : m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.floor(m / 60)} hour${Math.floor(m / 60) === 1 ? "" : "s"} ago`);

// Two questions an administrator should never have to guess: is the automatic check running
// (the 12-hour releases, reminders, alerts and queued emails), and are emails getting out?
// Quiet and small when all is well; loud when it is not.
function StatusPanel({ health, onRunNow, running }: { health: Health; onRunNow: () => void; running: boolean }) {
  const { scheduler, email } = health;
  const schedulerProblem = scheduler.status === "stale" || scheduler.lastRunOk === false;
  const emailProblem = email.failed > 0 || (email.waiting > 0 && (email.oldestWaitingMinutes ?? 0) >= 20) || (!email.configured && email.waiting > 0);
  const nothingScheduled = scheduler.status !== "never" && scheduler.lastCronAt === null;
  const tone = schedulerProblem || emailProblem ? "border-flag bg-flag/5" : "border-gold/30 bg-cream";
  return (
    <div className={`rounded-xl border p-4 text-sm ${tone}`} aria-label="System status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-base font-semibold text-forest">Automatic checks and email</p>
        <button
          type="button"
          onClick={onRunNow}
          disabled={running}
          className="cursor-pointer rounded-full border border-forest px-4 py-1.5 text-xs font-semibold text-forest hover:bg-forest hover:text-cream disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? "Running…" : "Run the check now"}
        </button>
      </div>
      <ul className="mt-2 space-y-1 text-ink-soft">
        <li className={schedulerProblem ? "font-semibold text-flag" : ""}>
          {scheduler.status === "never"
            ? "The automatic check has not run yet. It runs when someone visits the site, or on a schedule once one is set up."
            : scheduler.lastRunOk === false
              ? `The last automatic check FAILED ${minutesText(scheduler.minutesSinceLastRun)}${scheduler.lastRunError ? `: ${scheduler.lastRunError}` : ""}.`
              : scheduler.status === "stale"
                ? `The automatic check last ran ${minutesText(scheduler.minutesSinceLastRun)}. Reminders, alerts and emails may be late until it runs again.`
                : `Automatic check ran ${minutesText(scheduler.minutesSinceLastRun)}.`}
          {nothingScheduled && scheduler.status === "ok" && " (Triggered by site visits: no scheduled job is set up yet.)"}
        </li>
        <li className={emailProblem ? "font-semibold text-flag" : ""}>
          {!email.configured
            ? `Email is not connected${email.waiting > 0 ? `, so ${email.waiting} email${email.waiting === 1 ? " is" : "s are"} waiting` : ""}.`
            : email.waiting > 0
              ? `${email.waiting} email${email.waiting === 1 ? "" : "s"} waiting to be sent${email.oldestWaitingMinutes ? ` (the oldest for ${email.oldestWaitingMinutes} minutes)` : ""}. They are retried automatically.`
              : "No emails waiting."}{" "}
          <span className="font-normal text-ink-soft">
            {email.sentLast24h} sent in the last 24 hours (a Gmail account allows about 500 a day).
          </span>
        </li>
      </ul>
      {email.failedItems.length > 0 && (
        <div className="mt-3 rounded-lg border border-flag bg-white p-3">
          <p className="font-semibold text-flag">
            {email.failed} email{email.failed === 1 ? "" : "s"} could not be delivered. Call the family:
          </p>
          <ul className="mt-1 space-y-1 text-ink-soft">
            {email.failedItems.map((f) => (
              <li key={`${f.reference}-${f.kind}`}>
                <span className="font-display tracking-wider text-forest">{f.reference}</span> &middot; {f.parentName} &middot;{" "}
                <a className="font-semibold text-forest hover:underline" href={`tel:${f.primaryPhone}`}>
                  {f.primaryPhone}
                </a>{" "}
                &middot; {f.kind.replace(/_/g, " ")} &middot; <span className="text-xs">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AdminPaymentQueue() {
  const call = useAdminCall();
  const [queue, setQueue] = useState<(PaymentQueue & { health?: Health }) | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const result = await call("/api/admin/payment-queue", undefined, "GET");
    if (result.ok) {
      setQueue(result.data as unknown as PaymentQueue & { health?: Health });
      setError("");
    } else {
      setError(String(result.data.error ?? "Could not load the review queue."));
    }
  }, [call]);

  useEffect(() => {
    // First load straight away (in a timer callback, so state is set outside the effect body),
    // then every 30 seconds.
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 30_000);
    // An action taken elsewhere on the page (the search panel) changes what this list should show.
    window.addEventListener("camp-admin-changed", load);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("camp-admin-changed", load);
    };
  }, [load]);

  const changed = (message: string) => {
    setNotice(message);
    load();
  };

  async function runNow() {
    setRunning(true);
    const result = await call("/api/admin/run-check", {});
    setRunning(false);
    if (result.ok && result.data.ok) {
      const d = result.data as Record<string, unknown> & { emails?: Record<string, number> };
      setNotice(
        `Check done: ${d.released ?? 0} reservation(s) released, ${d.alertsSent ?? 0} alert(s) and ${d.emails?.sent ?? 0} email(s) sent` +
          (d.skipped === "already_running" ? " (another check was already running)" : "") +
          (d.noEmailConfigured ? ". Email is not connected, so nothing could be sent" : "") +
          "."
      );
    } else {
      setNotice(`The check failed: ${String(result.data.error ?? "unknown problem")}`);
    }
    load();
  }

  if (error && !queue) {
    return (
      <p role="alert" className="mt-8 text-sm text-flag">
        {error}
      </p>
    );
  }
  if (!queue) return <p className="mt-8 text-sm text-ink-soft">Loading the review queue…</p>;

  const target = (i: QueueItem) => ({
    id: i.id,
    reference: i.reference,
    status: i.status,
    amountDueCents: i.amountDueCents,
    childNames: i.childNames,
    extensionCount: i.extensionCount,
    reinstateCount: i.reinstateCount,
  });
  const max = queue.settings.extensionMaxCount;
  const endingSoon = queue.awaiting.filter((i) => i.holdExpiresAt && new Date(i.holdExpiresAt).getTime() - new Date(queue.generatedAt).getTime() < 4 * 3_600_000);

  return (
    <section aria-label="Payment review queue" className="mt-8 space-y-6">
      {queue.health && <StatusPanel health={queue.health} onRunNow={runNow} running={running} />}
      {queue.overdueCount > 0 && (
        <div role="alert" className="rounded-xl border-2 border-flag bg-flag/10 p-4">
          <p className="font-display text-base font-semibold text-flag">
            {queue.overdueCount} payment{queue.overdueCount === 1 ? "" : "s"} overdue for review
          </p>
          <p className="mt-1 text-sm text-ink">
            {queue.blockedSpots} spot{queue.blockedSpots === 1 ? " is" : "s are"} held by unverified payments; the longest has been overdue {queue.longestOverdueHours} hour
            {queue.longestOverdueHours === 1 ? "" : "s"}. Check your bank, then confirm, release or extend each one below.
          </p>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-cream-dark px-4 py-2 text-sm font-medium text-forest">
          {notice}
        </p>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold text-forest">Payments to verify ({queue.reported.length})</h2>
        <p className="text-sm text-ink-soft">The parent says they&apos;ve sent it. Nothing is confirmed until you see the deposit.</p>
        {queue.reported.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Nothing waiting.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {queue.reported.map((i) => (
              <Card key={i.id} item={i} tone={i.overdue ? "overdue" : "normal"}>
                <p className={`mt-2 text-sm font-semibold ${i.overdue ? "text-flag" : "text-forest"}`}>
                  {i.overdue
                    ? `OVERDUE FOR REVIEW by ${i.overdueHours} hour${i.overdueHours === 1 ? "" : "s"} · spot still held`
                    : "Payment Reported — Awaiting Verification"}
                </p>
                <p className="text-xs text-ink-soft">
                  Reported {i.paymentReportedAt ? formatMontreal(i.paymentReportedAt) : "-"} · review {i.overdue ? "was due" : "due"}{" "}
                  {i.reviewDueAt ? formatMontreal(i.reviewDueAt) : "-"}
                  {i.extensionCount > 0 && ` · ${i.extensionCount} extension${i.extensionCount === 1 ? "" : "s"} used`}
                </p>
                <div className="mt-3">
                  <RegistrationActionButtons target={target(i)} extensionMax={max} onChanged={changed} />
                </div>
              </Card>
            ))}
          </ul>
        )}
      </div>

      <details className="rounded-xl border border-gold/30 bg-cream p-4" open={endingSoon.length > 0}>
        <summary className="cursor-pointer font-display text-base font-semibold text-forest">
          Awaiting payment — {queue.awaiting.length} (spot held {queue.settings.holdHours} hours
          {endingSoon.length > 0 ? `; ${endingSoon.length} ending within 4 hours` : ""})
        </summary>
        <p className="mt-2 text-xs text-ink-soft">
          Once a day, look in your bank for these references. If a deposit is there, click Confirm: the family does not need to tap
          anything first. Families who have not reported get a reminder email a few hours before their hold ends.
        </p>
        {queue.awaiting.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">None.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {queue.awaiting.map((i) => (
              <Card key={i.id} item={i} tone="normal">
                <p className="mt-2 text-xs text-ink-soft">Hold ends {i.holdExpiresAt ? formatMontreal(i.holdExpiresAt) : "-"}. If it arrives before the parent taps the button, you can still confirm it.</p>
                <div className="mt-3">
                  <RegistrationActionButtons target={target(i)} extensionMax={max} onChanged={changed} />
                </div>
              </Card>
            ))}
          </ul>
        )}
      </details>

      <details className="rounded-xl border border-gold/30 bg-cream p-4">
        <summary className="cursor-pointer font-display text-base font-semibold text-forest">
          Recently released — {queue.released.length} (last 14 days; a late deposit lands here)
        </summary>
        {queue.released.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">None.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {queue.released.map((i) => (
              <Card key={i.id} item={i} tone="normal">
                <p className="mt-2 text-xs text-ink-soft">
                  {i.releaseReason === "expired_unpaid" ? "Released — no payment report" : "Released by admin — payment not received"}
                  {i.cancelledAt ? `, ${formatMontreal(i.cancelledAt)}` : ""}
                </p>
                <div className="mt-3">
                  <RegistrationActionButtons target={target(i)} extensionMax={max} onChanged={changed} />
                </div>
              </Card>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
