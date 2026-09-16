import type { Metadata } from "next";
import Image from "next/image";
import Container from "@/components/Container";
import CTAButton from "@/components/CTAButton";
import { bio, business, locations } from "@/lib/content";

export const metadata: Metadata = {
  title: `About | ${business.name}`,
};

export default function AboutPage() {
  return (
    <div>
      <section className="py-16 sm:py-24">
        <Container className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              About
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              Meet Coach James
            </h1>

            <div className="mt-6 space-y-4 text-ink-soft">
              <p>{bio.intro}</p>
              <p>{bio.journey}</p>
              <p>{bio.closing}</p>
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              <CTAButton href="/book">Book a Lesson</CTAButton>
              <CTAButton
                href="/contact"
                variant="outline"
                className="!border-forest !text-forest hover:!bg-forest hover:!text-cream"
              >
                Get in Touch
              </CTAButton>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl shadow-lg">
            <Image
              src="/images/jimmy-dean-tee-shot.jpg"
              alt="Coach James mid-swing on the course"
              width={1336}
              height={2000}
              className="h-full w-full object-cover"
            />
          </div>
        </Container>
      </section>

      <section className="bg-cream-dark py-16 sm:py-24">
        <Container>
          <div className="grid gap-8 sm:grid-cols-2">
            <BioList title="Current Roles" items={bio.currentRoles} />
            <BioList title="Golf Background" items={bio.golfBackground} />
            <BioList title="Other Sports Achievements" items={bio.otherAchievements} />
            <BioList title="Certifications" items={bio.certifications} />
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <div className="text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
              Where to Find Us
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">
              Year-round, two facilities
            </h2>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-gold/30 bg-cream-dark p-8">
              <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
                {locations.summer.label}
              </p>
              <h3 className="mt-1 font-display text-xl font-semibold text-forest">
                {locations.summer.name}
              </h3>
              <p className="mt-2 text-sm text-ink-soft">{locations.summer.address}</p>
            </div>
            <div className="rounded-2xl border border-gold/30 bg-cream-dark p-8">
              <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
                {locations.winter.label}
              </p>
              <h3 className="mt-1 font-display text-xl font-semibold text-forest">
                {locations.winter.name}
              </h3>
              <p className="mt-2 text-sm text-ink-soft">{locations.winter.address}</p>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}

function BioList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-cream p-8">
      <h2 className="font-display text-lg font-semibold text-forest">{title}</h2>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-ink-soft">
            <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-gold" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
