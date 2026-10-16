// The summer camp calendar — the ONE place the season's dates are written down.
//
// Everything a parent sees (week tiles, emails, the payment page, the spreadsheet tabs) and
// everything the database is seeded with (db/migrations/002_seed_weeks.sql) is derived from
// the `days` lists below, so the labels, the weekdays and the stored dates cannot drift
// apart. `npm run season:write` regenerates the seed and docs/SEASON_2027.md from this file;
// the test suite fails if either is out of date, or if a week breaks a calendar rule
// (weekend day, camp on a statutory holiday, days outside one Monday-to-Friday week, ...).
//
// *** STATUS: PROPOSED, NOT CONFIRMED. ***
// The owner has not yet approved the 2027 dates. The calendar below is a proposal built
// mechanically from the 2026 pattern (ten weeks, Monday to Thursday, Friday held back as a
// rain makeup day) and the real 2027 weekdays. While `confirmed` is false the public site says
// "dates coming soon" and the registration endpoint refuses (see registrationWindow.ts), so a
// draft calendar cannot reach parents. Set `confirmed: true` only in the commit that records
// the owner's approval — that commit is the audit trail.

import type { Lang } from "./lang";

// A week as written down by hand. Only the camp days are required.
type WeekDef = {
  /** The days camp actually runs, as ISO dates (YYYY-MM-DD), earliest first. */
  days: string[];
  /** Explains anything unusual about this week to parents (a holiday, a short week). */
  note?: { en: string; fr: string };
};

export type SeasonWeek = {
  /** The Monday of the week as an ISO date, e.g. "2027-06-21". Unique for all time. */
  id: string;
  days: string[];
  startDate: string;
  endDate: string;
  /** English label, e.g. "June 21, 22, 23 & 25". */
  label: string;
  /** French label, e.g. "21, 22, 23 et 25 juin". */
  labelFr: string;
  /** Compact range for a spreadsheet tab, e.g. "Jun 21-25". */
  shortLabel: string;
  note?: { en: string; fr: string };
};

export const SEASON_YEAR = 2027;

const WEEK_DEFS: WeekDef[] = [
  {
    // Thursday June 24 is the Fête nationale. The 2026 season handled its holiday weeks the
    // same way: the holiday is skipped and Friday becomes a regular camp day.
    days: ["2027-06-21", "2027-06-22", "2027-06-23", "2027-06-25"],
    note: {
      en: "Thursday, June 24 is the Fête nationale du Québec (a holiday), so there is no camp that day. Camp runs Friday, June 25 instead, and there is no rain makeup day this week.",
      fr: "Le jeudi 24 juin est la Fête nationale du Québec (jour férié) : il n’y a pas de camp ce jour-là. Le camp a lieu le vendredi 25 juin à la place, et il n’y a pas de journée de reprise en cas de pluie cette semaine-là.",
    },
  },
  {
    // Thursday July 1 is Canada Day.
    days: ["2027-06-28", "2027-06-29", "2027-06-30", "2027-07-02"],
    note: {
      en: "Thursday, July 1 is Canada Day (a holiday), so there is no camp that day. Camp runs Friday, July 2 instead, and there is no rain makeup day this week.",
      fr: "Le jeudi 1er juillet est la fête du Canada (jour férié) : il n’y a pas de camp ce jour-là. Le camp a lieu le vendredi 2 juillet à la place, et il n’y a pas de journée de reprise en cas de pluie cette semaine-là.",
    },
  },
  { days: ["2027-07-05", "2027-07-06", "2027-07-07", "2027-07-08"] },
  { days: ["2027-07-12", "2027-07-13", "2027-07-14", "2027-07-15"] },
  { days: ["2027-07-19", "2027-07-20", "2027-07-21", "2027-07-22"] },
  { days: ["2027-07-26", "2027-07-27", "2027-07-28", "2027-07-29"] },
  { days: ["2027-08-02", "2027-08-03", "2027-08-04", "2027-08-05"] },
  { days: ["2027-08-09", "2027-08-10", "2027-08-11", "2027-08-12"] },
  { days: ["2027-08-16", "2027-08-17", "2027-08-18", "2027-08-19"] },
  { days: ["2027-08-23", "2027-08-24", "2027-08-25", "2027-08-26"] },
];

// ---------------------------------------------------------------------------------------
// Calendar arithmetic on plain ISO dates. Everything is done in UTC on the date alone, so no
// time zone, daylight-saving change or server locale can move a day.
// ---------------------------------------------------------------------------------------

const MONTHS: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};
const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new Error(`Not an ISO date: ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Not a real calendar date: ${iso}`);
  }
  return { y, m, d };
}

