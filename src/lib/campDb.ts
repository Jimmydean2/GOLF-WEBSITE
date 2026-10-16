import { randomInt, randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { capacityViolationWeek, getPool, isUniqueViolation } from "./db";
import { calculateTotal } from "./pricing";
import { parseSettings, type CampSettings } from "./campSettings";
import { enqueueEmail } from "./outboxQueue";
import { logError } from "./safeLog";

// Server-only. The authoritative store for camp-week capacity and registrations.
//
// THE PAYMENT POLICY (migration 004 enforces it in the database; this file drives it):
//   * An unpaid reservation (pending_payment) holds its spots for 12 hours, then is
//     released automatically. It always has an expiry.
//   * A parent's "I've Sent My Payment" moves it to payment_reported, protected for a
//     48-hour review. A claim is NOT proof of payment.
//   * At 48 hours the registration is flagged overdue but is NEVER released by the
//     system. Only an authorized administrator can confirm it, release it, or extend
//     the review (a counted, time-limited extension).
//   * Nothing becomes paid except confirmRegistrationPayment, called from the
//     authenticated admin route after the administrator has seen the deposit; the
//     database refuses paid without the verification record.
//
// HOW CAPACITY IS ENFORCED (migration 003):
//   * camp_weeks.taken_count is maintained by a trigger on registration_spots. Activating
//     a spot takes the week's row lock and is refused when the week is full, so
//     concurrent attempts queue and re-check. This file never writes taken_count.
//   * Deferred checks at COMMIT refuse any transaction that leaves a counter out of step
//     with the active spots, a pending/reported/paid registration without all of its
//     spots, or a cancelled/refunded one still holding a spot.
//   * This file still takes the week locks up front, in one sorted order, and checks room
//     first, for clean "week X is full" answers and deadlock-free multi-week work.
//
// Lock order everywhere: registration row first, then camp_weeks rows in sorted id order.
//
// Times: every deadline is computed from the database clock. The optional `now`
// parameters exist so tests can simulate time passing.

export const CAPACITY_STANDARD = 30;
export const CAPACITY_CEILING = 33;

type Queryable = Pool | PoolClient;

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

type LockedWeek = { maxCapacity: number; takenCount: number; isOpen: boolean };

// Locks the given weeks (FOR UPDATE) in sorted id order and returns their state.
async function lockWeeks(client: PoolClient, weekIds: string[]): Promise<Map<string, LockedWeek>> {
  const locked = new Map<string, LockedWeek>();
  for (const id of [...new Set(weekIds)].sort()) {
    const { rows } = await client.query(
      `SELECT max_capacity, taken_count, is_open FROM camp_weeks WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (rows.length > 0) {
      locked.set(id, {
        maxCapacity: rows[0].max_capacity as number,
        takenCount: rows[0].taken_count as number,
        isOpen: rows[0].is_open as boolean,
      });
    }
  }
  return locked;
}

type Actor = "owner" | "system" | "parent";

async function writeAudit(
  client: Queryable,
  action: string,
  targetId: string,
  details: Record<string, unknown>,
  actor: Actor = "owner",
  targetType = "registration"
): Promise<void> {
  await client.query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [action, targetType, targetId, JSON.stringify(details), actor]
  );
}

export async function getCampSettings(client: Queryable = getPool()): Promise<CampSettings> {
  const { rows } = await client.query(`SELECT key, value FROM camp_settings`);
  return parseSettings(rows as { key: string; value: string }[]);
}

// --- keys used to recognise the same family across registrations --------------------

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}
// The same child written two ways ("Émilie  Tremblay" / "emilie tremblay", "Jean-Luc" /
// "Jean Luc") is the same child. Letters from any alphabet are kept; accents, case, spacing
// and punctuation are ignored. Combined with the date of birth it identifies a child.
export function childKey(fullName: string, dateOfBirth: string): string {
  const name = fullName
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return `${name}|${dateOfBirth.trim()}`;
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

export function generateReference(): string {
  let ref = "GD-";
  for (let i = 0; i < 6; i++) ref += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return ref;
}

// "gd 7k4m2q", "GD-7K4M2Q" and "7K4M2Q" all normalise to the same thing.
export function normalizeReference(value: string): string {
  const letters = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return letters.length === 6 ? `GD${letters}` : letters;
}

// -------------------------------------------------------------------------------------
// Camp weeks
// -------------------------------------------------------------------------------------

export type CampWeekRow = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  maxCapacity: number;
  takenCount: number;
  priceCents: number;
  isOpen: boolean;
};

export async function getCampWeeks(): Promise<CampWeekRow[]> {
  // Capacity is current on every read: anything past its hold is released first.
  await releaseExpiredReservationsQuietly();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, label, start_date, end_date, max_capacity, taken_count, price_cents, is_open
     FROM camp_weeks ORDER BY start_date`
  );
  return rows.map(mapWeekRow);
}

function mapWeekRow(row: Record<string, unknown>): CampWeekRow {
  return {
    id: row.id as string,
    label: row.label as string,
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    maxCapacity: row.max_capacity as number,
    takenCount: row.taken_count as number,
    priceCents: row.price_cents as number,
    isOpen: row.is_open as boolean,
  };
}

async function releaseExpiredReservationsQuietly(): Promise<void> {
  try {
    await releaseExpiredReservations();
  } catch (err) {
    // Never fail a read because the housekeeping failed; the next read retries.
    logError("Releasing expired reservations failed:", err);
  }
}

// -------------------------------------------------------------------------------------
// Reserving
// -------------------------------------------------------------------------------------

export type ReserveChildInput = {
  fullName: string;
  dateOfBirth: string;
  age: string;
  healthInfo: string;
};

export type ReserveRegistrationInput = {
  idempotencyKey: string;
  parentName: string;
  email: string;
  primaryPhone: string;
  secondaryPhone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  codeOfConductAccepted: boolean;
  consentAccepted: boolean;
  children: ReserveChildInput[];
  weekIds: string[];
};

export type ReserveResult =
  | {
      ok: true;
      registrationId: string;
      reference: string;
      totalPriceCents: number; // before tax
      amountDueCents: number; // tax included: what the parent sends
      payByAt: string; // ISO: when the 12-hour hold ends, as shown to the parent
      holdExpiresAt: string; // ISO: when the system releases it (pay-by plus the report allowance)
      alreadyExisted: boolean;
    }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[] }
  | { ok: false; reason: "weeks_unavailable"; unavailableWeekIds: string[] }
  | { ok: false; reason: "too_many_open" }
  // A child in this request already holds (or has paid for) a spot in one of these weeks under
  // the same email or phone number. Nothing is written. `conflicts` uses the names exactly as
  // the requester typed them; `openRegistrationIds` are the unpaid ones, whose payment
  // instructions can be sent again to the address on file.
  | { ok: false; reason: "already_registered"; conflicts: { childName: string; weekIds: string[] }[]; openRegistrationIds: string[] }
  // The idempotency key belongs to a different family's reservation. No details are returned.
  | { ok: false; reason: "idempotency_conflict" };

// Reserves spots for every (child, week) combination in a single all-or-nothing
// transaction: if any requested week can't fit every child in this submission, nothing
// is written and the whole request is rejected (a family isn't left half-booked).
export async function reserveRegistration(input: ReserveRegistrationInput): Promise<ReserveResult> {
  await releaseExpiredReservationsQuietly();
  for (let attempt = 0; ; attempt++) {
    try {
      return await reserveOnce(input);
    } catch (err) {
      // A reference collision (about 1 in a billion) simply gets a new reference.
      if (attempt < 3 && isUniqueViolation(err) && String((err as { constraint?: string }).constraint) === "idx_registrations_reference") {
        continue;
      }
      throw err;
    }
  }
}

// The fast path for a repeated submission (double-click, retry after a dropped connection):
// the reservation already made for this key, or null. Reads only.
export async function findExistingReservation(idempotencyKey: string, email: string): Promise<ReserveResult | null> {
  return existingReservation(getPool(), idempotencyKey, email);
}

async function existingReservation(client: Queryable, idempotencyKey: string, email: string): Promise<ReserveResult | null> {
  const { rows } = await client.query(
    `SELECT id, email, reference_code, total_price_cents, amount_due_cents, hold_expires_at, hold_ends_at_initial
       FROM registrations WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  // A retry of the same submission comes from the same family. If the key turns up with a
  // different email, hand back nothing: the key is not theirs.
  if (emailKey(row.email as string) !== emailKey(email)) return { ok: false, reason: "idempotency_conflict" };
  const settings = await getCampSettings(client);
  const holdExpiresAt = new Date(row.hold_ends_at_initial as string);
  return {
    ok: true,
    registrationId: row.id,
    reference: row.reference_code,
    totalPriceCents: row.total_price_cents,
    amountDueCents: row.amount_due_cents,
    payByAt: new Date(holdExpiresAt.getTime() - settings.reportAllowanceMinutes * 60_000).toISOString(),
    holdExpiresAt: holdExpiresAt.toISOString(),
    alreadyExisted: true,
  };
}

async function reserveOnce(input: ReserveRegistrationInput): Promise<ReserveResult> {
  const pool = getPool();
  const client = await pool.connect();
  // The connection goes back to the pool BEFORE any fallback query below: with a pool of one
  // (the production setting) a query made while still holding it would wait for itself forever.
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      client.release();
    }
  };
  try {
    await client.query("BEGIN");

    // Submissions from the same family are handled one at a time: two at once cannot both
    // slip under the limit, and a double-click is recognised as the repeat it is. The lock
    // is taken on the email and on the phone number (always in that order, so two
    // submissions can never wait on each other).
    const eKey = emailKey(input.email);
    const pKey = phoneKey(input.primaryPhone);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`contact:${eKey}`]);
    if (pKey) await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`contactphone:${pKey}`]);

    const existing = await existingReservation(client, input.idempotencyKey, input.email);
    if (existing) {
      await client.query("ROLLBACK");
      return existing;
    }

    const settings = await getCampSettings(client);

    // A child can only be in one reservation per week. If any child in this request already
    // holds that week for this family (unpaid, reported or paid), refuse instead of making
    // a second one: the usual cause is a family registering again because the first
    // confirmation email was slow, and the second reservation would hold double the places.
    const sortedForClaims = [...new Set(input.weekIds)].sort();
    const claims = await client.query(
      `SELECT r.id AS registration_id, r.status, c.full_name, to_char(c.date_of_birth, 'YYYY-MM-DD') AS dob, s.week_id
         FROM registrations r
         JOIN children c ON c.registration_id = r.id
         JOIN registration_spots s ON s.child_id = c.id AND s.status = 'active'
        WHERE r.status IN ('pending_payment', 'payment_reported', 'paid')
          AND s.week_id = ANY($3::text[])
          AND (lower(r.email) = $1 OR ($2 <> '' AND right(regexp_replace(r.primary_phone, '\\D', '', 'g'), 10) = $2))`,
      [eKey, pKey, sortedForClaims]
    );
    if (claims.rows.length > 0) {
      const typedNames = new Map(input.children.map((c) => [childKey(c.fullName, c.dateOfBirth), c.fullName]));
      const overlap = new Map<string, Set<string>>();
      const openRegistrationIds = new Set<string>();
      for (const row of claims.rows) {
        const typed = typedNames.get(childKey(row.full_name as string, row.dob as string));
        if (!typed) continue;
        if (!overlap.has(typed)) overlap.set(typed, new Set());
        overlap.get(typed)!.add(row.week_id as string);
        if (row.status !== "paid") openRegistrationIds.add(row.registration_id as string);
      }
      if (overlap.size > 0) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          reason: "already_registered",
          conflicts: [...overlap.entries()].map(([childName, weeks]) => ({ childName, weekIds: [...weeks].sort() })),
          openRegistrationIds: [...openRegistrationIds],
        };
      }
    }

    // Limit how many unpaid reservations one family can hold at once.
    const open = await client.query(
      `SELECT count(*)::int AS n FROM registrations
        WHERE status IN ('pending_payment', 'payment_reported')
          AND (lower(email) = $1 OR ($2 <> '' AND right(regexp_replace(primary_phone, '\\D', '', 'g'), 10) = $2))`,
      [eKey, pKey]
    );
    if ((open.rows[0].n as number) >= settings.openReservationsPerContact) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "too_many_open" };
    }

    const spotsPerWeek = input.children.length;
    const sortedWeekIds = [...new Set(input.weekIds)].sort();

    let totalPriceCents = 0;
    const fullWeekIds: string[] = [];
    const unavailableWeekIds: string[] = [];

    for (const weekId of sortedWeekIds) {
      const { rows } = await client.query(
        `SELECT price_cents, is_open, max_capacity, taken_count FROM camp_weeks WHERE id = $1 FOR UPDATE`,
        [weekId]
      );
      if (rows.length === 0 || !rows[0].is_open) {
        unavailableWeekIds.push(weekId);
        continue;
      }
      const week = rows[0];
      if (week.taken_count + spotsPerWeek > week.max_capacity) {
        fullWeekIds.push(weekId);
        continue;
      }
      totalPriceCents += week.price_cents * spotsPerWeek;
    }

    if (unavailableWeekIds.length > 0 || fullWeekIds.length > 0) {
      await client.query("ROLLBACK");
      if (fullWeekIds.length > 0) return { ok: false, reason: "weeks_full", fullWeekIds };
      return { ok: false, reason: "weeks_unavailable", unavailableWeekIds };
    }

    // No taken_count write here: the registration_spots trigger counts each spot as it is
    // inserted below (and refuses if a week would overflow).

    const amountDueCents = calculateTotal(totalPriceCents).totalCents;
    const reference = generateReference();
    const holdMinutes = settings.holdHours * 60 + settings.reportAllowanceMinutes;
    const regResult = await client.query(
      `INSERT INTO registrations
         (idempotency_key, parent_name, email, primary_phone, secondary_phone,
          emergency_name, emergency_relationship, emergency_phone,
          code_of_conduct_accepted, consent_accepted, total_price_cents,
          reference_code, amount_due_cents, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() + make_interval(mins => $14))
       RETURNING id, hold_expires_at`,
      [
        input.idempotencyKey,
        input.parentName,
        input.email,
        input.primaryPhone,
        input.secondaryPhone,
        input.emergencyName,
        input.emergencyRelationship,
        input.emergencyPhone,
        input.codeOfConductAccepted,
        input.consentAccepted,
        totalPriceCents,
        reference,
        amountDueCents,
        holdMinutes,
      ]
    );
    const registrationId = regResult.rows[0].id as string;
    const holdExpiresAt = new Date(regResult.rows[0].hold_expires_at as string);

    for (const child of input.children) {
      const childResult = await client.query(
        `INSERT INTO children (registration_id, full_name, date_of_birth, age, health_info)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [registrationId, child.fullName, child.dateOfBirth, child.age, child.healthInfo]
      );
      const childId = childResult.rows[0].id as string;
      for (const weekId of sortedWeekIds) {
        await client.query(
          `INSERT INTO registration_spots (registration_id, child_id, week_id) VALUES ($1,$2,$3)`,
          [registrationId, childId, weekId]
        );
      }
    }

    // The emails this reservation owes, recorded in the same transaction: if the reservation
    // exists, so do they; if it was rolled back, neither does.
    await enqueueEmail(client, "parent_instructions", registrationId);
    await enqueueEmail(client, "coach_notice", registrationId);

    await client.query("COMMIT");
    return {
      ok: true,
      registrationId,
      reference,
      totalPriceCents,
      amountDueCents,
      payByAt: new Date(holdExpiresAt.getTime() - settings.reportAllowanceMinutes * 60_000).toISOString(),
      holdExpiresAt: holdExpiresAt.toISOString(),
      alreadyExisted: false,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    release();
    // Defence in depth: the week locks above should make this unreachable, but if the
    // database ever refuses a spot as over capacity, answer "full" instead of failing.
    const fullWeek = capacityViolationWeek(err);
    if (fullWeek) return { ok: false, reason: "weeks_full", fullWeekIds: [fullWeek] };
    if (isUniqueViolation(err) && String((err as { constraint?: string }).constraint) !== "idx_registrations_reference") {
      const retry = await existingReservation(pool, input.idempotencyKey, input.email);
      if (retry) return retry;
    }
    throw err;
  } finally {
    release();
  }
}

