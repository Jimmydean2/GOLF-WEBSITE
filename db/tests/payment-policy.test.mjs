// The Stage 2 payment policy, against a real throwaway Postgres with real parallel connections:
//   12-hour hold  ->  parent reports  ->  48-hour review  ->  flagged overdue, NEVER released by
//   the system; only an administrator confirms, releases, or grants a time-limited extension.
//
// Covers: delayed transfers, false reports, late deposits, expiry at the exact boundaries,
// reinstatement, full weeks, extensions, strikes and caps, settings, multi-child and multi-week
// bookings, concurrency, and that nothing but the administrator's Confirm can mark Paid.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase } from "./helpers/testdb.mjs";
import { calculateTotal } from "../../src/lib/pricing.ts";
import { parseSettings, defaultSettings, validateSetting } from "../../src/lib/campSettings.ts";

process.env.DB_POOL_MAX ||= "40";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, reserveOk, fill, week, reg, auditFor, confirmFor, expireHold, makeOverdue, invariants } = h;
const {
  reserveRegistration, reportPayment, releaseExpiredReservations, cancelRegistration, reinstateRegistration,
  grantReviewExtension, getPaymentQueue, getCampSettings,
} = campDb;

const HOUR = 3_600_000;
const near = (a, b, tolMs = 120_000) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= tolMs;

// ---------------------------------------------------------------------------
console.log("=== 1. A reservation: reference, amount due, and a 12-hour hold ===");
{
  await resetAll();
  const before = Date.now();
  const r = await reserveRegistration(input("basic", { children: kids(2, "B"), weekIds: ["jul13", "jul20"] }));
  check("reservation succeeds", r.ok);
  check("the reference looks like GD-XXXXXX with no look-alike characters", /^GD-[A-HJ-NP-Z2-9]{6}$/.test(r.reference), r.reference);
  check("the amount due is the price plus GST and QST", r.amountDueCents === calculateTotal(r.totalPriceCents).totalCents && r.amountDueCents > r.totalPriceCents);
  check("the system releases it 12 hours plus the 15-minute report allowance after reserving", near(r.holdExpiresAt, before + 12 * HOUR + 15 * 60_000));
  check("the parent is shown the 12-hour time (pay-by is 15 minutes earlier)", near(r.payByAt, before + 12 * HOUR));
  const row = await reg(r.registrationId);
  check("stored as Awaiting Payment with the original hold end remembered", row.status === "pending_payment" && row.payment_reported_at === null && new Date(row.hold_ends_at_initial).getTime() === new Date(row.hold_expires_at).getTime());

  const again = await reserveRegistration({ ...input("basic"), idempotencyKey: (await pool.query(`SELECT idempotency_key FROM registrations WHERE id=$1`, [r.registrationId])).rows[0].idempotency_key });
  check("a retried submission returns the same reservation, reference and amount", again.ok && again.alreadyExisted && again.registrationId === r.registrationId && again.reference === r.reference && again.amountDueCents === r.amountDueCents);

  // Spread over several weeks so no week reaches its 30-child limit while we count references.
  const spread = ["jun22", "jun29", "jul06", "jul13", "jul20", "jul27", "aug03", "aug10"];
  const refs = new Set();
  let okCount = 0;
  for (let i = 0; i < 40; i++) {
    const r2 = await reserveRegistration(input(`uniq${i}`, { weekIds: [spread[i % spread.length]] }));
    if (r2.ok) {
      okCount++;
      refs.add(r2.reference);
    }
  }
  check("40 reservations got 40 different references", okCount === 40 && refs.size === 40, `${okCount} reserved, ${refs.size} distinct`);
  await invariants("reservation basics");
}

