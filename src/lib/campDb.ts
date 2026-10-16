import { randomBytes, randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { capacityViolationWeek, getPool, isUniqueViolation } from "./db";

// Server-only. This is the authoritative store for camp-week capacity and
// registrations — the "never more than 30 confirmed or reserved spots per
// week" rule is enforced inside real Postgres transactions, and since
// db/migrations/003_capacity_integrity.sql by the database itself, not just by
// this file. Google Sheets (src/lib/googleSheets.ts) remains a synchronized
// reporting copy only; nothing here ever reads it to decide whether a spot is
// available.
//
// How capacity is enforced:
//   * camp_weeks.taken_count is maintained by a trigger on registration_spots.
//     Activating a spot (new registration, reinstatement, anything) takes the
//     week's row lock and is refused if the week is full; concurrent attempts
//     queue on that lock and each re-checks against the committed count. This
//     code therefore NEVER writes taken_count.
//   * Deferred checks at COMMIT refuse any transaction that leaves a counter
//     out of step with the active spots, or a pending/paid registration
//     without all of its spots, or a cancelled/refunded registration holding
//     one. So nothing — including a bug in this file — can confirm a
//     registration without real allocated capacity.
//   * This file still takes the week locks up front, in one sorted order, and
//     checks room first. That gives callers clean "week X is full" answers and
//     keeps concurrent multi-week transactions from deadlocking; the database
//     is the backstop, not the first line.
//
// Lock order everywhere: registration row first, then camp_weeks rows in
// sorted id order.

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

async function writeAudit(
  client: PoolClient,
  action: string,
  registrationId: string,
  details: Record<string, unknown>,
  actor: "owner" | "system" | "parent" = "owner"
): Promise<void> {
  await client.query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details, actor)
     VALUES ($1, 'registration', $2, $3, $4)`,
    [action, registrationId, JSON.stringify(details), actor]
  );
}

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
      confirmToken: string;
      totalPriceCents: number;
      alreadyExisted: boolean;
    }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[] }
  | { ok: false; reason: "weeks_unavailable"; unavailableWeekIds: string[] };

// Reserves spots for every (child, week) combination in a single
// all-or-nothing transaction: if any requested week can't fit every child
// in this submission, nothing is written and the whole request is
// rejected (matching the existing UX — a family isn't left half-booked).
export async function reserveRegistration(input: ReserveRegistrationInput): Promise<ReserveResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, confirm_token, total_price_cents FROM registrations WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      const row = existing.rows[0];
      return {
        ok: true,
        registrationId: row.id,
        confirmToken: row.confirm_token,
        totalPriceCents: row.total_price_cents,
        alreadyExisted: true,
      };
    }

    const spotsPerWeek = input.children.length;
    const sortedWeekIds = [...new Set(input.weekIds)].sort();

    let totalPriceCents = 0;
    const fullWeekIds: string[] = [];
    const unavailableWeekIds: string[] = [];
    const priceByWeek = new Map<string, number>();

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
      priceByWeek.set(weekId, week.price_cents);
      totalPriceCents += week.price_cents * spotsPerWeek;
    }

    if (unavailableWeekIds.length > 0 || fullWeekIds.length > 0) {
      await client.query("ROLLBACK");
      if (fullWeekIds.length > 0) return { ok: false, reason: "weeks_full", fullWeekIds };
      return { ok: false, reason: "weeks_unavailable", unavailableWeekIds };
    }

    // No taken_count write here: the registration_spots trigger counts each
    // spot as it is inserted below (and refuses if a week would overflow).

    const confirmToken = randomBytes(24).toString("hex");
    const regResult = await client.query(
      `INSERT INTO registrations
         (idempotency_key, parent_name, email, primary_phone, secondary_phone,
          emergency_name, emergency_relationship, emergency_phone,
          code_of_conduct_accepted, consent_accepted, confirm_token, total_price_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
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
        confirmToken,
        totalPriceCents,
      ]
    );
    const registrationId = regResult.rows[0].id as string;

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

    await client.query("COMMIT");
    return { ok: true, registrationId, confirmToken, totalPriceCents, alreadyExisted: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Defence in depth: the week locks above should make this unreachable, but
    // if the database ever refuses a spot as over capacity, answer "full"
    // instead of failing the request.
    const fullWeek = capacityViolationWeek(err);
    if (fullWeek) return { ok: false, reason: "weeks_full", fullWeekIds: [fullWeek] };
    if (isUniqueViolation(err)) {
      const retry = await pool.query(
        `SELECT id, confirm_token, total_price_cents FROM registrations WHERE idempotency_key = $1`,
        [input.idempotencyKey]
      );
      if (retry.rows.length > 0) {
        const row = retry.rows[0];
        return {
          ok: true,
          registrationId: row.id,
          confirmToken: row.confirm_token,
          totalPriceCents: row.total_price_cents,
          alreadyExisted: true,
        };
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

export type RegistrationDetail = {
  id: string;
  parentName: string;
  email: string;
  primaryPhone: string;
  secondaryPhone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  status: string;
  confirmToken: string;
  totalPriceCents: number;
  paidAt: string | null;
  createdAt: string;
  // The parent's "I've sent it" marker (ISO time) — a marker only, never a status.
  paymentReportedAt: string | null;
  // When an unreported reservation may be released (null = it does not expire).
  holdExpiresAt: string | null;
  // Why a reservation was released ("expired_unpaid", "owner_cancelled"), if it was.
  releaseReason: string | null;
  children: { id: string; fullName: string; dateOfBirth: string; age: string; healthInfo: string }[];
  // Weeks this registration currently HOLDS a spot in (active spots only).
  weekIds: string[];
  // Every week it has spots in, held or released — what a reinstatement would restore.
  allWeekIds: string[];
};

function isoOrNull(value: unknown): string | null {
  return value ? new Date(value as string).toISOString() : null;
}

async function loadRegistration(client: Pool | PoolClient, id: string): Promise<RegistrationDetail | null> {
  const regRes = await client.query(`SELECT * FROM registrations WHERE id = $1`, [id]);
  if (regRes.rows.length === 0) return null;
  const childRes = await client.query(`SELECT * FROM children WHERE registration_id = $1`, [id]);
  const spotRes = await client.query(
    `SELECT week_id, bool_or(status = 'active') AS held
       FROM registration_spots WHERE registration_id = $1 GROUP BY week_id ORDER BY week_id`,
    [id]
  );
  const row = regRes.rows[0];
  const detail: RegistrationDetail = {
    id: row.id,
    parentName: row.parent_name,
    email: row.email,
    primaryPhone: row.primary_phone,
    secondaryPhone: row.secondary_phone,
    emergencyName: row.emergency_name,
    emergencyRelationship: row.emergency_relationship,
    emergencyPhone: row.emergency_phone,
    status: row.status,
    confirmToken: row.confirm_token,
    totalPriceCents: row.total_price_cents,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    paymentReportedAt: isoOrNull(row.payment_reported_at),
    holdExpiresAt: isoOrNull(row.hold_expires_at),
    releaseReason: row.release_reason ?? null,
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
  return detail;
}

export async function getRegistrationById(id: string): Promise<RegistrationDetail | null> {
  const pool = getPool();
  return loadRegistration(pool, id);
}

// Releases every spot a registration holds (status 'active' -> 'cancelled'),
// freeing that capacity. The registration row must already be locked by the
// caller; this takes the week locks (sorted) itself. The database trigger does
// the counting. Returns the weeks that were released.
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

// Re-reserves every released spot of a registration, all-or-nothing and
// capacity-checked. The registration row must already be locked by the caller.
// Refuses (writing nothing) if any needed week is full or closed. This is the
// single code path that takes capacity back, shared by Reinstate and by
// Confirm-on-a-released-registration.
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

export type ConfirmPaymentResult =
  | { ok: true; registration: RegistrationDetail; alreadyPaid: boolean; reinstatedWeekIds: string[] }
  | { ok: false; reason: "not_found" | "refunded" | "no_spots" }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[] }
  | { ok: false; reason: "weeks_closed"; closedWeekIds: string[] };

// The ONLY code path that sets a registration to 'paid'. Called only from the
// authenticated admin route, after the owner has seen the deposit in their bank.
//
//   * Already paid       -> no-op (idempotent), reported as alreadyPaid.
//   * Awaiting payment   -> its spots are already held; becomes paid.
//   * Released           -> the spots are first re-reserved with a capacity
//     check (all-or-nothing). If any week is full or closed the whole thing is
//     refused and the registration stays released. Never a plain status flip.
//
// Whatever happens, the database re-verifies at COMMIT that a paid
// registration holds all of its spots and that no week is over capacity.
export async function confirmRegistrationPayment(
  registrationId: string,
  opts: { depositNote?: string } = {}
): Promise<ConfirmPaymentResult> {
  try {
    return await inTransaction<ConfirmPaymentResult>(async (client) => {
      const { rows } = await client.query(
        `SELECT status, cancelled_reason, release_reason FROM registrations WHERE id = $1 FOR UPDATE`,
        [registrationId]
      );
      if (rows.length === 0) return { ok: false, reason: "not_found" };
      const previous = rows[0] as { status: string; cancelled_reason: string | null; release_reason: string | null };

      if (previous.status === "paid") {
        const registration = (await loadRegistration(client, registrationId))!;
        return { ok: true, registration, alreadyPaid: true, reinstatedWeekIds: [] };
      }
      if (previous.status === "refunded") return { ok: false, reason: "refunded" };

      let reinstatedWeekIds: string[] = [];
      if (previous.status === "cancelled") {
        const reinstated = await reinstateSpotsTx(client, registrationId);
        if (!reinstated.ok) return reinstated;
        reinstatedWeekIds = reinstated.reinstatedWeekIds;
      }

      await client.query(
        `UPDATE registrations
            SET status = 'paid', paid_at = now(), hold_expires_at = NULL,
                cancelled_at = NULL, cancelled_reason = NULL, release_reason = NULL
          WHERE id = $1`,
        [registrationId]
      );
      await writeAudit(client, reinstatedWeekIds.length > 0 ? "reinstate_and_confirm_payment" : "confirm_payment", registrationId, {
        previousStatus: previous.status,
        previousReleaseReason: previous.release_reason,
        reinstatedWeekIds,
        depositNote: opts.depositNote?.trim() || undefined,
      });

      const registration = (await loadRegistration(client, registrationId))!;
      return { ok: true, registration, alreadyPaid: false, reinstatedWeekIds };
    });
  } catch (err) {
    const fullWeek = capacityViolationWeek(err);
    if (fullWeek) return { ok: false, reason: "weeks_full", fullWeekIds: [fullWeek] };
    throw err;
  }
}

export type ReinstateResult =
  | { ok: true; registration: RegistrationDetail; reinstatedWeekIds: string[] }
  | { ok: false; reason: "not_found" | "not_released" | "no_spots" }
  | { ok: false; reason: "weeks_full"; fullWeekIds: string[] }
  | { ok: false; reason: "weeks_closed"; closedWeekIds: string[] };

// Takes a released (cancelled) registration's spots back and returns it to
// "Awaiting payment", with the same capacity check and all-or-nothing rule as
// Confirm. It gets NO expiry (hold_expires_at is cleared): a reinstated
// reservation is only ever released again by the owner.
export async function reinstateRegistration(registrationId: string): Promise<ReinstateResult> {
  try {
    return await inTransaction<ReinstateResult>(async (client) => {
      const { rows } = await client.query(
        `SELECT status, cancelled_reason, release_reason FROM registrations WHERE id = $1 FOR UPDATE`,
        [registrationId]
      );
      if (rows.length === 0) return { ok: false, reason: "not_found" };
      const previous = rows[0] as { status: string; cancelled_reason: string | null; release_reason: string | null };
      if (previous.status !== "cancelled") return { ok: false, reason: "not_released" };

      const reinstated = await reinstateSpotsTx(client, registrationId);
      if (!reinstated.ok) return reinstated;

      await client.query(
        `UPDATE registrations
            SET status = 'pending_payment', hold_expires_at = NULL,
                cancelled_at = NULL, cancelled_reason = NULL, release_reason = NULL
          WHERE id = $1`,
        [registrationId]
      );
      await writeAudit(client, "reinstate_registration", registrationId, {
        previousReleaseReason: previous.release_reason,
        previousCancelledReason: previous.cancelled_reason,
        reinstatedWeekIds: reinstated.reinstatedWeekIds,
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

// Cancels a registration (the owner's "Not received" / cancel) and releases
// every spot it holds back to the weeks' capacity, in one transaction, with an
// audit entry. A registration that is already cancelled or refunded is left
// alone (no-op), so a repeat click changes nothing.
export async function cancelRegistration(
  registrationId: string,
  reason: string
): Promise<{ ok: boolean; releasedWeekIds: string[] }> {
  return inTransaction(async (client) => {
    const { rows } = await client.query(`SELECT status FROM registrations WHERE id = $1 FOR UPDATE`, [registrationId]);
    if (rows.length === 0) return { ok: false, releasedWeekIds: [] };
    if (rows[0].status === "cancelled" || rows[0].status === "refunded") return { ok: true, releasedWeekIds: [] };

    const releasedWeekIds = await releaseSpotsTx(client, registrationId);
    await client.query(
      `UPDATE registrations
          SET status = 'cancelled', cancelled_at = now(), cancelled_reason = $2,
              release_reason = 'owner_cancelled', hold_expires_at = NULL
        WHERE id = $1`,
      [registrationId, reason]
    );
    await writeAudit(client, "cancel_registration", registrationId, { reason, releasedWeekIds });
    return { ok: true, releasedWeekIds };
  });
}

export type ReportPaymentResult =
  | { ok: true; alreadyReported: boolean }
  | { ok: false; reason: "not_found" | "already_paid" | "released" | "window_closed" };

// The parent's "I've sent it" marker. It records WHEN the parent said they paid
// and nothing else: it never changes the registration's status, never confirms
// anything, and its only effect is that the registration is no longer eligible
// for automatic release (see releaseExpiredReservations). Accepted only while
// the reservation still holds its spots and its hold has not ended. (The
// parent-facing page and button arrive in a later stage; this is the
// server-side rule they will call.)
export async function reportPayment(registrationId: string, now: Date = new Date()): Promise<ReportPaymentResult> {
  return inTransaction<ReportPaymentResult>(async (client) => {
    const { rows } = await client.query(
      `SELECT status, hold_expires_at, payment_reported_at FROM registrations WHERE id = $1 FOR UPDATE`,
      [registrationId]
    );
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    const row = rows[0] as { status: string; hold_expires_at: Date | null; payment_reported_at: Date | null };
    if (row.status === "paid") return { ok: false, reason: "already_paid" };
    if (row.status !== "pending_payment") return { ok: false, reason: "released" };
    if (row.hold_expires_at && row.hold_expires_at.getTime() < now.getTime()) {
      return { ok: false, reason: "window_closed" };
    }
    if (row.payment_reported_at) return { ok: true, alreadyReported: true };

    await client.query(`UPDATE registrations SET payment_reported_at = $2 WHERE id = $1`, [registrationId, now]);
    await writeAudit(client, "payment_reported", registrationId, {}, "parent");
    return { ok: true, alreadyReported: false };
  });
}

// Releases reservations whose hold has ended WITHOUT a payment report, freeing
// their spots. Only registrations that are still "Awaiting payment", have no
// parent report, and have a hold_expires_at in the past qualify. A reported
// reservation is NEVER released here, however old it is (the database also
// refuses to record an expiry on a reported registration), and a registration
// with no hold_expires_at never expires. Each release is its own transaction
// that re-checks those conditions under the registration's row lock, so a
// payment confirmed or reported a moment earlier always wins the race.
export async function releaseExpiredReservations(
  now: Date = new Date()
): Promise<{ releasedRegistrationIds: string[] }> {
  const { rows } = await getPool().query(
    `SELECT id FROM registrations
      WHERE status = 'pending_payment' AND payment_reported_at IS NULL
        AND hold_expires_at IS NOT NULL AND hold_expires_at < $1
      ORDER BY hold_expires_at, id`,
    [now]
  );
  const releasedRegistrationIds: string[] = [];
  for (const { id } of rows as { id: string }[]) {
    const released = await inTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id FROM registrations
          WHERE id = $1 AND status = 'pending_payment' AND payment_reported_at IS NULL
            AND hold_expires_at IS NOT NULL AND hold_expires_at < $2
          FOR UPDATE`,
        [id, now]
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
      return true;
    });
    if (released) releasedRegistrationIds.push(id);
  }
  return { releasedRegistrationIds };
}

export async function adjustWeekCapacity(
  weekId: string,
  newMaxCapacity: number
): Promise<{ ok: true } | { ok: false; reason: "below_taken"; takenCount: number }> {
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
    await client.query(`UPDATE camp_weeks SET max_capacity = $2, updated_at = now() WHERE id = $1`, [
      weekId,
      newMaxCapacity,
    ]);
    await client.query(
      `INSERT INTO admin_audit_log (action, target_type, target_id, details)
       VALUES ('adjust_capacity', 'camp_week', $1, $2)`,
      [weekId, JSON.stringify({ newMaxCapacity, previousTakenCount: takenCount })]
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function setWeekOpen(weekId: string, isOpen: boolean): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE camp_weeks SET is_open = $2, updated_at = now() WHERE id = $1`, [weekId, isOpen]);
  await pool.query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details)
     VALUES ($1, 'camp_week', $2, $3)`,
    [isOpen ? "reopen_week" : "close_week", weekId, JSON.stringify({})]
  );
}

export async function setWeekPrice(weekId: string, priceCents: number): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE camp_weeks SET price_cents = $2, updated_at = now() WHERE id = $1`, [weekId, priceCents]);
  await pool.query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details)
     VALUES ('adjust_price', 'camp_week', $1, $2)`,
    [weekId, JSON.stringify({ priceCents })]
  );
}

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
    `SELECT DISTINCT r.id FROM registrations r
     LEFT JOIN children c ON c.registration_id = r.id
     WHERE r.parent_name ILIKE $1 OR c.full_name ILIKE $1 OR r.email ILIKE $1
     ORDER BY r.id DESC LIMIT 50`,
    [`%${query}%`]
  );
  const results: RegistrationDetail[] = [];
  for (const row of rows) {
    const detail = await loadRegistration(pool, row.id);
    if (detail) results.push(detail);
  }
  return results;
}

export async function getAuditLog(limit = 100): Promise<
  { id: string; action: string; targetType: string; targetId: string; details: unknown; createdAt: string }[]
> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, action, target_type, target_id, details, created_at
     FROM admin_audit_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    createdAt: r.created_at,
  }));
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