// -------------------------------------------------------------------------------------
// Reading registrations
// -------------------------------------------------------------------------------------

export type RegistrationDetail = {
  id: string;
  reference: string;
  parentName: string;
  email: string;
  primaryPhone: string;
  secondaryPhone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  status: string;
  totalPriceCents: number; // before tax
  amountDueCents: number; // tax included
  paidAt: string | null;
  createdAt: string;
  paymentReportedAt: string | null;
  holdExpiresAt: string | null; // when an unreported reservation will be released
  reviewDueAt: string | null; // when a reported payment becomes overdue for review
  reviewOverdue: boolean; // reported, and past its review time as of this read
  extensionCount: number;
  reinstateCount: number;
  releaseReason: string | null; // expired_unpaid, not_received, owner_cancelled
  verifiedAt: string | null;
  depositAt: string | null;
  paidOnTime: boolean | null;
  children: { id: string; fullName: string; dateOfBirth: string; age: string; healthInfo: string }[];
  // Weeks this registration currently HOLDS a spot in (active spots only).
  weekIds: string[];
  // Every week it has spots in, held or released: what a reinstatement would restore.
  allWeekIds: string[];
};

function isoOrNull(value: unknown): string | null {
  return value ? new Date(value as string).toISOString() : null;
}

async function loadRegistration(client: Queryable, id: string): Promise<RegistrationDetail | null> {
  const regRes = await client.query(`SELECT * FROM registrations WHERE id = $1`, [id]);
  if (regRes.rows.length === 0) return null;
  const childRes = await client.query(`SELECT * FROM children WHERE registration_id = $1`, [id]);
  const spotRes = await client.query(
    `SELECT week_id, bool_or(status = 'active') AS held
       FROM registration_spots WHERE registration_id = $1 GROUP BY week_id ORDER BY week_id`,
    [id]
  );
  const row = regRes.rows[0];
  return {
    id: row.id,
    reference: row.reference_code,
    parentName: row.parent_name,
    email: row.email,
    primaryPhone: row.primary_phone,
    secondaryPhone: row.secondary_phone,
    emergencyName: row.emergency_name,
    emergencyRelationship: row.emergency_relationship,
    emergencyPhone: row.emergency_phone,
    status: row.status,
    totalPriceCents: row.total_price_cents,
    amountDueCents: row.amount_due_cents,
    paidAt: isoOrNull(row.paid_at),
    createdAt: new Date(row.created_at).toISOString(),
    paymentReportedAt: isoOrNull(row.payment_reported_at),
    holdExpiresAt: isoOrNull(row.hold_expires_at),
    reviewDueAt: isoOrNull(row.review_due_at),
    reviewOverdue: row.status === "payment_reported" && Boolean(row.review_due_at) && new Date(row.review_due_at).getTime() < Date.now(),
    extensionCount: row.extension_count,
    reinstateCount: row.reinstate_count,
    releaseReason: row.release_reason ?? null,
    verifiedAt: isoOrNull(row.verified_at),
    depositAt: isoOrNull(row.deposit_at),
    paidOnTime: row.paid_on_time ?? null,
    children: childRes.rows.map((c) => ({
      id: c.id,
      fullName: c.full_name,
      dateOfBirth: String(c.date_of_birth),
      age: c.age,
      healthInfo: c.health_info,
    })),
    weekIds: spotRes.rows.filter((s) => s.held).map((s) => s.week_id as string),
    allWeekIds: spotRes.rows.map((s) => s.week_id as string),
  };
}

