// "A parent paid but never tapped 'I've sent my payment'": can the owner still find the family,
// verify the real deposit and confirm it, without ever overbooking a week or displacing someone?
//
//   1. A registration nobody reported on can be confirmed straight from the bank, whatever state it is in
//      (still held, or released because no report came in).
//   2. The owner can FIND it from whatever the bank shows: the reference (typed any way), a name, the
//      email, a phone number, or the amount.
//   3. When the places were given to other families meanwhile, confirming is refused and NOTHING else
//      changes: no confirmed or held family loses a place, no week goes over its limit. The only ways
//      to make room are the owner's own recorded decisions.
//   4. The same, with two confirmations racing for the last place.
//   5. (Over HTTP, with the login, the recent password and the confirmation email: manual-confirm-http.test.mjs.)
// Real Postgres; nothing is mocked.

import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, reserveOk, confirmFor, expireHold, fill, reg, week, auditFor, invariants } = h;

const W = "2027-07-19";
const W2 = "2027-07-26";
const snapshotOthers = async (exceptId) =>
  JSON.stringify((await pool.query(`SELECT to_jsonb(r) AS row FROM registrations r WHERE id <> $1 ORDER BY id`, [exceptId])).rows.map((x) => x.row));
const spotSnapshot = async (exceptId) =>
  JSON.stringify((await pool.query(`SELECT to_jsonb(s) AS row FROM registration_spots s WHERE registration_id <> $1 ORDER BY id`, [exceptId])).rows.map((x) => x.row));

