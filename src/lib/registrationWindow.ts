// Is registration open right now? One small answer that the registration endpoint, the
// capacity endpoint and the pages all share, so the site can never say "Registration is Open"
// while the endpoint is refusing, or the other way round.
//
//   not_announced  the owner has not approved the season's dates (season.confirmed is false)
//                  and this is not a rehearsal site (SEASON_PREVIEW=true). Public pages show
//                  "dates coming soon"; the endpoint refuses. This is the safe default.
//   opens_later    the dates are public but registration opens at a set moment
//                  (season.registrationOpensAt, or REGISTRATION_OPENS_AT to rehearse it).
//   open           parents can register. Which weeks are bookable is still decided, week by
//                  week, by the database (a closed or full week is refused there).
//
// Server-side only: it reads environment variables. The browser gets the answer from
// /api/camp-capacity.

import { parseOpensAt, season } from "./season";

export type RegistrationWindow =
  | { state: "open" }
  | { state: "opens_later"; opensAt: string }
  | { state: "not_announced" };

type Env = Record<string, string | undefined>;

// The two calendar facts the answer depends on (a parameter so tests can try the other states).
type Calendar = { confirmed: boolean; registrationOpensAt: string | null };

// A staging site rehearses with the draft calendar. Never set this on the real site: the
// preflight check fails if it is set while the site is marked as production.
export function isSeasonPreview(env: Env = process.env): boolean {
  return env.SEASON_PREVIEW === "true";
}

// Are the dates fit to show the public? (Build-time safe: depends only on the calendar flag
// and the preview switch.)
export function isSeasonPublic(env: Env = process.env, calendar: Calendar = season): boolean {
  return calendar.confirmed || isSeasonPreview(env);
}

// The configured opening moment: the environment (for rehearsals) wins over the calendar. A
// value that is present but unreadable is reported as not ok, so callers can keep the doors
// shut instead of guessing.
export function configuredOpensAt(env: Env = process.env, calendar: Calendar = season): { ok: true; iso: string | null } | { ok: false } {
  const fromEnv = parseOpensAt(env.REGISTRATION_OPENS_AT);
  const fromCalendar = parseOpensAt(calendar.registrationOpensAt);
  if (!fromEnv.ok || !fromCalendar.ok) return { ok: false };
  return { ok: true, iso: fromEnv.iso ?? fromCalendar.iso };
}

export function registrationWindow(now: Date = new Date(), env: Env = process.env, calendar: Calendar = season): RegistrationWindow {
  if (!isSeasonPublic(env, calendar)) return { state: "not_announced" };

  // A mistyped opening time (in the environment or in the calendar) must never open the doors
  // early: treat it as "not announced" until it is fixed. The preflight check reports it.
  const opens = configuredOpensAt(env, calendar);
  if (!opens.ok) return { state: "not_announced" };
  if (opens.iso && now.getTime() < Date.parse(opens.iso)) return { state: "opens_later", opensAt: opens.iso };
  return { state: "open" };
}
