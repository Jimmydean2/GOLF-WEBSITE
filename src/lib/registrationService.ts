import { juniorCamps } from "./content";
import { isDatabaseConfigured } from "./db";
import {
  childKey,
  emailKey,
  findExistingReservation,
  reserveRegistration,
  type ReserveChildInput,
  type ReserveRegistrationInput,
  type ReserveResult,
} from "./campDb";
import { isValidEmail } from "./validation";
import { isRegistrationLinkConfigured, makeAccessToken } from "./registrationLink";
import { clientIp, rateLimit, rateLimitRefund, type RateLimitResult } from "./rateLimit";
import { siteOrigin } from "./siteUrl";
import { inCalendarOrder } from "./weeks";
import { logError } from "./safeLog";
import { registrationWindow } from "./registrationWindow";
import { formatMontreal } from "./payment";
import { labelForWeekId, season } from "./season";
import { parseLang, type Lang } from "./lang";
import { getMessages, reservationPath, type Messages } from "./i18n";

// Server-only. Everything the registration form's POST does, kept apart from the Next.js
// route file so it can be exercised directly (and under load) without a web server.
//
// The order matters, because each step decides what a family is charged for:
//   1. Validate the form. A mistake costs the family nothing: no rate-limit allowance is
//      used and nothing touches the database.
//   2. A repeat of a submission that already succeeded (double-click, retry after a dropped
//      connection) returns the same reservation. It uses no allowance either.
//   3. Only then is an attempt to make a NEW reservation counted, per connection and per
//      email. If it ends up creating nothing (weeks full, already registered, error) the
//      count is handed back, so a family waiting for a week to free up is never locked out.
//   4. A generous flood limit counts everything that passed validation and is never handed
//      back: it exists to stop a runaway script, not families.

export const REGISTRATION_LIMITS = {
  // Per connection, per hour: every well-formed submission, repeats included. Generous on
  // purpose (a school or mobile carrier can put many families behind one address).
  floodPerIpPerHour: 300,
  // Per connection, per hour: reservations actually created.
  newPerIpPerHour: 30,
  // Per email address, per hour: reservations actually created. Equal to the number of
  // unpaid reservations one family may hold, so this limit never bites before that one.
  newPerEmailPerHour: 8,
  maxChildrenPerSubmission: 12,
  maxBodyBytes: 200_000,
} as const;

const VALID_WEEKS: string[] = juniorCamps.weeks.map((w) => w.id);

// --- validation -----------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; value: ReserveRegistrationInput }
  | { ok: false; error: string; code: string };

const fail = (code: string, error: string): ValidationResult => ({ ok: false, code, error });

const MAX = { name: 120, email: 254, phone: 40, relationship: 60, age: 12, health: 2000 } as const;

