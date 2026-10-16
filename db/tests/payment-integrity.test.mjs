// Stage 1 tests: capacity and "paid" integrity, against a real local Postgres
// (not mocked). Covers the original bug — a released registration could be
// marked paid while holding zero spots — plus database-level enforcement
// (including raw SQL that bypasses the app), real concurrent contention,
// multiple children across multiple weeks, expiry, late payment, reinstatement,
// and the rule that a parent-reported reservation is never auto-released.
//
// Run with: DATABASE_URL=postgres://user:pass@localhost:5432/dbname \
//   npx tsx db/tests/payment-integrity.test.mjs
//
// Needs migrations 001, 002 and 003 applied. Deletes registrations and resets
// camp-week settings — do not point this at a database with real data in it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../../src/lib/db.ts";
import * as campDb from "../../src/lib/campDb.ts";
import { buildCoachNotificationEmail } from "../../src/lib/campEmailTemplates.ts";

// Real parallel connections, so "simultaneous" really means simultaneous.
process.env.DB_POOL_MAX ||= "40";

const {
  reserveRegistration,
  cancelRegistration,
  confirmRegistrationPayment,
  reinstateRegistration,
  releaseExpiredReservations,
  reportPayment,
  getRegistrationById,
} = campDb;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Point it at a disposable test database before running this.");
  process.exit(1);
}

const pool = getPool();
let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  const ok = Boolean(condition);
  checks++;
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail !== undefined && detail !== "" ? " — " + detail : ""}`);
}

// Expects the database to REFUSE `fn` with a check_violation (23514).
async function refused(label, fn, constraint) {
  try {
    await fn();
    check(label, false, "the database ACCEPTED it");
  } catch (e) {
    const ok = e.code === "23514" && (!constraint || e.constraint === constraint);
    check(label, ok, `${e.code} ${e.constraint ?? ""} — ${String(e.message).slice(0, 110)}`);
  }
}

async function resetAll() {
  await pool.query(`DELETE FROM registrations`); // cascades to children + spots; the DB frees the capacity
  await pool.query(`DELETE FROM admin_audit_log`);
  await pool.query(`UPDATE camp_weeks SET max_capacity = 30, is_open = true`);
}

let seq = 0;
function input(label, overrides = {}) {
  seq++;
  return {
    idempotencyKey: `${label}-${seq}-${Date.now()}-${Math.random()}`,
    parentName: `Parent ${label}`,
    email: `parent${seq}@example.test`,
    primaryPhone: "514-555-0000",
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
  const r = await reserveRegistration(input(label, overrides));
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
  const s = (await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active FROM registration_spots WHERE registration_id=$1`,
    [id]
  )).rows[0];
  return { ...r, spotsTotal: s.total, spotsActive: s.active };
}
async function auditFor(id) {
  return (await pool.query(`SELECT action, actor, details FROM admin_audit_log WHERE target_id=$1 ORDER BY created_at, id`, [id])).rows;
}

// Recomputes the invariants straight from the tables, independent of the
// triggers, and asserts them. Run after every scenario.
async function invariants(label) {
  const weeks = (await pool.query(
    `SELECT w.id, w.max_capacity, w.taken_count,
            (SELECT count(*) FROM registration_spots s WHERE s.week_id = w.id AND s.status = 'active')::int AS active
       FROM camp_weeks w`
  )).rows;
  const badWeeks = weeks.filter((w) => w.taken_count !== w.active || w.active > w.max_capacity);
  check(`${label}: every week's counter equals its active spots and none is over capacity`, badWeeks.length === 0, JSON.stringify(badWeeks));

  const badRegs = (await pool.query(
    `SELECT r.id, r.status, s.total, s.active
       FROM registrations r
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active
           FROM registration_spots WHERE registration_id = r.id
       ) s ON TRUE
      WHERE (r.status IN ('pending_payment','paid') AND (s.total = 0 OR s.active <> s.total))
         OR (r.status IN ('cancelled','refunded') AND s.active > 0)`
  )).rows;
  check(`${label}: no confirmed/awaiting registration is missing spots; no released one still holds a spot`, badRegs.length === 0, JSON.stringify(badRegs));
}

