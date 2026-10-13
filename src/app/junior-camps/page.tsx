import type { Metadata } from "next";
import Image from "next/image";
import Container from "@/components/Container";
import CampRegistrationForm from "@/components/CampRegistrationForm";
import { business, juniorCamps, locations } from "@/lib/content";

export const metadata: Metadata = {
  title: `Junior Camps | ${business.name}`,
};

export default function JuniorCampsPage() {
  return (
    <div>
      <section className="relative isolate flex min-h-[45vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/junior-golf-lesson.jpg"
          alt="Junior golfers at a summer camp session"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10" aria-hidden="true" />
        <Container className="relative z-10 pb-12 pt-24">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            Summer Day Camps
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-cream sm:text-5xl">
            Junior Camps
          </h1>
          <p className="mt-4 max-w-xl text-cream/90">
            A full day of golf, games, and coaching at {locations[juniorCamps.venue].name} &mdash;
            one week at a time, limited to {juniorCamps.maxPerWeek} kids per week.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              {juniorCamps.hoursLabel}
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              {juniorCamps.hours}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-ink-soft">
              Pick any week below &mdash; each one runs as its own full-day camp,
              capped at {juniorCamps.maxPerWeek} kids so every camper gets real
              coaching time.
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {juniorCamps.weeks.map((week) => (
              <div key={week.id} className="rounded-xl border border-gold/30 bg-cream-dark p-4 text-center">
                <p className="font-display font-semibold text-forest">{week.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl bg-forest px-8 py-6 text-center text-cream">
            <p className="font-display text-2xl font-semibold">
              ${juniorCamps.pricePerWeek} {juniorCamps.priceNote} per week
            </p>
            <p className="mt-1 text-sm text-cream/80">
              Max {juniorCamps.maxPerWeek} kids per week &middot; {juniorCamps.hours}
            </p>
            <p className="mt-1 text-sm text-cream/80">{locations[juniorCamps.venue].name}</p>
          </div>
        </Container>
      </section>

      <section className="bg-cream-dark py-16 sm:py-24">
        <Container className="max-w-2xl">
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Limited Registration
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest">
              Register Your Child
            </h2>
            <p className="mt-3 text-ink-soft">
              Please fill out the form below to register your child. One
              registration form is required per child.
            </p>
          </div>

          <div className="mt-10">
            <CampRegistrationForm />
          </div>
        </Container>
      </section>
    </div>
  );
}
