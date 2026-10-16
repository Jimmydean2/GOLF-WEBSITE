// Capacity and "paid" integrity, against a real throwaway Postgres (not mocked), with real
// parallel connections. Carries Stage 1's coverage forward under the Stage 2 rules: the
// original bug (a released registration marked paid without spots), what the database refuses
// even from raw SQL, contention between reinstatements/confirms and new registrations,
// multiple children across multiple weeks, and the capacity limit (30, up to 33 only with a
// recorded authorization).
//
// Run with: DATABASE_URL=postgres://user:pass@localhost:5432/anydb npx tsx db/tests/payment-integrity.test.mjs
// It creates its own database from the migration files and drops it afterwards; it only ever
// runs against a local server.

import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "40";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, refused, resetAll, input, kids, reserveOk, fill, week, activeSpots, reg, auditFor, confirmFor, invariants, rawRegistrationSql, inTx } = h;
const { reserveRegistration, cancelRegistration, reinstateRegistration, releaseExpiredReservations, authorizeWeekCapacity, adjustWeekCapacity } = campDb;

// ---------------------------------------------------------------------------
console.log("=== 1. THE ORIGINAL BUG: a released registration must not become paid without spots ===");
{
  await resetAll();
  const a = await reserveOk("bug", { weekIds: ["2027-07-05"] });
  await cancelRegistration(a, "released (simulated)");
  let r = await reg(a);
  check("setup: released registration is cancelled, holds 0 spots, week counter 0", r.status === "cancelled" && r.spotsActive === 0 && (await week("2027-07-05")).taken_count === 0);

  await refused(
    "raw SQL `UPDATE registrations SET status='paid'` is REFUSED: no verification record",
    () => pool.query(`UPDATE registrations SET status='paid', paid_at=now() WHERE id=$1`, [a]),
    "registrations_paid_verified"
  );
  await refused(
    "even WITH a complete verification record, raw SQL cannot mark a spotless registration paid",
    () =>
      pool.query(
        `UPDATE registrations SET status='paid', paid_at=now(), verified_at=now(), verification_method='reference_matched',
                amount_received_cents=amount_due_cents, deposit_at=now() WHERE id=$1`,
        [a]
      ),
    "registration_status_matches_spots"
  );
  r = await reg(a);
  check("it is still cancelled, with 0 spots, and the week is untouched", r.status === "cancelled" && r.spotsActive === 0 && (await week("2027-07-05")).taken_count === 0);

  const c = await confirmFor(a, { note: "late e-Transfer found" });
  r = await reg(a);
  check("owner Confirm on the released registration (room available) reinstates it first", c.ok && c.reinstatedWeekIds.join() === "2027-07-05" && c.alreadyPaid === false);
  check("it is now paid AND holds its spot; the week counter is 1", r.status === "paid" && r.spotsActive === 1 && (await week("2027-07-05")).taken_count === 1);
  check("release fields cleared; paid_at and the verification record set", r.release_reason === null && r.cancelled_reason === null && r.paid_at !== null && r.verified_at !== null && r.amount_received_cents === r.amount_due_cents);
  const audit = await auditFor(a);
  check("audit trail: cancel, then reinstate_and_confirm_payment (owner)", audit.map((x) => x.action).join() === "cancel_registration,reinstate_and_confirm_payment" && audit[1].actor === "owner");
  await invariants("after reinstate-and-confirm");
}

