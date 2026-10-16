// Real concurrency tests for the camp capacity rules, against a real throwaway Postgres with
// real parallel connections (not simulated or mocked). They drive the exact functions the live
// API routes call.
//
// Run with:  DATABASE_URL=postgres://user:pass@localhost:5432/anydb npm run test:concurrency
// (The test creates its own temporary database, applies every migration to it, and drops it
// at the end. It refuses to run against anything but a local Postgres.)

import { createTestDatabase } from "./helpers/testdb.mjs";

// One connection per request, so the "simultaneous" bursts genuinely race inside Postgres.
process.env.DB_POOL_MAX ||= "40";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, reserveOk, fill, reg, confirmFor, expireHold, invariants } = h;
const { reserveRegistration, cancelRegistration, adjustWeekCapacity, releaseExpiredReservations } = campDb;

const weekRow = async (id) => (await pool.query(`SELECT taken_count, max_capacity FROM camp_weeks WHERE id = $1`, [id])).rows[0];

async function testBurst(n, weekId, prefillTo, expectedSuccesses) {
  await resetAll();
  await fill(weekId, prefillTo, "prefill");
  const start = Date.now();
  const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => reserveRegistration(input(`burst-${i}`, { weekIds: [weekId] }))));
  const elapsed = Date.now() - start;
  const values = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const succeeded = values.filter((r) => r.ok).length;
  const rejected = values.filter((r) => !r.ok && r.reason === "weeks_full").length;
  const errors = results.length - values.length;
  const week = await weekRow(weekId);
  console.log(`  ${n} simultaneous attempts (week pre-filled to ${prefillTo}/${week.max_capacity}), fired in ${elapsed}ms: succeeded=${succeeded} rejected=${rejected} errors=${errors}`);
  check(`exactly ${expectedSuccesses} succeeded`, succeeded === expectedSuccesses, `got ${succeeded}`);
  check("every other attempt was cleanly told the week is full", rejected === n - expectedSuccesses);
  check("zero unexpected errors (no deadlocks, no crashes)", errors === 0, `${errors} errors`);
  await invariants(`burst of ${n}`);
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

console.log("\n=== Multi-child burst: 40 families of 2 children race for one week — exactly 15 fit ===");
{
  await resetAll();
  const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => reserveRegistration(input(`pair-${i}`, { weekIds: ["jul13"], children: kids(2, `P${i}`) }))));
  const values = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  check("exactly 15 families (30 children) got in", values.filter((r) => r.ok).length === 15 && (await weekRow("jul13")).taken_count === 30);
  check("the other 25 were refused cleanly, and nothing threw", values.filter((r) => !r.ok && r.reason === "weeks_full").length === 25 && results.every((r) => r.status === "fulfilled"));
  await invariants("40 two-child families");
}

console.log("\n=== Mixed family sizes (1 to 3 children), 70 families at once ===");
{
  await resetAll();
  const sizes = Array.from({ length: 70 }, (_, i) => 1 + (i % 3));
  const results = await Promise.allSettled(sizes.map((n, i) => reserveRegistration(input(`mix-${i}`, { weekIds: ["jul20"], children: kids(n, `M${i}`) }))));
  const values = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const spots = (await weekRow("jul20")).taken_count;
  check("never more than 30 children in the week", spots <= 30, String(spots));
  check("nobody was half-booked: every successful family holds exactly one spot per child", (await pool.query(`SELECT count(*)::int AS n FROM registrations r WHERE r.status = 'pending_payment' AND (SELECT count(*) FROM registration_spots s WHERE s.registration_id = r.id AND s.status = 'active') <> (SELECT count(*) FROM children c WHERE c.registration_id = r.id)`)).rows[0].n === 0);
  check("and no unexpected errors", results.every((r) => r.status === "fulfilled") && values.every((r) => r.ok || r.reason === "weeks_full"));
  await invariants("mixed family sizes");
}

console.log("\n=== Scenario B: one parent, 3 children, same week ===");
{
  await resetAll();
  const result = await reserveRegistration(input("B", { children: kids(3, "B"), weekIds: ["jun22"] }));
  const week = (await pool.query(`SELECT taken_count, price_cents FROM camp_weeks WHERE id='jun22'`)).rows[0];
  check("registration succeeded", result.ok);
  check("3 spots allocated", week.taken_count === 3, `got ${week.taken_count}`);
  check("total price = 3 x weekly price", result.ok && result.totalPriceCents === week.price_cents * 3);
}

