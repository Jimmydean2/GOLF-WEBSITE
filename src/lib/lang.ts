// The two languages the camp pages and messages come in. Kept tiny and import-free so the
// season calendar, the dictionaries, the emails and the browser code can all share it.

export type Lang = "en" | "fr";

export const LANGS: readonly Lang[] = ["en", "fr"];
export const DEFAULT_LANG: Lang = "en";

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "fr";
}

// Anything that is not exactly "en" or "fr" (missing, misspelled, hostile) is English.
export function parseLang(value: unknown): Lang {
  return isLang(value) ? value : DEFAULT_LANG;
}
