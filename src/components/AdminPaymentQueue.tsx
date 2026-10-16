"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminCall } from "./AdminActions";
import RegistrationActionButtons from "./AdminRegistrationActions";
import { formatMontreal } from "@/lib/payment";
import { formatCents } from "@/lib/pricing";
import { juniorCamps } from "@/lib/content";
import type { PaymentQueue, QueueItem } from "@/lib/campDb";

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
      </p>
      <p className="mt-1 text-sm text-ink-soft">{(item.weekIds.length ? item.weekIds : []).map(weekLabel).join(" · ")}</p>
      {children}
    </li>
  );
}

export default function AdminPaymentQueue() {
  const call = useAdminCall();
  const [queue, setQueue] = useState<PaymentQueue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const result = await call("/api/admin/payment-queue", undefined, "GET");
    if (result.ok) {
      setQueue(result.data as unknown as PaymentQueue);
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
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const changed = (message: string) => {
    setNotice(message);
    load();
  };

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

  return (
    <section aria-label="Payment review queue" className="mt-8 space-y-6">
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

      <details className="rounded-xl border border-gold/30 bg-cream p-4">
        <summary className="cursor-pointer font-display text-base font-semibold text-forest">
          Awaiting payment — {queue.awaiting.length} (spot held {queue.settings.holdHours} hours)
        </summary>
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