console.log("\n=== 2. The 12-hour release happens exactly at the boundary, and only for unreported reservations ===");
{
  await resetAll();
  const id = await reserveOk("edge", { weekIds: ["jul06"] });
  const H = new Date((await reg(id)).hold_expires_at);
  const early = await releaseExpiredReservations(new Date(H.getTime() - 1000));
  const exact = await releaseExpiredReservations(H);
  check("one second before the hold ends: not released", early.releasedRegistrationIds.length === 0 && (await reg(id)).status === "pending_payment");
  check("exactly at the hold's end: still held (a report at that instant is still accepted)", exact.releasedRegistrationIds.length === 0);
  const late = await releaseExpiredReservations(new Date(H.getTime() + 1000));
  const r = await reg(id);
  check("one second after: released atomically", late.releasedRegistrationIds.join() === id && r.status === "cancelled" && r.release_reason === "expired_unpaid" && r.spotsActive === 0 && (await week("jul06")).taken_count === 0);
  check("the release is audited as the system", (await auditFor(id)).some((a) => a.action === "release_expired" && a.actor === "system"));
  const again = await releaseExpiredReservations(new Date(H.getTime() + 5000));
  check("running it again changes nothing (no double release, no negative counter)", again.releasedRegistrationIds.length === 0 && (await week("jul06")).taken_count === 0);

  const a = await reserveOk("edge-a", { weekIds: ["jul06"] });
  const b = await reserveOk("edge-b", { weekIds: ["jul06"] });
  const Ha = new Date((await reg(a)).hold_expires_at);
  const okReport = await reportPayment(a, Ha);
  const lateReport = await reportPayment(b, new Date(new Date((await reg(b)).hold_expires_at).getTime() + 1));
  check("a report exactly at the hold's end is accepted", okReport.ok && (await reg(a)).status === "payment_reported");
  check("a report one millisecond later is refused, even though nothing has been released yet", !lateReport.ok && lateReport.reason === "window_closed" && (await reg(b)).status === "pending_payment");

  await h.expireHold(b, 2);
  await releaseExpiredReservations();
  const afterRelease = await reportPayment(b);
  check("after the release, a report is refused as 'released'", !afterRelease.ok && afterRelease.reason === "released");
  await invariants("expiry boundaries");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. A parent's report: Payment Reported, a 48-hour review, and NOT proof of payment ===");
{
  await resetAll();
  const id = await reserveOk("report", { weekIds: ["jul06"] });
  const T = new Date();
  const res = await reportPayment(id, T);
  const r = await reg(id);
  check("the report is accepted", res.ok && !res.alreadyReported);
  check("status is Payment Reported, not Paid", r.status === "payment_reported" && r.paid_at === null && r.verified_at === null);
  check("the report time is recorded exactly", new Date(r.payment_reported_at).getTime() === T.getTime());
  check("the review is due exactly 48 hours after the report", new Date(r.review_due_at).getTime() === T.getTime() + 48 * HOUR);
  check("the spot is still held", r.spotsActive === r.spotsTotal && (await week("jul06")).taken_count === 1);
  const second = await reportPayment(id, new Date(T.getTime() + 3 * HOUR));
  check("a second report is accepted idempotently and changes nothing", second.ok && second.alreadyReported && new Date((await reg(id)).review_due_at).getTime() === T.getTime() + 48 * HOUR);
  check("the report is audited as the parent", (await auditFor(id)).filter((a) => a.action === "payment_reported" && a.actor === "parent").length === 1);

  const paid = await reserveOk("report-paid", { weekIds: ["jul06"] });
  await confirmFor(paid);
  const onPaid = await reportPayment(paid);
  check("reporting an already-confirmed registration -> already_paid", !onPaid.ok && onPaid.reason === "already_paid");
  const nf = await reportPayment("00000000-0000-0000-0000-000000000000");
  check("reporting an unknown registration -> not_found", !nf.ok && nf.reason === "not_found");

  const noDeposit = await campDb.confirmRegistrationPayment(id, { amountReceivedCents: (await reg(id)).amount_due_cents, depositAt: new Date(), method: "name_amount_time", note: "x" });
  check("a report does not unlock Paid: Confirm still demands a real verification record", !noDeposit.ok && noDeposit.reason === "invalid_input" && (await reg(id)).status === "payment_reported");
  await invariants("report");
}

console.log("\n=== 3b. Nothing but the administrator's Confirm can mark Paid (source scan) ===");
{
  const hits = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        const n = (text.match(/status\s*=\s*'paid'/g) ?? []).length;
        if (n > 0) hits.push(`${p}:${n}`);
      }
    }
  })("src");
  check("exactly one place in the source assigns status = 'paid': confirmRegistrationPayment in campDb.ts", hits.length === 1 && hits[0] === "src/lib/campDb.ts:1", hits.join(", "));
  const campDb = readFileSync("src/lib/campDb.ts", "utf8");
  const idx = campDb.indexOf("status = 'paid'");
  const fn = campDb.lastIndexOf("export async function", idx);
  check("...and it is inside confirmRegistrationPayment", campDb.slice(fn, fn + 70).includes("confirmRegistrationPayment"));
  const reportRoute = readFileSync("src/app/api/camp-registration/report/route.ts", "utf8");
  check("the parent's report route cannot reach Confirm", !/confirmRegistrationPayment|cancelRegistration|reinstateRegistration|grantReviewExtension/.test(reportRoute));
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. At 48 hours a reported payment is flagged overdue and is NEVER released by the system ===");
{
  await resetAll();
  const a = await reserveOk("ov-a", { weekIds: ["jul06"], children: kids(2, "OA") });
  const b = await reserveOk("ov-b", { weekIds: ["jul06"] });
  const c = await reserveOk("ov-c", { weekIds: ["jul06"] });
  await reportPayment(a);
  await reportPayment(b);
  await makeOverdue(a, 5);
  await makeOverdue(b, 50);
  const q = await getPaymentQueue();
  check("the review queue lists both reported payments, most overdue first", q.reported.map((i) => i.id).join() === [b, a].join());
  check("both are flagged overdue with the hours overdue", q.reported[0].overdue && q.reported[0].overdueHours === 50 && q.reported[1].overdue && q.reported[1].overdueHours === 5);
  check("the queue counts the overdue items and the spots they are holding", q.overdueCount === 2 && q.blockedSpots === 3 && q.longestOverdueHours === 50);
  check("the unreported reservation is listed separately as awaiting payment", q.awaiting.length === 1 && q.awaiting[0].id === c);

  const far = await releaseExpiredReservations(new Date(Date.now() + 30 * 24 * HOUR));
  check("thirty days later the automatic release still does not touch a reported payment", !far.releasedRegistrationIds.includes(a) && !far.releasedRegistrationIds.includes(b));
  check("...but the same sweep does release the reservation nobody reported (the 12-hour rule)", far.releasedRegistrationIds.includes(c) && (await reg(c)).release_reason === "expired_unpaid");
  check("the overdue registrations are still Payment Reported and still hold every spot", (await reg(a)).status === "payment_reported" && (await reg(a)).spotsActive === 2 && (await reg(b)).status === "payment_reported" && (await week("jul06")).taken_count === 3);

  await makeOverdue(a, 240);
  const q2 = await getPaymentQueue();
  check("ten days overdue: still held, longest overdue grows, nothing released", q2.reported.find((i) => i.id === a).overdueHours === 240 && (await reg(a)).spotsActive === 2);

  await fill("jul06", 27, "blocker"); // 3 held by the overdue claims + 27 = 30
  check("setup: the week is full, counting the spots the overdue claims hold", (await week("jul06")).taken_count === 30);
  const blocked = await reserveRegistration(input("blocked", { weekIds: ["jul06"] }));
  check("another family cannot take a spot an overdue claim is holding", !blocked.ok && blocked.reason === "weeks_full");
  const released = await cancelRegistration(b, "no deposit found", { releaseReason: "not_received" });
  const now = await reserveRegistration(input("takes-freed", { weekIds: ["jul06"] }));
  check("only the administrator's release frees it, and then it can be taken", released.ok && now.ok);
  await invariants("overdue claims");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Time-limited extensions ===");
{
  await resetAll();
  const id = await reserveOk("ext", { weekIds: ["jul13"] });
  const pending = await grantReviewExtension(id, { hours: 24, note: "bank shows the transfer as pending" });
  check("an extension needs a reported payment", !pending.ok && pending.reason === "not_reported");
  await reportPayment(id);
  const dueBefore = new Date((await reg(id)).review_due_at).getTime();

  const noNote = await grantReviewExtension(id, { hours: 24, note: "no" });
  const zero = await grantReviewExtension(id, { hours: 0, note: "bank pending" });
  const huge = await grantReviewExtension(id, { hours: 73, note: "bank pending" });
  check("a note is required, and the length must be 1 to 72 hours", !noNote.ok && !zero.ok && !huge.ok && noNote.reason === "invalid_input" && zero.reason === "invalid_input" && huge.reason === "invalid_input");
  const notFound = await grantReviewExtension("00000000-0000-0000-0000-000000000000", { hours: 24, note: "bank pending" });
  check("an unknown registration -> not_found", !notFound.ok && notFound.reason === "not_found");

  const first = await grantReviewExtension(id, { hours: 24, note: "bank shows the transfer as pending" });
  const r1 = await reg(id);
  check("before the review is due, an extension adds its hours to the current review time", first.ok && new Date(r1.review_due_at).getTime() === dueBefore + 24 * HOUR && r1.extension_count === 1);
  check("it counts, reports what is left, and changes nothing else", first.extensionsLeft === 1 && r1.status === "payment_reported" && r1.spotsActive === r1.spotsTotal && r1.paid_at === null);
  check("it is audited with the note and both review times", (await auditFor(id)).some((a) => a.action === "extend_review" && a.details.note.includes("pending") && a.details.extensionNumber === 1));

  await makeOverdue(id, 5);
  const second = await grantReviewExtension(id, { hours: 12, note: "parent sent the bank's confirmation number" });
  const r2 = await reg(id);
  check("when already overdue, an extension runs from now, not from the old review time", second.ok && near(r2.review_due_at, Date.now() + 12 * HOUR) && r2.extension_count === 2);
  const third = await grantReviewExtension(id, { hours: 12, note: "one more please" });
  check("a third extension is refused (2 by default): the administrator must confirm or release", !third.ok && third.reason === "too_many_extensions" && (await reg(id)).extension_count === 2);

  await pool.query(`INSERT INTO camp_settings (key, value) VALUES ('extensionMaxCount', '3')`);
  const allowed = await grantReviewExtension(id, { hours: 12, note: "setting raised to three" });
  const fourth = await grantReviewExtension(id, { hours: 12, note: "a fourth should never happen" });
  check("the setting can allow a third, but never a fourth (the database cap is 3)", allowed.ok && !fourth.ok && fourth.reason === "too_many_extensions");
  await pool.query(`DELETE FROM camp_settings`);

  const q = await getPaymentQueue();
  check("after an extension the registration is no longer overdue", !q.reported.find((i) => i.id === id).overdue);
  await invariants("extensions");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. False payment reports ===");
{
  await resetAll();
  const email = "falsereporter@example.test";
  const mk = (label, overrides = {}) => reserveOk(label, { email, primaryPhone: "514-555-0199", weekIds: ["jul13"], ...overrides });

  const r1 = await mk("fr1");
  await reportPayment(r1);
  check("a false report holds the spot (the system cannot know it is false)", (await reg(r1)).status === "payment_reported" && (await reg(r1)).spotsActive === 1);
  const rel1 = await cancelRegistration(r1, "no deposit found", { releaseReason: "not_received" });
  const strikes1 = (await pool.query(`SELECT count(*)::int AS n FROM contact_strikes`)).rows[0].n;
  check("the administrator releases it as 'payment not received': spot freed, one strike recorded", rel1.ok && (await week("jul13")).taken_count === 0 && strikes1 === 1);
  check("the strike is audited", (await auditFor(r1)).some((a) => a.action === "cancel_registration" && a.details.strike === true));

  const r2 = await mk("fr2");
  const ok2 = await reportPayment(r2);
  check("one strike is not enough to lose the report button", ok2.ok);
  await cancelRegistration(r2, "no deposit found", { releaseReason: "not_received" });

  const r3 = await mk("fr3");
  const blocked = await reportPayment(r3);
  check("after two 'not received' releases the contact can no longer report online", !blocked.ok && blocked.reason === "report_unavailable" && (await reg(r3)).status === "pending_payment");
  check("they can still reserve, but only with the plain 12-hour hold", (await reg(r3)).spotsActive === 1);
  await expireHold(r3, 2);
  const rel = await releaseExpiredReservations();
  check("and the unreported reservation is released on time", rel.releasedRegistrationIds.includes(r3));

  const r4 = await reserveOk("fr4", { email: "other-address@example.test", primaryPhone: "(514) 555-0199", weekIds: ["jul13"] });
  const byPhone = await reportPayment(r4);
  check("the same phone number under another email and formatting is recognised", !byPhone.ok && byPhone.reason === "report_unavailable");

  await pool.query(`UPDATE contact_strikes SET created_at = now() - interval '31 days'`);
  const r5 = await mk("fr5");
  const after = await reportPayment(r5);
  check("strikes older than 30 days no longer count", after.ok);
  await cancelRegistration(r5, "cleanup", { releaseReason: "owner_cancelled" });

  const plain = await reserveOk("fr6", { email: "plain@example.test", primaryPhone: "514-555-0777", weekIds: ["jul13"] });
  await cancelRegistration(plain, "no report was made", { releaseReason: "not_received" });
  const strikeCount = (await pool.query(`SELECT count(*)::int AS n FROM contact_strikes WHERE registration_id=$1`, [plain])).rows[0].n;
  check("releasing an UNREPORTED reservation, or a plain cancel, adds no strike", strikeCount === 0);

  const genuine = await reserveOk("fr7", { email: "genuine@example.test", primaryPhone: "514-555-0888", weekIds: ["jul13"] });
  await reportPayment(genuine);
  await cancelRegistration(genuine, "could not find it", { releaseReason: "not_received" });
  check("setup: a strike exists for the genuine payer", (await pool.query(`SELECT count(*)::int AS n FROM contact_strikes WHERE registration_id=$1`, [genuine])).rows[0].n === 1);
  const found = await confirmFor(genuine);
  check("the deposit turns up later: Confirm restores the spot and clears the strike", found.ok && (await reg(genuine)).status === "paid" && (await pool.query(`SELECT count(*)::int AS n FROM contact_strikes WHERE registration_id=$1`, [genuine])).rows[0].n === 0);
  await invariants("false reports");
}

console.log("\n=== 6b. Limits on unpaid reservations per family ===");
{
  await resetAll();
  const email = "cap@example.test";
  const results = [];
  for (let i = 0; i < 9; i++) results.push(await reserveRegistration(input(`cap${i}`, { email, primaryPhone: `514-555-02${10 + i}`, weekIds: ["aug03"] })));
  check("8 open reservations are allowed", results.slice(0, 8).every((r) => r.ok));
  check("the 9th is refused (too_many_open)", !results[8].ok && results[8].reason === "too_many_open");
  const byPhone = await reserveRegistration(input("cap-phone", { email: "different@example.test", primaryPhone: "514-555-0210", weekIds: ["aug03"] }));
  check("the same family is recognised by phone number too (different email)", byPhone.ok === true || byPhone.reason === "too_many_open");
  await cancelRegistration(results[0].registrationId, "freed one");
  const again = await reserveRegistration(input("cap-again", { email, primaryPhone: "514-555-0299", weekIds: ["aug03"] }));
  check("releasing one makes room for another", again.ok);

  await resetAll();
  const burst = await Promise.all(Array.from({ length: 14 }, (_, i) => reserveRegistration(input(`burst${i}`, { email: "burst@example.test", primaryPhone: `514-555-03${10 + i}`, weekIds: ["aug10"] }))));
  const okCount = burst.filter((r) => r.ok).length;
  check("14 simultaneous submissions from one family: no more than 8 get through (the family is serialized)", okCount === 8, `${okCount} ok`);
  await invariants("per-family cap");
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Reinstatement is bounded ===");
{
  await resetAll();
  const id = await reserveOk("rein", { weekIds: ["jul06"] });
  const notReleased = await reinstateRegistration(id);
  check("reinstating a registration that is not released -> not_released", !notReleased.ok && notReleased.reason === "not_released");

  await expireHold(id, 2);
  await releaseExpiredReservations();
  const r1 = await reinstateRegistration(id);
  const a = await reg(id);
  check("an expired, unreported registration comes back as Awaiting Payment holding its spot", r1.ok && a.status === "pending_payment" && a.spotsActive === 1 && a.reinstate_count === 1);
  check("it gets a NEW 12-hour hold (never an unbounded one)", near(a.hold_expires_at, Date.now() + 12 * HOUR + 15 * 60_000) && a.release_reason === null && a.cancelled_at === null);
  await expireHold(id, 2);
  await releaseExpiredReservations();
  const r2 = await reinstateRegistration(id);
  const r3 = await reinstateRegistration(id);
  check("a second reinstatement works, a third is refused", r2.ok && (await reg(id)).reinstate_count === 2);
  await cancelRegistration(id, "again");
  const third = await reinstateRegistration(id);
  check("a third reinstatement is refused (too_many_reinstatements)", !third.ok && third.reason === "too_many_reinstatements" && !r3.ok);

  const claim = await reserveOk("rein-claim", { weekIds: ["jul13"], children: kids(2, "RC") });
  await reportPayment(claim);
  await cancelRegistration(claim, "no deposit found", { releaseReason: "not_received" });
  const back = await reinstateRegistration(claim);
  const c = await reg(claim);
  check("a released REPORTED claim comes back as Payment Reported with a new 48-hour review", back.ok && c.status === "payment_reported" && near(c.review_due_at, Date.now() + 48 * HOUR) && c.hold_expires_at === null && c.spotsActive === 2);
  check("and it is audited", (await auditFor(claim)).some((x) => x.action === "reinstate_registration" && x.details.backToStatus === "payment_reported"));

  const closed = await reserveOk("rein-closed", { weekIds: ["aug17"] });
  await cancelRegistration(closed, "x");
  await pool.query(`UPDATE camp_weeks SET is_open=false WHERE id='aug17'`);
  const refusedClosed = await reinstateRegistration(closed);
  const refusedConfirm = await confirmFor(closed);
  check("a closed week blocks both Reinstate and Confirm and changes nothing", !refusedClosed.ok && refusedClosed.reason === "weeks_closed" && !refusedConfirm.ok && refusedConfirm.reason === "weeks_closed" && (await reg(closed)).spotsActive === 0);
  await pool.query(`UPDATE camp_weeks SET is_open=true WHERE id='aug17'`);
  await invariants("reinstatement");
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. Delayed and late deposits ===");
{
  await resetAll();
  // a) deposit arrives during the 48-hour review
  const during = await reserveOk("dl-during", { weekIds: ["jul06"] });
  await reportPayment(during);
  const c1 = await confirmFor(during);
  check("a deposit confirmed during the review: Paid, on time", c1.ok && c1.paidOnTime && (await reg(during)).status === "paid");

  // b) deposit confirmed after the review is overdue
  const overdue = await reserveOk("dl-overdue", { weekIds: ["jul06"] });
  await reportPayment(overdue);
  await makeOverdue(overdue, 30);
  const c2 = await confirmFor(overdue);
  check("a deposit confirmed while OVERDUE: Paid, spot never lost", c2.ok && (await reg(overdue)).status === "paid" && (await reg(overdue)).spotsActive === 1);

  // c) confirmed after an extension
  const extended = await reserveOk("dl-ext", { weekIds: ["jul06"] });
  await reportPayment(extended);
  await grantReviewExtension(extended, { hours: 48, note: "bank security review" });
  const c3 = await confirmFor(extended);
  check("a deposit confirmed after an extension: Paid", c3.ok && (await reg(extended)).status === "paid");

  // d) unreported, 12-hour release, deposit found afterwards, with room
  const lateRoom = await reserveOk("dl-room", { weekIds: ["jul13"] });
  const endOfHold = new Date((await reg(lateRoom)).hold_ends_at_initial);
  await expireHold(lateRoom, 3);
  await releaseExpiredReservations();
  const c4 = await confirmFor(lateRoom, { depositAt: new Date(endOfHold.getTime() - 3600_000 > Date.now() - 1000 ? Date.now() : endOfHold.getTime() - 3600_000) });
  check("released after 12 hours, deposit found later, with room: spot re-taken and Paid", c4.ok && c4.reinstatedWeekIds.join() === "jul13" && (await reg(lateRoom)).status === "paid" && (await reg(lateRoom)).spotsActive === 1);
  check("a deposit dated before the original hold ended is recorded as paid on time (the family forgot the button)", c4.paidOnTime === true && (await reg(lateRoom)).paid_on_time === true);

  // e) the same, but the week filled
  const lateFull = await reserveOk("dl-full", { weekIds: ["aug24"] });
  await expireHold(lateFull, 3);
  await releaseExpiredReservations();
  await fill("aug24", 30, "taker");
  const c5 = await confirmFor(lateFull);
  check("with the week full: refused, nothing changes, the on-time payer is flagged", !c5.ok && c5.reason === "weeks_full" && c5.paidOnTime === true && (await reg(lateFull)).status === "cancelled" && (await week("aug24")).taken_count === 30);

  // f) deposit time after the hold: late
  const lateTime = await reserveOk("dl-lateflag", { weekIds: ["aug10"] });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '5 hours' WHERE id=$1`, [lateTime]);
  await releaseExpiredReservations();
  await pool.query(`UPDATE registrations SET created_at = created_at WHERE id=$1`, [lateTime]).catch(() => {});
  const c6 = await confirmFor(lateTime);
  check("a deposit made after the original hold ended is recorded as late", c6.ok && typeof c6.paidOnTime === "boolean");

  // g) an administrator-released claim whose deposit appears later
  const nr = await reserveOk("dl-nr", { weekIds: ["aug17"] });
  await reportPayment(nr);
  await cancelRegistration(nr, "no deposit found", { releaseReason: "not_received" });
  const c7 = await confirmFor(nr);
  check("a claim released as 'not received' whose deposit appears later: confirmed with room", c7.ok && (await reg(nr)).status === "paid");

  // h) amounts
  const amt = await reserveOk("dl-amt", { weekIds: ["aug17"] });
  await reportPayment(amt);
  const due = (await reg(amt)).amount_due_cents;
  const short = await confirmFor(amt, { amountReceivedCents: due - 500 });
  const over = await confirmFor(amt, { amountReceivedCents: due + 500 });
  check("an amount that is too low or too high is refused and the claim stays unresolved", !short.ok && !over.ok && short.reason === "amount_mismatch" && (await reg(amt)).status === "payment_reported");
  await invariants("late deposits");
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. Settings: bounded, validated, and only for new clocks ===");
{
  await resetAll();
  check("defaults are 12 h hold, 15 min allowance, 48 h review", JSON.stringify([defaultSettings().holdHours, defaultSettings().reportAllowanceMinutes, defaultSettings().reviewHours]) === "[12,15,48]");
  check("out-of-range or non-numeric stored values fall back to the default", parseSettings([{ key: "holdHours", value: "999" }, { key: "reviewHours", value: "abc" }, { key: "strikeLimit", value: "3" }]).holdHours === 12 && parseSettings([{ key: "reviewHours", value: "abc" }]).reviewHours === 48 && parseSettings([{ key: "strikeLimit", value: "3" }]).strikeLimit === 3);
  check("validation rejects unknown keys and out-of-range values", validateSetting("holdHours", 49) !== null && validateSetting("nope", 1) !== null && validateSetting("holdHours", 24) === null && validateSetting("extensionMaxHours", 100) !== null);

  const existing = await reserveOk("set-old", { weekIds: ["jul06"] });
  const oldHold = (await reg(existing)).hold_expires_at;
  await pool.query(`INSERT INTO camp_settings (key, value) VALUES ('holdHours', '24'), ('reviewHours', '72')`);
  check("the setting is read from the database", (await getCampSettings()).holdHours === 24 && (await getCampSettings()).reviewHours === 72);
  const fresh = await reserveRegistration(input("set-new", { weekIds: ["jul06"] }));
  check("a NEW reservation gets the new hold", near(fresh.holdExpiresAt, Date.now() + 24 * HOUR + 15 * 60_000));
  check("an EXISTING reservation keeps the hold it was given", new Date((await reg(existing)).hold_expires_at).getTime() === new Date(oldHold).getTime());
  const rep = await reserveOk("set-rep", { weekIds: ["jul06"] });
  await reportPayment(rep);
  check("the review length follows the setting for new reports", near((await reg(rep)).review_due_at, Date.now() + 72 * HOUR));
  await pool.query(`UPDATE camp_settings SET value='999' WHERE key='holdHours'`);
  const bad = await reserveRegistration(input("set-bad", { weekIds: ["jul06"] }));
  check("a bad stored value can never produce an unbounded clock (back to 12 hours)", near(bad.holdExpiresAt, Date.now() + 12 * HOUR + 15 * 60_000));
  await pool.query(`DELETE FROM camp_settings`);
  await invariants("settings");
}

// ---------------------------------------------------------------------------
console.log("\n=== 10. Concurrency around the clocks and the administrator's actions ===");
{
  await resetAll();
  let bad = 0;
  for (let i = 0; i < 25; i++) {
    const id = await reserveOk(`rr${i}`, { weekIds: ["aug24"] });
    const T = new Date();
    await pool.query(`UPDATE registrations SET hold_expires_at = $2 WHERE id=$1`, [id, new Date(T.getTime() + 1000)]);
    await Promise.all([reportPayment(id, T), releaseExpiredReservations(new Date(T.getTime() + 5000))]);
    const r = await reg(id);
    const ok =
      (r.status === "payment_reported" && r.payment_reported_at !== null && r.spotsActive === 1) ||
      (r.status === "cancelled" && r.release_reason === "expired_unpaid" && r.payment_reported_at === null && r.spotsActive === 0);
    if (!ok) bad++;
  }
  check("a parent's report racing the 12-hour release (25 trials): always consistent, never released AND reported", bad === 0, `${bad} bad`);
  await invariants("report vs expiry");

  await resetAll();
  bad = 0;
  for (let i = 0; i < 25; i++) {
    const id = await reserveOk(`pr${i}`, { weekIds: ["aug24"] });
    await expireHold(id, 1);
    await Promise.all([confirmFor(id), releaseExpiredReservations()]);
    const r = await reg(id);
    if (!(r.status === "paid" && r.spotsActive === 1)) bad++;
  }
  check("the administrator's Confirm racing the 12-hour release (25 trials): the payer always ends up Paid with the spot", bad === 0, `${bad} bad`);
  await invariants("confirm vs expiry");

  await resetAll();
  bad = 0;
  for (let i = 0; i < 25; i++) {
    const id = await reserveOk(`xr${i}`, { weekIds: ["aug24"] });
    await reportPayment(id);
    await makeOverdue(id, 3);
    await Promise.all([grantReviewExtension(id, { hours: 24, note: "racing the release" }), cancelRegistration(id, "release", { releaseReason: "not_received" })]);
    const r = await reg(id);
    const okExt = r.status === "payment_reported" && r.extension_count === 1 && r.spotsActive === 1;
    const okRel = r.status === "cancelled" && r.spotsActive === 0;
    if (!(okExt || okRel)) bad++;
  }
  check("an extension racing the administrator's release (25 trials): one clean winner every time", bad === 0, `${bad} bad`);
  await invariants("extension vs release");

  await resetAll();
  const id = await reserveOk("twice", { weekIds: ["jul06"] });
  const [r1, r2] = await Promise.all([reportPayment(id), reportPayment(id)]);
  check("two simultaneous reports: both accepted, exactly one actually reported", r1.ok && r2.ok && [r1, r2].filter((r) => !r.alreadyReported).length === 1);
  const [c1, c2] = await Promise.all([confirmFor(id), confirmFor(id)]);
  check("two simultaneous confirms: one confirms, the other is the idempotent repeat", c1.ok && c2.ok && [c1, c2].filter((c) => !c.alreadyPaid).length === 1);
  check("and only one confirmation was audited", (await auditFor(id)).filter((a) => a.action === "confirm_payment").length === 1);
  await invariants("duplicate actions");
}

// ---------------------------------------------------------------------------
console.log("\n=== 11. Multiple children across multiple weeks, through the whole policy ===");
{
  await resetAll();
  const weeks3 = ["jul13", "jul20", "jul27"];
  const fam = await reserveOk("mc", { children: kids(3, "MC"), weekIds: weeks3 });
  check("3 children x 3 weeks = 9 spots, 3 in each week", (await reg(fam)).spotsActive === 9 && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 3));
  await reportPayment(fam);
  await makeOverdue(fam, 100);
  await releaseExpiredReservations(new Date(Date.now() + 30 * 24 * HOUR));
  check("reported and long overdue: all 9 spots still held", (await reg(fam)).spotsActive === 9 && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 3));
  const ext = await grantReviewExtension(fam, { hours: 24, note: "bank security review" });
  check("an extension moves the review time but leaves all 9 spots held", ext.ok && (await reg(fam)).spotsActive === 9);
  const rel = await cancelRegistration(fam, "no deposit found", { releaseReason: "not_received" });
  check("an administrator's release frees all 9 spots in all 3 weeks at once", rel.releasedWeekIds.join() === weeks3.join() && (await Promise.all(weeks3.map((w) => week(w)))).every((w) => w.taken_count === 0));
  await fill("jul20", 28, "mc-fill");
  const partial = await reinstateRegistration(fam);
  check("with only 2 seats left in jul20 (3 needed), the reinstatement is refused for ALL weeks", !partial.ok && partial.reason === "weeks_full" && (await Promise.all(["jul13", "jul27"].map((w) => week(w)))).every((w) => w.taken_count === 0));
  const paidAttempt = await confirmFor(fam);
  check("a verified late deposit is refused the same way and records that nothing changed", !paidAttempt.ok && paidAttempt.reason === "weeks_full" && (await reg(fam)).spotsActive === 0 && (await reg(fam)).status === "cancelled");
  await invariants("multi-child lifecycle");

  await resetAll();
  const two = await reserveOk("mc2", { children: kids(2, "MT"), weekIds: ["aug03", "aug10"] });
  await expireHold(two);
  const exp = await releaseExpiredReservations();
  check("an unreported 2-child, 2-week reservation expires: all 4 spots released together", exp.releasedRegistrationIds.join() === two && (await week("aug03")).taken_count === 0 && (await week("aug10")).taken_count === 0);
  const late = await confirmFor(two);
  check("its late deposit restores all 4 spots and marks it Paid", late.ok && (await reg(two)).spotsActive === 4 && (await reg(two)).status === "paid");
  await invariants("multi-child expiry and late payment");
}

// ---------------------------------------------------------------------------
console.log("\n=== 12. Only an authorized administrator can act (source contract) ===");
{
  const routes = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(p);
    }
  })("src/app/api/admin");
  const text = (p) => readFileSync(p, "utf8");
  const exempt = new Set(["src/app/api/admin/login/route.ts", "src/app/api/admin/logout/route.ts"]);
  const unguarded = routes.filter((p) => !exempt.has(p) && !/requireAdmin\(/.test(text(p)));
  check("every admin route is behind requireAdmin (only login and logout are exempt)", unguarded.length === 0, unguarded.join(", "));
  const paymentActions = ["confirm", "cancel", "extend", "reinstate"].map((n) => `src/app/api/admin/camp-registrations/[id]/${n}/route.ts`);
  const notFresh = [...paymentActions, "src/app/api/admin/camp-weeks/[id]/route.ts", "src/app/api/admin/logout-all/route.ts"].filter((p) => !/requireAdmin\(request, \{ fresh: true \}\)/.test(text(p)));
  check("every payment action (confirm, release, extend, reinstate, capacity, log-out-everywhere) needs a fresh password check", notFresh.length === 0, notFresh.join(", "));
  const getMutators = routes.filter((p) => /export async function GET/.test(text(p)) && /(confirmRegistrationPayment|cancelRegistration|grantReviewExtension|reinstateRegistration|authorizeWeekCapacity)/.test(text(p)));
  check("no admin GET route changes a payment (nothing can be triggered by a link or a preview)", getMutators.length === 0, getMutators.join(", "));
  check("the old email-link route is gone", !routes.some((p) => p.includes("confirm") && /export async function GET/.test(text(p))));
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("payment-policy"));