/** 0 = Sunday ... 6 = Saturday. */
export function isoWeekday(iso: string): number {
  const { y, m, d } = parseIsoDate(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysIso(iso: string, days: number): string {
  const { y, m, d } = parseIsoDate(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday of the week an ISO date falls in. */
export function mondayOf(iso: string): string {
  const weekday = isoWeekday(iso); // 0 = Sunday
  return addDaysIso(iso, -((weekday + 6) % 7));
}

/** "Thursday, June 24" / "jeudi 24 juin". */
export function formatDayLong(iso: string, lang: Lang): string {
  const { m, d } = parseIsoDate(iso);
  const weekday = WEEKDAYS[lang][isoWeekday(iso)];
  return lang === "fr" ? `${weekday} ${frDay(d)} ${MONTHS.fr[m - 1]}` : `${weekday}, ${MONTHS.en[m - 1]} ${d}`;
}

/** "Mon, Tue, Wed & Fri" / "lun., mar., mer. et ven." */
export function weekdaySummary(days: readonly string[], lang: Lang): string {
  const names = days.map((iso) => {
    const name = WEEKDAYS[lang][isoWeekday(iso)];
    return lang === "fr" ? `${name.slice(0, 3)}.` : name.slice(0, 3);
  });
  return joinList(names, lang);
}

function frDay(d: number): string {
  return d === 1 ? "1er" : String(d);
}

function joinList(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  const word = lang === "fr" ? " et " : " & ";
  return `${items.slice(0, -1).join(", ")}${word}${items[items.length - 1]}`;
}

type MonthGroup = { month: number; days: number[] };

function groupByMonth(days: readonly string[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const iso of days) {
    const { m, d } = parseIsoDate(iso);
    const last = groups[groups.length - 1];
    if (last && last.month === m) last.days.push(d);
    else groups.push({ month: m, days: [d] });
  }
  return groups;
}

/** "June 21, 22, 23 & 25" and, across a month end, "June 28, 29, 30 & July 2". */
export function labelEn(days: readonly string[]): string {
  const groups = groupByMonth(days);
  if (groups.length === 1) {
    const g = groups[0];
    return `${MONTHS.en[g.month - 1]} ${joinList(g.days.map(String), "en")}`;
  }
  return groups.map((g) => `${MONTHS.en[g.month - 1]} ${g.days.join(", ")}`).join(" & ");
}

/** "21, 22, 23 et 25 juin" and, across a month end, "28, 29, 30 juin et 2 juillet". */
export function labelFr(days: readonly string[]): string {
  const groups = groupByMonth(days);
  if (groups.length === 1) {
    const g = groups[0];
    return `${joinList(g.days.map(frDay), "fr")} ${MONTHS.fr[g.month - 1]}`;
  }
  return groups.map((g) => `${g.days.map(frDay).join(", ")} ${MONTHS.fr[g.month - 1]}`).join(" et ");
}

/** "Jun 21-25" / "Jun 28-Jul 2": first to last camp day, short enough for a spreadsheet tab. */
export function shortLabel(days: readonly string[]): string {
  const first = parseIsoDate(days[0]);
  const last = parseIsoDate(days[days.length - 1]);
  const a = `${MONTHS_SHORT_EN[first.m - 1]} ${first.d}`;
  return first.m === last.m ? `${a}-${last.d}` : `${a}-${MONTHS_SHORT_EN[last.m - 1]} ${last.d}`;
}

export function buildWeek(def: WeekDef): SeasonWeek {
  const days = [...def.days];
  return {
    id: mondayOf(days[0]),
    days,
    startDate: days[0],
    endDate: days[days.length - 1],
    label: labelEn(days),
    labelFr: labelFr(days),
    shortLabel: shortLabel(days),
    ...(def.note ? { note: def.note } : {}),
  };
}

export const season = {
  year: SEASON_YEAR,
  /**
   * False until the owner has approved this calendar. The public pages and the registration
   * endpoint stay closed while it is false (unless SEASON_PREVIEW=true, for rehearsals on a
   * staging site).
   */
  confirmed: false,
  /**
   * When registration opens: an ISO timestamp WITH its offset, e.g. "2027-01-16T09:00:00-05:00"
   * (Montreal winter time is -05:00, summer time -04:00). null = open as soon as the site is
   * live. The REGISTRATION_OPENS_AT environment variable overrides this (for rehearsals).
   */
  registrationOpensAt: null as string | null,
  weeks: WEEK_DEFS.map(buildWeek),
};

export function weekLabel(week: Pick<SeasonWeek, "label" | "labelFr">, lang: Lang): string {
  return lang === "fr" ? week.labelFr : week.label;
}

/** The label for a week id in a language; an unknown id is returned as it is. */
export function labelForWeekId(weekId: string, lang: Lang = "en"): string {
  const week = season.weeks.find((w) => w.id === weekId);
  return week ? weekLabel(week, lang) : weekId;
}

/** "June 21 – August 26, 2027" / "du 21 juin au 26 août 2027". */
export function seasonRange(lang: Lang): string {
  const first = season.weeks[0].startDate;
  const last = season.weeks[season.weeks.length - 1].endDate;
  const a = parseIsoDate(first);
  const b = parseIsoDate(last);
  if (lang === "fr") return `du ${frDay(a.d)} ${MONTHS.fr[a.m - 1]} au ${frDay(b.d)} ${MONTHS.fr[b.m - 1]} ${b.y}`;
  return `${MONTHS.en[a.m - 1]} ${a.d} – ${MONTHS.en[b.m - 1]} ${b.d}, ${b.y}`;
}

// An ISO timestamp that carries its own offset ("...Z" or "...-05:00"); anything else is
// rejected, because a time with no offset would silently mean the server's time zone.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseOpensAt(value: string | null | undefined): { ok: true; iso: string | null } | { ok: false } {
  const raw = (value ?? "").trim();
  if (raw === "") return { ok: true, iso: null };
  if (!ISO_WITH_OFFSET.test(raw)) return { ok: false };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, iso: new Date(ms).toISOString() };
}

// Quebec's statutory holidays that can fall inside a summer camp season. Used by the tests
// to make sure no camp day lands on one by accident (running on a holiday is allowed, but
// it should be a decision, not a typo).
export function quebecSummerHolidays(year: number): { date: string; name: string }[] {
  const canadaDay = `${year}-07-01`;
  // When July 1 is a Sunday the statutory holiday moves to Monday, July 2.
  const observedCanadaDay = isoWeekday(canadaDay) === 0 ? `${year}-07-02` : canadaDay;
  return [
    { date: `${year}-06-24`, name: "Fête nationale du Québec" },
    { date: observedCanadaDay, name: "Canada Day" },
  ];
}
