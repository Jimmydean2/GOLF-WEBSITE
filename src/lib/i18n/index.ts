// The one door to the translations: getMessages("fr").form.submit.
//
// French typography (no-break spaces before a colon, inside « », before % and $, in a time of
// day) is applied once, here, to every French string and to every string a French message
// function returns, so the dictionary can be written naturally.

import { parseLang, type Lang } from "../lang";
import { en } from "./en";
import { fr as frDraft } from "./fr";
import { frenchTypography } from "./format";
import type { Messages } from "./types";

export type { Messages } from "./types";
export { b, renderRichHtml, renderRichText, richParts, escapeHtml } from "./rich";
export { formatMoney, formatMontreal, formatMontrealLong, formatDollars, joinNames } from "./format";
export { ROUTES, campsPath, privacyPath, reservationPath, alternatePath, langOfPath } from "./routes";

function polish<T>(value: T): T {
  if (typeof value === "string") return frenchTypography(value) as T;
  if (typeof value === "function") {
    const fn = value as unknown as (...args: unknown[]) => unknown;
    return ((...args: unknown[]) => polish(fn(...args))) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => polish(item)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, polish(item)])) as T;
  }
  return value;
}

const french: Messages = polish(frDraft);
const english: Messages = en;

export function getMessages(lang: Lang): Messages {
  return lang === "fr" ? french : english;
}

// For code that has an untrusted value (a request body, a column) rather than a Lang.
export function messagesFor(value: unknown): Messages {
  return getMessages(parseLang(value));
}