// Reads a registration without the housekeeping getRegistrationById does first. For
// background work (the email outbox) that is called many times in a row.
export async function getRegistrationSnapshot(id: string): Promise<RegistrationDetail | null> {
  return loadRegistration(getPool(), id);
}

// The time shown to the parent as "pay by": the end of the 12-hour hold, before the short
// allowance for tapping "I've Sent My Payment". Fixed when the reservation is made.
export async function getPayByAt(registrationId: string): Promise<string | null> {
  const { rows } = await getPool().query(`SELECT hold_ends_at_initial FROM registrations WHERE id = $1`, [registrationId]);
  if (rows.length === 0 || !rows[0].hold_ends_at_initial) return null;
  const settings = await getCampSettings();
  return new Date(new Date(rows[0].hold_ends_at_initial as string).getTime() - settings.reportAllowanceMinutes * 60_000).toISOString();
}

export async function getRegistrationById(id: string): Promise<RegistrationDetail | null> {
  await releaseExpiredReservationsQuietly();
  return loadRegistration(getPool(), id);
}

// -------------------------------------------------------------------------------------
// Releasing and reinstating spots
// -------------------------------------------------------------------------------------

// Releases every spot a registration holds (active -> cancelled), freeing that capacity.
// The registration row must already be locked by the caller; this takes the week locks
// (sorted) itself. The database trigger does the counting. Returns the weeks released.
async function releaseSpotsTx(client: PoolClient, registrationId: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT week_id FROM registration_spots WHERE registration_id = $1 AND status = 'active'`,
    [registrationId]
  );
  const weekIds = rows.map((r) => r.week_id as string).sort();
  await lockWeeks(client, weekIds);
  await client.query(
    `UPDATE registration_spots SET status = 'cancelled' WHERE registration_id = $1 AND status = 'active'`,
    [registrationId]
  );
  return weekIds;
}

type ReinstateSpotsResult =
  | { ok: true; reinstatedWeekIds: string[] }
  | { ok: false; reason: "no_spots" }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[] }
  | { ok: false; reason: "weeks_closed"; closedWeekIds: string[] };

// Re-reserves every released spot of a registration, all-or-nothing and capacity-checked.
// The registration row must already be locked by the caller. Refuses (writing nothing) if
// any needed week is full or closed. The single code path that takes capacity back.
async function reinstateSpotsTx(client: PoolClient, registrationId: string): Promise<ReinstateSpotsResult> {
  const { rows } = await client.query(
    `SELECT week_id, count(*)::int AS n FROM registration_spots
      WHERE registration_id = $1 AND status = 'cancelled' GROUP BY week_id`,
    [registrationId]
  );
  if (rows.length === 0) return { ok: false, reason: "no_spots" };
  const needed = new Map<string, number>(rows.map((r) => [r.week_id as string, r.n as number]));
  const locked = await lockWeeks(client, [...needed.keys()]);

  const closedWeekIds: string[] = [];
  const fullWeekIds: string[] = [];
  for (const [weekId, n] of [...needed.entries()].sort()) {
    const week = locked.get(weekId);
    if (!week || !week.isOpen) closedWeekIds.push(weekId);
    else if (week.takenCount + n > week.maxCapacity) fullWeekIds.push(weekId);
  }
  if (fullWeekIds.length > 0) return { ok: false, reason: "weeks_full", fullWeekIds };
  if (closedWeekIds.length > 0) return { ok: false, reason: "weeks_closed", closedWeekIds };

  await client.query(`UPDATE registration_spots SET status = 'active' WHERE registration_id = $1 AND status = 'cancelled'`, [
    registrationId,
  ]);
  return { ok: true, reinstatedWeekIds: [...needed.keys()].sort() };
}

// -------------------------------------------------------------------------------------
// The parent's report
// -------------------------------------------------------------------------------------

export type ReportPaymentResult =
  | { ok: true; alreadyReported: boolean; reviewDueAt: string }
  | { ok: false; reason: "not_found" | "already_paid" | "released" | "window_closed" | "report_unavailable" };

// The parent's "I've Sent My Payment". It moves the registration to payment_reported and
// starts the 48-hour review. It proves nothing: only an administrator's verification can
// make it paid. Accepted only while the reservation still holds its spots and its hold
// (plus the report allowance) has not ended. A contact with too many recent "payment not
// received" releases cannot report (the reservation still holds for its 12 hours).
export async function reportPayment(registrationId: string, now?: Date): Promise<ReportPaymentResult> {
  return inTransaction<ReportPaymentResult>(async (client) => {
    const { rows } = await client.query(
      `SELECT status, hold_expires_at, review_due_at, email, primary_phone,
              COALESCE($2::timestamptz, now()) AS now_ts
         FROM registrations WHERE id = $1 FOR UPDATE`,
      [registrationId, now ?? null]
    );
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    const row = rows[0];
    const nowTs = new Date(row.now_ts as string);
    if (row.status === "paid") return { ok: false, reason: "already_paid" };
    if (row.status === "payment_reported") {
      return { ok: true, alreadyReported: true, reviewDueAt: new Date(row.review_due_at as string).toISOString() };
    }
    if (row.status !== "pending_payment") return { ok: false, reason: "released" };
    if (new Date(row.hold_expires_at as string).getTime() < nowTs.getTime()) {
      return { ok: false, reason: "window_closed" };
    }

    const settings = await getCampSettings(client);
    const strikes = await client.query(
      `SELECT count(*)::int AS n FROM contact_strikes
        WHERE (email_key = $1 OR ($2 <> '' AND phone_key = $2))
          AND created_at > $3::timestamptz - make_interval(days => $4)`,
      [emailKey(row.email as string), phoneKey(row.primary_phone as string), nowTs, settings.strikeWindowDays]
    );
    if ((strikes.rows[0].n as number) >= settings.strikeLimit) return { ok: false, reason: "report_unavailable" };

    const updated = await client.query(
      `UPDATE registrations
          SET status = 'payment_reported', payment_reported_at = $2::timestamptz,
              review_due_at = $2::timestamptz + make_interval(hours => $3)
        WHERE id = $1 RETURNING review_due_at`,
      [registrationId, nowTs, settings.reviewHours]
    );
    const reviewDueAt = new Date(updated.rows[0].review_due_at as string).toISOString();
    await writeAudit(client, "payment_reported", registrationId, { reviewDueAt }, "parent");
    return { ok: true, alreadyReported: false, reviewDueAt };
  });
}

// -------------------------------------------------------------------------------------
// The 12-hour release (automatic)
// -------------------------------------------------------------------------------------

// Releases reservations whose hold has ended WITHOUT a payment report, freeing their
// spots. Only registrations still "Awaiting Payment" with a hold in the past qualify. A
// reported registration is a different status and is never touched here, however old
// (and the database refuses to record an expiry against a reported registration). Each
// release is its own transaction that re-checks the conditions under the registration's
// row lock, so a report or confirmation a moment earlier always wins the race.
export async function releaseExpiredReservations(now?: Date): Promise<{ releasedRegistrationIds: string[] }> {
  const { rows } = await getPool().query(
    `SELECT id FROM registrations
      WHERE status = 'pending_payment' AND payment_reported_at IS NULL
        AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($1::timestamptz, now())
      ORDER BY hold_expires_at, id`,
    [now ?? null]
  );
  const releasedRegistrationIds: string[] = [];
  for (const { id } of rows as { id: string }[]) {
    const released = await inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id FROM registrations
          WHERE id = $1 AND status = 'pending_payment' AND payment_reported_at IS NULL
            AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($2::timestamptz, now())
          FOR UPDATE`,
        [id, now ?? null]
      );
      if (locked.rows.length === 0) return false;
      const releasedWeekIds = await releaseSpotsTx(client, id);
      await client.query(
        `UPDATE registrations
            SET status = 'cancelled', cancelled_at = now(),
                cancelled_reason = 'Payment window ended with no payment report',
                release_reason = 'expired_unpaid'
          WHERE id = $1`,
        [id]
      );
      await writeAudit(client, "release_expired", id, { releasedWeekIds }, "system");
      // The family is told, with the reply-if-you-paid safety net. Recorded with the release,
      // so it is sent (and retried) whichever page or job happened to do the releasing.
      await enqueueEmail(client, "parent_release", id);
      return true;
    });
    if (released) releasedRegistrationIds.push(id);
  }
  return { releasedRegistrationIds };
}

