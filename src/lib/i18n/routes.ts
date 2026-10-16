// Where each camp page lives in each language, and how to get from one to the other.
//
// The English pages keep the addresses the site has always had. The French pages live under /fr
// with French names (a French-speaking parent sees a French address, and a search engine can
// tell the two versions belong together). Only the camp journey is translated: the rest of the
// site (lessons, clinics, about, contact) is English, and the French pages do not link to it.

import type { Lang } from "../lang";

export const ROUTES = {
  camps: { en: "/junior-camps", fr: "/fr/camps-juniors" },
  privacy: { en: "/privacy", fr: "/fr/confidentialite" },
  // A parent's private reservation page; the token is appended.
  reservationBase: { en: "/camp-registration", fr: "/fr/inscription-camp" },
} as const;

export function campsPath(lang: Lang): string {
  return ROUTES.camps[lang];
}

export function privacyPath(lang: Lang): string {
  return ROUTES.privacy[lang];
}

// The private reservation page for a signed token, in a language.
export function reservationPath(lang: Lang, token: string): string {
  return `${ROUTES.reservationBase[lang]}/${token}`;
}

// The same page in the other language, or null when there is no translation of it.
export function alternatePath(pathname: string): { lang: Lang; path: string } | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (clean === ROUTES.camps.en) return { lang: "fr", path: ROUTES.camps.fr };
  if (clean === ROUTES.camps.fr) return { lang: "en", path: ROUTES.camps.en };
  if (clean === ROUTES.privacy.en) return { lang: "fr", path: ROUTES.privacy.fr };
  if (clean === ROUTES.privacy.fr) return { lang: "en", path: ROUTES.privacy.en };
  for (const [from, to] of [
    ["en", "fr"],
    ["fr", "en"],
  ] as const) {
    const prefix = `${ROUTES.reservationBase[from]}/`;
    if (clean.startsWith(prefix) && clean.length > prefix.length && !clean.slice(prefix.length).includes("/")) {
      return { lang: to, path: `${ROUTES.reservationBase[to]}/${clean.slice(prefix.length)}` };
    }
  }
  return null;
}

// Which language a page address belongs to (used to render the right header and footer).
export function langOfPath(pathname: string): Lang {
  return pathname === "/fr" || pathname.startsWith("/fr/") ? "fr" : "en";
}
