// Real families, real habits: siblings, many weeks, several submissions, repeats and
// back-button resubmissions. The question behind every check here: is a genuine family
// ever blocked, double-booked or overcharged by the limits that protect the camp?
//
// The limit under review is "8 unpaid reservations per family contact". A "reservation" is
// one submission of the form (any number of children, any number of weeks), not one child
// and not one week.

import { createTestDatabase } from "./helpers/testdb.mjs";
import { calculateTotal } from "../../src/lib/pricing.ts";

process.env.DB_POOL_MAX ||= "20";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, confirmFor, invariants } = h;
const { reserveRegistration, cancelRegistration } = campDb;

const ALL_WEEKS = ["jun22", "jun29", "jul06", "jul13", "jul20", "jul27", "aug03", "aug10", "aug17", "aug24"];
const family = (email, phone) => ({ email, primaryPhone: phone });
const openFor = async (email) => Number((await pool.query(`SELECT count(*) FROM registrations WHERE lower(email)=$1 AND status IN ('pending_payment','payment_reported')`, [email.toLowerCase()])).rows[0].count);

// ---------------------------------------------------------------------------
console.log("=== 1. One submission can be as big as the family needs ===");
{
  await resetAll();
  const contact = family("big.family@example.test", "514-555-0140");
  const r = await reserveRegistration(input("big", { ...contact, children: kids(4, "Big"), weekIds: ALL_WEEKS }));
  check("4 children x all 10 weeks is accepted as ONE reservation", r.ok);
  const spots = Number((await pool.query(`SELECT count(*) FROM registration_spots WHERE registration_id=$1 AND status='active'`, [r.registrationId])).rows[0].count);
  check("it holds 40 spots (every child in every week)", spots === 40, String(spots));
  check("it counts as one open reservation, not forty", (await openFor(contact.email)) === 1);
  check("the amount is the 40 child-weeks plus tax, in one payment", r.totalPriceCents === 40 * 38000 && r.amountDueCents === calculateTotal(40 * 38000).totalCents, `${r.amountDueCents}`);
  const more = [];
  for (let i = 0; i < 7; i++) more.push(await reserveRegistration(input(`more${i}`, { ...contact, children: kids(1, `M${i}`), weekIds: ["jul06"] })));
  check("the same family can still make 7 more separate submissions (8 open)", more.every((x) => x.ok) && (await openFor(contact.email)) === 8);
  const ninth = await reserveRegistration(input("ninth", { ...contact, children: kids(1, "Nine"), weekIds: ["jul13"] }));
  check("the 9th unpaid submission is the first one refused", !ninth.ok && ninth.reason === "too_many_open");
  await invariants("big family");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Paying, or releasing, frees a place under the limit ===");
{
  await resetAll();
  const contact = family("steady@example.test", "514-555-0141");
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push((await reserveRegistration(input(`s${i}`, { ...contact, children: kids(1, `S${i}`), weekIds: [ALL_WEEKS[i]] }))).registrationId);
  check("8 open reservations, all accepted", ids.every(Boolean) && (await openFor(contact.email)) === 8);
  const refused = await reserveRegistration(input("s8", { ...contact, children: kids(1, "S8"), weekIds: ["aug24"] }));
  check("a 9th is refused while all 8 are unpaid", !refused.ok && refused.reason === "too_many_open");
  await confirmFor(ids[0]);
  const afterPay = await reserveRegistration(input("s8b", { ...contact, children: kids(1, "S8b"), weekIds: ["aug24"] }));
  check("once one is PAID it stops counting, and the next submission is accepted", afterPay.ok && (await openFor(contact.email)) === 8);
  const again = await reserveRegistration(input("s9", { ...contact, children: kids(1, "S9"), weekIds: ["aug17"] }));
  check("...and then the limit applies again", !again.ok && again.reason === "too_many_open");
  await cancelRegistration(ids[1], "family changed plans", { releaseReason: "owner_cancelled" });
  const afterRelease = await reserveRegistration(input("s9b", { ...contact, children: kids(1, "S9b"), weekIds: ["aug17"] }));
  check("a released reservation stops counting too", afterRelease.ok);
  await campDb.reportPayment(ids[2]);
  const reportedStillCounts = await reserveRegistration(input("s10", { ...contact, children: kids(1, "S10"), weekIds: ["aug10"] }));
  check("a reservation whose payment is reported (not yet verified) still counts as open", !reportedStillCounts.ok && reportedStillCounts.reason === "too_many_open");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The limit follows the family's contact details, not the way they type them ===");
{
  await resetAll();
  const phones = ["514-555-0150", "(514) 555-0150", "+1 514 555 0150", "5145550150", "1-514-555-0150", "514.555.0150", "514 555 0150", "(514)555-0150"];
  const results = [];
  for (let i = 0; i < phones.length; i++) results.push(await reserveRegistration(input(`p${i}`, { email: `different${i}@example.test`, primaryPhone: phones[i], children: kids(1, `P${i}`), weekIds: [ALL_WEEKS[i]] })));
  check("8 submissions with different emails but the same phone number written 8 ways: all accepted", results.every((r) => r.ok));
  const ninth = await reserveRegistration(input("p9", { email: "yet.another@example.test", primaryPhone: "514 555 0150", children: kids(1, "P9"), weekIds: ["aug24"] }));
  check("the 9th with that same phone is refused, whatever the email", !ninth.ok && ninth.reason === "too_many_open");
  const caps = await reserveRegistration(input("e1", { email: "Steady.Family@Example.TEST", primaryPhone: "438-555-0199", children: kids(1, "E1"), weekIds: ["jul06"] }));
  const lower = await reserveRegistration(input("e2", { email: "steady.family@example.test", primaryPhone: "438-555-0198", children: kids(1, "E2"), weekIds: ["jul13"] }));
  check("capital letters in an email are treated as the same address (counted together)", caps.ok && lower.ok && (await openFor("steady.family@example.test")) === 2);
  const stranger = await reserveRegistration(input("other", { email: "neighbour@example.test", primaryPhone: "514-555-0151", children: kids(1, "Other"), weekIds: ["jul06"] }));
  check("a different family is not affected by anyone else's limit", stranger.ok);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Siblings who want different weeks ===");
{
  await resetAll();
  const contact = family("siblings@example.test", "514-555-0160");
  const a = await reserveRegistration(input("sibA", { ...contact, children: [{ fullName: "Emma Siblings", dateOfBirth: "2016-05-05", age: "10", healthInfo: "none" }], weekIds: ["jul06", "jul13", "jul20"] }));
  const b = await reserveRegistration(input("sibB", { ...contact, children: [{ fullName: "Lucas Siblings", dateOfBirth: "2018-02-03", age: "8", healthInfo: "none" }], weekIds: ["jul13", "aug03"] }));
  check("two siblings with different week choices register separately without trouble", a.ok && b.ok);
  const both = await reserveRegistration(input("sibC", { ...contact, children: [{ fullName: "Mia Siblings", dateOfBirth: "2019-07-07", age: "7", healthInfo: "none" }, { fullName: "Noah Siblings", dateOfBirth: "2020-01-01", age: "6", healthInfo: "none" }], weekIds: ["aug10", "aug17"] }));
  check("a third pair registering together for two other weeks is fine too", both.ok && (await openFor(contact.email)) === 3);
  await invariants("siblings");
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("families"));