// -------------------------------------------------------------------------------------
// Administrator actions
// -------------------------------------------------------------------------------------

export type ConfirmPaymentInput = {
  amountReceivedCents: number;
  depositAt: Date;
  method: "reference_matched" | "name_amount_time";
  referenceEntered?: string; // required for reference_matched
  bankConfirmationNumber?: string;
  note?: string; // required (8+ characters) for name_amount_time
};

export type ConfirmPaymentResult =
  | { ok: true; registration: RegistrationDetail; alreadyPaid: boolean; reinstatedWeekIds: string[]; paidOnTime: boolean }
  | { ok: false; reason: "not_found" | "refunded" | "no_spots" | "invalid_input"; message?: string }
  | { ok: false; reason: "amount_mismatch"; expectedCents: number; receivedCents: number }
  | { ok: false; reason: "reference_mismatch" }
  | { ok: false; reason: "deposit_in_future" | "deposit_before_reservation" | "confirmation_number_in_use" }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[]; paidOnTime: boolean }
  | { ok: false; reason: "weeks_closed"; closedWeekIds: string[] };

// The ONLY code path that sets a registration to 'paid'. Called only from the
// authenticated admin route, after the administrator has seen the deposit in the bank
// account. A parent's report never reaches this. It requires the amount received to equal
// the amount due, the reference (or a documented name/amount/time match), and the deposit
// time; the database refuses paid without that record.
//
//   * Already paid                       -> no-op (idempotent).
//   * Awaiting / Payment Reported / overdue -> its spots are already held; becomes paid.
//   * Released (cancelled)               -> the spots are first re-reserved with a capacity
//     check, all-or-nothing. If any week is full or closed it is refused and nothing
//     changes. Never a plain status flip.
export async function confirmRegistrationPayment(
  registrationId: string,
  input: ConfirmPaymentInput
): Promise<ConfirmPaymentResult> {
  if (!Number.isInteger(input.amountReceivedCents) || input.amountReceivedCents < 0) {
    return { ok: false, reason: "invalid_input", message: "The amount received must be a whole number of cents." };
  }
  if (!(input.depositAt instanceof Date) || Number.isNaN(input.depositAt.getTime())) {
    return { ok: false, reason: "invalid_input", message: "Enter the date and time of the deposit." };
  }
  const note = input.note?.trim() ?? "";
  if (input.method === "name_amount_time" && note.length < 8) {
    return { ok: false, reason: "invalid_input", message: "Add a note saying how you matched the deposit (name, amount and time)." };
  }
  const bankNumber = input.bankConfirmationNumber?.trim().toUpperCase() || null;
  if (bankNumber && !/^[A-Z0-9-]{4,40}$/.test(bankNumber)) {
    return { ok: false, reason: "invalid_input", message: "The bank confirmation number should be 4 to 40 letters and digits." };
  }

  try {
    return await inTransaction<ConfirmPaymentResult>(async (client) => {
      const { rows } = await client.query(
        `SELECT status, reference_code, amount_due_cents, created_at, hold_ends_at_initial, release_reason,
                now() AS now_ts
           FROM registrations WHERE id = $1 FOR UPDATE`,
        [registrationId]
      );
      if (rows.length === 0) return { ok: false, reason: "not_found" };
      const previous = rows[0];

      if (previous.status === "paid") {
        const registration = (await loadRegistration(client, registrationId))!;
        return { ok: true, registration, alreadyPaid: true, reinstatedWeekIds: [], paidOnTime: Boolean(registration.paidOnTime) };
      }
      if (previous.status === "refunded") return { ok: false, reason: "refunded" };

      if (input.amountReceivedCents !== previous.amount_due_cents) {
        return { ok: false, reason: "amount_mismatch", expectedCents: previous.amount_due_cents, receivedCents: input.amountReceivedCents };
      }
      if (input.method === "reference_matched") {
        if (!input.referenceEntered || normalizeReference(input.referenceEntered) !== normalizeReference(previous.reference_code)) {
          return { ok: false, reason: "reference_mismatch" };
        }
      }
      const nowTs = new Date(previous.now_ts as string);
      if (input.depositAt.getTime() > nowTs.getTime() + 5 * 60_000) return { ok: false, reason: "deposit_in_future" };
      if (input.depositAt.getTime() < new Date(previous.created_at as string).getTime() - 10 * 60_000) {
        return { ok: false, reason: "deposit_before_reservation" };
      }
      const paidOnTime = input.depositAt.getTime() <= new Date(previous.hold_ends_at_initial as string).getTime();

      let reinstatedWeekIds: string[] = [];
      if (previous.status === "cancelled") {
        const reinstated = await reinstateSpotsTx(client, registrationId);
        if (!reinstated.ok) {
          if (reinstated.reason === "weeks_full") return { ...reinstated, paidOnTime };
          return reinstated;
        }
        reinstatedWeekIds = reinstated.reinstatedWeekIds;
      }

      await client.query(
        `UPDATE registrations
            SET status = 'paid', paid_at = now(), hold_expires_at = NULL,
                cancelled_at = NULL, cancelled_reason = NULL, release_reason = NULL,
                verified_at = now(), verification_method = $2, verified_reference = $3,
                amount_received_cents = $4, deposit_at = $5, bank_confirmation_number = $6,
                verification_note = $7, paid_on_time = $8
          WHERE id = $1`,
        [
          registrationId,
          input.method,
          // A matched reference is recorded in its normal form (GD-XXXXXX); anything typed
          // alongside a name/amount/time match is kept as the administrator entered it.
          input.method === "reference_matched"
            ? previous.reference_code
            : input.referenceEntered
              ? normalizeReference(input.referenceEntered)
              : null,
          input.amountReceivedCents,
          input.depositAt,
          bankNumber,
          note || null,
          paidOnTime,
        ]
      );
      // A claim that proved genuine clears any strike its release had caused.
      await client.query(`DELETE FROM contact_strikes WHERE registration_id = $1`, [registrationId]);
      await writeAudit(
        client,
        reinstatedWeekIds.length > 0 ? "reinstate_and_confirm_payment" : "confirm_payment",
        registrationId,
        {
          previousStatus: previous.status,
          previousReleaseReason: previous.release_reason,
          reinstatedWeekIds,
          method: input.method,
          amountReceivedCents: input.amountReceivedCents,
          depositAt: input.depositAt.toISOString(),
          paidOnTime,
          bankConfirmationNumber: bankNumber,
          note: note || undefined,
        }
      );

      // The confirmation the family is owed, recorded in the same transaction as the payment.
      await enqueueEmail(client, "parent_confirmation", registrationId);

      const registration = (await loadRegistration(client, registrationId))!;
      return { ok: true, registration, alreadyPaid: false, reinstatedWeekIds, paidOnTime };
    });
  } catch (err) {
    const fullWeek = capacityViolationWeek(err);
    if (fullWeek) return { ok: false, reason: "weeks_full", fullWeekIds: [fullWeek], paidOnTime: false };
    if (isUniqueViolation(err) && String((err as { constraint?: string }).constraint) === "idx_registrations_bank_confirmation") {
      return { ok: false, reason: "confirmation_number_in_use" };
    }
    throw err;
  }
}

