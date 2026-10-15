// Real concurrency/correctness tests for the camp-registration capacity
// logic in src/lib/campDb.ts, run against an actual local Postgres
// database — not simulated or mocked. This directly exercises the exact
// code path the live API routes call.
//
// Run with: DATABASE_URL=postgres://user:pass@localhost:5432/dbname \
//   npx tsx db/tests/concurrency.test.mjs
//
// Requires the schema from db/migrations/001_init.sql and the seed data
// from db/migrations/002_seed_weeks.sql to already be applied. Destroys
// and recreates test data in the camp_weeks it touches — do not point
// this at a database with real registrations in it.

import { getPool } from "../../src/lib/db.ts";
import {
  reserveRegistration,
  cancelRegistration,
  markRegistrationPaid,
  adjustWeekCapacity,
} from "../../src/lib/campDb.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Point it at a disposable test database before running this.");
  process.exit(1);
}

const pool = getPool();
let failures = 0;

function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

async function resetAll() {
  await pool.query(`DELETE FROM registration_spots`);
  await pool.query(`DELETE FROM children`);
  await pool.query(`DELETE FROM registrations`);
  await pool.query(`DELETE FROM admin_audit_log`);
  await pool.query(`UPDATE camp_weeks SET taken_count = 0, max_capacity = 30, price_cents = 38000, is_open = true`);
}

function basicRegistrant(label, overrides = {}) {
  return {
    idempotencyKey: `${label}-${Date.now()}-${Math.random()}`,
    parentName: `Parent ${label}`,
    email: `parent${label}@example.com`,
    primaryPhone: "514-555-0000",
    secondaryPhone: "",
    emergencyName: "Emergency Contact",
    emergencyRelationship: "Aunt",
    emergencyPhone: "514-555-1111",
    codeOfConductAccepted: true,
    consentAccepted: true,
    children: [{ fullName: `Child ${label}`, dateOfBirth: "2018-01-01", age: "8", healthInfo: "none" }],
    weekIds: ["jul06"],
    ...overrides,
  };
}

async function testBurst(n, weekId, prefillTo, expectedSuccesses) {
  await resetAll();
  if (prefillTo > 0) {
    for (let i = 0; i < prefillTo; i++) {
      const r = await reserveRegistration(basicRegistrant(`prefill-${i}`, { weekIds: [weekId] }));
      if (!r.ok) throw new Error("Unexpected prefill failure: " + JSON.stringify(r));
    }
  }
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => reserveRegistration(basicRegistrant(`burst-${i}`, { weekIds: [weekId] })))
  );
  const elapsed = Date.now() - start;
  const succeeded = results.filter((r) => r.ok).length;
  const rejected = results.filter((r) => !r.ok && r.reason === "weeks_full").length;
  const errors = results.filter((r) => !r.ok && r.reason === "error").length;

  const spotCount = Number(
    (await pool.query(`SELECT count(*) FROM registration_spots WHERE week_id = $1 AND status = 'active'`, [weekId]))
      .rows[0].count
  );
  const weekRow = (await pool.query(`SELECT taken_count, max_capacity FROM camp_weeks WHERE id = $1`, [weekId]))
    .rows[0];

  console.log(
    `  ${n} simultaneous attempts (week pre-filled to ${prefillTo}/${weekRow.max_capacity}), fired in ${elapsed}ms`
  );
  console.log(`  succeeded=${succeeded} rejected=${rejected} errors=${errors}`);
  check(
    `exactly ${expectedSuccesses} succeeded`,
    succeeded === expectedSuccesses,
    `got ${succeeded}`
  );
  check("spot rows match taken_count counter", spotCount === weekRow.taken_count, `${spotCount} vs ${weekRow.taken_count}`);
  check("never exceeded max_capacity", spotCount <= weekRow.max_capacity, `${spotCount} <= ${weekRow.max_capacity}`);
  check("zero unexpected errors", errors === 0, `${errors} errors`);
}

console.log("=== Scenario: 10 simultaneous, empty week (max 30) — expect 10 succeed ===");
await testBurst(10, "jul06", 0, 10);

console.log("\n=== Scenario: 30 simultaneous, empty week (max 30) — expect 30 succeed ===");
await testBurst(30, "jul06", 0, 30);

console.log("\n=== Scenario E (50): 50 simultaneous, empty week (max 30) — expect exactly 30 succeed, 20 rejected ===");
await testBurst(50, "jul06", 0, 30);

console.log("\n=== Scenario E (100): 100 simultaneous, empty week (max 30) — expect exactly 30 succeed, 70 rejected ===");
await testBurst(100, "jul06", 0, 30);

console.log("\n=== Scenario D: week at 29/30, 10 simultaneous attempts — expect exactly 1 succeeds ===");
await testBurst(10, "jul06", 29, 1);

console.log("\n=== Scenario B: one parent, 3 children, same week ===");
{
  await resetAll();
  const result = await reserveRegistration(
    basicRegistrant("B", {
      children: [
        { fullName: "Child One", dateOfBirth: "2016-01-01", age: "10", healthInfo: "none" },
        { fullName: "Child Two", dateOfBirth: "2017-01-01", age: "9", healthInfo: "none" },
        { fullName: "Child Three", dateOfBirth: "2018-01-01", age: "8", healthInfo: "peanut allergy" },
      ],
      weekIds: ["jun22"],
    })
  );
  const week = (await pool.query(`SELECT taken_count, price_cents FROM camp_weeks WHERE id='jun22'`)).rows[0];
  check("registration succeeded", result.ok);
  check("3 spots allocated", week.taken_count === 3, `got ${week.taken_count}`);
  check("total price = 3 x weekly price", result.ok && result.totalPriceCents === week.price_cents * 3);
}