console.log("\n=== Scenario C: one parent, 2 children, 3 different weeks ===");
{
  await resetAll();
  const weekIds = ["jul13", "jul20", "jul27"];
  const result = await reserveRegistration(input("C", { children: kids(2, "C"), weekIds }));
  check("registration succeeded", result.ok);
  for (const weekId of weekIds) check(`${weekId} shows 2 spots taken`, (await weekRow(weekId)).taken_count === 2);
  const totalSpots = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE status='active'`)).rows[0].count);
  check("6 total spot rows (2 children x 3 weeks)", totalSpots === 6, `got ${totalSpots}`);
}

console.log("\n=== Multi-week all-or-nothing: one requested week full -> whole submission rejected, no partial booking ===");
{
  await resetAll();
  await fill("aug03", 30, "fill");
  const before = (await weekRow("aug10")).taken_count;
  const result = await reserveRegistration(input("partial", { weekIds: ["aug03", "aug10"] }));
  check("rejected because aug03 is full", !result.ok && result.reason === "weeks_full");
  check("aug10 did not receive a spot either (no partial booking)", before === (await weekRow("aug10")).taken_count);
}

console.log("\n=== Multi-week burst: 50 families (2 children x 2 weeks) race for the same two weeks — exactly 15 fit ===");
{
  await resetAll();
  const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => reserveRegistration(input(`mw-${i}`, { weekIds: i % 2 ? ["aug03", "aug10"] : ["aug10", "aug03"], children: kids(2, `W${i}`) }))));
  const values = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  check("exactly 15 families got both weeks", values.filter((r) => r.ok).length === 15);
  check("both weeks are exactly full, and equal (nobody got one week without the other)", (await weekRow("aug03")).taken_count === 30 && (await weekRow("aug10")).taken_count === 30);
  check("no deadlocks or other errors (the order of weeks in a request doesn't matter)", results.every((r) => r.status === "fulfilled"));
  await invariants("multi-week burst");
}

console.log("\n=== Overlapping week choices: 120 families, 1-2 children, 2-3 of 4 weeks in random orders ===");
{
  await resetAll();
  const pool4 = ["jul06", "jul13", "jul20", "jul27"];
  let seed = 12345; // a fixed seed keeps the "random" orders the same on every run
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const shuffled = (list) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const pick = (i) => shuffled(pool4).slice(0, 2 + (i % 2));
  const results = await Promise.allSettled(Array.from({ length: 120 }, (_, i) => reserveRegistration(input(`ov-${i}`, { weekIds: pick(i), children: kids(1 + (i % 2), `O${i}`) }))));
  const errors = results.filter((r) => r.status === "rejected");
  check("no errors at all — in particular no deadlocks between families who want overlapping weeks", errors.length === 0, errors.slice(0, 2).map((e) => String(e.reason?.message ?? e.reason)).join(" | "));
  check("every week ended at or below 30", (await pool.query(`SELECT count(*)::int AS n FROM camp_weeks WHERE taken_count > max_capacity`)).rows[0].n === 0);
  check("every refusal was a clean 'week is full'", results.filter((r) => r.status === "fulfilled").every((r) => r.value.ok || r.value.reason === "weeks_full"));
  await invariants("overlapping weeks");
}

console.log("\n=== Scenario H: duplicate submission (double-click) with the same idempotency key ===");
{
  await resetAll();
  const dup = input("dup", { weekIds: ["aug17"] });
  const [r1, r2] = await Promise.all([reserveRegistration(dup), reserveRegistration(dup)]);
  const spotCount = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE week_id='aug17' AND status='active'`)).rows[0].count);
  check("both calls returned ok", r1.ok && r2.ok);
  check("same registration id and same reference both times", r1.ok && r2.ok && r1.registrationId === r2.registrationId && r1.reference === r2.reference);
  check("exactly 1 spot created, not 2", spotCount === 1, `got ${spotCount}`);
  const many = input("dup-many", { weekIds: ["aug17"] });
  const burst = await Promise.all(Array.from({ length: 25 }, () => reserveRegistration(many)));
  check("25 simultaneous retries of one submission create exactly one registration", new Set(burst.map((r) => r.registrationId)).size === 1 && (await weekRow("aug17")).taken_count === 2);
}

console.log("\n=== Cancellation releases capacity atomically and is fully reusable ===");
{
  await resetAll();
  const r = await reserveRegistration(input("cancel", { children: kids(2, "K"), weekIds: ["jun29"] }));
  check("2 spots taken before cancel", r.ok && (await weekRow("jun29")).taken_count === 2);
  const [c1, c2] = await Promise.all([cancelRegistration(r.registrationId, "Parent requested refund"), cancelRegistration(r.registrationId, "Parent requested refund")]);
  check("cancelling twice at once is harmless: released exactly once", c1.ok && c2.ok && c1.releasedWeekIds.length + c2.releasedWeekIds.length === 1);
  check("taken_count back to 0 (not negative)", (await weekRow("jun29")).taken_count === 0);
  const auditRows = (await pool.query(`SELECT action FROM admin_audit_log WHERE target_id = $1`, [r.registrationId])).rows;
  check("exactly one cancel entry in the audit log", auditRows.filter((a) => a.action === "cancel_registration").length === 1);
  await fill("jun29", 30, "refill");
  check("released capacity fully reusable (30/30)", (await weekRow("jun29")).taken_count === 30);
}

