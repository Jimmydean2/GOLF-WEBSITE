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
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10" aria-hidden="true" />
        <Container className="relative z-10 pb-12 pt-24">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            Small-Group Coaching
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-cream sm:text-5xl">
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
                <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
                  Clinic {clinic.number}
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-forest">
                  {clinic.title}
                </h2>
                <p className="mt-3 text-sm text-ink-soft">{clinic.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl bg-forest px-8 py-6 text-center text-cream">
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