function rawRegistrationSql(label, status = "pending_payment") {
  return {
    text: `INSERT INTO registrations (idempotency_key, parent_name, email, primary_phone, emergency_name,
             emergency_relationship, emergency_phone, code_of_conduct_accepted, consent_accepted,
             status, confirm_token, total_price_cents)
           VALUES ($1,'Raw Parent','raw@example.test','1','E','A','2',true,true,$2,'t',38000) RETURNING id`,
    values: [`raw-${label}-${Date.now()}-${Math.random()}`, status],
  };
}

// ---------------------------------------------------------------------------
console.log("=== 1. THE ORIGINAL BUG: a released registration must not become paid without spots ===");
{
  await resetAll();
  const a = await reserveOk("bug", { weekIds: ["jul06"] });
  await cancelRegistration(a, "released (simulated)");
  let r = await reg(a);
  check("setup: released registration is cancelled, holds 0 spots, week counter 0", r.status === "cancelled" && r.spotsActive === 0 && (await week("jul06")).taken_count === 0);

  await refused(
    "raw SQL `UPDATE registrations SET status='paid'` on the released registration is REFUSED by the database",
    () => pool.query(`UPDATE registrations SET status='paid', paid_at=now() WHERE id=$1`, [a]),
    "registration_status_matches_spots"
  );
  r = await reg(a);
  check("it is still cancelled, with 0 spots, and the week is untouched", r.status === "cancelled" && r.spotsActive === 0 && (await week("jul06")).taken_count === 0);

  const c = await confirmRegistrationPayment(a, { depositNote: "late e-Transfer found" });
  r = await reg(a);
  check("owner Confirm on the released registration (room available) reinstates it first", c.ok && c.reinstatedWeekIds.join() === "jul06" && c.alreadyPaid === false);
  check("it is now paid AND holds its spot; the week counter is 1", r.status === "paid" && r.spotsActive === 1 && (await week("jul06")).taken_count === 1);
  check("release fields cleared, paid_at set", r.release_reason === null && r.cancelled_reason === null && r.paid_at !== null);
  const audit = await auditFor(a);
  check("audit trail shows cancel then reinstate_and_confirm_payment (owner)", audit.map((x) => x.action).join() === "cancel_registration,reinstate_and_confirm_payment" && audit[1].actor === "owner");
  await invariants("after reinstate-and-confirm");
}

console.log("\n=== 1b. Same, but the week FILLED while the registration was released ===");
{
  await resetAll();
  const a = await reserveOk("late", { weekIds: ["jul06"] });
  await cancelRegistration(a, "released (simulated)");
  const fillers = await fill("jul06", 30);
  check("setup: week is 30/30 with other families", (await week("jul06")).taken_count === 30);

  const c = await confirmRegistrationPayment(a);
  const r = await reg(a);
  check("Confirm is REFUSED with weeks_full naming jul06", !c.ok && c.reason === "weeks_full" && c.fullWeekIds.join() === "jul06", JSON.stringify(c));
  check("nothing changed: still released, no spot, week still 30/30 (never 31)", r.status === "cancelled" && r.spotsActive === 0 && (await week("jul06")).taken_count === 30);
  check("no confirm audit entry was written", !(await auditFor(a)).some((x) => x.action.includes("confirm")));
  const rein = await reinstateRegistration(a);
  check("Reinstate is refused the same way", !rein.ok && rein.reason === "weeks_full");

  await cancelRegistration(fillers[0], "owner freed a spot");
  const c2 = await confirmRegistrationPayment(a);
  check("after a spot frees up, Confirm succeeds and the week is exactly 30/30", c2.ok && (await week("jul06")).taken_count === 30 && (await reg(a)).status === "paid");
  await invariants("after refused + retried confirm");
}