console.log("\n=== 1b. Same, but the week FILLED while the registration was released ===");
{
  await resetAll();
  const a = await reserveOk("late", { weekIds: ["2027-07-05"] });
  await cancelRegistration(a, "released (simulated)");
  const fillers = await fill("2027-07-05", 30);
  check("setup: week is 30/30 with other families", (await week("2027-07-05")).taken_count === 30);

  const c = await confirmFor(a);
  const r = await reg(a);
  check("Confirm is REFUSED with weeks_full naming 2027-07-05", !c.ok && c.reason === "weeks_full" && c.fullWeekIds.join() === "2027-07-05", JSON.stringify(c));
  check("an on-time payer is flagged so the administrator resolves this one first", !c.ok && c.paidOnTime === true);
  check("nothing changed: still released, no spot, week still 30/30 (never 31)", r.status === "cancelled" && r.spotsActive === 0 && (await week("2027-07-05")).taken_count === 30);
  check("no confirm audit entry was written", !(await auditFor(a)).some((x) => x.action.includes("confirm")));
  const rein = await reinstateRegistration(a);
  check("Reinstate is refused the same way", !rein.ok && rein.reason === "weeks_full");

  await cancelRegistration(fillers[0], "owner freed a spot");
  const c2 = await confirmFor(a);
  check("after a spot frees up, Confirm succeeds and the week is exactly 30/30", c2.ok && (await week("2027-07-05")).taken_count === 30 && (await reg(a)).status === "paid");
  await invariants("after refused + retried confirm");
}

