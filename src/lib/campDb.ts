import { randomBytes, randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { getPool, isUniqueViolation } from "./db";

// Server-only. This is the authoritative store for camp-week capacity and
// registrations — the "never more than 30 confirmed or reserved spots per
// week" rule is enforced here, inside real Postgres transactions, not in
// application code. Google Sheets (src/lib/googleSheets.ts) remains a
// synchronized reporting copy only; nothing here ever reads it to decide
// whether a spot is available.
//
// The core trick: camp_weeks.taken_count is incremented with
//   UPDATE camp_weeks SET taken_count = taken_count + N
//   WHERE id = $1 AND taken_count + N <= max_capacity
// inside a transaction that first takes a row lock (SELECT ... FOR UPDATE)
// on every week being touched, in a consistent sorted order. Postgres
// serializes concurrent UPDATEs to the same row automatically — a second
// transaction trying to touch the same week simply waits for the first to
// commit or roll back, then re-evaluates the capacity check against the
// now-current count. That's what makes the capacity check atomic instead
// of the classic read-then-write race.

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

    for (const weekId of sortedWeekIds) {
      await client.query(
        `UPDATE camp_weeks SET taken_count = taken_count + $2, updated_at = now() WHERE id = $1`,
        [weekId, spotsPerWeek]
      );
    }

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
  children: { id: string; fullName: string; dateOfBirth: string; age: string; healthInfo: string }[];
  weekIds: string[];
};

async function loadRegistration(client: Pool | PoolClient, id: string): Promise<RegistrationDetail | null> {
  const regRes = await client.query(`SELECT * FROM registrations WHERE id = $1`, [id]);
  if (regRes.rows.length === 0) return null;
  const childRes = await client.query(`SELECT * FROM children WHERE registration_id = $1`, [id]);
  const spotRes = await client.query(
    `SELECT DISTINCT week_id FROM registration_spots WHERE registration_id = $1 AND status = 'active'`,
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
    children: childRes.rows.map((c) => ({
      id: c.id,
      fullName: c.full_name,
      dateOfBirth: String(c.date_of_birth),
      age: c.age,
      healthInfo: c.health_info,
    })),
    weekIds: spotRes.rows.map((s) => s.week_id as string),
  };
  return detail;
}

export async function getRegistrationById(id: string): Promise<RegistrationDetail | null> {
  const pool = getPool();
  return loadRegistration(pool, id);
}

// Marks a registration paid by (id, confirm token) — the same "Mark as
// Paid" email-link pattern as before. Idempotent: a second click (or a
// duplicated email-provider notification) is a no-op that returns the
// already-paid state rather than erroring or double-sending anything.
export async function markRegistrationPaid(
  id: string,
  token: string
): Promise<{ registration: RegistrationDetail; alreadyPaid: boolean } | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT status FROM registrations WHERE id = $1 AND confirm_token = $2 FOR UPDATE`,
      [id, token]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const alreadyPaid = rows[0].status === "paid";
    if (!alreadyPaid) {
      await client.query(`UPDATE registrations SET status = 'paid', paid_at = now() WHERE id = $1`, [id]);
    }
    const registration = await loadRegistration(client, id);
    await client.query("COMMIT");
    return { registration: registration!, alreadyPaid };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Cancels a registration and atomically releases every active spot it
// was holding back to the relevant weeks' capacity. Writes an audit-log
// entry so there's a record of who/what cancelled it and why.
export async function cancelRegistration(
  registrationId: string,
  reason: string
): Promise<{ ok: boolean; releasedWeekIds: string[] }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const spotsRes = await client.query(
      `SELECT week_id, count(*) as n FROM registration_spots
       WHERE registration_id = $1 AND status = 'active' GROUP BY week_id`,
      [registrationId]
    );
    const releases: { weekId: string; n: number }[] = spotsRes.rows.map((r) => ({
      weekId: r.week_id as string,
      n: Number(r.n),
    }));
    const sortedForLocking = [...releases].sort((a, b) => a.weekId.localeCompare(b.weekId));

    for (const { weekId } of sortedForLocking) {
      await client.query(`SELECT 1 FROM camp_weeks WHERE id = $1 FOR UPDATE`, [weekId]);
    }
    for (const { weekId, n } of sortedForLocking) {
      await client.query(
        `UPDATE camp_weeks SET taken_count = GREATEST(taken_count - $2, 0), updated_at = now() WHERE id = $1`,
        [weekId, n]
      );
    }

    await client.query(
      `UPDATE registration_spots SET status = 'cancelled' WHERE registration_id = $1 AND status = 'active'`,
      [registrationId]
    );
    await client.query(
      `UPDATE registrations SET status = 'cancelled', cancelled_at = now(), cancelled_reason = $2 WHERE id = $1`,
      [registrationId, reason]
    );
    await client.query(
      `INSERT INTO admin_audit_log (action, target_type, target_id, details)
       VALUES ('cancel_registration', 'registration', $1, $2)`,
      [registrationId, JSON.stringify({ reason, releasedWeekIds: releases.map((r) => r.weekId) })]
    );

    await client.query("COMMIT");
    return { ok: true, releasedWeekIds: releases.map((r) => r.weekId) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