console.log("\n=== 1c. Other confirm paths ===");
{
  await resetAll();
  const unknown = await confirmRegistrationPayment("00000000-0000-0000-0000-000000000000");
  check("unknown registration id -> not_found", !unknown.ok && unknown.reason === "not_found");
  const a = await reserveOk("refunded", { weekIds: ["jul13"] });
  await cancelRegistration(a, "x");
  await pool.query(`UPDATE registrations SET status='refunded' WHERE id=$1`, [a]);
  const refunded = await confirmRegistrationPayment(a);
  check("a refunded registration cannot be confirmed", !refunded.ok && refunded.reason === "refunded");
  const b = await reserveOk("normal", { weekIds: ["jul13"] });
  const first = await confirmRegistrationPayment(b);
  const second = await confirmRegistrationPayment(b);
  check("awaiting-payment registration confirms; a repeat is an idempotent no-op", first.ok && !first.alreadyPaid && second.ok && second.alreadyPaid);
  check("repeat wrote no second audit entry", (await auditFor(b)).filter((x) => x.action === "confirm_payment").length === 1);
  await invariants("confirm paths");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. DATABASE-LEVEL ENFORCEMENT (raw SQL, bypassing the application entirely) ===");
{
  await resetAll();
  const ids = await fill("jul06", 30);
  const victim = ids[0];

  const childOf = (await pool.query(`SELECT child_id FROM registration_spots WHERE registration_id=$1`, [victim])).rows[0].child_id;
  await refused(
    "inserting a 31st active spot into a full week is refused",
    async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const rr = await c.query(rawRegistrationSql("over"));
        const ch = await c.query(`INSERT INTO children (registration_id, full_name, date_of_birth, age) VALUES ($1,'Extra','2018-01-01','8') RETURNING id`, [rr.rows[0].id]);
        await c.query(`INSERT INTO registration_spots (registration_id, child_id, week_id) VALUES ($1,$2,'jul06')`, [rr.rows[0].id, ch.rows[0].id]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    "camp_week_capacity"
  );

  await cancelRegistration(victim, "released");
  await fill("jul06", 1, "replacement");
  check("setup: victim released, a replacement took the spot, week 30/30", (await week("jul06")).taken_count === 30);
  await refused(
    "reactivating the released spot in raw SQL on the full week is refused (this overbooked 31/30 before the fix)",
    () => pool.query(`UPDATE registration_spots SET status='active' WHERE registration_id=$1`, [victim]),
    "camp_week_capacity"
  );
  check("week is still exactly 30/30", (await week("jul06")).taken_count === 30 && (await activeSpots("jul06")) === 30);
  void childOf;

  await refused(
    "tampering with the counter (taken_count - 1) is refused at commit",
    () => pool.query(`UPDATE camp_weeks SET taken_count = taken_count - 1 WHERE id='jul06'`),
    "camp_week_counter"
  );
  await refused(
    "shrinking capacity below the active spots is refused",
    () => pool.query(`UPDATE camp_weeks SET max_capacity = 5 WHERE id='jul06'`),
    "taken_within_capacity"
  );

  const live = ids[1];
  await confirmRegistrationPayment(live);
  await refused(
    "cancelling a single spot of a PAID registration (leaving it paid) is refused",
    () => pool.query(`UPDATE registration_spots SET status='cancelled' WHERE registration_id=$1`, [live]),
    "registration_status_matches_spots"
  );
  await refused(
    "marking a registration cancelled while it still holds a spot is refused (would leak capacity)",
    () => pool.query(`UPDATE registrations SET status='cancelled' WHERE id=$1`, [ids[2]]),
    "registration_status_matches_spots"
  );
  await refused(
    "a registration 'awaiting payment' with no spots at all is refused",
    () => pool.query(rawRegistrationSql("nospots")),
    "registration_status_matches_spots"
  );
  await refused(
    "deleting one spot of an awaiting-payment registration is refused",
    () => pool.query(`DELETE FROM registration_spots WHERE registration_id=$1`, [ids[3]]),
    "registration_status_matches_spots"
  );

  const before = await week("jul06");
  await pool.query(`DELETE FROM registrations WHERE id=$1`, [ids[4]]);
  check("deleting a whole registration is allowed and frees exactly its spot", (await week("jul06")).taken_count === before.taken_count - 1);
  await invariants("after all raw-SQL attacks");
}

console.log("\n=== 2b. Raw concurrent SQL: 60 separate connections race for 20 spots, no application locking at all ===");
{
  await resetAll();
  await pool.query(`UPDATE camp_weeks SET max_capacity = 20 WHERE id='jul06'`);
  const attempts = await Promise.all(
    Array.from({ length: 60 }, async (_, i) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const rr = await c.query(rawRegistrationSql(`race${i}`));
        const ch = await c.query(`INSERT INTO children (registration_id, full_name, date_of_birth, age) VALUES ($1,$2,'2018-01-01','8') RETURNING id`, [rr.rows[0].id, `Racer ${i}`]);
        await c.query(`INSERT INTO registration_spots (registration_id, child_id, week_id) VALUES ($1,$2,'jul06')`, [rr.rows[0].id, ch.rows[0].id]);
        await c.query("COMMIT");
        return "ok";
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        return e.constraint === "camp_week_capacity" ? "full" : `other:${e.code}:${e.message}`;
      } finally {
        c.release();
      }
    })
  );
  const ok = attempts.filter((x) => x === "ok").length;
  const full = attempts.filter((x) => x === "full").length;
  const other = attempts.filter((x) => x.startsWith("other"));
  check("exactly 20 transactions committed", ok === 20, `got ${ok}`);
  check("the other 40 were refused by the database as full", full === 40, `got ${full}`);
  check("no other kind of error (no deadlocks)", other.length === 0, other.slice(0, 2).join(" | "));
  check("week is exactly 20/20", (await week("jul06")).taken_count === 20 && (await activeSpots("jul06")) === 20);
  await invariants("raw race");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. SIMULTANEOUS contention: reinstatements and confirms vs. new registrations for the last spots ===");
for (let round = 1; round <= 4; round++) {
  await resetAll();
  const ids = await fill("jul06", 30);
  const released = ids.slice(0, 5);
  for (const id of released) await cancelRegistration(id, "released");
  check(`round ${round}: setup — 25/30 taken, 5 released registrations waiting`, (await week("jul06")).taken_count === 25);

  const tasks = [
    ...released.map((id) => confirmRegistrationPayment(id).then((r) => ({ kind: "confirm", id, r }))),
    ...released.map((id) => reinstateRegistration(id).then((r) => ({ kind: "reinstate", id, r }))),
    ...Array.from({ length: 15 }, (_, i) => reserveRegistration(input(`new${round}-${i}`, { weekIds: ["jul06"] })).then((r) => ({ kind: "new", r }))),
  ];
  const results = await Promise.all(tasks);
  const newOk = results.filter((x) => x.kind === "new" && x.r.ok).length;
  const restored = (await Promise.all(released.map((id) => reg(id)))).filter((r) => r.status !== "cancelled").length;
  const thrown = results.filter((x) => x.r && x.r.ok === false && !["weeks_full", "not_released"].includes(x.r.reason));
  check(`round ${round}: 25 competing requests for 5 free spots -> week is exactly 30/30`, (await week("jul06")).taken_count === 30 && (await activeSpots("jul06")) === 30);
  check(`round ${round}: new registrations + restored registrations = exactly 5`, newOk + restored === 5, `${newOk} new + ${restored} restored`);
  check(`round ${round}: every refusal was a clean weeks_full / not_released`, thrown.length === 0, JSON.stringify(thrown.slice(0, 2)));
  await invariants(`round ${round}`);
}

console.log("\n=== 3b. Confirm racing Cancel on the same registration (30 trials) ===");
{
  await resetAll();
  let bad = 0;
  let paidEnd = 0;
  let cancelledEnd = 0;
  for (let i = 0; i < 30; i++) {
    const id = await reserveOk(`cc${i}`, { weekIds: ["jul20"] });
    await Promise.all([confirmRegistrationPayment(id), cancelRegistration(id, "race")]);
    const r = await reg(id);
    if (r.status === "paid" && r.spotsActive === r.spotsTotal && r.spotsTotal > 0) paidEnd++;
    else if (r.status === "cancelled" && r.spotsActive === 0) cancelledEnd++;
    else bad++;
  }
  check("every trial ended consistent: paid-with-spots or cancelled-with-none (never paid without a spot)", bad === 0, `paid=${paidEnd} cancelled=${cancelledEnd} inconsistent=${bad}`);
  await invariants("confirm vs cancel");
}

console.log("\n=== 3c. Multiple families, multiple children, overlapping weeks — 24 simultaneous registrations ===");
{
  await resetAll();
  const pairs = [
    ["aug03", "aug10"],
    ["aug10", "aug17"],
    ["aug17", "aug03"],
  ];
  const outcomes = await Promise.all(
    Array.from({ length: 24 }, (_, i) => reserveRegistration(input(`multi${i}`, { children: kids(2, `M${i}`), weekIds: pairs[i % 3] })).then((r) => ({ r, weeks: pairs[i % 3] })).catch((e) => ({ r: { ok: false, reason: `THROWN ${e.message}` } })))
  );
  const okOnes = outcomes.filter((o) => o.r.ok);
  const refusedOnes = outcomes.filter((o) => !o.r.ok);
  check("no request threw (no deadlocks between overlapping multi-week requests)", refusedOnes.every((o) => o.r.reason === "weeks_full"), refusedOnes.map((o) => o.r.reason).slice(0, 3).join());
  check("demand (2 children x 16 families per week = 32 seats) exceeded capacity, so some were refused", refusedOnes.length > 0 && okOnes.length > 0, `${okOnes.length} ok / ${refusedOnes.length} refused`);
  for (const w of ["aug03", "aug10", "aug17"]) {
    const wk = await week(w);
    check(`${w}: ${wk.taken_count}/30, counter equals active spots`, wk.taken_count <= 30 && wk.taken_count === (await activeSpots(w)));
  }
  let partial = 0;
  for (const o of okOnes) {
    const r = await reg(o.r.registrationId);
    if (r.spotsActive !== 4) partial++; // 2 children x 2 weeks
  }
  check("every successful registration holds all 4 of its spots (2 children x 2 weeks)", partial === 0, `${partial} partial`);
  const orphanKids = (await pool.query(`SELECT count(*)::int AS n FROM children c LEFT JOIN registrations r ON r.id=c.registration_id WHERE r.id IS NULL`)).rows[0].n;
  check("refused requests left nothing behind", orphanKids === 0 && (await pool.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n === okOnes.length);
  await invariants("multi-family burst");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Multiple children x multiple weeks: all-or-nothing release and reinstatement ===");
{
  await resetAll();
  const weeks3 = ["jul13", "jul20", "jul27"];
  const fam = await reserveOk("family", { children: kids(2, "Fam"), weekIds: weeks3 });
  check("2 children x 3 weeks = 6 spots, 2 taken in each week", (await reg(fam)).spotsActive === 6 && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 2));

  const cancelled = await cancelRegistration(fam, "released");
  check("release frees all 6 spots across all 3 weeks", cancelled.releasedWeekIds.join() === weeks3.join() && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 0));

  const jul20 = await fill("jul20", 29, "jul20fill"); // leaves exactly 1 seat; the family needs 2
  const snapshot = await Promise.all(weeks3.map((w) => week(w)));
  const attempt = await reinstateRegistration(fam);
  const after = await Promise.all(weeks3.map((w) => week(w)));
  check("only 1 seat free in jul20 but 2 needed: reinstatement refused with weeks_full [jul20]", !attempt.ok && attempt.reason === "weeks_full" && attempt.fullWeekIds.join() === "jul20", JSON.stringify(attempt));
  check("all-or-nothing: jul13 and jul27 were NOT partially restored", JSON.stringify(snapshot) === JSON.stringify(after) && (await reg(fam)).spotsActive === 0);
  const confirmAttempt = await confirmRegistrationPayment(fam);
  check("Confirm is refused the same way and the family stays released", !confirmAttempt.ok && (await reg(fam)).status === "cancelled");

  await cancelRegistration(jul20[0], "freed");
  const done = await confirmRegistrationPayment(fam);
  const r = await reg(fam);
  check("once 2 seats are free, Confirm restores all 6 spots and marks it paid", done.ok && done.reinstatedWeekIds.join() === weeks3.join() && r.status === "paid" && r.spotsActive === 6);
  check("jul13 and jul27 hold 2 each; jul20 is full at 30", (await week("jul13")).taken_count === 2 && (await week("jul27")).taken_count === 2 && (await week("jul20")).taken_count === 30);
  await invariants("family reinstatement");

  await resetAll();
  const three = await reserveOk("trio", { children: kids(3, "Trio"), weekIds: ["aug03", "aug10"] });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 hour' WHERE id=$1`, [three]);
  const rel = await releaseExpiredReservations();
  check("an expired 3-child, 2-week registration releases all 6 spots at once", rel.releasedRegistrationIds.join() === three && (await week("aug03")).taken_count === 0 && (await week("aug10")).taken_count === 0);
  await invariants("trio expiry");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. EXPIRY: only unreported, expired reservations are released ===");
{
  await resetAll();
  const T = new Date();
  const hours = (h) => new Date(T.getTime() + h * 3600 * 1000);
  const setHold = (id, d) => pool.query(`UPDATE registrations SET hold_expires_at=$2 WHERE id=$1`, [id, d]);

  const expired = await reserveOk("expired", { weekIds: ["jul06"] });
  const future = await reserveOk("future", { weekIds: ["jul06"] });
  const never = await reserveOk("never", { weekIds: ["jul06"] }); // hold_expires_at stays NULL
  const reported = await reserveOk("reported", { weekIds: ["jul06"] });
  const paid = await reserveOk("paid", { weekIds: ["jul06"] });
  await setHold(expired, hours(-1));
  await setHold(future, hours(+1));
  await setHold(reported, hours(-1));
  await setHold(paid, hours(-1));

  const rep = await reportPayment(reported, hours(-2)); // reported while the hold was still open
  check("parent report before the hold ends is accepted", rep.ok && rep.alreadyReported === false);
  const repAgain = await reportPayment(reported, hours(-2));
  check("a repeated report is accepted idempotently", repAgain.ok && repAgain.alreadyReported === true);
  check("a report is a marker only: status is still 'Awaiting payment', not confirmed", (await reg(reported)).status === "pending_payment" && (await reg(reported)).paid_at === null);
  await confirmRegistrationPayment(paid);
  await setHold(paid, hours(-1)); // even a stale hold value must not matter once paid

  const out = await releaseExpiredReservations(T);
  check("exactly one registration was released: the unreported, expired one", out.releasedRegistrationIds.join() === expired, out.releasedRegistrationIds.join());
  const e = await reg(expired);
  check("it is cancelled, release_reason='expired_unpaid', and holds no spot", e.status === "cancelled" && e.release_reason === "expired_unpaid" && e.spotsActive === 0);
  const ea = await auditFor(expired);
  check("audit: release_expired by 'system'", ea.some((x) => x.action === "release_expired" && x.actor === "system"));
  check("unexpired, never-expiring, reported and paid registrations are all untouched", (await Promise.all([future, never, reported, paid].map(reg))).every((r) => r.spotsActive === 1 && r.status !== "cancelled"));
  check("week shows 4 taken (5 - 1 released)", (await week("jul06")).taken_count === 4);

  const long = await releaseExpiredReservations(hours(24 * 30));
  const stillReported = await reg(reported);
  check("a REPORTED reservation is not released even 30 days later", !long.releasedRegistrationIds.includes(reported) && stillReported.status === "pending_payment" && stillReported.spotsActive === 1);
  check("a paid registration is never released", !long.releasedRegistrationIds.includes(paid) && (await reg(paid)).status === "paid");
  check("(the unreported ones with a future hold do expire when their time comes — and only those)", long.releasedRegistrationIds.includes(future) && !long.releasedRegistrationIds.includes(never));
  await invariants("expiry rules");
}

console.log("\n=== 5b. The database itself refuses to record an expiry against a reported reservation ===");
{
  await resetAll();
  const id = await reserveOk("rep-db", { weekIds: ["jul06"] });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() + interval '1 hour' WHERE id=$1`, [id]);
  await reportPayment(id);
  await refused(
    "even a correct-looking release (spots freed, status cancelled) with release_reason='expired_unpaid' is refused when the parent reported",
    async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`UPDATE registration_spots SET status='cancelled' WHERE registration_id=$1`, [id]);
        await c.query(`UPDATE registrations SET status='cancelled', release_reason='expired_unpaid' WHERE id=$1`, [id]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    "registrations_expiry_never_reported"
  );
  check("the reported reservation still holds its spot", (await reg(id)).spotsActive === 1);
  const ownerCancel = await cancelRegistration(id, "Not received");
  check("only the owner can release it (cancel/'Not received' works)", ownerCancel.ok && (await reg(id)).status === "cancelled" && (await reg(id)).release_reason === "owner_cancelled");
}

console.log("\n=== 5c. Report timing rules ===");
{
  await resetAll();
  const T = new Date("2027-01-10T15:00:00Z");
  const id = await reserveOk("timing", { weekIds: ["jul06"] });
  await pool.query(`UPDATE registrations SET hold_expires_at=$2 WHERE id=$1`, [id, T]);
  const exactly = await reportPayment(id, T);
  check("a report exactly at the hold time is accepted", exactly.ok);

  const late = await reserveOk("timing-late", { weekIds: ["jul06"] });
  await pool.query(`UPDATE registrations SET hold_expires_at=$2 WHERE id=$1`, [late, T]);
  const afterHold = await reportPayment(late, new Date(T.getTime() + 1000));
  check("a report one second after the hold ends is refused (window_closed) even before the cleanup has run", !afterHold.ok && afterHold.reason === "window_closed");
  check("a refused report leaves no marker", (await reg(late)).payment_reported_at === null);
  await releaseExpiredReservations(new Date(T.getTime() + 1000));
  const afterRelease = await reportPayment(late, new Date(T.getTime() + 2000));
  check("after release the report is refused as 'released' (the late-payment path is the owner's Confirm)", !afterRelease.ok && afterRelease.reason === "released");
  const paid = await reserveOk("timing-paid", { weekIds: ["jul06"] });
  await confirmRegistrationPayment(paid);
  const onPaid = await reportPayment(paid);
  check("reporting an already-confirmed registration -> already_paid", !onPaid.ok && onPaid.reason === "already_paid");
  const nf = await reportPayment("00000000-0000-0000-0000-000000000000");
  check("reporting an unknown registration -> not_found", !nf.ok && nf.reason === "not_found");
  const audit = await auditFor(id);
  check("the parent's report is audited with actor 'parent'", audit.some((x) => x.action === "payment_reported" && x.actor === "parent"));
  await invariants("report timing");
}

console.log("\n=== 5d. Concurrency around expiry ===");
{
  await resetAll();
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await reserveOk(`conc-exp${i}`, { weekIds: ["aug24"], children: kids(2, `C${i}`) }));
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 hour'`);
  const runs = await Promise.all(Array.from({ length: 6 }, () => releaseExpiredReservations()));
  const all = runs.flatMap((r) => r.releasedRegistrationIds);
  check("6 simultaneous cleanup runs released each of 12 registrations exactly once", all.length === 12 && new Set(all).size === 12, `${all.length} releases, ${new Set(all).size} distinct`);
  check("capacity was freed exactly once: week back to 0 (no double-free, no negative)", (await week("aug24")).taken_count === 0);
  await invariants("simultaneous cleanup");

  await resetAll();
  const trials = 25;
  let bad = 0;
  for (let i = 0; i < trials; i++) {
    const id = await reserveOk(`race-pay${i}`, { weekIds: ["aug24"] });
    await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 hour' WHERE id=$1`, [id]);
    await Promise.all([confirmRegistrationPayment(id), releaseExpiredReservations()]);
    const r = await reg(id);
    // Either order is fine, but the family must end up paid WITH its spot (room exists):
    // payment-first makes the cleanup skip it; cleanup-first makes Confirm reinstate it.
    if (!(r.status === "paid" && r.spotsActive === 1)) bad++;
  }
  check(`owner Confirm racing the expiry cleanup (${trials} trials): the paid family always ends up with its spot`, bad === 0, `${bad} bad`);
  await invariants("confirm vs expiry race");

  await resetAll();
  bad = 0;
  for (let i = 0; i < trials; i++) {
    const id = await reserveOk(`race-rep${i}`, { weekIds: ["aug24"] });
    const T = new Date();
    await pool.query(`UPDATE registrations SET hold_expires_at=$2 WHERE id=$1`, [id, new Date(T.getTime() + 1000)]);
    // The report is stamped inside the window while the cleanup runs "after" it.
    await Promise.all([reportPayment(id, T), releaseExpiredReservations(new Date(T.getTime() + 5000))]);
    const r = await reg(id);
    const ok =
      (r.status === "pending_payment" && r.payment_reported_at !== null && r.spotsActive === 1) ||
      (r.status === "cancelled" && r.release_reason === "expired_unpaid" && r.payment_reported_at === null && r.spotsActive === 0);
    if (!ok) bad++;
  }
  check(`parent report racing the cleanup (${trials} trials): always consistent, never a released reservation that was also reported`, bad === 0, `${bad} bad`);
  await invariants("report vs expiry race");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. LATE PAYMENT after expiry ===");
{
  await resetAll();
  const id = await reserveOk("latepay", { weekIds: ["jul27"], children: kids(2, "Late") });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '2 hours' WHERE id=$1`, [id]);
  await releaseExpiredReservations();
  check("the unreported reservation expired and freed its 2 spots", (await reg(id)).status === "cancelled" && (await week("jul27")).taken_count === 0);

  const taker = await fill("jul27", 29, "taker"); // 29 + 2 would be 31 — no room for the family
  const refusedLate = await confirmRegistrationPayment(id);
  check("owner finds the late deposit but only 1 seat is left for 2 children: refused, family stays released", !refusedLate.ok && refusedLate.reason === "weeks_full" && (await reg(id)).spotsActive === 0 && (await week("jul27")).taken_count === 29);
  await cancelRegistration(taker[0], "freed a second seat");
  await cancelRegistration(taker[1], "freed a second seat");
  const okLate = await confirmRegistrationPayment(id, { depositNote: "deposit arrived 2:55 PM" });
  const r = await reg(id);
  check("with 2+ seats free the late payment is confirmed and BOTH children get their spots", okLate.ok && r.status === "paid" && r.spotsActive === 2 && (await week("jul27")).taken_count === 29 - 2 + 2);
  const audit = await auditFor(id);
  check("audit records the release by 'system', then reinstate_and_confirm_payment by 'owner' with the note", audit.map((x) => `${x.actor}:${x.action}`).join() === "system:release_expired,owner:reinstate_and_confirm_payment" && audit[1].details.depositNote === "deposit arrived 2:55 PM");
  await invariants("late payment");
}

console.log("\n=== 6b. Reinstating without confirming; a reinstated reservation never auto-expires ===");
{
  await resetAll();
  const id = await reserveOk("rein", { weekIds: ["jul06"] });
  const notReleased = await reinstateRegistration(id);
  check("reinstating a registration that is not released -> not_released", !notReleased.ok && notReleased.reason === "not_released");
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 hour' WHERE id=$1`, [id]);
  await releaseExpiredReservations();
  const rein = await reinstateRegistration(id);
  const r = await reg(id);
  check("reinstate returns it to 'Awaiting payment' holding its spot", rein.ok && r.status === "pending_payment" && r.spotsActive === 1 && r.paid_at === null);
  check("its old (expired) hold was cleared", r.hold_expires_at === null && r.release_reason === null);
  const sweep = await releaseExpiredReservations(new Date(Date.now() + 365 * 24 * 3600 * 1000));
  check("a year later the cleanup still leaves it alone", !sweep.releasedRegistrationIds.includes(id) && (await reg(id)).spotsActive === 1);

  await cancelRegistration(id, "x");
  await pool.query(`UPDATE camp_weeks SET is_open=false WHERE id='jul06'`);
  const closed = await reinstateRegistration(id);
  const closedConfirm = await confirmRegistrationPayment(id);
  check("a closed week blocks both Reinstate and Confirm (weeks_closed) and changes nothing", !closed.ok && closed.reason === "weeks_closed" && !closedConfirm.ok && closedConfirm.reason === "weeks_closed" && (await reg(id)).spotsActive === 0);
  await pool.query(`UPDATE camp_weeks SET is_open=true WHERE id='jul06'`);
  await invariants("reinstate");
}

console.log("\n=== 7. Cancel is idempotent and audited ===");
{
  await resetAll();
  const id = await reserveOk("cancel2", { weekIds: ["jul06"] });
  const first = await cancelRegistration(id, "Parent asked");
  const second = await cancelRegistration(id, "again");
  const none = await cancelRegistration("00000000-0000-0000-0000-000000000000", "x");
  check("first cancel releases the week; second is a harmless no-op", first.ok && first.releasedWeekIds.join() === "jul06" && second.ok && second.releasedWeekIds.length === 0);
  check("unknown id -> ok:false", none.ok === false);
  check("one audit entry only, and the original reason is kept", (await auditFor(id)).length === 1 && (await reg(id)).cancelled_reason === "Parent asked");
  await invariants("cancel");
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. The old one-click 'Mark as Paid' email link is gone ===");
{
  check("markRegistrationPaid no longer exists in the data layer", typeof campDb.markRegistrationPaid === "undefined");
  check("the GET /api/camp-registration/confirm route file was deleted", !existsSync("src/app/api/camp-registration/confirm/route.ts"));
  const offenders = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && /camp-registration\/confirm|Mark as Paid/.test(readFileSync(p, "utf8"))) offenders.push(p);
    }
  })("src");
  check("no source file references that URL or the 'Mark as Paid' button text", offenders.length === 0, offenders.join(", "));
  const id = await reserveOk("email", { weekIds: ["jul06"] });
  const detail = await getRegistrationById(id);
  const mail = buildCoachNotificationEmail(detail, "https://example.test/admin/camp-rosters");
  check("the owner's notification email links only to the dashboard and carries no token or confirm URL", !/token=|api\/camp-registration|Mark as Paid/i.test(mail.html + mail.text) && mail.html.includes("/admin/camp-rosters"));
}

await resetAll();
await pool.end();

console.log(`\n\n${failures === 0 ? `ALL TESTS PASS (${checks - failures} pass, 0 fail)` : `${failures} OF ${checks} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
