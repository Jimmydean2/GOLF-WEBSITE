import type { Metadata } from "next";
import Container from "@/components/Container";
import { business, juniorCamps } from "@/lib/content";

export const metadata: Metadata = {
  title: `Registration Confirmed | ${business.name}`,
  robots: { index: false, follow: false },
};

export default async function CampRegistrationConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const child = typeof params.child === "string" ? params.child : "";
  const weekId = typeof params.week === "string" ? params.week : "";
  const email = typeof params.email === "string" ? params.email : "";
  const alreadyPaid = params.already === "1";
  const emailSent = params.emailSent === "1";
  const week = juniorCamps.weeks.find((w) => w.id === weekId)?.label ?? weekId;

  return (
    <div className="py-20 sm:py-28">
      <Container className="max-w-lg text-center">
        <div className="rounded-2xl border border-gold/30 bg-cream p-8">
          <p className="font-display text-2xl font-semibold text-forest">
            {alreadyPaid ? "Already marked as paid" : "Marked as paid ✓"}
          </p>
          <p className="mt-3 text-ink-soft">
            {child ? <strong>{child}</strong> : "This registration"}
            {week ? ` — ${week} — ` : " — "}
            is confirmed.
          </p>
          {email && (
            <p className="mt-2 text-sm text-ink-soft">
              {alreadyPaid
                ? `The confirmation email was already sent to ${email}.`
                : emailSent
                  ? `A confirmation email with camp-day details has been sent to ${email}.`
                  : `Email isn't connected yet, so no confirmation was sent to ${email}. Reach out to them directly.`}
            </p>
          )}
        </div>
      </Container>
    </div>
  );
}