export type ExtensionResult =
  | { ok: true; reviewDueAt: string; extensionCount: number; extensionsLeft: number }
  | { ok: false; reason: "not_found" | "not_reported" | "too_many_extensions" | "invalid_input"; message?: string };

// A time-limited extension of the verification review, granted by an administrator. The
// new review time is the later of the current one and now, plus the hours. Counted and
// capped; the database refuses any other way of moving the review time later.
export async function grantReviewExtension(
  registrationId: string,
  input: { hours: number; note: string }
): Promise<ExtensionResult> {
  const note = input.note.trim();
  if (note.length < 5) return { ok: false, reason: "invalid_input", message: "Add a short note saying why." };
  return inTransaction<ExtensionResult>(async (client) => {
    const settings = await getCampSettings(client);
    if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > settings.extensionMaxHours) {
      return { ok: false, reason: "invalid_input", message: `An extension is 1 to ${settings.extensionMaxHours} hours.` };
    }
    const { rows } = await client.query(
      `SELECT status, review_due_at, extension_count FROM registrations WHERE id = $1 FOR UPDATE`,
      [registrationId]
    );
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows[0].status !== "payment_reported") return { ok: false, reason: "not_reported" };
    if ((rows[0].extension_count as number) >= settings.extensionMaxCount) return { ok: false, reason: "too_many_extensions" };

    const updated = await client.query(
      `UPDATE registrations
          SET review_due_at = GREATEST(review_due_at, now()) + make_interval(hours => $2),
              extension_count = extension_count + 1
        WHERE id = $1 RETURNING review_due_at, extension_count`,
      [registrationId, input.hours]
    );
    const reviewDueAt = new Date(updated.rows[0].review_due_at as string).toISOString();
    const extensionCount = updated.rows[0].extension_count as number;
    await writeAudit(client, "extend_review", registrationId, {
      hours: input.hours,
      note,
      previousReviewDueAt: new Date(rows[0].review_due_at as string).toISOString(),
      reviewDueAt,
      extensionNumber: extensionCount,
    });
    return { ok: true, reviewDueAt, extensionCount, extensionsLeft: settings.extensionMaxCount - extensionCount };
  });
}

