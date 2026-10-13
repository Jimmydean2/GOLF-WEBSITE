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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="2026 Junior Camps"
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-cream shadow-xl">
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-ink/50 text-cream transition-colors hover:bg-ink/70"
        >
          &times;
        </button>

        <div className="relative h-40 w-full">
          <Image
            src="/images/junior-golf-lesson.jpg"
            alt="Junior golfers at a summer camp session"
            fill
            className="object-cover"
            sizes="384px"
          />
        </div>

        <div className="p-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-gold">
            2026 Junior Camps
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold text-forest">
            Registration is Open
          </h2>
          <p className="mt-3 text-sm text-ink-soft">
            A full day of golf, games, and coaching at {locations[juniorCamps.venue].name}
            &nbsp;&mdash; one week at a time, limited to {juniorCamps.maxPerWeek} kids per
            week.
          </p>
          <Link
            href="/junior-camps"
            onClick={() => setVisible(false)}
            className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark"
          >
            See Camp Dates
          </Link>
          <p className="mt-3 text-xs text-ink-soft/80">
            Spots are limited and subject to availability.
          </p>
        </div>
      </div>
    </div>
  );
}
