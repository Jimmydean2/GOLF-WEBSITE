import type { Metadata } from "next";
import Image from "next/image";
import Container from "@/components/Container";
import CTAButton from "@/components/CTAButton";
import { business, juniorPrograms, locations } from "@/lib/content";

export const metadata: Metadata = {
  title: `Junior Programs | ${business.name}`,
};

export default function JuniorProgramsPage() {
  return (
    <div>
      <section className="relative isolate flex min-h-[45vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/junior-swing-guidance.jpg"
          alt="Coach James guiding a junior golfer's swing"
          fill
          priority
          className="object-cover object-top"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10" aria-hidden="true" />
        <Container className="relative z-10 pb-12 pt-24">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            For Young Golfers
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-cream sm:text-5xl">
            Junior Programs
          </h1>
          <p className="mt-4 max-w-xl text-cream/90">
            Three {juniorPrograms.weeks}-week programs a year &mdash; Fall,
            Winter, and Spring &mdash; built to make real improvement fun.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-12 md:grid-cols-2">
            <div>
              <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
                The Program
              </p>
              <h2 className="mt-3 font-display text-3xl font-semibold text-forest">
                {juniorPrograms.weeks} weeks, {juniorPrograms.hoursPerSession}{" "}
                hours of fun golf training
              </h2>
              <p className="mt-4 text-ink-soft">
                {juniorPrograms.frequency}, your child will spend{" "}
                {juniorPrograms.hoursPerSession} hours learning proper golf
                swing technique, building strength and mobility through
                multisport training methods, and participating in engaging
                games and challenges &mdash; all while training with
                world-class TrackMan technology.
              </p>
              <ul className="mt-6 space-y-3">
                {juniorPrograms.curriculum.map((item) => (
                  <li key={item} className="flex gap-3 text-ink-soft">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-gold" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col justify-center rounded-2xl border border-gold/30 bg-cream-dark p-8">
              <p className="font-display text-4xl font-semibold text-forest">
                ${juniorPrograms.price}
                <span className="ml-2 text-base font-normal text-ink-soft">
                  {juniorPrograms.priceNote}
                </span>
              </p>
              <ul className="mt-6 space-y-2 text-sm text-ink-soft">
                <li>{juniorPrograms.weeks}-week program</li>
                <li>
                  {juniorPrograms.frequency.toLowerCase()},{" "}
                  {juniorPrograms.hoursPerSession} hours per session
                </li>
                <li>Max {juniorPrograms.maxPerGroup} kids per group</li>
              </ul>
              <p className="mt-4 text-sm text-ink-soft/80">
                {juniorPrograms.multipleNightsNote}
              </p>
              <div className="mt-6">
                <CTAButton href="/contact">Register Interest</CTAButton>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-cream-dark py-16 sm:py-24">
        <Container>
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Three Seasons
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              Fall, Winter &amp; Spring
            </h2>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {juniorPrograms.seasons.map(({ season, venue }) => (
              <div
                key={season}
                className="flex flex-col rounded-2xl border border-gold/30 bg-cream p-8"
              >
                <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
                  {season} Season
                </p>
                <h3 className="mt-1 font-display text-xl font-semibold text-forest">
                  {locations[venue].name}
                </h3>
                <p className="mt-4 flex-1 text-sm text-ink-soft">
                  {juniorPrograms.weeks} weeks &middot; ${juniorPrograms.price}{" "}
                  {juniorPrograms.priceNote}
                </p>
                <p className="mt-4 text-sm font-semibold text-forest">
                  Exact day/time &amp; age groups: contact us for the latest details.
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center gap-4 text-center">
            <p className="max-w-xl text-ink-soft">
              Want to be the first to know when Coach James&apos;s junior
              programs open for registration?
            </p>
            <CTAButton href="/contact">Get in Touch</CTAButton>
          </div>
        </Container>
      </section>
    </div>
  );
}
