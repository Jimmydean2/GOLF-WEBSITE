import Image from "next/image";
import Link from "next/link";
import { business, primaryNav } from "@/lib/content";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur supports-[backdrop-filter]:bg-cream/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/images/jimmy-dean-golf-logo.webp"
            alt={`${business.name} logo`}
            width={48}
            height={48}
            className="h-12 w-12 rounded-full ring-1 ring-gold/40"
            priority
          />
          <span className="font-display text-lg font-semibold text-forest sm:text-xl">
            {business.name}
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
            Book a Lesson
          </Link>
        </nav>
      </div>
      <div className="gold-divider" aria-hidden="true" />
    </header>
  );
}
