import type { PoolClient } from "pg";
import { getPool } from "./db";
import { recordAudit } from "./campDb";
import { enqueueWaitlistEmail } from "./outboxQueue";
import { isValidEmail } from "./validation";
import { juniorCamps } from "./content";
import { parseLang, type Lang } from "./lang";
import { PRIVACY_NOTICE_VERSION } from "./privacy";
import { getMessages } from "./i18n";

// Server-only. The optional waiting list for full camp weeks.
//
// THE RULE THIS FILE EXISTS TO KEEP: a waiting list never promises and never assigns a place.
// Nothing here holds, reserves or books anything: this code only ever READS registrations and
// weeks, never writes them, and the waitlist table has no link to either. The one thing it can
// do for a family is send an email saying "a place may have opened; it is not held for you;
// register the usual way, first come, first served", and only when the owner presses the button
// and the week really has room right now. tests (waitlist.test.mjs) prove each of those.

export const WAITLIST_LIMITS = {
  perIpPerHour: 10,
  perEmailPerHour: 6,
  maxPerWeek: 300, // a list cannot grow without limit, even under a script's attack
  maxNotifications: 3, // per entry; also enforced by the database
  renotifyAfterHours: 12,
  maxPlaces: 6,
} as const;

const MAX = { name: 120, email: 254, phone: 40 } as const;
const VALID_WEEKS = juniorCamps.weeks.map((w) => w.id);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const emailKey = (email: string) => email.trim().toLowerCase();

// The waiting list is prepared but OFF until the owner decides to offer it: set WAITLIST_ENABLED=true.
// While it is off the camp page shows no waiting-list form and the endpoint refuses.
export function isWaitlistEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WAITLIST_ENABLED === "true";
}

export type WaitlistInput = {
  parentName: string;
  email: string;
  phone: string;
  placesWanted: number;
  weekIds: string[];
  language: Lang;
};
export type WaitlistValidation = { ok: true; value: WaitlistInput } | { ok: false; code: string; error: string };

