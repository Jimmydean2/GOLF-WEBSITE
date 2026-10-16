import type { Metadata } from "next";
import Container from "@/components/Container";
import LessonBookingCalendar from "@/components/LessonBookingCalendar";
import { business } from "@/lib/content";

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
            Pick a day and time that works for you &mdash; book a single
            lesson or a recurring weekly spot, added straight to Coach
            James&apos;s calendar.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-2xl">
          <LessonBookingCalendar />
        </div>

        <p className="mx-auto mt-6 max-w-xl text-center text-sm text-ink-soft">
          Looking for the Saturday group clinic instead?{" "}
          <a href="/clinics" className="font-semibold text-forest hover:underline">
            See Group Clinics
          </a>
          .
        </p>
      </Container>
    </div>
  );
}
