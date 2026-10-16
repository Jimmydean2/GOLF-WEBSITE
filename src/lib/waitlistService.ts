import { isDatabaseConfigured } from "./db";
import { emailKey } from "./campDb";
import { clientIp, rateLimit } from "./rateLimit";
import { siteOrigin } from "./siteUrl";
import { registrationWindow } from "./registrationWindow";
import { formatMontreal } from "./payment";
import { labelForWeekId, season } from "./season";
import { inCalendarOrder } from "./weeks";
import { logError } from "./safeLog";
import { parseLang } from "./lang";
import { getMessages } from "./i18n";
import { isWaitlistEnabled, joinWaitlist, validateWaitlistBody, WAITLIST_LIMITS } from "./waitlist";

// Server-only. What the waiting-list form's POST does, apart from the Next.js route file so it
// can be tested directly. Its promises are the same as the registration form's, and smaller:
//   * it can only ever add a row to the waiting list (never a registration, a spot or a count);
//   * it answers in the family's language;
//   * it is refused while registration itself is not open (a waiting list for weeks nobody can
//     book yet would be meaningless);
//   * it is refused for a week that still has room (the family should register instead);
//   * it is rate limited per connection and per email address.

export type WaitlistHooks = {
  // Runs after the answer is sent (the platform's after()): sends the acknowledgement at once.
  defer?: (task: () => Promise<unknown>) => void;
  onJoined?: (info: { entryId: string; origin: string }) => Promise<unknown>;
  now?: Date;
};

const json = (body: Record<string, unknown>, status = 200, headers?: Record<string, string>) => Response.json(body, { status, headers });

export async function handleWaitlistRequest(request: Request, hooks: WaitlistHooks = {}): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) return json({ error: getMessages("en").errors.tooLarge, code: "too_large" }, 413);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: getMessages("en").errors.invalidRequest, code: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: getMessages("en").errors.invalidRequest, code: "invalid_request" }, 400);
  const lang = parseLang((body as Record<string, unknown>).language);
  const m = getMessages(lang);

  if (!isDatabaseConfigured()) return json({ error: m.errors.unavailable, code: "unavailable" }, 503);
  // Prepared but off until the owner chooses to offer it (WAITLIST_ENABLED=true).
  if (!isWaitlistEnabled()) return json({ error: m.waitlist.errors.off, code: "waitlist_off" }, 404);

  const opening = registrationWindow(hooks.now ?? new Date());
  if (opening.state !== "open") {
    return json(
      {
        error: opening.state === "opens_later" ? m.errors.opensLater(formatMontreal(opening.opensAt, lang)) : m.errors.notAnnounced(season.year),
        code: "registration_not_open",
      },
      403
    );
  }

  const parsed = validateWaitlistBody(body as Record<string, unknown>);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, 400);
  const input = parsed.value;

  const ip = clientIp(request);
  if (ip !== "unknown") {
    const hit = await rateLimit("waitlist-ip", ip, WAITLIST_LIMITS.perIpPerHour, 3600);
    if (!hit.allowed) return json({ error: m.errors.rateLimited, code: "rate_limited" }, 429, { "Retry-After": String(hit.retryAfterSeconds) });
  }
  const perEmail = await rateLimit("waitlist-email", emailKey(input.email), WAITLIST_LIMITS.perEmailPerHour, 3600);
  if (!perEmail.allowed) return json({ error: m.errors.rateLimited, code: "rate_limited" }, 429, { "Retry-After": String(perEmail.retryAfterSeconds) });

  try {
    const result = await joinWaitlist(input);
    if (!result.ok) {
      if (result.reason === "week_has_room") {
        return json({ error: m.waitlist.errors.weekHasRoom(inCalendarOrder(result.weekIds).map((id) => labelForWeekId(id, lang))), code: "week_has_room", weekIds: result.weekIds }, 409);
      }
      if (result.reason === "list_full") return json({ error: m.waitlist.errors.listFull, code: "list_full" }, 409);
      return json({ error: m.errors.invalidWeeks, code: "invalid_weeks" }, 400);
    }
    const origin = siteOrigin(request.url);
    if (result.entryIds.length > 0 && hooks.onJoined) {
      const defer = hooks.defer ?? ((task: () => Promise<unknown>) => void task().catch(() => {}));
      defer(async () => {
        try {
          await hooks.onJoined!({ entryId: result.entryIds[0], origin });
        } catch (err) {
          logError("Sending the waiting-list acknowledgement failed (it stays queued):", err);
        }
      });
    }
    return json({
      success: true,
      weekIds: inCalendarOrder([...result.added, ...result.already]),
      added: result.added.length,
      alreadyOnList: result.already.length,
      message: m.waitlist.done(inCalendarOrder([...result.added, ...result.already]).map((id) => labelForWeekId(id, lang)).join("; "), input.email),
    });
  } catch (err) {
    logError("Joining the waiting list failed:", err);
    return json({ error: m.waitlist.errors.tryAgain, code: "server_error" }, 502);
  }
}