// A real calendar date written YYYY-MM-DD, not in the future and not absurdly old.
function isPlausibleBirthDate(value: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  if (date.getTime() > now.getTime()) return false;
  return y >= now.getUTCFullYear() - 25;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function validateRegistrationBody(body: Record<string, unknown>, now: Date = new Date(), lang: Lang = "en"): ValidationResult {
  const m: Messages["errors"] = getMessages(lang).errors;
  const idempotencyKey = text(body.idempotencyKey);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
    return fail("invalid_request", lang === "en" ? "Invalid request (missing idempotency key)." : m.invalidRequest);
  }

  const parentName = text(body.parentName);
  const email = text(body.email);
  const primaryPhone = text(body.primaryPhone);
  const secondaryPhone = text(body.secondaryPhone);
  const emergencyName = text(body.emergencyName);
  const emergencyRelationship = text(body.emergencyRelationship);
  const emergencyPhone = text(body.emergencyPhone);
  const weekIds = Array.from(new Set((Array.isArray(body.weeks) ? body.weeks : []).map(text).filter(Boolean)));
  const childrenInput = Array.isArray(body.children) ? body.children : [];

  const children: (ReserveChildInput | null)[] = childrenInput.map((raw) => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const child = { fullName: text(r.fullName), dateOfBirth: text(r.dateOfBirth), age: text(r.age), healthInfo: text(r.healthInfo) };
    return child.fullName && child.dateOfBirth && child.age && child.healthInfo ? child : null;
  });

  if (
    !parentName || !email || !primaryPhone || !emergencyName || !emergencyRelationship || !emergencyPhone ||
    weekIds.length === 0 || children.length === 0 || children.some((c) => c === null)
  ) {
    return fail("missing_fields", m.missingFields);
  }
  const kids = children as ReserveChildInput[];

  if (
    parentName.length > MAX.name || email.length > MAX.email || primaryPhone.length > MAX.phone ||
    secondaryPhone.length > MAX.phone || emergencyName.length > MAX.name || emergencyPhone.length > MAX.phone ||
    emergencyRelationship.length > MAX.relationship ||
    kids.some((c) => c.fullName.length > MAX.name || c.age.length > MAX.age || c.healthInfo.length > MAX.health)
  ) {
    return fail("too_long", m.tooLong);
  }
  if (!isValidEmail(email)) return fail("invalid_email", m.invalidEmail);

  // The owner phones families, and the same phone number links a family's reservations: a number
  // with no area code, or with letters in it, helps nobody.
  const phoneDigits = (value: string) => value.replace(/\D/g, "").length;
  const badPhone = (value: string, required: boolean) => (required || value !== "") && (phoneDigits(value) < 10 || phoneDigits(value) > 15 || /[A-Za-z]/.test(value));
  if (badPhone(primaryPhone, true) || badPhone(emergencyPhone, true) || badPhone(secondaryPhone, false)) {
    return fail("invalid_phone", m.invalidPhone);
  }

  if (body.codeOfConductAccepted !== true || body.consentAccepted !== true) {
    return fail("consent_required", m.consentRequired);
  }
  if (weekIds.some((w) => !VALID_WEEKS.includes(w))) return fail("invalid_weeks", m.invalidWeeks);

  if (kids.length > REGISTRATION_LIMITS.maxChildrenPerSubmission) {
    return fail("too_many_children", m.tooManyChildren(REGISTRATION_LIMITS.maxChildrenPerSubmission));
  }
  for (const child of kids) {
    if (!isPlausibleBirthDate(child.dateOfBirth, now)) {
      return fail("invalid_birth_date", m.invalidBirthDate(child.fullName));
    }
  }
  const seen = new Set<string>();
  for (const child of kids) {
    const key = childKey(child.fullName, child.dateOfBirth);
    if (seen.has(key)) {
      return fail("duplicate_child", m.duplicateChild(child.fullName));
    }
    seen.add(key);
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      parentName,
      email,
      primaryPhone,
      secondaryPhone,
      emergencyName,
      emergencyRelationship,
      emergencyPhone,
      codeOfConductAccepted: true,
      consentAccepted: true,
      language: lang,
      children: kids,
      weekIds,
    },
  };
}

// --- the request ----------------------------------------------------------------------

export type RegistrationHooks = {
  // Runs work after the response is on its way (Next's after() in production). Without
  // one, the work simply starts and is not waited for.
  defer?: (task: () => Promise<unknown>) => void;
  // A new reservation was just made.
  onCreated?: (info: { registrationId: string; origin: string }) => Promise<unknown> | unknown;
  // Someone submitted something that is already reserved; these unpaid reservations may
  // want their instructions sent again (to the address already on file, never elsewhere).
  onDuplicate?: (info: { registrationIds: string[]; origin: string }) => Promise<unknown> | unknown;
  // The clock used to validate birth dates. Tests only.
  now?: Date;
};

