"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { juniorCamps, locations } from "@/lib/content";

const SEEN_KEY = "jdg-camp-promo-seen";

export default function JuniorCampsPromo() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Not on the registration page itself, and never on the administrators' screens or a
    // parent's private payment page: a pop-up advert has no place beside a payment button.
    if (pathname === "/junior-camps" || pathname?.startsWith("/admin") || pathname?.startsWith("/camp-registration")) return;

    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      alreadySeen = false;
    }
    if (alreadySeen) return;

    const timer = setTimeout(() => {
      setVisible(true);
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        // Ignore storage failures (private browsing, etc.) — the popup just
        // won't remember it was shown this session.
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-72"
      role="complementary"
      aria-label="2026 Junior Camps promotion"
    >
      {/* Mobile: a slim bar, not a tall card — a full-height card here would
          sit over whatever form field the shopper scrolls to next, since
          mobile inputs run edge to edge. */}
      <div className="flex items-center gap-3 border-t border-gold/40 bg-forest-dark px-4 py-3 shadow-xl shadow-black/40 sm:hidden">
        <div className="relative h-12 w-12 flex-none overflow-hidden rounded-lg">
          <Image
            src="/images/junior-golf-lesson.jpg"
            alt=""
            fill
            className="object-cover"
            style={{ objectPosition: "center 35%" }}
            sizes="48px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold text-cream">
            2026 Junior Camps &mdash; Registration is Open
          </p>
          <Link
            href="/junior-camps"
            onClick={() => setVisible(false)}
            className="text-xs font-semibold text-gold-light underline underline-offset-2"
          >
            See camp dates &rarr;
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Close"
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full bg-cream text-forest transition-colors hover:bg-cream/90"
        >
          &times;
        </button>
      </div>

      {/* Desktop/tablet: the full card, corner-anchored with plenty of page
          around it, so it never blocks the rest of the page. */}
      <div className="relative hidden overflow-hidden rounded-2xl bg-gradient-to-br from-forest via-forest to-forest-dark shadow-xl ring-1 ring-gold/30 shadow-black/40 sm:block">
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-cream text-forest transition-colors hover:bg-cream/90"
        >
          &times;
        </button>

        <div className="relative aspect-square w-full">
          <Image
            src="/images/junior-golf-lesson.jpg"
            alt="Junior golfers at a summer camp session"
            fill
            className="object-cover"
            style={{ objectPosition: "center 35%" }}
            sizes="288px"
          />
          <div className="absolute inset-x-0 top-0 bg-forest-dark/90 py-1.5 text-center">
            <p className="font-display text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-cream">
              2026 Junior Golf Camps
            </p>
          </div>
        </div>

        <div className="p-5 text-center">
          <h2 className="font-display text-xl font-bold uppercase leading-tight text-cream">
            Registration
            <br />
            is Open
          </h2>
          <p className="mt-3 text-xs text-cream/85">
            A full day at {locations[juniorCamps.venue].name} &mdash; limited to{" "}
            {juniorCamps.maxPerWeek} kids per week.
          </p>
          <Link
            href="/junior-camps"
            onClick={() => setVisible(false)}
            className="mt-4 inline-flex w-full items-center justify-center rounded-full border-2 border-gold-light/80 px-4 py-2 text-xs font-semibold text-cream transition-colors hover:border-gold-light hover:bg-gold-light hover:text-ink"
          >
            See Camp Dates
          </Link>
          <p className="mt-3 text-[0.65rem] text-cream/70">
            Spots are limited and subject to availability.
          </p>
        </div>
      </div>
    </div>
  );
}
