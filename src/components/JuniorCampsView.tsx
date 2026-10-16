import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import Container from "@/components/Container";
import CampRegistrationForm from "@/components/CampRegistrationForm";
import WaitlistForm from "@/components/WaitlistForm";
import { business, juniorCamps } from "@/lib/content";
import { campsPath, getMessages, privacyPath } from "@/lib/i18n";
import { weekLabel } from "@/lib/season";
import { isSeasonPublic } from "@/lib/registrationWindow";
import type { Lang } from "@/lib/lang";

// The Junior Camps page, in either language: the English page (/junior-camps) and the French
// page (/fr/camps-juniors) are this one component with a different dictionary.
export default function JuniorCampsView({ lang }: { lang: Lang }) {
  const m = getMessages(lang);
  // A draft calendar is never shown to the public: until the owner confirms the dates, this
  // page says they are coming soon (and the registration endpoint refuses).
  const datesPublic = isSeasonPublic();
  return (
    <div>
      <section className="relative isolate flex min-h-[45vh] items-end overflow-hidden bg-forest">
        <Image
          src="/images/junior-golf-lesson.jpg"
          alt={m.camp.heroAlt}
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-t from-gold/25 via-gold/5 to-transparent mix-blend-overlay" aria-hidden="true" />
        <Container className="relative z-10 pb-12 pt-24">
          <p className="reveal-up font-display text-sm uppercase tracking-[0.3em] text-gold-light">
            {m.camp.heroEyebrow(juniorCamps.year)}
          </p>
          <h1 className="reveal-up mt-3 font-display text-4xl font-semibold text-cream sm:text-5xl [animation-delay:120ms]">
            {m.camp.heroTitle}
          </h1>
          <p className="mt-4 max-w-xl text-cream/90">{m.camp.heroIntro}</p>
        </Container>
      </section>

      {!datesPublic ? (
        <section className="py-16 sm:py-24">
          <Container className="max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold text-forest">{m.camp.comingSoonTitle(juniorCamps.year)}</h2>
            <p className="mt-4 text-ink-soft">{m.camp.comingSoonBody(juniorCamps.year)}</p>
            <div className="mt-4 flex flex-col items-center gap-1">
              <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
                {business.phone}
              </a>
              <a href={`mailto:${business.email}`} className="font-semibold text-forest hover:underline">
                {business.email}
              </a>
            </div>
          </Container>
        </section>
      ) : (
        <>
          <section className="py-16 sm:py-24">
            <Container>
              <div className="text-center">
                <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">{m.info.hoursLabel}</p>
                <h2 className="mt-3 font-display text-3xl font-semibold text-forest sm:text-4xl">{m.info.hours}</h2>
                <p className="mx-auto mt-3 max-w-xl text-ink-soft">{m.camp.pickAnyWeek}</p>
                <p className="mx-auto mt-2 max-w-xl text-sm font-semibold text-forest">{m.info.scheduleNote}</p>
                <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">{m.camp.tapWeek}</p>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {juniorCamps.weeks.map((week) => (
                  <Link
                    key={week.id}
                    href={`${campsPath(lang)}?week=${week.id}#register`}
                    scroll={true}
                    className="group cursor-pointer rounded-xl border border-gold/30 bg-cream-dark p-4 text-center transition-all duration-300 hover:-translate-y-0.5 hover:border-gold hover:bg-white hover:shadow-md hover:shadow-black/10"
                  >
                    <p className="font-display font-semibold text-forest">{weekLabel(week, lang)}</p>
                    {week.note && <p className="mt-1 text-xs text-ink-soft">{week.note[lang]}</p>}
                    <span className="mt-1 inline-block text-xs font-semibold text-gold-deep opacity-0 transition-opacity group-hover:opacity-100">
                      {m.camp.registerThisWeek}
                    </span>
                  </Link>
                ))}
              </div>

              <div className="relative mt-10 overflow-hidden rounded-2xl bg-gradient-to-br from-forest via-forest-dark to-black px-8 py-6 text-center text-cream ring-1 ring-gold/20">
                <div className="gold-divider absolute inset-x-0 top-0" aria-hidden="true" />
                <p className="font-display text-2xl font-semibold">{m.camp.priceLine(juniorCamps.pricePerWeek)}</p>
                <p className="mt-1 text-sm text-cream/80">{m.camp.maxLine(m.info.hours)}</p>
                <p className="mt-1 text-sm text-cream/80">{m.info.venueName}</p>
              </div>
            </Container>
          </section>

          <section id="register" className="scroll-mt-28 bg-cream-dark py-16 sm:py-24">
            <Container className="max-w-2xl">
              <div className="text-center">
                <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">{m.camp.registerEyebrow}</p>
                <h2 className="mt-3 font-display text-3xl font-semibold text-forest">{m.camp.registerTitle}</h2>
                <p className="mt-3 text-ink-soft">{m.camp.registerIntro}</p>
                <p className="mt-2 text-sm text-ink-soft">
                  <Link href={privacyPath(lang)} className="underline underline-offset-2 hover:text-forest">
                    {m.camp.privacyLink}
                  </Link>
                </p>
              </div>

              <div className="mt-10">
                <Suspense fallback={null}>
                  <CampRegistrationForm lang={lang} />
                </Suspense>
              </div>

              <div className="mt-10">
                <WaitlistForm lang={lang} />
              </div>
            </Container>
          </section>
        </>
      )}
    </div>
  );
}