// Releases a registration (the administrator's "Release" / "payment not received" or a
// plain cancel) and frees every spot it holds, in one transaction, with an audit entry. A
// registration that is already cancelled or refunded is left alone (no-op). Releasing a
// REPORTED claim as "not_received" adds a strike against that contact.
export async function cancelRegistration(
  registrationId: string,
  reason: string,
  opts: { releaseReason?: "owner_cancelled" | "not_received" } = {}
): Promise<{ ok: boolean; releasedWeekIds: string[] }> {
  const releaseReason = opts.releaseReason ?? "owner_cancelled";
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT status, email, primary_phone FROM registrations WHERE id = $1 FOR UPDATE`,
      [registrationId]
    );
    if (rows.length === 0) return { ok: false, releasedWeekIds: [] };
    const row = rows[0];
    if (row.status === "cancelled" || row.status === "refunded") return { ok: true, releasedWeekIds: [] };

    const releasedWeekIds = await releaseSpotsTx(client, registrationId);
    await client.query(
      `UPDATE registrations
          SET status = 'cancelled', cancelled_at = now(), cancelled_reason = $2,
              release_reason = $3, hold_expires_at = NULL
        WHERE id = $1`,
      [registrationId, reason, releaseReason]
    );
    let strike = false;
    if (row.status === "payment_reported" && releaseReason === "not_received") {
      await client.query(`INSERT INTO contact_strikes (registration_id, email_key, phone_key) VALUES ($1, $2, $3)`, [
        registrationId,
        emailKey(row.email as string),
        phoneKey(row.primary_phone as string),
      ]);
      strike = true;
    }
    await writeAudit(client, "cancel_registration", registrationId, {
      reason,
      releaseReason,
      previousStatus: row.status,
      releasedWeekIds,
      strike,
    });
    return { ok: true, releasedWeekIds };
  });
}

export type ReinstateResult =
  | { ok: true; registration: RegistrationDetail; reinstatedWeekIds: string[] }
  | { ok: false; reason: "not_found" | "not_released" | "no_spots" | "too_many_reinstatements" }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[] }
  | { ok: false; reason: "weeks_closed"; closedWeekIds: string[] };

// Takes a released registration's spots back, capacity-checked and all-or-nothing, and
// starts a fresh BOUNDED clock: a new 12-hour hold, or a new 48-hour review if the parent
// had reported. Capped at 2 reinstatements. (To restore a spot for a verified deposit,
// use confirmRegistrationPayment instead.)
export async function reinstateRegistration(registrationId: string): Promise<ReinstateResult> {
  try {
    return await inTransaction<ReinstateResult>(async (client) => {
      const { rows } = await client.query(
        `SELECT status, payment_reported_at, reinstate_count FROM registrations WHERE id = $1 FOR UPDATE`,
        [registrationId]
      );
      if (rows.length === 0) return { ok: false, reason: "not_found" };
      const row = rows[0];
      if (row.status !== "cancelled") return { ok: false, reason: "not_released" };
      if ((row.reinstate_count as number) >= 2) return { ok: false, reason: "too_many_reinstatements" };

      const reinstated = await reinstateSpotsTx(client, registrationId);
      if (!reinstated.ok) return reinstated;

      const settings = await getCampSettings(client);
      if (row.payment_reported_at) {
        await client.query(
          `UPDATE registrations
              SET status = 'payment_reported', review_due_at = now() + make_interval(hours => $2),
                  hold_expires_at = NULL, reinstate_count = reinstate_count + 1,
                  cancelled_at = NULL, cancelled_reason = NULL, release_reason = NULL
            WHERE id = $1`,
          [registrationId, settings.reviewHours]
        );
      } else {
        await client.query(
          `UPDATE registrations
              SET status = 'pending_payment', hold_expires_at = now() + make_interval(mins => $2),
                  reinstate_count = reinstate_count + 1,
                  cancelled_at = NULL, cancelled_reason = NULL, release_reason = NULL
            WHERE id = $1`,
          [registrationId, settings.holdHours * 60 + settings.reportAllowanceMinutes]
        );
      }
      await writeAudit(client, "reinstate_registration", registrationId, {
        reinstatedWeekIds: reinstated.reinstatedWeekIds,
        backToStatus: row.payment_reported_at ? "payment_reported" : "pending_payment",
        reinstatement: (row.reinstate_count as number) + 1,
      });
      const registration = (await loadRegistration(client, registrationId))!;
      return { ok: true, registration, reinstatedWeekIds: reinstated.reinstatedWeekIds };
    });
  } catch (err) {
    const fullWeek = capacityViolationWeek(err);
    if (fullWeek) return { ok: false, reason: "weeks_full", fullWeekIds: [fullWeek] };
    throw err;
  }
}

// -------------------------------------------------------------------------------------
// Capacity (30 standard; up to 33 only with a recorded administrator authorization)
// -------------------------------------------------------------------------------------

export type AdjustCapacityResult =
  | { ok: true }
  | { ok: false; reason: "below_taken"; takenCount: number }
  | { ok: false; reason: "needs_authorization" };

// Sets a week's capacity to 30 or fewer. Anything above 30 must go through
// authorizeWeekCapacity, so it is recorded with a reason.
export async function adjustWeekCapacity(weekId: string, newMaxCapacity: number): Promise<AdjustCapacityResult> {
  if (newMaxCapacity > CAPACITY_STANDARD) return { ok: false, reason: "needs_authorization" };
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT taken_count FROM camp_weeks WHERE id = $1 FOR UPDATE`, [weekId]);
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error(`Unknown week id: ${weekId}`);
    }
    const takenCount = rows[0].taken_count as number;
    if (newMaxCapacity < takenCount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "below_taken", takenCount };
    }
    await client.query(`UPDATE camp_weeks SET max_capacity = $2, updated_at = now() WHERE id = $1`, [weekId, newMaxCapacity]);
    await writeAudit(client, "adjust_capacity", weekId, { newMaxCapacity, previousTakenCount: takenCount }, "owner", "camp_week");
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type AuthorizeCapacityResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input"; message: string }
  | { ok: false; reason: "unknown_week" };