export function validateWaitlistBody(body: Record<string, unknown>): WaitlistValidation {
  const lang = parseLang(body.language);
  const m = getMessages(lang);
  const fail = (code: string, error: string): WaitlistValidation => ({ ok: false, code, error });
  const parentName = text(body.parentName);
  const email = text(body.email);
  const phone = text(body.phone);
  const weekIds = Array.from(new Set((Array.isArray(body.weeks) ? body.weeks : []).map(text).filter(Boolean)));
  const places = Number(body.placesWanted);
  if (!parentName || !email || weekIds.length === 0) return fail("missing_fields", m.waitlist.errors.missing);
  if (parentName.length > MAX.name || email.length > MAX.email || phone.length > MAX.phone) return fail("too_long", m.errors.tooLong);
  if (!isValidEmail(email)) return fail("invalid_email", m.errors.invalidEmail);
  const digits = phone.replace(/\D/g, "").length;
  if (phone !== "" && (digits < 10 || digits > 15 || /[A-Za-z]/.test(phone))) return fail("invalid_phone", m.errors.invalidPhone);
  if (body.consentAccepted !== true) return fail("consent_required", m.waitlist.errors.consent);
  if (weekIds.some((w) => !VALID_WEEKS.includes(w)) || weekIds.length > VALID_WEEKS.length) return fail("invalid_weeks", m.errors.invalidWeeks);
  if (!Number.isInteger(places) || places < 1 || places > WAITLIST_LIMITS.maxPlaces) return fail("invalid_places", m.errors.invalidRequest);
  return { ok: true, value: { parentName, email, phone, placesWanted: places, weekIds, language: lang } };
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type JoinResult =
  | { ok: true; added: string[]; already: string[]; entryIds: string[] }
  | { ok: false; reason: "week_has_room"; weekIds: string[] }
  | { ok: false; reason: "list_full" }
  | { ok: false; reason: "unknown_week" };

// Adds the family to the list for each full week they chose. Weeks that still have room are
// refused (they should register instead); nothing is added unless every chosen week is full.
export async function joinWaitlist(input: WaitlistInput): Promise<JoinResult> {
  return inTransaction<JoinResult>(async (client) => {
    const weeks = await client.query(`SELECT id, taken_count, max_capacity FROM camp_weeks WHERE id = ANY($1::text[]) ORDER BY id`, [input.weekIds]);
    if (weeks.rows.length !== input.weekIds.length) return { ok: false, reason: "unknown_week" };
    const withRoom = weeks.rows.filter((w) => (w.taken_count as number) < (w.max_capacity as number)).map((w) => w.id as string);
    if (withRoom.length > 0) return { ok: false, reason: "week_has_room", weekIds: withRoom };
    const counts = await client.query(`SELECT week_id, count(*)::int AS n FROM waitlist_entries WHERE week_id = ANY($1::text[]) GROUP BY week_id`, [input.weekIds]);
    if (counts.rows.some((r) => (r.n as number) >= WAITLIST_LIMITS.maxPerWeek)) return { ok: false, reason: "list_full" };

    const batch = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
    const added: string[] = [];
    const already: string[] = [];
    const entryIds: string[] = [];
    for (const weekId of input.weekIds.slice().sort()) {
      const inserted = await client.query(
        `INSERT INTO waitlist_entries (week_id, parent_name, email, email_key, batch_id, phone, places_wanted, language, consent_version, consent_recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (email_key, week_id) DO NOTHING RETURNING id`,
        [weekId, input.parentName, input.email, emailKey(input.email), batch, input.phone, input.placesWanted, input.language, PRIVACY_NOTICE_VERSION]
      );
      if (inserted.rows.length > 0) {
        added.push(weekId);
        entryIds.push(inserted.rows[0].id as string);
      } else {
        already.push(weekId);
      }
    }
    // One acknowledgement for the whole request, recorded with the entries, so it cannot be lost.
    if (entryIds.length > 0) await enqueueWaitlistEmail(client, "waitlist_ack", entryIds[0], `waitlist_ack:${batch}`);
    return { ok: true, added, already, entryIds };
  });
}

// --- for the owner ------------------------------------------------------------------------

export type WaitlistEntryView = {
  id: string;
  parentName: string;
  email: string;
  phone: string;
  placesWanted: number;
  language: Lang;
  status: "waiting" | "notified";
  joinedAt: string;
  notifiedAt: string | null;
  notifiedCount: number;
  /** The same email address already holds a place in this week (nothing to tell them). */
  alreadyRegistered: boolean;
};
export type WaitlistWeekView = {
  weekId: string;
  label: string;
  taken: number;
  max: number;
  remaining: number;
  isOpen: boolean;
  entries: WaitlistEntryView[];
};

export async function listWaitlist(): Promise<WaitlistWeekView[]> {
  const { rows } = await getPool().query(
    `SELECT w.id, w.taken_count, w.max_capacity, w.is_open,
            e.id AS entry_id, e.parent_name, e.email, e.phone, e.places_wanted, e.language, e.status,
            e.created_at, e.notified_at, e.notified_count,
            EXISTS (SELECT 1 FROM registrations r JOIN registration_spots s ON s.registration_id = r.id
                     WHERE s.week_id = e.week_id AND s.status = 'active' AND lower(btrim(r.email)) = e.email_key) AS already_registered
       FROM camp_weeks w JOIN waitlist_entries e ON e.week_id = w.id
      ORDER BY w.start_date, e.created_at, e.id`
  );
  const byWeek = new Map<string, WaitlistWeekView>();
  for (const r of rows) {
    let week = byWeek.get(r.id as string);
    if (!week) {
      const def = juniorCamps.weeks.find((x) => x.id === r.id);
      week = {
        weekId: r.id as string,
        label: def?.label ?? (r.id as string),
        taken: r.taken_count as number,
        max: r.max_capacity as number,
        remaining: Math.max((r.max_capacity as number) - (r.taken_count as number), 0),
        isOpen: r.is_open as boolean,
        entries: [],
      };
      byWeek.set(week.weekId, week);
    }
    week.entries.push({
      id: r.entry_id as string,
      parentName: r.parent_name as string,
      email: r.email as string,
      phone: r.phone as string,
      placesWanted: r.places_wanted as number,
      language: r.language as Lang,
      status: r.status as "waiting" | "notified",
      joinedAt: new Date(r.created_at as string).toISOString(),
      notifiedAt: r.notified_at ? new Date(r.notified_at as string).toISOString() : null,
      notifiedCount: r.notified_count as number,
      alreadyRegistered: Boolean(r.already_registered),
    });
  }
  return [...byWeek.values()];
}

export type NotifyResult =
  | { ok: true; notifiedCount: number }
  | { ok: false; reason: "not_found" | "week_full" | "week_closed" | "already_registered" | "too_many" | "too_soon" };

// The owner tells one family that a place MAY be open. Allowed only while the week really has room
// and is open, the family does not already hold a place, and they have not been told too often.
// It changes nothing about any registration or week.
export async function notifyWaitlistEntry(entryId: string, now: Date = new Date()): Promise<NotifyResult> {
  return inTransaction<NotifyResult>(async (client) => {
    const found = await client.query(
      `SELECT e.id, e.week_id, e.email_key, e.notified_at, e.notified_count, w.taken_count, w.max_capacity, w.is_open
         FROM waitlist_entries e JOIN camp_weeks w ON w.id = e.week_id WHERE e.id = $1 FOR UPDATE OF e`,
      [entryId]
    );
    if (found.rows.length === 0) return { ok: false, reason: "not_found" };
    const e = found.rows[0];
    if (!e.is_open) return { ok: false, reason: "week_closed" };
    if ((e.taken_count as number) >= (e.max_capacity as number)) return { ok: false, reason: "week_full" };
    const registered = await client.query(
      `SELECT 1 FROM registrations r JOIN registration_spots s ON s.registration_id = r.id
        WHERE s.week_id = $1 AND s.status = 'active' AND lower(btrim(r.email)) = $2 LIMIT 1`,
      [e.week_id, e.email_key]
    );
    if (registered.rows.length > 0) return { ok: false, reason: "already_registered" };
    if ((e.notified_count as number) >= WAITLIST_LIMITS.maxNotifications) return { ok: false, reason: "too_many" };
    if (e.notified_at && now.getTime() - new Date(e.notified_at as string).getTime() < WAITLIST_LIMITS.renotifyAfterHours * 3600_000) {
      return { ok: false, reason: "too_soon" };
    }
    const count = (e.notified_count as number) + 1;
    await client.query(`UPDATE waitlist_entries SET status = 'notified', notified_at = $2::timestamptz, notified_count = $3 WHERE id = $1`, [entryId, now.toISOString(), count]);
    await enqueueWaitlistEmail(client, "waitlist_notify", entryId, `waitlist_notify:${entryId}:${count}`);
    await client.query(
      `INSERT INTO admin_audit_log (action, target_type, target_id, details, actor) VALUES ('waitlist_notify', 'waitlist', $1, $2, 'owner')`,
      [entryId, JSON.stringify({ weekId: e.week_id, notification: count })]
    );
    return { ok: true, notifiedCount: count };
  });
}

// Takes a family off the list (they asked, or the owner is tidying up). The row is deleted:
// the list has no accounting purpose, so nothing needs to be kept. Emails queued for it go too.
export async function removeWaitlistEntry(entryId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`DELETE FROM waitlist_entries WHERE id = $1`, [entryId]);
  if ((rowCount ?? 0) > 0) await recordAudit("waitlist_remove", entryId, {}, "waitlist");
  return (rowCount ?? 0) > 0;
}

