import type { Metadata } from "next";
import Image from "next/image";
import Container from "@/components/Container";
import CTAButton from "@/components/CTAButton";
import { business, locations } from "@/lib/content";

export const metadata: Metadata = {
  title: `Junior Programs | ${business.name}`,
};

const seasons = [
  {
    name: "Fall",
    venue: locations.summer.name,
  },
  {
    name: "Winter",
    venue: locations.winter.name,
  },
  {
    name: "Spring",
    venue: locations.summer.name,
  },
];

export default function JuniorProgramsPage() {
  return (
    <div>
      <section className="relative isolate flex min-h-[45vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/junior-golf-lesson.jpg"
          alt="Coach James coaching a junior golfer"
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
            Season-long programs that build real fundamentals, at every time
            of year.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-8 md:grid-cols-3">
            {seasons.map((season) => (
              <div
                key={season.name}
                className="flex flex-col rounded-2xl border border-gold/30 bg-cream-dark p-8"
              >
                <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
                  {season.name} Season
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-forest">
                  {season.venue}
                </h2>
                <p className="mt-4 flex-1 text-sm text-ink-soft">
                  Ages, schedule, and pricing for the {season.name.toLowerCase()}{" "}
                  program are being finalized.
                </p>
                <p className="mt-4 text-sm font-semibold text-forest">
                  Contact us for the latest details.
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
