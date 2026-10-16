import Image from "next/image";
import Link from "next/link";
import LanguageSwitch from "@/components/LanguageSwitch";
import { business, primaryNav } from "@/lib/content";
import { campsPath, getMessages } from "@/lib/i18n";
import type { Lang } from "@/lib/lang";

// The French header is deliberately small: the camp journey is the only part of the site that
// is translated, so it offers the camp page and a way back to English, not links into English
// pages.
export default function Navbar({ lang = "en" }: { lang?: Lang }) {
  const m = getMessages(lang);
  return (
    <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur supports-[backdrop-filter]:bg-cream/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <Link href={lang === "fr" ? campsPath("fr") : "/"} className="flex items-center gap-3">
          <Image
            src="/images/jimmy-dean-golf-logo.webp"
            alt={m.site.logoAlt}
            width={48}
            height={48}
            className="h-12 w-12 rounded-full object-contain"
            priority
          />
          <span className="font-display text-lg font-semibold text-forest sm:text-xl">
            {business.name}
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {lang === "en" ? (
            <>
              {primaryNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm font-medium text-ink-soft transition-colors hover:text-forest"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/book"
                className="rounded-full bg-gradient-to-br from-forest via-forest to-forest-dark px-5 py-2.5 text-sm font-semibold text-cream shadow-sm shadow-black/20 ring-1 ring-gold/30 transition-all duration-300 hover:shadow-md hover:shadow-black/30 hover:brightness-110"
              >
                {m.site.bookLesson}
              </Link>
            </>
          ) : (
            <Link href={campsPath("fr")} className="text-sm font-medium text-ink-soft transition-colors hover:text-forest">
              {m.camp.heroTitle}
            </Link>
          )}
          <LanguageSwitch lang={lang} />
        </nav>
      </div>
      <div className="gold-divider" aria-hidden="true" />
    </header>
  );
}
