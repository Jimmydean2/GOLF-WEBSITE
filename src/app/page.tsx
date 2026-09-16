import Image from "next/image";
import Link from "next/link";
import Container from "@/components/Container";
import CTAButton from "@/components/CTAButton";
import HeroCarousel from "@/components/HeroCarousel";
import { business, locations } from "@/lib/content";

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative isolate flex min-h-[85vh] items-end overflow-hidden bg-forest">
        <HeroCarousel
          slides={[
            { src: "/images/jimmy-dean-tee-shot.jpg", alt: "Coach James mid-swing on the tee at Golf Dorval" },
            { src: "/images/junior-golf-lesson.jpg", alt: "Coach James coaching a junior golfer at the practice mats" },
            { src: "/images/practice-green-wide.jpg", alt: "Practice green and range at Golf Dorval" },
            { src: "/images/practice-green-closeup.jpg", alt: "Close-up of the practice green" },
          ]}
        />
        <div
          className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10"
          aria-hidden="true"
        />
        <Container className="relative z-10 pb-16 pt-32 sm:pb-24">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            Montreal, Quebec
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-4xl font-semibold text-cream sm:text-5xl md:text-6xl">
            {business.name}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-cream/90">
            Private lessons, group clinics, and junior programs built around a
            simple idea: better fundamentals make golf more fun.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <CTAButton href="/book" variant="secondary">
              Book a Lesson
            </CTAButton>
            <CTAButton href="/junior-programs" variant="outline">
              Junior Programs
            </CTAButton>
          </div>
        </Container>
      </section>

      {/* Intro */}
      <section className="py-16 sm:py-24">
        <Container className="grid items-center gap-12 md:grid-cols-2">
          <div className="overflow-hidden rounded-2xl shadow-lg">
            <Image
              src="/images/junior-golf-lesson.jpg"
              alt="Coach James coaching a junior golfer at the practice mats"
              width={1125}
              height={2000}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Coaching Philosophy
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              Fundamentals first, for every age and level
            </h2>
            <p className="mt-4 text-ink-soft">
              Whether you&apos;re a junior picking up a club for the first
              time or an adult looking to shoot lower scores, every lesson is
              built around clear, honest feedback and a plan you can actually
              stick to.
            </p>
            <div className="mt-6">
              <Link
                href="/about"
                className="font-semibold text-forest underline decoration-gold decoration-2 underline-offset-4 hover:text-forest-dark"
              >
                More about Coach James &rarr;
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* Programs overview */}
      <section className="bg-cream-dark py-16 sm:py-24">
        <Container>
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Programs
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              Find the right fit
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <ProgramCard
              image="/images/jimmy-dean-tee-shot.jpg"
              title="Individual Lessons"
              href="/lessons"
            />
            <ProgramCard
              image="/images/practice-green-wide.jpg"
              title="Group Clinics"
              href="/clinics"
            />
            <ProgramCard
              image="/images/junior-golf-lesson.jpg"
              title="Junior Programs"
              href="/junior-programs"
            />
          </div>
        </Container>
      </section>

      {/* Locations */}
      <section className="py-16 sm:py-24">
        <Container>
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Where We Play
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              Two facilities, year-round golf
            </h2>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <LocationCard
              image="/images/practice-green-wide.jpg"
              season={locations.summer.label}
              name={locations.summer.name}
              address={locations.summer.address}
              mapsQuery={locations.summer.mapsQuery}
            />
            <LocationCard
              image="/images/royal-westcourt-lounge.jpg"
              season={locations.winter.label}
              name={locations.winter.name}
              address={locations.winter.address}
              mapsQuery={locations.winter.mapsQuery}
            />
          </div>
        </Container>
      </section>

      {/* Final CTA */}
      <section className="bg-forest py-16 sm:py-20">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="font-display text-3xl font-semibold text-cream sm:text-4xl">
            Ready to work on your game?
          </h2>
          <p className="max-w-xl text-cream/85">
            Book a private lesson online and it&apos;s added straight to
            Coach James&apos;s calendar &mdash; no back-and-forth required.
          </p>
          <CTAButton href="/book" variant="secondary">
            Book a Lesson
          </CTAButton>
        </Container>
      </section>
    </div>
  );
}

function ProgramCard({
  image,
  title,
  href,
}: {
  image: string;
  title: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative isolate flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-2xl shadow-sm transition-shadow hover:shadow-xl"
    >
      <Image
        src={image}
        alt=""
        fill
        className="object-cover transition-transform duration-500 group-hover:scale-105"
        sizes="(max-width: 768px) 100vw, 33vw"
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent"
        aria-hidden="true"
      />
      <div className="relative z-10 p-6">
        <h3 className="font-display text-2xl font-bold uppercase leading-tight text-cream sm:text-3xl">
          {title}
        </h3>
        <span className="mt-3 inline-block text-sm font-semibold text-cream/90 group-hover:underline">
          Learn more &rarr;
        </span>
      </div>
    </Link>
  );
}

function LocationCard({
  image,
  season,
  name,
  address,
  mapsQuery,
}: {
  image: string;
  season: string;
  name: string;
  address: string;
  mapsQuery: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gold/30 bg-cream shadow-sm">
      <div className="relative h-56 w-full">
        <Image src={image} alt={`${name} practice facility`} fill className="object-cover" />
      </div>
      <div className="p-6">
        <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">{season}</p>
        <h3 className="mt-1 font-display text-xl font-semibold text-forest">{name}</h3>
        <p className="mt-2 text-sm text-ink-soft">{address}</p>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm font-semibold text-forest underline decoration-gold decoration-2 underline-offset-4 hover:text-forest-dark"
        >
          Get directions &rarr;
        </a>
      </div>
    </div>
  );
}
