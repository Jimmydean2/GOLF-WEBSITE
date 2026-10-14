import type { Metadata } from "next";
import Image from "next/image";
import Container from "@/components/Container";
import ClinicSignupForm from "@/components/ClinicSignupForm";
import { business, groupClinics } from "@/lib/content";

export const metadata: Metadata = {
  title: `Group Clinics | ${business.name}`,
};

export default function ClinicsPage() {
  return (
    <div>
      <section className="relative isolate flex min-h-[45vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/practice-green-closeup.jpg"
          alt="Practice green with golf balls near the hole"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-t from-gold/25 via-gold/5 to-transparent mix-blend-overlay" aria-hidden="true" />
        <Container className="relative z-10 pb-12 pt-24">
          <p className="reveal-up font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            Small-Group Coaching
          </p>
          <h1 className="reveal-up mt-3 font-display text-4xl font-semibold text-cream sm:text-5xl [animation-delay:120ms]">
            Group Clinics
          </h1>
          <p className="mt-4 max-w-xl text-cream/90">
            {groupClinics.sessionsCount} sessions, {groupClinics.sessionDuration}{" "}
            each, capped at {groupClinics.maxParticipants} players &mdash; a
            complete tour through every part of your game.
          </p>
          <p className="mt-2 max-w-xl font-semibold text-gold-light">
            {groupClinics.cohorts.map((c) => c.month).join(" · ")} &mdash; {groupClinics.schedule}
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-6 sm:grid-cols-2">
            {groupClinics.clinics.map((clinic) => (
              <div
                key={clinic.number}
                className="rounded-2xl border border-gold/30 bg-cream-dark p-8"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-gradient-to-br from-gold-light via-gold to-gold-deep font-display text-xl font-bold text-ink shadow-md shadow-black/20">
                    {clinic.number}
                  </span>
                  <p className="font-display text-base font-bold uppercase tracking-[0.2em] text-gold-deep">
                    Clinic {clinic.number}
                  </p>
                </div>
                <h2 className="mt-3 font-display text-xl font-semibold text-forest">
                  {clinic.title}
                </h2>
                <p className="mt-3 text-sm text-ink-soft">{clinic.description}</p>
              </div>
            ))}
          </div>

          <div className="relative mt-10 overflow-hidden rounded-2xl bg-gradient-to-br from-forest via-forest-dark to-black px-8 py-6 text-center text-cream ring-1 ring-gold/20">
            <div className="gold-divider absolute inset-x-0 top-0" aria-hidden="true" />
            <p className="font-display text-2xl font-semibold">
              ${groupClinics.pricePerPerson} per person for all{" "}
              {groupClinics.sessionsCount} clinics
            </p>
            <p className="mt-1 text-sm text-cream/80">
              Max {groupClinics.maxParticipants} players per group &middot;{" "}
              {groupClinics.sessionDuration} per session
            </p>
            <p className="mt-1 text-sm text-cream/80">
              Runs {groupClinics.cohorts.map((c) => c.month).join(", ")} &middot; {groupClinics.schedule}
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-cream-dark py-16 sm:py-24">
        <Container className="max-w-2xl">
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Reserve Your Spot
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest">
              Sign Up for a Clinic
            </h2>
            <p className="mt-3 text-ink-soft">
              Submit your info below and Coach James will reach out to
              confirm your spot and collect payment.
            </p>
          </div>

          <div className="mt-10">
            <ClinicSignupForm />
          </div>
        </Container>
      </section>
    </div>
  );
}