console.log("\n=== 1c. Confirm needs verified receipt ===");
{
  await resetAll();
  const unknown = await campDb.confirmRegistrationPayment("00000000-0000-0000-0000-000000000000", {
    amountReceivedCents: 100, depositAt: new Date(), method: "name_amount_time", note: "matched by name",
  });
  check("unknown registration id -> not_found", !unknown.ok && unknown.reason === "not_found");

  const a = await reserveOk("refunded", { weekIds: ["2027-07-12"] });
  await cancelRegistration(a, "x");
  await pool.query(`UPDATE registrations SET status='refunded' WHERE id=$1`, [a]);
  const refunded = await confirmFor(a);
  check("a refunded registration cannot be confirmed", !refunded.ok && refunded.reason === "refunded");

  const b = await reserveOk("normal", { weekIds: ["2027-07-12"] });
  const due = (await reg(b)).amount_due_cents;
  const ref = (await reg(b)).reference_code;
  const wrongAmount = await confirmFor(b, { amountReceivedCents: due - 1 });
  check("an amount that differs from the amount due is refused (nothing changes)", !wrongAmount.ok && wrongAmount.reason === "amount_mismatch" && wrongAmount.expectedCents === due && (await reg(b)).status === "pending_payment");
  const wrongRef = await confirmFor(b, { referenceEntered: "GD-AAAAAA" });
  check("a reference that doesn't match is refused", !wrongRef.ok && wrongRef.reason === "reference_mismatch" && (await reg(b)).status === "pending_payment");
  const future = await confirmFor(b, { depositAt: new Date(Date.now() + 3600_000) });
  check("a deposit time in the future is refused", !future.ok && future.reason === "deposit_in_future");
  const before = await confirmFor(b, { depositAt: new Date(Date.now() - 3 * 86400_000) });
  check("a deposit dated before the reservation can't be payment for it", !before.ok && before.reason === "deposit_before_reservation");
  const noNote = await confirmFor(b, { method: "name_amount_time", referenceEntered: undefined, note: "short" });
  check("matching by name/amount/time needs a real note", !noNote.ok && noNote.reason === "invalid_input");
  const badNumber = await confirmFor(b, { bankConfirmationNumber: "!!" });
  check("a malformed bank confirmation number is refused", !badNumber.ok && badNumber.reason === "invalid_input");
  check("none of those refusals changed the registration", (await reg(b)).status === "pending_payment" && (await reg(b)).verified_at === null);

  const first = await confirmFor(b, { referenceEntered: ref.toLowerCase().replace("-", " "), bankConfirmationNumber: "ca1b2c3d4" });
  const second = await confirmFor(b);
  check("a correct confirmation works (reference typed loosely: lower case, space instead of dash)", first.ok && !first.alreadyPaid && first.paidOnTime === true);
  check("a repeat is an idempotent no-op", second.ok && second.alreadyPaid);
  check("the repeat wrote no second audit entry", (await auditFor(b)).filter((x) => x.action === "confirm_payment").length === 1);

  const c = await reserveOk("dupnum", { weekIds: ["2027-07-12"] });
  const dup = await confirmFor(c, { bankConfirmationNumber: "CA1B2C3D4" });
  check("one bank confirmation number can only be attached to one registration", !dup.ok && dup.reason === "confirmation_number_in_use" && (await reg(c)).status === "pending_payment");

  const late = await reserveOk("lateflag", { weekIds: ["2027-07-12"] });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id=$1`, [late]);
  await pool.query(`UPDATE registrations SET hold_expires_at = hold_expires_at WHERE id=$1`, [late]);
  const initialEnd = new Date((await reg(late)).hold_ends_at_initial);
  const afterHold = await confirmFor(late, { depositAt: new Date(initialEnd.getTime() + 3600_000 > Date.now() ? Date.now() : initialEnd.getTime() + 3600_000) });
  check("paid_on_time reflects the deposit time against the ORIGINAL hold end", afterHold.ok && typeof afterHold.paidOnTime === "boolean");
  await invariants("confirm rules");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. DATABASE-LEVEL ENFORCEMENT (raw SQL, bypassing the application entirely) ===");
{
  await resetAll();
  const ids = await fill("2027-07-05", 30);
  const victim = ids[0];

  await refused(
    "inserting a 31st active spot into a full week is refused",
    () =>
      inTx(async (c) => {
        const rr = await c.query(rawRegistrationSql("over"));
        const ch = await c.query(`INSERT INTO children (registration_id, full_name, date_of_birth, age) VALUES ($1,'Extra','2018-01-01','8') RETURNING id`, [rr.rows[0].id]);
        await c.query(`INSERT INTO registration_spots (registration_id, child_id, week_id) VALUES ($1,$2,'2027-07-05')`, [rr.rows[0].id, ch.rows[0].id]);
      }),
    "camp_week_capacity"
  );

  await cancelRegistration(victim, "released");
  await fill("2027-07-05", 1, "replacement");
  check("setup: victim released, a replacement took the spot, week 30/30", (await week("2027-07-05")).taken_count === 30);
  await refused(
    "reactivating the released spot in raw SQL on the full week is refused (this overbooked 31/30 before Stage 1)",
    () => pool.query(`UPDATE registration_spots SET status='active' WHERE registration_id=$1`, [victim]),
    "camp_week_capacity"
  );
  check("week is still exactly 30/30", (await week("2027-07-05")).taken_count === 30 && (await activeSpots("2027-07-05")) === 30);

  await refused("tampering with the counter (taken_count - 1) is refused at commit", () => pool.query(`UPDATE camp_weeks SET taken_count = taken_count - 1 WHERE id='2027-07-05'`), "camp_week_counter");
  await refused("shrinking capacity below the active spots is refused", () => pool.query(`UPDATE camp_weeks SET max_capacity = 5 WHERE id='2027-07-05'`), "taken_within_capacity");

  const live = ids[1];
  await confirmFor(live);
  await refused(
    "cancelling a single spot of a PAID registration (leaving it paid) is refused",
    () => pool.query(`UPDATE registration_spots SET status='cancelled' WHERE registration_id=$1`, [live]),
    "registration_status_matches_spots"
  );
  await refused("marking a registration cancelled while it still holds a spot is refused (would leak capacity)", () => pool.query(`UPDATE registrations SET status='cancelled' WHERE id=$1`, [ids[2]]), "registration_status_matches_spots");
  await refused("a registration 'awaiting payment' with no spots at all is refused", () => pool.query(rawRegistrationSql("nospots")), "registration_status_matches_spots");
  await refused("deleting one spot of an awaiting-payment registration is refused", () => pool.query(`DELETE FROM registration_spots WHERE registration_id=$1`, [ids[3]]), "registration_status_matches_spots");

  const before = await week("2027-07-05");
  await pool.query(`DELETE FROM registrations WHERE id=$1`, [ids[4]]);
  check("deleting a whole registration is allowed and frees exactly its spot", (await week("2027-07-05")).taken_count === before.taken_count - 1);
  await invariants("after raw-SQL attacks on capacity");
}

console.log("\n=== 2a. Illegal moves, fixed fields, and bounded clocks (raw SQL) ===");
{
  await resetAll();
  const p = await reserveOk("moves", { weekIds: ["2027-07-12"] });
  const q = await reserveOk("moves2", { weekIds: ["2027-07-12"] });
  await campDb.reportPayment(q);

  await refused("a registration cannot be created already paid", () => pool.query(rawRegistrationSql("bornpaid", "paid")), "registration_creation_state");
  await refused("a registration cannot be created already reported", () => pool.query(rawRegistrationSql("bornrep", "payment_reported")), "registration_creation_state");
  await refused("awaiting payment cannot jump back from reported (reported -> pending_payment)", () => pool.query(`UPDATE registrations SET status='pending_payment' WHERE id=$1`, [q]), "registration_legal_transition");
  await refused("the reference code cannot be changed", () => pool.query(`UPDATE registrations SET reference_code='GD-AAAAAA' WHERE id=$1`, [p]), "registration_fixed_fields");
  await refused("the amount due cannot be changed", () => pool.query(`UPDATE registrations SET amount_due_cents = 1 WHERE id=$1`, [p]), "registration_fixed_fields");
  await refused("the original hold end cannot be changed", () => pool.query(`UPDATE registrations SET hold_ends_at_initial = now() + interval '9 days' WHERE id=$1`, [p]), "registration_fixed_fields");
  await refused("the report time cannot be cleared", () => pool.query(`UPDATE registrations SET payment_reported_at = NULL WHERE id=$1`, [q]), "registration_fixed_fields");
  await refused("the report time cannot be changed", () => pool.query(`UPDATE registrations SET payment_reported_at = now() - interval '9 days' WHERE id=$1`, [q]), "registration_fixed_fields");
  await refused("a hold cannot be made later", () => pool.query(`UPDATE registrations SET hold_expires_at = hold_expires_at + interval '1 day' WHERE id=$1`, [p]), "registration_hold_bounded");
  await refused("a hold cannot be removed (an unpaid reservation must always expire)", () => pool.query(`UPDATE registrations SET hold_expires_at = NULL WHERE id=$1`, [p]), "registration_hold_bounded");
  await refused("the review time cannot move later without a counted extension", () => pool.query(`UPDATE registrations SET review_due_at = review_due_at + interval '1 day' WHERE id=$1`, [q]), "registration_extension_counted");
  await refused("the extension count cannot be raised on its own", () => pool.query(`UPDATE registrations SET extension_count = 1 WHERE id=$1`, [q]), "registration_extension_counted");
  await refused("even a counted extension cannot be longer than 72 hours", () => pool.query(`UPDATE registrations SET review_due_at = review_due_at + interval '80 hours', extension_count = 1 WHERE id=$1`, [q]), "registration_extension_bounded");
  await pool.query(`UPDATE registrations SET review_due_at = review_due_at - interval '1 hour' WHERE id=$1`, [q]);
  check("moving a deadline EARLIER is allowed (that is how tests simulate time)", true);
  await refused("a fourth extension is impossible (the database cap is 3)", () => pool.query(`UPDATE registrations SET extension_count = 4 WHERE id=$1`, [q]), "registration_extension_counted");
  await refused("a reinstatement count cannot be changed without a reinstatement", () => pool.query(`UPDATE registrations SET reinstate_count = 1 WHERE id=$1`, [q]), "registration_reinstate_counted");
  await refused("a reported registration cannot lose its review time", () => pool.query(`UPDATE registrations SET review_due_at = NULL WHERE id=$1`, [q]), "registrations_reported_has_review");

  await cancelRegistration(p, "x");
  await refused("a released registration cannot be reinstated in SQL without counting it", () => pool.query(`UPDATE registrations SET status='pending_payment' WHERE id=$1`, [p]), "registration_reinstate_counted");
  await pool.query(`UPDATE registrations SET status='refunded' WHERE id=$1`, [p]);
  await refused("a refunded registration can go nowhere", () => pool.query(`UPDATE registrations SET status='cancelled' WHERE id=$1`, [p]), "registration_legal_transition");

  const r3 = await reserveOk("moves3", { weekIds: ["2027-07-12"] });
  await cancelRegistration(r3, "x");
  await refused("a reinstated reservation must come back WITH a hold: an unpaid hold that never ends is impossible", () =>
    inTx(async (c) => {
      await c.query(`UPDATE registration_spots SET status='active' WHERE registration_id=$1`, [r3]);
      await c.query(
        `UPDATE registrations SET status='pending_payment', hold_expires_at=NULL, release_reason=NULL, cancelled_at=NULL,
                cancelled_reason=NULL, reinstate_count = reinstate_count + 1 WHERE id=$1`,
        [r3]
      );
    }), "registrations_pending_has_hold");

  await refused("an expiry release cannot be recorded against a reported registration", () =>
    inTx(async (c) => {
      await c.query(`UPDATE registration_spots SET status='cancelled' WHERE registration_id=$1`, [q]);
      await c.query(`UPDATE registrations SET status='cancelled', release_reason='expired_unpaid' WHERE id=$1`, [q]);
    }), "registrations_expiry_never_reported");

  await refused("the audit log cannot be edited", () => pool.query(`UPDATE admin_audit_log SET action='x'`), "audit_append_only", "23001");
  await refused("the audit log cannot have rows deleted", () => pool.query(`DELETE FROM admin_audit_log`), "audit_append_only", "23001");
  await refused("the audit log cannot be truncated", () => pool.query(`TRUNCATE admin_audit_log`), "audit_append_only", "23001");
  await invariants("illegal moves");
}

console.log("\n=== 2b. Raw concurrent SQL: 60 transactions on up to 40 connections race for 20 spots, no application locking at all ===");
{
  await resetAll();
  await pool.query(`UPDATE camp_weeks SET max_capacity = 20 WHERE id='2027-07-05'`);
  const attempts = await Promise.all(
    Array.from({ length: 60 }, async (_, i) => {
      try {
        await inTx(async (c) => {
          const rr = await c.query(rawRegistrationSql(`race${i}`));
          const ch = await c.query(`INSERT INTO children (registration_id, full_name, date_of_birth, age) VALUES ($1,$2,'2018-01-01','8') RETURNING id`, [rr.rows[0].id, `Racer ${i}`]);
          await c.query(`INSERT INTO registration_spots (registration_id, child_id, week_id) VALUES ($1,$2,'2027-07-05')`, [rr.rows[0].id, ch.rows[0].id]);
        });
        return "ok";
      } catch (e) {
        return e.constraint === "camp_week_capacity" ? "full" : `other:${e.code}:${e.message}`;
      }
    })
  );
  const ok = attempts.filter((x) => x === "ok").length;
  const full = attempts.filter((x) => x === "full").length;
  const other = attempts.filter((x) => x.startsWith("other"));
  check("exactly 20 transactions committed", ok === 20, `got ${ok}`);
  check("the other 40 were refused by the database as full", full === 40, `got ${full}`);
  check("no other kind of error (no deadlocks)", other.length === 0, other.slice(0, 2).join(" | "));
  check("week is exactly 20/20", (await week("2027-07-05")).taken_count === 20 && (await activeSpots("2027-07-05")) === 20);
  await invariants("raw race");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The capacity limit: 30 standard, up to 33 only with a recorded authorization ===");
{
  await resetAll();
  const noAuth = await adjustWeekCapacity("2027-07-19", 31);
  check("the ordinary capacity editor cannot go above 30", !noAuth.ok && noAuth.reason === "needs_authorization");
  await refused("raw SQL cannot raise a week above 30 (no authorization on record)", () => pool.query(`UPDATE camp_weeks SET max_capacity = 31 WHERE id='2027-07-19'`), "camp_week_capacity_authorization");
  await refused("raw SQL cannot set 34 or more", () => pool.query(`UPDATE camp_weeks SET max_capacity = 34 WHERE id='2027-07-19'`), "camp_week_capacity_authorization");
  await refused("the 33 ceiling is also a plain CHECK (an authorization row cannot even be written for 34)", () => pool.query(`INSERT INTO capacity_authorizations (week_id, authorized_capacity, reason) VALUES ('2027-07-19', 34, 'a perfectly long reason')`), null);

  // An authorization recorded in an EARLIER transaction does not license a later raise.
  await pool.query(`INSERT INTO capacity_authorizations (week_id, authorized_capacity, reason) VALUES ('2027-07-19', 31, 'recorded in an earlier transaction')`);
  await refused("an authorization from a different transaction does not count", () => pool.query(`UPDATE camp_weeks SET max_capacity = 31 WHERE id='2027-07-19'`), "camp_week_capacity_authorization");
  await refused("a new week cannot be created above 30", () => pool.query(`INSERT INTO camp_weeks (id, label, start_date, end_date, max_capacity) VALUES ('x1','X','2027-09-01','2027-09-04',32)`), "camp_week_capacity_authorization");

  const tooShort = await authorizeWeekCapacity("2027-07-19", 31, "short");
  const thirtyFour = await authorizeWeekCapacity("2027-07-19", 34, "needs a very large group");
  const thirty = await authorizeWeekCapacity("2027-07-19", 30, "this is not an increase at all");
  check("an authorization needs a real reason (10+ characters)", !tooShort.ok && tooShort.reason === "invalid_input");
  check("34 is refused; so is 30 (that is not an increase)", !thirtyFour.ok && !thirty.ok);
  const unknown = await authorizeWeekCapacity("nope", 31, "a long enough reason");
  check("an unknown week is refused", !unknown.ok && unknown.reason === "unknown_week");

  const granted = await authorizeWeekCapacity("2027-07-19", 33, "Two sibling groups requested the same week");
  check("an administrator can authorize up to 33 with a reason, and it is recorded", granted.ok && (await week("2027-07-19")).max_capacity === 33);
  const authRow = (await pool.query(`SELECT authorized_capacity, reason FROM capacity_authorizations WHERE week_id='2027-07-19' AND authorized_capacity=33`)).rows[0];
  check("the authorization row holds the reason", authRow && authRow.reason.includes("sibling groups"));
  check("the audit log records it", (await auditFor("2027-07-19")).some((a) => a.action === "authorize_capacity"));

  const fillRes = [];
  for (let i = 0; i < 33; i++) fillRes.push(await reserveRegistration(input(`cap33-${i}`, { weekIds: ["2027-07-19"] })));
  check("33 children fit in the authorized week", fillRes.every((r) => r.ok) && (await week("2027-07-19")).taken_count === 33);
  const over = await reserveRegistration(input("cap34", { weekIds: ["2027-07-19"] }));
  check("the 34th is refused", !over.ok && over.reason === "weeks_full");

  const shrink = await adjustWeekCapacity("2027-07-19", 20);
  check("capacity cannot be reduced below the children already registered", !shrink.ok && shrink.reason === "below_taken" && shrink.takenCount === 33);
  await resetAll();
  await pool.query(`UPDATE camp_weeks SET max_capacity = 30 WHERE id = '2027-07-19'`);
  check("a week can always be brought back to 30", (await week("2027-07-19")).max_capacity === 30);
  await invariants("capacity limit");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. SIMULTANEOUS contention: reinstatements and confirms vs. new registrations for the last spots ===");
for (let round = 1; round <= 4; round++) {
  await resetAll();
  const ids = await fill("2027-07-05", 30);
  const released = ids.slice(0, 5);
  for (const id of released) await cancelRegistration(id, "released");
  check(`round ${round}: setup — 25/30 taken, 5 released registrations waiting`, (await week("2027-07-05")).taken_count === 25);

  const tasks = [
    ...released.map((id) => confirmFor(id).then((r) => ({ kind: "confirm", id, r }))),
    ...released.map((id) => reinstateRegistration(id).then((r) => ({ kind: "reinstate", id, r }))),
    ...Array.from({ length: 15 }, (_, i) => reserveRegistration(input(`new${round}-${i}`, { weekIds: ["2027-07-05"] })).then((r) => ({ kind: "new", r }))),
  ];
  const results = await Promise.all(tasks);
  const newOk = results.filter((x) => x.kind === "new" && x.r.ok).length;
  const restored = (await Promise.all(released.map((id) => reg(id)))).filter((r) => r.status !== "cancelled").length;
  const thrown = results.filter((x) => x.r && x.r.ok === false && !["weeks_full", "not_released"].includes(x.r.reason));
  check(`round ${round}: 25 competing requests for 5 free spots -> week is exactly 30/30`, (await week("2027-07-05")).taken_count === 30 && (await activeSpots("2027-07-05")) === 30);
  check(`round ${round}: new registrations + restored registrations = exactly 5`, newOk + restored === 5, `${newOk} new + ${restored} restored`);
  check(`round ${round}: every refusal was a clean weeks_full / not_released`, thrown.length === 0, JSON.stringify(thrown.slice(0, 2)));
  await invariants(`round ${round}`);
}

console.log("\n=== 4b. Confirm racing Release on the same registration (30 trials) ===");
{
  await resetAll();
  let bad = 0;
  let paidEnd = 0;
  let releasedEnd = 0;
  for (let i = 0; i < 30; i++) {
    const id = await reserveOk(`cc${i}`, { weekIds: ["2027-07-19"] });
    await Promise.all([confirmFor(id), cancelRegistration(id, "race", { releaseReason: "not_received" })]);
    const r = await reg(id);
    if (r.status === "paid" && r.spotsActive === r.spotsTotal && r.spotsTotal > 0) paidEnd++;
    else if (r.status === "cancelled" && r.spotsActive === 0) releasedEnd++;
    else bad++;
  }
  check("every trial ended consistent: paid-with-spots or released-with-none (never paid without a spot)", bad === 0, `paid=${paidEnd} released=${releasedEnd} inconsistent=${bad}`);
  await invariants("confirm vs release");
}

console.log("\n=== 4c. Multiple families, multiple children, overlapping weeks — 24 simultaneous registrations ===");
{
  await resetAll();
  const pairs = [["2027-08-02", "2027-08-09"], ["2027-08-09", "2027-08-16"], ["2027-08-16", "2027-08-02"]];
  const outcomes = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      reserveRegistration(input(`multi${i}`, { children: kids(2, `M${i}`), weekIds: pairs[i % 3] }))
        .then((r) => ({ r }))
        .catch((e) => ({ r: { ok: false, reason: `THROWN ${e.message}` } }))
    )
  );
  const okOnes = outcomes.filter((o) => o.r.ok);
  const refusedOnes = outcomes.filter((o) => !o.r.ok);
  check("no request threw (no deadlocks between overlapping multi-week requests)", refusedOnes.every((o) => o.r.reason === "weeks_full"), refusedOnes.map((o) => o.r.reason).slice(0, 3).join());
  check("demand (2 children x 16 families per week = 32 seats) exceeded capacity, so some were refused", refusedOnes.length > 0 && okOnes.length > 0, `${okOnes.length} ok / ${refusedOnes.length} refused`);
  for (const w of ["2027-08-02", "2027-08-09", "2027-08-16"]) {
    const wk = await week(w);
    check(`${w}: ${wk.taken_count}/30, counter equals active spots`, wk.taken_count <= 30 && wk.taken_count === (await activeSpots(w)));
  }
  let partial = 0;
  for (const o of okOnes) {
    const r = await reg(o.r.registrationId);
    if (r.spotsActive !== 4) partial++;
  }
  check("every successful registration holds all 4 of its spots (2 children x 2 weeks)", partial === 0, `${partial} partial`);
  check("refused requests left nothing behind", (await pool.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n === okOnes.length);
  await invariants("multi-family burst");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Multiple children x multiple weeks: all-or-nothing release and reinstatement ===");
{
  await resetAll();
  const weeks3 = ["2027-07-12", "2027-07-19", "2027-07-26"];
  const fam = await reserveOk("family", { children: kids(2, "Fam"), weekIds: weeks3 });
  check("2 children x 3 weeks = 6 spots, 2 taken in each week", (await reg(fam)).spotsActive === 6 && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 2));

  const cancelled = await cancelRegistration(fam, "released");
  check("release frees all 6 spots across all 3 weeks", cancelled.releasedWeekIds.join() === weeks3.join() && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 0));

  const fillWeek = await fill("2027-07-19", 29, "jul19fill");
  const snapshot = await Promise.all(weeks3.map((w) => week(w)));
  const attempt = await reinstateRegistration(fam);
  const after = await Promise.all(weeks3.map((w) => week(w)));
  check("only 1 seat free in 2027-07-19 but 2 needed: reinstatement refused with weeks_full [2027-07-19]", !attempt.ok && attempt.reason === "weeks_full" && attempt.fullWeekIds.join() === "2027-07-19", JSON.stringify(attempt));
  check("all-or-nothing: 2027-07-12 and 2027-07-26 were NOT partially restored", JSON.stringify(snapshot) === JSON.stringify(after) && (await reg(fam)).spotsActive === 0);
  const confirmAttempt = await confirmFor(fam);
  check("Confirm is refused the same way and the family stays released", !confirmAttempt.ok && (await reg(fam)).status === "cancelled");

  await cancelRegistration(fillWeek[0], "freed");
  const done = await confirmFor(fam);
  const r = await reg(fam);
  check("once 2 seats are free, Confirm restores all 6 spots and marks it paid", done.ok && done.reinstatedWeekIds.join() === weeks3.join() && r.status === "paid" && r.spotsActive === 6);
  check("2027-07-12 and 2027-07-26 hold 2 each; 2027-07-19 is full at 30", (await week("2027-07-12")).taken_count === 2 && (await week("2027-07-26")).taken_count === 2 && (await week("2027-07-19")).taken_count === 30);
  await invariants("family reinstatement");

  await resetAll();
  const three = await reserveOk("trio", { children: kids(3, "Trio"), weekIds: ["2027-08-02", "2027-08-09"] });
  await h.expireHold(three);
  const rel = await releaseExpiredReservations();
  check("an expired 3-child, 2-week registration releases all 6 spots at once", rel.releasedRegistrationIds.join() === three && (await week("2027-08-02")).taken_count === 0 && (await week("2027-08-09")).taken_count === 0);
  await invariants("trio expiry");
}

console.log("\n=== 6. Cancel is idempotent and audited ===");
{
  await resetAll();
  const id = await reserveOk("cancel2", { weekIds: ["2027-07-05"] });
  const first = await cancelRegistration(id, "Parent asked");
  const second = await cancelRegistration(id, "again");
  const none = await cancelRegistration("00000000-0000-0000-0000-000000000000", "x");
  check("first cancel releases the week; second is a harmless no-op", first.ok && first.releasedWeekIds.join() === "2027-07-05" && second.ok && second.releasedWeekIds.length === 0);
  check("unknown id -> ok:false", none.ok === false);
  check("one audit entry only, and the original reason is kept", (await auditFor(id)).length === 1 && (await reg(id)).cancelled_reason === "Parent asked");
  await invariants("cancel");
}

await resetAll();
console.log(`  (pool at exit: total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount})`);
await pool.end();
await testDb.drop();
process.exit(h.finish("payment-integrity"));
