// Shared test harness: assertions, fixtures, and the invariant checker. Call
// createHarness() AFTER createTestDatabase() (it needs DATABASE_URL to point at the
// throwaway database).

import { getPool } from "../../../src/lib/db.ts";
import * as campDb from "../../../src/lib/campDb.ts";

export function createHarness() {
  const pool = getPool();
  let failures = 0;
  let checks = 0;
  let seq = 0;

  function check(label, condition, detail) {
    const ok = Boolean(condition);
    checks++;
    if (!ok) failures++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail !== undefined && detail !== "" ? " — " + detail : ""}`);
  }

  // Expects the database to REFUSE `fn` with a check_violation (23514), or another code.
  async function refused(label, fn, constraint, code = "23514") {
    try {
      await fn();
      check(label, false, "the database ACCEPTED it");
    } catch (e) {
      const ok = e.code === code && (!constraint || e.constraint === constraint);
      check(label, ok, `${e.code} ${e.constraint ?? ""} — ${String(e.message).slice(0, 110)}`);
    }
  }

  async function resetAll() {
    // The audit log is append-only, so tests never delete it: each assertion looks at the
    // entries of its own registration. Deleting registrations cascades to children, spots,
    // strikes and ledger rows, and the database frees the capacity itself.
    await pool.query(`DELETE FROM registrations`);
    await pool.query(`DELETE FROM contact_strikes`);
    await pool.query(`DELETE FROM camp_settings`);
    await pool.query(`UPDATE camp_weeks SET max_capacity = 30, is_open = true`);
  }

  function input(label, overrides = {}) {
    seq++;
    return {
      idempotencyKey: `${label}-${seq}-${Date.now()}-${Math.random()}`,
      parentName: `Parent ${label}`,
      email: `parent${seq}@example.test`,
      primaryPhone: `514-555-${String(1000 + (seq % 9000)).padStart(4, "0")}`,
      secondaryPhone: "",
      emergencyName: "Emergency Contact",
      emergencyRelationship: "Aunt",
      emergencyPhone: "514-555-1111",
      codeOfConductAccepted: true,
      consentAccepted: true,
      children: [{ fullName: `Test Child ${label}`, dateOfBirth: "2018-01-01", age: "8", healthInfo: "none" }],
      weekIds: ["jul06"],
      ...overrides,
    };
  }

  function kids(n, label = "K") {
    return Array.from({ length: n }, (_, i) => ({
      fullName: `${label} child ${i + 1}`,
      dateOfBirth: "2017-01-01",
      age: "9",
      healthInfo: "none",
    }));
  }

  async function reserveOk(label, overrides = {}) {
    const r = await campDb.reserveRegistration(input(label, overrides));
    if (!r.ok) throw new Error(`setup reservation "${label}" failed: ${JSON.stringify(r)}`);
    return r.registrationId;
  }

  async function fill(weekId, n, label = "filler") {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(await reserveOk(`${label}-${weekId}-${i}`, { weekIds: [weekId] }));
    return ids;
  }

  async function week(id) {
    return (await pool.query(`SELECT taken_count, max_capacity FROM camp_weeks WHERE id = $1`, [id])).rows[0];
  }
  async function activeSpots(weekId) {
    return Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE week_id=$1 AND status='active'`, [weekId])).rows[0].count);
  }
  async function reg(id) {
    const r = (await pool.query(`SELECT * FROM registrations WHERE id=$1`, [id])).rows[0];
    const s = (
      await pool.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active FROM registration_spots WHERE registration_id=$1`,
        [id]
      )
    ).rows[0];
    return { ...r, spotsTotal: s.total, spotsActive: s.active };
  }
  async function auditFor(id) {
    return (await pool.query(`SELECT action, actor, details FROM admin_audit_log WHERE target_id=$1 ORDER BY created_at, id`, [id])).rows;
  }

  // Confirms a registration the way the administrator's route does, with a valid
  // verification record built from the registration itself. Override any field.
  async function confirmFor(id, overrides = {}) {
    const r = (await pool.query(`SELECT reference_code, amount_due_cents FROM registrations WHERE id=$1`, [id])).rows[0];
    return campDb.confirmRegistrationPayment(id, {
      amountReceivedCents: r.amount_due_cents,
      depositAt: new Date(),
      method: "reference_matched",
      referenceEntered: r.reference_code,
      ...overrides,
    });
  }

  // Simulated time passing, done the honest way: move stored deadlines EARLIER (the database
  // allows that; it never allows a deadline to move later by itself).
  async function expireHold(id, hoursAgo = 1) {
    await pool.query(`UPDATE registrations SET hold_expires_at = now() - make_interval(hours => $2) WHERE id = $1`, [id, hoursAgo]);
  }
  async function makeOverdue(id, hoursOverdue) {
    await pool.query(`UPDATE registrations SET review_due_at = now() - make_interval(hours => $2) WHERE id = $1`, [id, hoursOverdue]);
  }

  // Recomputes the invariants straight from the tables, independent of the triggers.
  async function invariants(label) {
    const weeks = (
      await pool.query(
        `SELECT w.id, w.max_capacity, w.taken_count,
                (SELECT count(*) FROM registration_spots s WHERE s.week_id = w.id AND s.status = 'active')::int AS active
           FROM camp_weeks w`
      )
    ).rows;
    const badWeeks = weeks.filter((w) => w.taken_count !== w.active || w.active > w.max_capacity);
    check(`${label}: counters equal active spots and no week is over capacity`, badWeeks.length === 0, JSON.stringify(badWeeks));

    const overStandard = (
      await pool.query(
        `SELECT w.id FROM camp_weeks w
          WHERE w.max_capacity > 30
            AND NOT EXISTS (SELECT 1 FROM capacity_authorizations a WHERE a.week_id = w.id AND a.authorized_capacity >= w.max_capacity)`
      )
    ).rows;
    check(`${label}: no week is above 30 without a recorded authorization (and none above 33)`, overStandard.length === 0 && weeks.every((w) => w.max_capacity <= 33), JSON.stringify(overStandard));

    const badRegs = (
      await pool.query(
        `SELECT r.id, r.status, s.total, s.active
           FROM registrations r
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active
               FROM registration_spots WHERE registration_id = r.id
           ) s ON TRUE
          WHERE (r.status IN ('pending_payment','payment_reported','paid') AND (s.total = 0 OR s.active <> s.total))
             OR (r.status IN ('cancelled','refunded') AND s.active > 0)`
      )
    ).rows;
    check(`${label}: held registrations hold all their spots; released ones hold none`, badRegs.length === 0, JSON.stringify(badRegs));

    const badClocks = (
      await pool.query(
        `SELECT id, status FROM registrations
          WHERE (status = 'pending_payment' AND (hold_expires_at IS NULL OR payment_reported_at IS NOT NULL))
             OR (status = 'payment_reported' AND (payment_reported_at IS NULL OR review_due_at IS NULL))
             OR (status = 'paid' AND (verified_at IS NULL OR amount_received_cents IS DISTINCT FROM amount_due_cents OR deposit_at IS NULL))
             OR (release_reason = 'expired_unpaid' AND payment_reported_at IS NOT NULL)`
      )
    ).rows;
    check(`${label}: every hold has an expiry, every report a review time, every paid registration a verification record`, badClocks.length === 0, JSON.stringify(badClocks));
  }

  function rawRegistrationSql(label, status = "pending_payment") {
    return {
      text: `INSERT INTO registrations (idempotency_key, parent_name, email, primary_phone, emergency_name,
               emergency_relationship, emergency_phone, code_of_conduct_accepted, consent_accepted,
               status, total_price_cents)
             VALUES ($1,'Raw Parent','raw@example.test','1','E','A','2',true,true,$2,38000) RETURNING id`,
      values: [`raw-${label}-${Date.now()}-${Math.random()}`, status],
    };
  }

  async function inTx(fn) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  function finish(name) {
    console.log(`\n\n${failures === 0 ? `ALL TESTS PASS (${checks - failures} pass, 0 fail)` : `${failures} OF ${checks} CHECK(S) FAILED`} — ${name}`);
    return failures === 0 ? 0 : 1;
  }

  return {
    pool, campDb, check, refused, resetAll, input, kids, reserveOk, fill, week, activeSpots, reg, auditFor,
    confirmFor, expireHold, makeOverdue, invariants, rawRegistrationSql, inTx, finish,
  };
}