// Raises a week to 31, 32 or 33, with a recorded reason. The authorization row and the
// capacity change are one transaction; the database refuses a raise above 30 without it.
export async function authorizeWeekCapacity(
  weekId: string,
  newMaxCapacity: number,
  reason: string
): Promise<AuthorizeCapacityResult> {
  const trimmed = reason.trim();
  if (!Number.isInteger(newMaxCapacity) || newMaxCapacity <= CAPACITY_STANDARD || newMaxCapacity > CAPACITY_CEILING) {
    return { ok: false, reason: "invalid_input", message: `An authorized capacity is ${CAPACITY_STANDARD + 1} to ${CAPACITY_CEILING}.` };
  }
  if (trimmed.length < 10) {
    return { ok: false, reason: "invalid_input", message: "Give a reason of at least 10 characters (why this week needs the extra spots)." };
  }
  return inTransaction<AuthorizeCapacityResult>(async (client) => {
    const { rows } = await client.query(`SELECT max_capacity FROM camp_weeks WHERE id = $1 FOR UPDATE`, [weekId]);
    if (rows.length === 0) return { ok: false, reason: "unknown_week" };
    await client.query(
      `INSERT INTO capacity_authorizations (week_id, authorized_capacity, reason) VALUES ($1, $2, $3)`,
      [weekId, newMaxCapacity, trimmed]
    );
    await client.query(`UPDATE camp_weeks SET max_capacity = $2, updated_at = now() WHERE id = $1`, [weekId, newMaxCapacity]);
    await writeAudit(
      client,
      "authorize_capacity",
      weekId,
      { previousMaxCapacity: rows[0].max_capacity, newMaxCapacity, reason: trimmed },
      "owner",
      "camp_week"
    );
    return { ok: true };
  });
}

export async function setWeekOpen(weekId: string, isOpen: boolean): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE camp_weeks SET is_open = $2, updated_at = now() WHERE id = $1`, [weekId, isOpen]);
  await writeAudit(pool, isOpen ? "reopen_week" : "close_week", weekId, {}, "owner", "camp_week");
}

export async function setWeekPrice(weekId: string, priceCents: number): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE camp_weeks SET price_cents = $2, updated_at = now() WHERE id = $1`, [weekId, priceCents]);
  await writeAudit(pool, "adjust_price", weekId, { priceCents }, "owner", "camp_week");
}

// -------------------------------------------------------------------------------------
// The administrators' review queue
// -------------------------------------------------------------------------------------

export type QueueItem = {
  id: string;
  reference: string;
  status: string;
  parentName: string;
  email: string;
  primaryPhone: string;
  childNames: string[];
  weekIds: string[];
  heldSpots: number;
  amountDueCents: number;
  createdAt: string;
  holdExpiresAt: string | null;
  paymentReportedAt: string | null;
  reviewDueAt: string | null;
  overdue: boolean;
  overdueHours: number; // whole hours past the review time (0 if not overdue)
  extensionCount: number;
  reinstateCount: number;
  releaseReason: string | null;
  cancelledAt: string | null;
};

export type PaymentQueue = {
  generatedAt: string;
  reported: QueueItem[]; // payment reported, most overdue first
  awaiting: QueueItem[]; // unreported holds, soonest to expire first
  released: QueueItem[]; // released in the last 14 days, newest first (late deposits land here)
  overdueCount: number;
  blockedSpots: number; // spots held by overdue registrations
  longestOverdueHours: number;
  settings: Pick<CampSettings, "holdHours" | "reviewHours" | "extensionMaxCount" | "extensionDefaultHours" | "extensionMaxHours">;
};

