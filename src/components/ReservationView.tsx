import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import Container from "@/components/Container";
import ReportPaymentButton from "@/components/ReportPaymentButton";
import Rich from "@/components/Rich";
import { business } from "@/lib/content";
import { isDatabaseConfigured } from "@/lib/db";
import { getCampSettings, getRegistrationById } from "@/lib/campDb";
import { etransferInstructionLines } from "@/lib/payment";
import { formatMoney, formatMontreal, getMessages } from "@/lib/i18n";
import { labelForWeekId } from "@/lib/season";
import { registrationIdFromToken } from "@/lib/registrationLink";
import { maybeRunFromTraffic } from "@/lib/scheduledCheck";
import { maskEmail, siteOriginFromHeaders } from "@/lib/siteUrl";
import { logError } from "@/lib/safeLog";
import type { Lang } from "@/lib/lang";

// A parent's private reservation page, in either language (the English page and the French page
// are this component with a different dictionary). The link is the credential (there is no
// account): it is never indexed, never sent as a referrer, and never cached. It can show this
// one registration and report payment, nothing more.
export default async function ReservationView({ token, lang }: { token: string; lang: Lang }) {
  const m = getMessages(lang);
  const p = m.parent;
  const registrationId = registrationIdFromToken(token);
  if (!registrationId || !isDatabaseConfigured()) notFound();
  const registration = await getRegistrationById(registrationId);
  if (!registration) notFound();

  // A visit is a chance to run the scheduled check if nothing has run for a few minutes (a
  // fallback for when no scheduler is set up; at most one run every 5 minutes site-wide).
  const origin = siteOriginFromHeaders(await headers());
  if (origin) after(() => maybeRunFromTraffic(origin).catch((err) => logError("Scheduled check from a visit failed:", err)));

  const amountText = formatMoney(registration.amountDueCents, lang);
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const weeks = (registration.weekIds.length > 0 ? registration.weekIds : registration.allWeekIds).map((id) => labelForWeekId(id, lang));

  const settings = await getCampSettings();
  const payBy =
    registration.holdExpiresAt &&
    new Date(new Date(registration.holdExpiresAt).getTime() - settings.reportAllowanceMinutes * 60_000).toISOString();

  return (
    <div className="py-16 sm:py-24">
      <Container className="max-w-xl">
        <div className="rounded-2xl border border-gold/30 bg-cream p-6 sm:p-8">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">{p.eyebrow}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-forest">{childNames}</h1>
          <p className="mt-1 text-sm text-ink-soft">{weeks.join(" · ")}</p>

          <div className="mt-6 rounded-xl bg-cream-dark p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gold-deep">{p.reference}</p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-wider text-forest">{registration.reference}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.15em] text-gold-deep">{p.amountDue}</p>
            <p className="mt-1 font-display text-xl font-semibold text-forest">
              {amountText} <span className="text-sm font-normal text-ink-soft">{p.taxIncluded}</span>
            </p>
          </div>

          {registration.status === "pending_payment" && (
            <>
              <h2 className="mt-8 font-display text-lg font-semibold text-forest">{p.sendPayment}</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
                {etransferInstructionLines(registration.reference, amountText, "page", lang).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              {payBy && (
                <p className="mt-4 text-sm text-ink-soft">
                  <Rich text={p.heldUntil(formatMontreal(payBy, lang))} />
                </p>
              )}
              <p className="mt-2 text-xs text-ink-soft">
                <Rich text={p.emailedTo(maskEmail(registration.email), business.phone)} />
              </p>
              <div className="mt-6">
                <ReportPaymentButton token={token} lang={lang} />
              </div>
              <p className="mt-3 text-xs text-ink-soft">{p.tapNote}</p>
            </>
          )}

          {registration.status === "payment_reported" && (
            <div className="mt-8 rounded-xl border border-forest/30 bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-forest">{p.reportedTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                <Rich text={p.reportedBody(registration.reference)} />
              </p>
            </div>
          )}

          {registration.status === "paid" && (
            <div className="mt-8 rounded-xl border border-forest/30 bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-forest">{p.paidTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{p.paidBody}</p>
            </div>
          )}

          {(registration.status === "cancelled" || registration.status === "refunded") && (
            <div className="mt-8 rounded-xl border border-gold/40 bg-white p-5">
              <h2 className="font-display text-lg font-semibold text-forest">{p.inactiveTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {registration.releaseReason === "expired_unpaid" ? p.inactiveExpired : p.inactiveReleased} {p.inactiveContact}
              </p>
            </div>
          )}

          <p className="mt-8 text-center text-sm text-ink-soft">
            {p.questions} {p.callWord}{" "}
            <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
              {business.phone}
            </a>{" "}
            {p.orEmail}{" "}
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
