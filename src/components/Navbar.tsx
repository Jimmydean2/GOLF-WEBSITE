"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { business, nav } from "@/lib/content";

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gold/30 bg-cream/95 backdrop-blur supports-[backdrop-filter]:bg-cream/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <Image
            src="/images/jimmy-dean-golf-logo.webp"
            alt={`${business.name} logo`}
            width={48}
            height={48}
            className="h-12 w-12 rounded-full"
            priority
          />
          <span className="font-display text-lg font-semibold text-forest sm:text-xl">
            {business.name}
          </span>
        </Link>

        <nav className="hidden lg:flex lg:items-center lg:gap-6">
          {nav.map((item) => (
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
            className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark"
          >
            Book a Lesson
          </Link>
        </nav>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-forest lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {open ? (
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" className="border-t border-gold/30 bg-cream lg:hidden">
          <ul className="flex flex-col px-4 py-2 sm:px-6">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block py-3 text-base font-medium text-ink-soft hover:text-forest"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