console.log("\n=== Scenario C: one parent, 2 children, 3 different weeks ===");
{
  await resetAll();
  const weekIds = ["jul13", "jul20", "jul27"];
  const result = await reserveRegistration(
    basicRegistrant("C", {
      children: [
        { fullName: "Kid A", dateOfBirth: "2016-01-01", age: "10", healthInfo: "none" },
        { fullName: "Kid B", dateOfBirth: "2018-01-01", age: "8", healthInfo: "none" },
      ],
      weekIds,
    })
  );
  check("registration succeeded", result.ok);
  for (const weekId of weekIds) {
    const row = (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id=$1`, [weekId])).rows[0];
    check(`${weekId} shows 2 spots taken`, row.taken_count === 2, `got ${row.taken_count}`);
  }
  const totalSpots = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE status='active'`)).rows[0].count);
  check("6 total spot rows (2 children x 3 weeks)", totalSpots === 6, `got ${totalSpots}`);
}

console.log("\n=== Multi-week all-or-nothing: one requested week full -> whole submission rejected, no partial booking ===");
{
  await resetAll();
  for (let i = 0; i < 30; i++) {
    const r = await reserveRegistration(basicRegistrant(`fill-${i}`, { weekIds: ["aug03"] }));
    if (!r.ok) throw new Error("Unexpected fill failure");
  }
  const before = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE week_id='aug10' AND status='active'`)).rows[0].count);
  const result = await reserveRegistration(basicRegistrant("partial", { weekIds: ["aug03", "aug10"] }));
  const after = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE week_id='aug10' AND status='active'`)).rows[0].count);
  check("rejected because aug03 is full", !result.ok && result.reason === "weeks_full");
  check("aug10 did not receive a spot either (no partial booking)", before === after);
}

console.log("\n=== Scenario H: duplicate submission (double-click) with the same idempotency key ===");
{
  await resetAll();
  const input = basicRegistrant("dup", { weekIds: ["aug17"] });
  const [r1, r2] = await Promise.all([reserveRegistration(input), reserveRegistration(input)]);
  const spotCount = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE week_id='aug17' AND status='active'`)).rows[0].count);
  check("both calls returned ok", r1.ok && r2.ok);
  check("same registration id both times", r1.ok && r2.ok && r1.registrationId === r2.registrationId);
  check("exactly 1 spot created, not 2", spotCount === 1, `got ${spotCount}`);
}

console.log("\n=== Cancellation releases capacity atomically and is fully reusable ===");
{
  await resetAll();
  const reg = await reserveRegistration(
    basicRegistrant("cancel", {
      children: [
        { fullName: "K1", dateOfBirth: "2018-01-01", age: "8", healthInfo: "" },
        { fullName: "K2", dateOfBirth: "2019-01-01", age: "7", healthInfo: "" },
      ],
      weekIds: ["jun29"],
    })
  );
  const beforeCancel = (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id='jun29'`)).rows[0];
  check("2 spots taken before cancel", reg.ok && beforeCancel.taken_count === 2);

  const cancelResult = await cancelRegistration(reg.registrationId, "Parent requested refund");
  const afterCancel = (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id='jun29'`)).rows[0];
  check("cancel reports released week", cancelResult.releasedWeekIds.includes("jun29"));
  check("taken_count back to 0", afterCancel.taken_count === 0, `got ${afterCancel.taken_count}`);

  const auditRows = (await pool.query(`SELECT * FROM admin_audit_log WHERE target_id = $1`, [reg.registrationId])).rows;
  check("audit log entry written", auditRows.length === 1 && auditRows[0].action === "cancel_registration");

  for (let i = 0; i < 30; i++) {
    const r = await reserveRegistration(basicRegistrant(`refill-${i}`, { weekIds: ["jun29"] }));
    if (!r.ok) {
      check(`refill attempt ${i}`, false, JSON.stringify(r));
      break;
    }
  }
  const finalCount = (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id='jun29'`)).rows[0];
  check("released capacity fully reusable (30/30)", finalCount.taken_count === 30, `got ${finalCount.taken_count}`);
}

console.log("\n=== markRegistrationPaid is idempotent (duplicate click / duplicate notification) ===");
{
  await resetAll();
  const reg = await reserveRegistration(basicRegistrant("paid", { weekIds: ["aug24"] }));
  const [r1, r2] = await Promise.all([
    markRegistrationPaid(reg.registrationId, reg.confirmToken),
    markRegistrationPaid(reg.registrationId, reg.confirmToken),
  ]);
  check("both calls succeeded", r1 !== null && r2 !== null);
  check(
    "exactly one reports alreadyPaid=false, the other true",
    (r1.alreadyPaid === false && r2.alreadyPaid === true) || (r1.alreadyPaid === true && r2.alreadyPaid === false)
  );
  const final = (await pool.query(`SELECT status FROM registrations WHERE id=$1`, [reg.registrationId])).rows[0];
  check("final status is paid, not corrupted", final.status === "paid");

  const wrongToken = await markRegistrationPaid(reg.registrationId, "wrong-token-12345");
  check("wrong confirm token is rejected", wrongToken === null);
}

console.log("\n=== Admin cannot shrink capacity below the already-taken count ===");
{
  await resetAll();
  for (let i = 0; i < 5; i++) {
    await reserveRegistration(basicRegistrant(`cap-${i}`, { weekIds: ["jul06"] }));
  }
  const blocked = await adjustWeekCapacity("jul06", 3);
  check("shrinking below taken_count is rejected", blocked.ok === false && blocked.reason === "below_taken");
  const allowed = await adjustWeekCapacity("jul06", 10);
  check("raising capacity above taken_count is allowed", allowed.ok === true);
}

await resetAll();
await pool.end();

console.log(`\n\n${failures === 0 ? "ALL TESTS PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
