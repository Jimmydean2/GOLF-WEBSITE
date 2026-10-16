"use client";

import { usePathname } from "next/navigation";
import { alternatePath, getMessages } from "@/lib/i18n";
import type { Lang } from "@/lib/lang";

// "Français" on an English camp page, "English" on a French one. It appears only where the
// other language really exists (the camp page, the privacy notice, a reservation page), and it
// keeps the visitor's ?week= choice. The two languages are separate root layouts, so this is a
// plain link (a full page load either way).
export default function LanguageSwitch({ lang, className = "" }: { lang: Lang; className?: string }) {
  const pathname = usePathname();
  const alt = alternatePath(pathname ?? "");
  if (!alt) return null;
  const m = getMessages(lang).lang;
  return (
    <a
      href={alt.path}
      hrefLang={alt.lang === "fr" ? "fr-CA" : "en"}
      lang={alt.lang}
      aria-label={m.switchAria}
      onClick={(event) => {
        event.currentTarget.href = `${alt.path}${window.location.search}${window.location.hash}`;
      }}
      className={`rounded-full border border-gold/50 px-3 py-1 text-sm font-semibold text-forest transition-colors hover:border-forest hover:bg-white ${className}`}
    >
      {m.switchLabel}
    </a>
  );
}