const QUEUE_SELECT = `
  SELECT r.id, r.reference_code, r.status, r.parent_name, r.email, r.primary_phone, r.amount_due_cents,
         r.created_at, r.hold_expires_at, r.payment_reported_at, r.review_due_at, r.extension_count,
         r.reinstate_count, r.release_reason, r.cancelled_at,
         (SELECT array_agg(c.full_name ORDER BY c.full_name) FROM children c WHERE c.registration_id = r.id) AS child_names,
         (SELECT array_agg(DISTINCT s.week_id ORDER BY s.week_id) FROM registration_spots s WHERE s.registration_id = r.id) AS week_ids,
         (SELECT count(*)::int FROM registration_spots s WHERE s.registration_id = r.id AND s.status = 'active') AS held_spots
    FROM registrations r`;

function toQueueItem(row: Record<string, unknown>, nowMs: number): QueueItem {
  const reviewDueAt = isoOrNull(row.review_due_at);
  const overdueMs = row.status === "payment_reported" && reviewDueAt ? nowMs - new Date(reviewDueAt).getTime() : -1;
  return {
    id: row.id as string,
    reference: row.reference_code as string,
    status: row.status as string,
    parentName: row.parent_name as string,
    email: row.email as string,
    primaryPhone: row.primary_phone as string,
    childNames: (row.child_names as string[] | null) ?? [],
    weekIds: (row.week_ids as string[] | null) ?? [],
    heldSpots: row.held_spots as number,
    amountDueCents: row.amount_due_cents as number,
    createdAt: new Date(row.created_at as string).toISOString(),
    holdExpiresAt: isoOrNull(row.hold_expires_at),
    paymentReportedAt: isoOrNull(row.payment_reported_at),
    reviewDueAt,
    overdue: overdueMs > 0,
    overdueHours: overdueMs > 0 ? Math.floor(overdueMs / 3_600_000) : 0,
    extensionCount: row.extension_count as number,
    reinstateCount: row.reinstate_count as number,
    releaseReason: (row.release_reason as string | null) ?? null,
    cancelledAt: isoOrNull(row.cancelled_at),
  };
}

export async function getPaymentQueue(now?: Date): Promise<PaymentQueue> {
  await releaseExpiredReservations(now);
  const pool = getPool();
  const settings = await getCampSettings(pool);
  const nowRow = await pool.query(`SELECT COALESCE($1::timestamptz, now()) AS now_ts`, [now ?? null]);
  const nowTs = new Date(nowRow.rows[0].now_ts as string);

  const [reported, awaiting, released] = await Promise.all([
    pool.query(`${QUEUE_SELECT} WHERE r.status = 'payment_reported' ORDER BY r.review_due_at, r.id`),
    pool.query(`${QUEUE_SELECT} WHERE r.status = 'pending_payment' ORDER BY r.hold_expires_at, r.id`),
    pool.query(
      `${QUEUE_SELECT} WHERE r.status = 'cancelled' AND r.release_reason IN ('expired_unpaid', 'not_received')
         AND r.cancelled_at > $1::timestamptz - interval '14 days' ORDER BY r.cancelled_at DESC, r.id LIMIT 100`,
      [nowTs]
    ),
  ]);
  const reportedItems = reported.rows.map((r) => toQueueItem(r, nowTs.getTime()));
  const overdue = reportedItems.filter((i) => i.overdue);
  return {
    generatedAt: nowTs.toISOString(),
    reported: reportedItems,
    awaiting: awaiting.rows.map((r) => toQueueItem(r, nowTs.getTime())),
    released: released.rows.map((r) => toQueueItem(r, nowTs.getTime())),
    overdueCount: overdue.length,
    blockedSpots: overdue.reduce((sum, i) => sum + i.heldSpots, 0),
    longestOverdueHours: overdue.reduce((max, i) => Math.max(max, i.overdueHours), 0),
    settings: {
      holdHours: settings.holdHours,
      reviewHours: settings.reviewHours,
      extensionMaxCount: settings.extensionMaxCount,
      extensionDefaultHours: settings.extensionDefaultHours,
      extensionMaxHours: settings.extensionMaxHours,
    },
  };
}

// -------------------------------------------------------------------------------------
// Rosters, check-in, search, audit
// -------------------------------------------------------------------------------------

export type RosterRow = {
  spotId: string;
  registrationId: string;
  childId: string;
  childName: string;
  age: string;
  healthInfo: string;
  parentName: string;
  primaryPhone: string;
  secondaryPhone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  status: string;
  checkedInAt: string | null;
};

export async function getWeekRoster(weekId: string): Promise<RosterRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT rs.id as spot_id, rs.registration_id, rs.checked_in_at,
            c.id as child_id, c.full_name, c.age, c.health_info,
            r.parent_name, r.primary_phone, r.secondary_phone,
            r.emergency_name, r.emergency_relationship, r.emergency_phone, r.status
     FROM registration_spots rs
     JOIN children c ON c.id = rs.child_id
     JOIN registrations r ON r.id = rs.registration_id
     WHERE rs.week_id = $1 AND rs.status = 'active'
     ORDER BY c.full_name`,
    [weekId]
  );
  return rows.map((row) => ({
    spotId: row.spot_id,
    registrationId: row.registration_id,
    childId: row.child_id,
    childName: row.full_name,
    age: row.age,
    healthInfo: row.health_info,
    parentName: row.parent_name,
    primaryPhone: row.primary_phone,
    secondaryPhone: row.secondary_phone,
    emergencyName: row.emergency_name,
    emergencyRelationship: row.emergency_relationship,
    emergencyPhone: row.emergency_phone,
    status: row.status,
    checkedInAt: row.checked_in_at,
  }));
}

export async function markSpotCheckedIn(spotId: string, checkedIn: boolean): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE registration_spots SET checked_in_at = $2 WHERE id = $1`, [
    spotId,
    checkedIn ? new Date().toISOString() : null,
  ]);
}

export async function searchRegistrations(query: string): Promise<RegistrationDetail[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT r.id, r.created_at FROM registrations r
     LEFT JOIN children c ON c.registration_id = r.id
     WHERE r.parent_name ILIKE $1 OR c.full_name ILIKE $1 OR r.email ILIKE $1 OR r.reference_code ILIKE $1
     ORDER BY r.created_at DESC LIMIT 50`,
    [`%${query.replace(/[\\%_]/g, "\\$&")}%`]
  );
  const results: RegistrationDetail[] = [];
  for (const row of rows) {
    const detail = await loadRegistration(pool, row.id);
    if (detail) results.push(detail);
  }
  return results;
}

export async function getAuditLog(limit = 100): Promise<
  { id: string; action: string; targetType: string; targetId: string; actor: string; details: unknown; createdAt: string }[]
> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, action, target_type, target_id, actor, details, created_at
     FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    actor: r.actor,
    details: r.details,
    createdAt: r.created_at,
  }));
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