console.log("\n=== Confirming payment is idempotent (duplicate click / two tabs / 20 at once) ===");
{
  await resetAll();
  const id = await reserveOk("paid", { weekIds: ["aug24"] });
  const [r1, r2] = await Promise.all([confirmFor(id), confirmFor(id)]);
  check("both calls succeeded", r1.ok && r2.ok);
  check("exactly one did the confirming, the other found it already paid", r1.ok && r2.ok && r1.alreadyPaid !== r2.alreadyPaid);
  check("final status is paid, holding its spot", (await reg(id)).status === "paid" && (await reg(id)).spotsActive === 1);
  check("only one confirm_payment audit entry", (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id=$1 AND action='confirm_payment'`, [id])).rows[0].n === 1);

  const id2 = await reserveOk("paid2", { weekIds: ["aug24"] });
  const twenty = await Promise.all(Array.from({ length: 20 }, () => confirmFor(id2)));
  check("20 simultaneous confirmations: all report success, exactly one actually confirmed", twenty.every((x) => x.ok) && twenty.filter((x) => !x.alreadyPaid).length === 1);
  check("...and the audit log has exactly one entry for it", (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id=$1 AND action='confirm_payment'`, [id2])).rows[0].n === 1);
}

console.log("\n=== Late payment: a released registration's deposit arrives while others grab the last spot ===");
{
  const winners = { late: 0, newcomer: 0 };
  for (let round = 0; round < 8; round++) {
    await resetAll();
    const late = await reserveOk(`late-${round}`, { weekIds: ["aug10"] });
    await expireHold(late, 1);
    await releaseExpiredReservations();
    await fill("aug10", 29, `late-fill-${round}`); // 29 of 30 taken: exactly one spot is free
    const [lateConfirm, ...newcomers] = await Promise.all([
      confirmFor(late),
      ...Array.from({ length: 10 }, (_, i) => reserveRegistration(input(`late-new-${round}-${i}`, { weekIds: ["aug10"] }))),
    ]);
    const newcomersIn = newcomers.filter((r) => r.ok).length;
    const lateWon = lateConfirm.ok;
    const oneWinner = lateWon ? newcomersIn === 0 : newcomersIn === 1;
    const week = await weekRow("aug10");
    const lateRow = await reg(late);
    check(`round ${round + 1}: exactly one party got the last spot (${lateWon ? "the late payer" : "a new family"}); the week is exactly full`, oneWinner && week.taken_count === 30, `late ok=${lateWon}, newcomers in=${newcomersIn}, taken=${week.taken_count}`);
    check(`round ${round + 1}: the loser was told cleanly, and a refused late payer stays released (never paid without a spot)`, lateWon ? lateRow.status === "paid" && lateRow.spotsActive === 1 : !lateConfirm.ok && lateConfirm.reason === "weeks_full" && lateRow.status === "cancelled" && lateRow.spotsActive === 0);
    winners[lateWon ? "late" : "newcomer"]++;
  }
  await invariants("late payment races");
  console.log(`  (over 8 rounds: the late payer won ${winners.late}, a new family won ${winners.newcomer})`);
}

console.log("\n=== Expiry under load: 30 holds lapse while 20 sweeps and 40 new families all run at once ===");
{
  await resetAll();
  const old = await fill("jul27", 30, "lapse");
  for (const id of old) await expireHold(id, 1);
  const results = await Promise.allSettled([
    ...Array.from({ length: 20 }, () => releaseExpiredReservations()),
    ...Array.from({ length: 40 }, (_, i) => reserveRegistration(input(`after-lapse-${i}`, { weekIds: ["jul27"] }))),
  ]);
  check("nothing threw", results.every((r) => r.status === "fulfilled"), results.filter((r) => r.status === "rejected").map((r) => String(r.reason?.message)).slice(0, 2).join(" | "));
  const released = (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE id = ANY($1::uuid[]) AND status = 'cancelled' AND release_reason = 'expired_unpaid'`, [old])).rows[0].n;
  check("all 30 lapsed holds were released", released === 30);
  const audits = (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'release_expired' AND target_id = ANY($1::text[])`, [old])).rows[0].n;
  check("...each exactly once, however many sweeps raced (30 audit entries, not more)", audits === 30, String(audits));
  const newcomers = results.slice(20).filter((r) => r.status === "fulfilled").map((r) => r.value);
  check("the freed week then took exactly 30 of the 40 new families", newcomers.filter((r) => r.ok).length === 30 && (await weekRow("jul27")).taken_count === 30);
  await invariants("expiry under load");
}

console.log("\n=== Admin cannot shrink capacity below the already-taken count ===");
{
  await resetAll();
  await fill("jul06", 5, "cap");
  const blocked = await adjustWeekCapacity("jul06", 3);
  check("shrinking below taken_count is rejected", blocked.ok === false && blocked.reason === "below_taken");
  const allowed = await adjustWeekCapacity("jul06", 10);
  check("lowering capacity above taken_count is allowed", allowed.ok === true);
  const needsAuth = await adjustWeekCapacity("jul06", 31);
  check("raising above 30 needs a recorded authorization (the plain adjust refuses)", needsAuth.ok === false && needsAuth.reason === "needs_authorization");
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("concurrency"));
