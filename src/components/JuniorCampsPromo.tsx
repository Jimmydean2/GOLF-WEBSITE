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
    if (pathname === "/junior-camps") return;

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
      className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-72"
      role="complementary"
      aria-label="2026 Junior Camps promotion"
    >
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-forest via-forest to-forest-dark shadow-xl ring-1 ring-gold/30 shadow-black/40">
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
