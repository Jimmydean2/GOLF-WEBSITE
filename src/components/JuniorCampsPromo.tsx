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
      className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-80"
      role="complementary"
      aria-label="2026 Junior Camps promotion"
    >
      <div className="relative overflow-hidden rounded-2xl border border-gold/30 bg-cream shadow-xl">
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-ink/50 text-cream transition-colors hover:bg-ink/70"
        >
          &times;
        </button>

        <div className="relative h-24 w-full">
          <Image
            src="/images/junior-golf-lesson.jpg"
            alt="Junior golfers at a summer camp session"
            fill
            className="object-cover"
            style={{ objectPosition: "center 35%" }}
            sizes="320px"
          />
        </div>

        <div className="p-4">
          <p className="font-display text-xs uppercase tracking-[0.2em] text-gold">
            2026 Junior Camps
          </p>
          <h2 className="mt-1 font-display text-base font-semibold text-forest">
            Registration is Open
          </h2>
          <p className="mt-2 text-xs text-ink-soft">
            A full day at {locations[juniorCamps.venue].name} &mdash; limited to{" "}
            {juniorCamps.maxPerWeek} kids per week.
          </p>
          <Link
            href="/junior-camps"
            onClick={() => setVisible(false)}
            className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-forest px-4 py-2 text-xs font-semibold text-cream transition-colors hover:bg-forest-dark"
          >
            See Camp Dates
          </Link>
        </div>
      </div>
    </div>
  );
}