// Part of the season clean-up: a waiting-list entry is erased once its camp week has passed, as
// the privacy notice says.
export async function purgeFinishedWaitlist(today: string): Promise<number> {
  const { rowCount } = await getPool().query(
    `DELETE FROM waitlist_entries e USING camp_weeks w WHERE w.id = e.week_id AND w.end_date < $1::date`,
    [today]
  );
  return rowCount ?? 0;
}

// For the family's own copy of their data: what the list holds under this email address.
export async function waitlistEntriesForEmail(client: Pick<PoolClient, "query">, email: string): Promise<{ weekId: string; joinedAt: string; placesWanted: number; status: string }[]> {
  const { rows } = await client.query(`SELECT week_id, created_at, places_wanted, status FROM waitlist_entries WHERE email_key = $1 ORDER BY created_at`, [emailKey(email)]);
  return rows.map((r) => ({ weekId: r.week_id as string, joinedAt: new Date(r.created_at as string).toISOString(), placesWanted: r.places_wanted as number, status: r.status as string }));
}

// --- for the email queue -------------------------------------------------------------------

export type WaitlistEmailContext = {
  entryId: string;
  parentName: string;
  email: string;
  language: Lang;
  status: "waiting" | "notified";
  weekIds: string[]; // the weeks this email is about
};

// What an email needs to know, read at the moment it is sent. An acknowledgement lists every week
// of the same request that is still on the list; a notice is about its own week. Returns null if
// the entry has gone (removed, erased): nothing is sent then.
export async function loadWaitlistEmailContext(entryId: string, kind: "waitlist_ack" | "waitlist_notify"): Promise<WaitlistEmailContext | null> {
  const { rows } = await getPool().query(`SELECT id, parent_name, email, language, status, week_id, batch_id FROM waitlist_entries WHERE id = $1`, [entryId]);
  if (rows.length === 0) return null;
  const e = rows[0];
  let weekIds = [e.week_id as string];
  if (kind === "waitlist_ack") {
    const all = await getPool().query(`SELECT week_id FROM waitlist_entries WHERE batch_id = $1 ORDER BY week_id`, [e.batch_id]);
    weekIds = all.rows.map((r) => r.week_id as string);
  }
  return { entryId, parentName: e.parent_name as string, email: e.email as string, language: parseLang(e.language), status: e.status as "waiting" | "notified", weekIds };
}
