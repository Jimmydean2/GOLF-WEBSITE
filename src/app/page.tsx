import Image from "next/image";
import Link from "next/link";
import Container from "@/components/Container";
import CTAButton from "@/components/CTAButton";
import {
  business,
  groupClinics,
  individualLessons,
  juniorPrograms,
  locations,
} from "@/lib/content";

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative isolate flex min-h-[85vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/jimmy-dean-tee-shot.jpg"
          alt="Coach James mid-swing on the tee at Golf Dorval"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/30 to-ink/10"
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

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <ProgramCard
              title="Individual Lessons"
              description={`One-on-one, ${individualLessons.duration} sessions tailored to your game.`}
              price={`From $${individualLessons.summer.single}`}
              href="/lessons"
            />
            <ProgramCard
              title="Group Clinics"
              description={`${groupClinics.sessionsCount} sessions covering every part of your game, max ${groupClinics.maxParticipants} players.`}
              price={`$${groupClinics.pricePerPerson} for all ${groupClinics.sessionsCount}`}
              href="/clinics"
            />
            <ProgramCard
              title="Junior Programs"
              description={`${juniorPrograms.weeks}-week Fall, Winter & Spring programs — swing technique, athletic training, and TrackMan.`}
              price={`$${juniorPrograms.price} ${juniorPrograms.priceNote}`}
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
              image="/images/practice-green-closeup.jpg"
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
  title,
  description,
  price,
  href,
}: {
  title: string;
  description: string;
  price: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-gold/30 bg-cream p-8 shadow-sm transition-shadow hover:shadow-md"
    >
      <h3 className="font-display text-xl font-semibold text-forest">{title}</h3>
      <p className="mt-3 flex-1 text-sm text-ink-soft">{description}</p>
      <p className="mt-6 font-display text-lg font-semibold text-gold">{price}</p>
      <span className="mt-2 text-sm font-semibold text-forest group-hover:underline">
        Learn more &rarr;
      </span>
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
