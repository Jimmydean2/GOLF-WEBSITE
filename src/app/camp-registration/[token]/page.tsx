import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import Container from "@/components/Container";
import ReportPaymentButton from "@/components/ReportPaymentButton";
import { business, juniorCamps } from "@/lib/content";
import { isDatabaseConfigured } from "@/lib/db";
import { getCampSettings, getRegistrationById } from "@/lib/campDb";
import { etransferInstructionLines, formatMontreal } from "@/lib/payment";
import { formatCents } from "@/lib/pricing";
import { registrationIdFromToken } from "@/lib/registrationLink";
import { maybeRunFromTraffic } from "@/lib/scheduledCheck";
import { maskEmail, siteOriginFromHeaders } from "@/lib/siteUrl";
import { logError } from "@/lib/safeLog";

// A parent's private reservation page. The link is the credential (there is no account):
// it is never indexed, never sent as a referrer, and never cached. It can show this one
// registration and report payment, nothing more.
export const metadata: Metadata = {
  title: `Your camp reservation | ${business.name}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

const weekLabel = (id: string) => juniorCamps.weeks.find((w) => w.id === id)?.label ?? id;

export default async function ReservationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const registrationId = registrationIdFromToken(token);
  if (!registrationId || !isDatabaseConfigured()) notFound();
  const registration = await getRegistrationById(registrationId);
  if (!registration) notFound();

  // A visit is a chance to run the scheduled check if nothing has run for a few minutes (a
  // fallback for when no scheduler is set up; at most one run every 5 minutes site-wide).
  const origin = siteOriginFromHeaders(await headers());
  if (origin) after(() => maybeRunFromTraffic(origin).catch((err) => logError("Scheduled check from a visit failed:", err)));

  const amountText = `$${formatCents(registration.amountDueCents)}`;
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const weeks = (registration.weekIds.length > 0 ? registration.weekIds : registration.allWeekIds).map(weekLabel);

  const settings = await getCampSettings();
  const payBy =
    registration.holdExpiresAt &&
    new Date(new Date(registration.holdExpiresAt).getTime() - settings.reportAllowanceMinutes * 60_000).toISOString();

  return (
    <div className="py-16 sm:py-24">
      <Container className="max-w-xl">
        <div className="rounded-2xl border border-gold/30 bg-cream p-6 sm:p-8">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">Junior Camp reservation</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-forest">{childNames}</h1>
          <p className="mt-1 text-sm text-ink-soft">{weeks.join(" · ")}</p>

          <div className="mt-6 rounded-xl bg-cream-dark p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gold-deep">Your reference</p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-wider text-forest">{registration.reference}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.15em] text-gold-deep">Amount due</p>
            <p className="mt-1 font-display text-xl font-semibold text-forest">
              {amountText} <span className="text-sm font-normal text-ink-soft">tax included</span>
            </p>
          </div>

          {registration.status === "pending_payment" && (
            <>
              <h2 className="mt-8 font-display text-lg font-semibold text-forest">Send your payment</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
                {etransferInstructionLines(registration.reference, amountText).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              {payBy && (
                <p className="mt-4 text-sm text-ink-soft">
                  Your spot is held until <strong className="text-ink">{formatMontreal(payBy)}</strong> (Montreal time).
                </p>
              )}
              <p className="mt-2 text-xs text-ink-soft">
                We&apos;ve also emailed these instructions and this page&apos;s private link to{" "}
                <strong className="text-ink">{maskEmail(registration.email)}</strong>. Not the right address? Call{" "}
                <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
                  {business.phone}
                </a>
                .
              </p>
              <div className="mt-6">
                <ReportPaymentButton token={token} />
              </div>
              <p className="mt-3 text-xs text-ink-soft">
                Tapping the button tells us you&apos;ve sent it. Your spot is confirmed once we verify the payment in our bank account.
              </p>
            </>
          )}

          {registration.status === "payment_reported" && (
            <div className="mt-8 rounded-xl border border-forest/30 bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-forest">Thank you &mdash; we&apos;re checking your payment</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                We&apos;ve noted that you sent your payment, and your spot is being held while we verify it. You&apos;ll get an email
                as soon as it&apos;s confirmed. Please keep your reference, <strong className="text-ink">{registration.reference}</strong>,
                handy in case we need to match it.
              </p>
            </div>
          )}

          {registration.status === "paid" && (
            <div className="mt-8 rounded-xl border border-forest/30 bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-forest">You&apos;re confirmed!</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Your payment has been received and your spot is confirmed. Camp details are in your confirmation email.
              </p>
            </div>
          )}

          {(registration.status === "cancelled" || registration.status === "refunded") && (
            <div className="mt-8 rounded-xl border border-gold/40 bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-forest">This reservation isn&apos;t active</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {registration.releaseReason === "expired_unpaid"
                  ? "It was released because we didn't see a payment report in time. If you already sent your e-Transfer, your money isn't lost."
                  : "It has been released."}{" "}
                Please contact us with your reference and we&apos;ll sort it out.
              </p>
            </div>
          )}

          <p className="mt-8 text-center text-sm text-ink-soft">
            Questions? Call{" "}
            <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
              {business.phone}
            </a>{" "}
            or email{" "}
            <a href={`mailto:${business.email}`} className="font-semibold text-forest hover:underline">
              {business.email}
            </a>
            .
          </p>
        </div>
      </Container>
    </div>
  );
}
