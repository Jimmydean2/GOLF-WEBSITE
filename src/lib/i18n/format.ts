// Money, dates and small grammar helpers, per language. Pure functions, safe on the server and in
// the browser. Everything shown to a family in Montreal is Montreal time, in the way that
// language writes it: "$436.91" and "Fri, Oct 16, 11:28 p.m." in English; "436,91 $" and
// "ven. 16 oct., 23 h 28" in Canadian French.

import type { Lang } from "../lang";

export const NBSP = " ";

// Dollars: English keeps the plain "$436.91" the site has always used; Canadian French puts the
// sign after the amount, with a comma and a no-break space ("436,91 $", "1 234,56 $").
export function formatMoney(cents: number, lang: Lang): string {
  if (lang === "fr") return new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
  return `$${(cents / 100).toFixed(2)}`;
}

// A whole-dollar price for a headline: "$380" / "380 $".
export function formatDollars(dollars: number, lang: Lang): string {
  return lang === "fr" ? `${dollars}${NBSP}$` : `$${dollars}`;
}

const LOCALE: Record<Lang, string> = { en: "en-CA", fr: "fr-CA" };
const MONTREAL = "America/Toronto"; // the same clock as Montreal; the zone name Intl knows

// "Fri, Oct 16, 11:28 p.m." / "ven. 16 oct., 23 h 28"
export function formatMontreal(iso: string, lang: Lang = "en"): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: MONTREAL,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// With the year, for things that happen months from now: "Saturday, January 16, 2027 at 9:00 a.m."
export function formatMontrealLong(iso: string, lang: Lang = "en"): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: MONTREAL,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// "A, B and C" / "A, B et C".
export function joinNames(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  const word = lang === "fr" ? " et " : " and ";
  return `${items.slice(0, -1).join(", ")}${word}${items[items.length - 1]}`;
}

// French typography as Quebec writes it (Office québécois de la langue française): a no-break
// space before a colon, inside guillemets, before a percent sign and a dollar sign, and in a
// time of day. Applied to every French string when the dictionary is built, so the text can be
// written naturally.
export function frenchTypography(text: string): string {
  return text
    .replace(/ :/g, `${NBSP}:`)
    .replace(/« /g, `«${NBSP}`)
    .replace(/ »/g, `${NBSP}»`)
    .replace(/(\d) %/g, `$1${NBSP}%`)
    .replace(/(\d) \$/g, `$1${NBSP}$`)
    .replace(/(\d) h (\d)/g, `$1${NBSP}h${NBSP}$2`)
    .replace(/(\d) h\b/g, `$1${NBSP}h`);
}