function json(body: Record<string, unknown>, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

export async function handleRegistrationRequest(request: Request, hooks: RegistrationHooks = {}): Promise<Response> {
  // The size check needs no language; everything after it answers in the family's language,
  // which is read from the body ("en" or "fr"; anything else is English).
  if (Number(request.headers.get("content-length") ?? 0) > REGISTRATION_LIMITS.maxBodyBytes) {
    return json({ error: getMessages("en").errors.tooLarge, code: "too_large" }, 413);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: getMessages("en").errors.invalidRequest, code: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: getMessages("en").errors.invalidRequest, code: "invalid_request" }, 400);
  }
  const lang = parseLang((body as Record<string, unknown>).language);
  const m = getMessages(lang).errors;

  // Postgres is the authoritative store for capacity and registrations (see campDb.ts).
  // Google Sheets is an optional reporting copy only, never consulted.
  if (!isDatabaseConfigured()) {
    return json({ error: m.unavailable, code: "unavailable" }, 503);
  }
  // Every reservation is given a private link; without the key that signs it, a reservation
  // would be created that its parent could never reach. Refuse up front instead.
  if (!isRegistrationLinkConfigured()) {
    console.error("REGISTRATION_LINK_SECRET is missing or shorter than 16 characters: registration is switched off.");
    return json({ error: m.unavailable, code: "unavailable" }, 503);
  }

  // Is registration open at all? A draft calendar, or an opening time still ahead, is refused
  // here with the same answer the page shows (see registrationWindow.ts). Costs nothing.
  const opening = registrationWindow(hooks.now ?? new Date());
  if (opening.state !== "open") {
    return json(
      {
        error: opening.state === "opens_later" ? m.opensLater(formatMontreal(opening.opensAt, lang)) : m.notAnnounced(season.year),
        code: "registration_not_open",
        ...(opening.state === "opens_later" ? { opensAt: opening.opensAt } : {}),
      },
      403
    );
  }

  // 1. A mistake in the form is free.
  const parsed = validateRegistrationBody(body as Record<string, unknown>, hooks.now, lang);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, 400);
  const input = parsed.value;

  const ip = clientIp(request);
  // If the platform gives no address at all, every visitor would share the key "unknown"; one
  // limit would then throttle the whole site. The per-email limit still applies.
  const ipKnown = ip !== "unknown";
  const tooMany = (hit: RateLimitResult) =>
    json({ error: m.rateLimited, code: "rate_limited" }, 429, { "Retry-After": String(hit.retryAfterSeconds) });
  const origin = siteOrigin(request.url);
  const defer = hooks.defer ?? ((task: () => Promise<unknown>) => void task().catch(() => {}));
  const runAfter = (label: string, task: () => Promise<unknown> | unknown) =>
    defer(async () => {
      try {
        await task();
      } catch (err) {
        logError(`${label} failed (non-fatal):`, err);
      }
    });

  const reply = (result: Extract<ReserveResult, { ok: true }>) =>
    json({
      success: true,
      reference: result.reference,
      amountDueCents: result.amountDueCents,
      payByAt: result.payByAt,
      statusPath: reservationPath(lang, makeAccessToken(result.registrationId)),
    });

  const taken: RateLimitResult[] = [];
  const handBack = async () => {
    await Promise.allSettled(taken.map((hit) => rateLimitRefund(hit)));
  };

  try {
    // 4. The flood limit: counted for everything well-formed, never handed back.
    if (ipKnown) {
      const flood = await rateLimit("register-flood", ip, REGISTRATION_LIMITS.floodPerIpPerHour, 3600);
      if (!flood.allowed) return tooMany(flood);
    }

    // 2. A repeat of a submission that already worked is not a new attempt.
    const replay = await findExistingReservation(input.idempotencyKey, input.email);
    if (replay) {
      if (replay.ok) return reply(replay);
      return json({ error: m.invalidRequest, code: "invalid_request" }, 400);
    }

    // 3. Counting starts here: this is an attempt to make a new reservation.
    const perIp = ipKnown ? await rateLimit("register-ip", ip, REGISTRATION_LIMITS.newPerIpPerHour, 3600) : null;
    if (perIp) taken.push(perIp);
    const perEmail = await rateLimit("register-email", emailKey(input.email), REGISTRATION_LIMITS.newPerEmailPerHour, 3600);
    taken.push(perEmail);
    if ((perIp && !perIp.allowed) || !perEmail.allowed) {
      await handBack();
      return tooMany(perIp && !perIp.allowed ? perIp : perEmail);
    }

    const result = await reserveRegistration(input);

    if (!result.ok) {
      await handBack();
      switch (result.reason) {
        case "too_many_open":
          return json({ error: m.tooManyOpen, code: "too_many_open" }, 429);
        case "weeks_full":
          return json(
            {
              error: m.weeksFull(result.fullWeekIds.map((id) => labelForWeekId(id, lang))),
              code: "weeks_full",
              weekIds: result.fullWeekIds,
            },
            409
          );
        case "weeks_unavailable":
          return json(
            {
              error: m.weeksUnavailable(result.unavailableWeekIds.map((id) => labelForWeekId(id, lang))),
              code: "weeks_unavailable",
              weekIds: result.unavailableWeekIds,
            },
            409
          );
        case "already_registered": {
          const weeks = inCalendarOrder([...new Set(result.conflicts.flatMap((c) => c.weekIds))]).map((id) => labelForWeekId(id, lang));
          const names = result.conflicts.map((c) => c.childName);
          const resent = result.openRegistrationIds.length > 0;
          if (resent) {
            runAfter("Re-sending payment instructions", () =>
              hooks.onDuplicate?.({ registrationIds: result.openRegistrationIds, origin })
            );
          }
          return json({ error: m.alreadyRegistered(names, weeks, resent), code: "already_registered" }, 409);
        }
        case "idempotency_conflict":
          return json({ error: m.invalidRequest, code: "invalid_request" }, 400);
      }
    }

    if (result.alreadyExisted) {
      // Two identical submissions raced; the other one created it.
      await handBack();
      return reply(result);
    }

    runAfter("Registration follow-up", () => hooks.onCreated?.({ registrationId: result.registrationId, origin }));
    return reply(result);
  } catch (err) {
    await handBack();
    logError("Camp registration failed:", err);
    return json({ error: m.serverError, code: "server_error" }, 502);
  }
}
