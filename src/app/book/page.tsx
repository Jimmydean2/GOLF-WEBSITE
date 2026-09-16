import type { Metadata } from "next";
import Container from "@/components/Container";
import { business, googleAppointmentScheduleUrl } from "@/lib/content";

export const metadata: Metadata = {
  title: `Book a Lesson | ${business.name}`,
};

export default function BookPage() {
  return (
    <div className="py-16 sm:py-24">
      <Container>
        <div className="text-center">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
            Book Online
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-forest sm:text-5xl">
            Book a Lesson
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-ink-soft">
            Pick a time that works for you &mdash; it&apos;s added straight
            to Coach James&apos;s calendar and confirmed automatically.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          {googleAppointmentScheduleUrl ? (
            <div className="overflow-hidden rounded-2xl border border-gold/30 shadow-sm">
              <iframe
                src={googleAppointmentScheduleUrl}
                title="Book a lesson with James Dean Golf"
                className="h-[720px] w-full"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-gold/30 bg-cream-dark p-10 text-center">
              <p className="font-display text-xl font-semibold text-forest">
                Online booking is almost ready
              </p>
              <p className="mx-auto mt-3 max-w-md text-ink-soft">
                In the meantime, reach out directly and we&apos;ll find a
                time that works.
              </p>
              <div className="mt-6 flex flex-col items-center gap-2">
                <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
                  {business.phone}
                </a>
                <a
                  href={`mailto:${business.email}`}
                  className="font-semibold text-forest hover:underline"
                >
                  {business.email}
                </a>
              </div>
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}
