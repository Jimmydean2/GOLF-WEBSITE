import type { Metadata } from "next";
import Image from "next/image";
import Container from "@/components/Container";
import CTAButton from "@/components/CTAButton";
import { business, individualLessons, locations, type LessonPricing } from "@/lib/content";

export const metadata: Metadata = {
  title: `Individual Lessons | ${business.name}`,
};

export default function LessonsPage() {
  return (
    <div>
      <section className="relative isolate flex min-h-[45vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/practice-green-wide.jpg"
          alt="Practice green at Golf Dorval"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10" aria-hidden="true" />
        <Container className="relative z-10 pb-12 pt-24">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            One-on-One Coaching
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-cream sm:text-5xl">
            Individual Lessons
          </h1>
          <p className="mt-4 max-w-xl text-cream/90">
            Focused {individualLessons.duration} sessions, tailored entirely
            to your swing and your goals.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-8 md:grid-cols-2">
            <PricingCard
              season={locations.summer.label}
              venue={locations.summer.name}
              pricing={individualLessons.summer}
            />
            <PricingCard
              season={locations.winter.label}
              venue={locations.winter.name}
              pricing={individualLessons.winter}
            />
          </div>

          <p className="mt-8 text-center text-sm text-ink-soft">
            +${individualLessons.extraPersonFee} per additional person joining
            a lesson (summer &amp; winter).
          </p>

          <div className="mt-10 flex justify-center">
            <CTAButton href="/book">Book a Lesson</CTAButton>
          </div>
        </Container>
      </section>
    </div>
  );
}

function PricingCard({
  season,
  venue,
  pricing,
}: {
  season: string;
  venue: string;
  pricing: LessonPricing;
}) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-cream-dark p-8 shadow-sm">
      <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">{season}</p>
      <h2 className="mt-1 font-display text-2xl font-semibold text-forest">{venue}</h2>

      <ul className="mt-6 divide-y divide-gold/20">
        <PriceRow label="1 lesson" price={pricing.single} />
        <PriceRow label="3 lessons" price={pricing.pack3} />
        <PriceRow label="5 lessons" price={pricing.pack5} />
      </ul>
    </div>
  );
}

function PriceRow({ label, price }: { label: string; price: number }) {
  return (
    <li className="flex items-center justify-between py-3">
      <span className="text-ink-soft">{label}</span>
      <span className="font-display text-lg font-semibold text-forest">${price}</span>
    </li>
  );
}