// ---------------------------------------------------------------------------
console.log("=== 1. Confirming a payment the parent never reported ===");
{
  await resetAll();
  const held = await reserveOk("never-clicked", { weekIds: [W], children: [{ fullName: "Hana Never-Clicked", dateOfBirth: "2017-01-01", age: "9", healthInfo: "None" }] });
  const before = await reg(held);
  check("setup: held, no report", before.status === "pending_payment" && before.payment_reported_at === null);
  const r = await confirmFor(held);
  const after = await reg(held);
  check("confirming it straight from the bank makes it Paid, with the verification record", r.ok && after.status === "paid" && after.verification_method === "reference_matched" && after.amount_received_cents === after.amount_due_cents && after.deposit_at !== null);
  check("its places are unchanged and the week count is unchanged", after.spotsActive === 1 && (await week(W)).taken_count === 1);
  check("the audit log says who confirmed what, and holds no personal details", JSON.stringify(await auditFor(held)).includes("confirm_payment") && !/Hana|example\.test/.test(JSON.stringify(await auditFor(held))));
  const queued = (await pool.query(`SELECT kind FROM email_outbox WHERE registration_id = $1 AND kind = 'parent_confirmation'`, [held])).rows.length;
  check("the family's confirmation email is queued in the same step", queued === 1);

  const lapsed = await reserveOk("lapsed", { weekIds: [W], children: [{ fullName: "Ivo Lapsed", dateOfBirth: "2017-02-02", age: "9", healthInfo: "None" }] });
  await expireHold(lapsed, 3);
  await campDb.releaseExpiredReservations();
  check("setup: the hold lapsed without a report, so it was released (places freed)", (await reg(lapsed)).status === "cancelled" && (await reg(lapsed)).spotsActive === 0 && (await week(W)).taken_count === 1);
  const late = await confirmFor(lapsed); // the deposit is dated now: inside the original 12-hour hold, so it was on time
  const lateAfter = await reg(lapsed);
  check("a genuine deposit for a released reservation brings the places back and confirms it", late.ok && late.reinstatedWeekIds.join() === W && lateAfter.status === "paid" && lateAfter.spotsActive === 1 && (await week(W)).taken_count === 2);
  check("it is recorded as a reinstatement, and as paid on time (the deposit was before the hold ended)", (await auditFor(lapsed)).some((a) => a.action === "reinstate_and_confirm_payment") && lateAfter.paid_on_time === true);
  await invariants("after confirming unreported payments");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Finding the family from what the bank shows ===");
{
  await resetAll();
  const id = await reserveOk("findme", {
    weekIds: [W],
    parentName: "Chantal Côté-Tremblay",
    email: "chantal.find@example.test",
    primaryPhone: "(514) 555-0142",
    secondaryPhone: "438-555-0177",
    children: [{ fullName: "Émilie Côté", dateOfBirth: "2016-03-03", age: "10", healthInfo: "None" }],
  });
  const r = await reg(id);
  const ref = r.reference_code;
  const dollars = (r.amount_due_cents / 100).toFixed(2);
  const find = async (q) => (await campDb.searchRegistrations(q)).map((x) => x.id);
  const hit = async (q) => (await find(q)).includes(id);
  check("by the reference as printed", await hit(ref));
  check("by the reference in lower case, without the dash, or with spaces", (await hit(ref.toLowerCase())) && (await hit(ref.replace("-", ""))) && (await hit(`gd ${ref.slice(3, 6)} ${ref.slice(6)}`.toLowerCase())), ref);
  check("by the parent's name or the child's name, in part", (await hit("Côté-Trem")) && (await hit("milie")));
  check("by the email address, in part", await hit("chantal.find@"));
  check("by the phone number, however it is written", (await hit("514-555-0142")) && (await hit("5145550142")) && (await hit("(514) 555 0142")) && (await hit("+1 514 555 0142")) && (await hit("438 555 0177")));
  check("by the amount, written the English or the French way", (await hit(dollars)) && (await hit(`$${dollars}`)) && (await hit(dollars.replace(".", ","))) && (await hit(`${dollars.replace(".", ",")} $`)), dollars);
  check("a random number finds nothing it should not", !(await hit("999.99")) && !(await hit("5149999999")));
  await confirmFor(id);
  check("an amount search looks at registrations that still need a payment: once paid, it no longer turns up for the amount", !(await hit(dollars)) && (await hit(ref)));
  const second = await reserveOk("second", { weekIds: [W], children: [{ fullName: "Zed Second", dateOfBirth: "2017-04-04", age: "9", healthInfo: "None" }] });
  await campDb.cancelRegistration(second, "no payment found", { releaseReason: "not_received" });
  check("a released registration is still found by its amount, so a late deposit can be matched", (await find(dollars)).includes(second));
  check("an empty or punctuation-only search returns nothing rather than everything", (await find("%")).length === 0 && (await find("_")).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. No one is overbooked or displaced ===");
{
  await resetAll();
  const target = await reserveOk("paid-late", { weekIds: [W], children: [{ fullName: "Kai Paidlate", dateOfBirth: "2017-05-05", age: "9", healthInfo: "None" }] });
  await expireHold(target, 2);
  await campDb.releaseExpiredReservations();
  const others = await fill(W, 30, "other");
  const firstTen = others.slice(0, 10);
  for (const id of firstTen) await confirmFor(id);
  await campDb.reportPayment(others[10]);
  check("setup: the released family's week is now full: 10 confirmed, 1 reported, 19 held", (await week(W)).taken_count === 30 && (await reg(target)).status === "cancelled");

  const beforeRegs = await snapshotOthers(target);
  const beforeSpots = await spotSnapshot(target);
  const refused = await confirmFor(target);
  check("the owner sees a real deposit, but confirming is refused: the week is full", !refused.ok && refused.reason === "weeks_full" && refused.fullWeekIds.join() === W, JSON.stringify(refused));
  check("the released registration stays released, with no places", (await reg(target)).status === "cancelled" && (await reg(target)).spotsActive === 0);
  check("no other registration changed in any way (status, hold, review, payment)", (await snapshotOthers(target)) === beforeRegs);
  check("no other family lost or gained a place", (await spotSnapshot(target)) === beforeSpots);
  check("the week is exactly full, not over", (await week(W)).taken_count === 30 && (await h.activeSpots(W)) === 30);
  check("nothing in the audit log says it was confirmed", !(await auditFor(target)).some((a) => /confirm/.test(a.action)));
  check("it can still be reinstated or confirmed later: nothing was lost", (await reg(target)).status === "cancelled" && (await reg(target)).reinstate_count === 0);

  const reinstate = await campDb.reinstateRegistration(target);
  check("the 'reinstate (awaiting)' route is refused the same way", !reinstate.ok && reinstate.reason === "weeks_full");

  // The owner's own recorded decisions are the only ways to make room.
  let aboveCeiling = false;
  try {
    aboveCeiling = (await campDb.authorizeWeekCapacity(W, 34, "ceiling must hold even with a reason")).ok === true;
  } catch {
    aboveCeiling = false;
  }
  check("authorizing above the ceiling of 33 is impossible", !aboveCeiling);
  const noReason = await campDb.authorizeWeekCapacity(W, 31, "");
  check("authorizing an extra place needs a written reason", !noReason.ok);
  const auth = await campDb.authorizeWeekCapacity(W, 31, "A coach can take one more camper; the family paid on time");
  check("the owner can authorize one extra place, with a reason", auth.ok);
  const done = await confirmFor(target);
  check("then the deposit can be confirmed; the week is 31 of 31", done.ok && (await week(W)).taken_count === 31 && (await reg(target)).status === "paid");
  check("and everybody else is still exactly as they were", (await snapshotOthers(target)) === beforeRegs);
  await invariants("after an authorized extra place");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. All or nothing, and a race for the last place ===");
{
  await resetAll();
  const two = await reserveOk("two-weeks", { weekIds: [W, W2], children: [{ fullName: "Mia Twoweeks", dateOfBirth: "2017-06-06", age: "9", healthInfo: "None" }] });
  await expireHold(two, 2);
  await campDb.releaseExpiredReservations();
  await fill(W2, 30, "fills-second-week");
  const r = await confirmFor(two);
  check("a deposit for two weeks, one now full: refused as a whole", !r.ok && r.reason === "weeks_full");
  check("no place is taken in the week that had room", (await week(W)).taken_count === 0 && (await reg(two)).spotsActive === 0);
}
{
  await resetAll();
  const [x, y] = await Promise.all([reserveOk("race-x", { weekIds: [W] }), reserveOk("race-y", { weekIds: [W] })]);
  for (const id of [x, y]) {
    await expireHold(id, 2);
  }
  await campDb.releaseExpiredReservations();
  await fill(W, 29, "almost-full");
  check("setup: two released reservations and 29 held places: exactly one place is free", (await week(W)).taken_count === 29 && (await reg(x)).status === "cancelled" && (await reg(y)).status === "cancelled");
  const results = await Promise.all([confirmFor(x), confirmFor(y)]);
  const won = results.filter((r) => r.ok).length;
  const refused = results.filter((r) => !r.ok && r.reason === "weeks_full").length;
  check("two deposits confirmed at the same moment for the last place: exactly one wins, one is refused", won === 1 && refused === 1, JSON.stringify(results.map((r) => r.ok ? "ok" : r.reason)));
  check("the week is exactly full, never 31", (await week(W)).taken_count === 30 && (await h.activeSpots(W)) === 30);
  await invariants("after the race");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. A deposit that does not match is refused, in plain terms, and changes nothing ===");
{
  await resetAll();
  const id = await reserveOk("mismatch", { weekIds: [W] });
  const r = await reg(id);
  const bad = [
    ["amount one cent short", await confirmFor(id, { amountReceivedCents: r.amount_due_cents - 1 }), "amount_mismatch"],
    ["another family's reference", await confirmFor(id, { referenceEntered: "GD-ZZZZZZ" }), "reference_mismatch"],
    ["a deposit dated in the future", await confirmFor(id, { depositAt: new Date(Date.now() + 3600_000) }), "deposit_in_future"],
    ["a deposit dated a day before the reservation", await confirmFor(id, { depositAt: new Date(Date.now() - 24 * 3600_000) }), "deposit_before_reservation"],
    ["a name/amount/time match without a note", await confirmFor(id, { method: "name_amount_time", referenceEntered: undefined, note: "" }), "invalid_input"],
  ];
  for (const [label, result, reason] of bad) check(`${label}: refused (${reason})`, !result.ok && result.reason === reason, JSON.stringify(result));
  check("and the registration is untouched", (await reg(id)).status === "pending_payment");
  const noRef = await confirmFor(id, { method: "name_amount_time", referenceEntered: undefined, note: "Sender name matches the parent; exact amount; arrived 9:41 pm" });
  check("a deposit that carries no reference can be matched by name, amount and time, with a written note", noRef.ok && (await reg(id)).verification_method === "name_amount_time" && (await reg(id)).verification_note.includes("9:41"));
  const other = await reserveOk("bank-number", { weekIds: [W] });
  const reuse = await confirmFor(other, { bankConfirmationNumber: "CAabc123" });
  const first = await reserveOk("bank-number-2", { weekIds: [W] });
  const dup = await confirmFor(first, { bankConfirmationNumber: "caabc123" });
  check("one bank confirmation number cannot confirm two registrations", reuse.ok && !dup.ok && dup.reason === "confirmation_number_in_use", JSON.stringify(dup));
}

await pool.end();
await testDb.drop();
process.exit(h.finish("manual-confirm"));
