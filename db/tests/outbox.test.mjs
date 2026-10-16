// The email outbox: every email a family is owed is recorded with the reservation or the payment
// that causes it, sent afterwards, retried when the mail server misbehaves, and sent exactly once.
// A fake mailer stands in for Gmail; the SMTP-level behaviour is covered by the rehearsal suite.

import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "20";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const outbox = await import("../../src/lib/outbox.ts");
const { classifySendError } = await import("../../src/lib/email.ts");
const { registrationIdFromToken } = await import("../../src/lib/registrationLink.ts");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, reserveOk, confirmFor, invariants } = h;
const { processOutbox, enqueueDueReminders, enqueueInstructionsResend, getEmailHealth, backoffMinutes } = outbox;

const ORIGIN = "https://camp.example.test";
const ADMINS = ["owner@example.test", "backup@example.test"];
const MIN = 60_000;
const HOUR = 60 * MIN;

function mailer(failure = () => null) {
  const sent = [];
  let calls = 0;
  const send = async (message) => {
    calls++;
    const err = failure(message, calls);
    if (err) throw err;
    sent.push(message);
  };
  return { send, sent, get calls() { return calls; } };
}
const smtpError = (code, text) => Object.assign(new Error(text), { responseCode: code, response: text });
const TRANSIENT = () => smtpError(421, "421 4.7.0 Try again later, closing connection.");
const run = (m, extra = {}) => processOutbox({ origin: ORIGIN, send: m.send, adminEmails: ADMINS, ...extra });
const rows = async (where = "TRUE", params = []) => (await pool.query(`SELECT * FROM email_outbox WHERE ${where} ORDER BY id`, params)).rows;
const rowFor = async (kind, regId) => (await rows("kind = $1 AND registration_id = $2", [kind, regId]))[0];
const reset = async () => {
  await resetAll();
  await pool.query(`DELETE FROM job_runs`);
  delete process.env.COACH_NOTICE_MODE;
  delete process.env.COACH_DIGEST_MINUTES;
  delete process.env.EMAIL_DAILY_BUDGET;
};

// ---------------------------------------------------------------------------
console.log("=== 1. A reservation and its emails are one decision ===");
{
  await reset();
  const id = await reserveOk("atomic", { email: "mom@example.test" });
  const queued = await rows("registration_id = $1", [id]);
  check("making a reservation records the parent's instructions and the coach's notice", queued.map((r) => r.kind).sort().join() === "coach_notice,parent_instructions");
  check("both are waiting to be sent", queued.every((r) => r.status === "pending" && r.attempts === 0));

  const replay = await campDb.reserveRegistration(input("atomic-replay"));
  const before = (await rows()).length;
  const same = await campDb.reserveRegistration({ ...input("x"), idempotencyKey: (await pool.query(`SELECT idempotency_key FROM registrations WHERE id=$1`, [id])).rows[0].idempotency_key, email: "mom@example.test" });
  check("a repeated submission queues nothing more", same.ok && same.alreadyExisted && (await rows()).length === before && replay.ok);

  await h.fill("jul13", 30, "fullweek");
  const beforeRefusals = (await rows()).length;
  const full = await campDb.reserveRegistration(input("nofit", { weekIds: ["jul13"] }));
  check("a refused reservation (week full) queues nothing", !full.ok && (await rows()).length === beforeRefusals);

  // A reservation that fails halfway rolls its emails back with it.
  await pool.query(`CREATE OR REPLACE FUNCTION test_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
  await pool.query(`CREATE TRIGGER test_boom BEFORE INSERT ON registration_spots FOR EACH ROW EXECUTE FUNCTION test_boom()`);
  const beforeBoom = (await rows()).length;
  let blew = false;
  try { await campDb.reserveRegistration(input("boom", { weekIds: ["aug24"] })); } catch { blew = true; }
  await pool.query(`DROP TRIGGER test_boom ON registration_spots`);
  check("a reservation that dies mid-way leaves no emails behind", blew && (await rows()).length === beforeBoom);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Delivery: the right email, to the right people, once ===");
{
  await reset();
  const id = await reserveOk("deliver", { email: "Parent.One@example.test", parentName: "Pat Parent", children: kids(2, "Dee") });
  const m = mailer();
  const summary = await run(m);
  const parentMail = m.sent.find((x) => x.to === "Parent.One@example.test");
  check("the parent gets their payment instructions at the address they entered", Boolean(parentMail) && /payment|reserved/i.test(parentMail.subject));
  check("it carries the reference and the exact amount due", parentMail.text.includes((await campDb.getRegistrationById(id)).reference) && parentMail.text.includes("$"));
  const link = parentMail.text.match(/https:\/\/camp\.example\.test\/camp-registration\/([A-Za-z0-9._-]+)/);
  check("it carries a private link on the site's own address that opens THIS reservation", Boolean(link) && registrationIdFromToken(link[1]) === id);
  const coachMail = m.sent.find((x) => x.to === ADMINS.join(", "));
  check("the coach summary goes to every administrator address", Boolean(coachMail) && /new camp registration/i.test(coachMail.subject));
  check("two emails sent, none failed", summary.sent === 2 && summary.failed === 0 && summary.retried === 0, JSON.stringify(summary));
  const again = await run(mailer());
  check("running again sends nothing (each email is sent once)", again.sent === 0);
  check("the rows are marked sent with a time", (await rows("registration_id = $1", [id])).every((r) => r.status === "sent" && r.sent_at));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. A struggling mail server: retry with growing delays, never lose or double-send ===");
{
  await reset();
  const id = await reserveOk("retry", { email: "retry@example.test" });
  const t0 = new Date();
  const down = mailer(() => TRANSIENT());
  const first = await run(down, { now: t0, coachMode: "off" });
  const r1 = await rowFor("parent_instructions", id);
  check("a failed send stays queued for another try", first.retried === 1 && first.sent === 0 && r1.status === "pending" && r1.attempts === 1);
  check("and is not retried until its delay has passed", new Date(r1.next_attempt_at).getTime() >= t0.getTime() + 55_000);
  const tooSoon = mailer();
  await run(tooSoon, { now: new Date(t0.getTime() + 20_000), coachMode: "off" });
  check("an early run does not touch it", tooSoon.calls === 0);
  const back = mailer();
  const later = await run(back, { now: new Date(t0.getTime() + 2 * MIN), coachMode: "off" });
  check("when the delay is over and the server is back, it is sent", later.sent === 1 && back.sent[0].to === "retry@example.test");
  check("the delays grow, then level off at 30 minutes", [1, 2, 3, 4, 5, 6, 7, 20].map(backoffMinutes).join() === "1,2,4,8,16,30,30,30");

  // Three failures in a row: stop hammering a dead server.
  await reset();
  for (let i = 0; i < 8; i++) await reserveOk(`dead${i}`, { email: `dead${i}@example.test`, weekIds: ["jul06"] });
  const dead = mailer(() => TRANSIENT());
  const stopped = await run(dead, { coachMode: "off" });
  check("after 3 failures in a row a run gives up instead of waiting on a dead server 8 times", dead.calls === 3 && stopped.stoppedEarly !== null, `${dead.calls} calls`);
  check("the 5 emails it did not try are untouched (no attempt used up)", (await rows("kind = 'parent_instructions' AND status = 'pending' AND attempts = 0")).length === 5);
  check("the 3 it did try each used one attempt", (await rows("kind = 'parent_instructions' AND status = 'pending' AND attempts = 1")).length === 3);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. A bad address is given up on at once; a full mailbox quota is not ===");
{
  await reset();
  const bad = await reserveOk("typo", { email: "typo@gmial.example" });
  const good = await reserveOk("fine", { email: "fine@example.test", weekIds: ["jul13"] });
  const m = mailer((message) => (message.to === "typo@gmial.example" ? smtpError(550, "550 5.1.1 <typo@gmial.example>: Recipient address rejected: User unknown") : null));
  const s = await run(m, { coachMode: "off" });
  const badRow = await rowFor("parent_instructions", bad);
  check("the rejected address is marked failed straight away, with the reason", badRow.status === "failed" && /rejected/.test(badRow.last_error), badRow.last_error);
  check("the address itself is not kept in the error text or the run summary", !badRow.last_error.includes("typo@gmial") && s.errors.every((e) => !e.includes("typo@gmial")), `${badRow.last_error} | ${s.errors}`);
  check("a bad address does not stop the next family's email", (await rowFor("parent_instructions", good)).status === "sent");
  check("it counts as 'failed', not as a mail server problem", s.failed === 1 && s.stoppedEarly === null);
  const health = await getEmailHealth();
  check("the dashboard can list it with the phone number to call", health.failed === 1 && health.failedItems[0].reference === (await campDb.getRegistrationById(bad)).reference && health.failedItems[0].primaryPhone.length > 5);

  check("a daily-quota message is treated as temporary", classifySendError(smtpError(550, "550 5.4.5 Daily user sending quota exceeded")).permanent === false);
  check("a wrong app password is temporary (the owner fixes it, the emails go)", classifySendError(Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 })).permanent === false);
  check("a timeout is temporary", classifySendError(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })).permanent === false);
  check("an invalid recipient is permanent", classifySendError(Object.assign(new Error("No recipients defined"), { code: "EENVELOPE" })).permanent === true);

  await reset();
  const stale = await reserveOk("giveup", { email: "giveup@example.test" });
  const t0 = new Date();
  const err = mailer(() => TRANSIENT());
  await run(err, { now: t0, coachMode: "off" });
  const done = await run(err, { now: new Date(t0.getTime() + 37 * HOUR), coachMode: "off" });
  check("an instructions email still failing 36 hours later is given up on and shown as failed", done.failed === 1 && (await rowFor("parent_instructions", stale)).status === "failed");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Sending an email that no longer makes sense is skipped ===");
{
  await reset();
  const released = await reserveOk("late1", { email: "late1@example.test" });
  const paid = await reserveOk("late2", { email: "late2@example.test", weekIds: ["jul13"] });
  const reported = await reserveOk("late3", { email: "late3@example.test", weekIds: ["jul20"] });
  await reserveOk("late4", { email: "late4@example.test", weekIds: ["jul27"] });
  await campDb.cancelRegistration(released, "changed plans", { releaseReason: "owner_cancelled" });
  await confirmFor(paid);
  await campDb.reportPayment(reported);
  await pool.query(`UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE kind = 'parent_confirmation'`);
  const m = mailer();
  await run(m, { coachMode: "off" });
  const to = m.sent.map((x) => x.to);
  check("the instructions for a released reservation are not sent", !to.includes("late1@example.test"));
  check("nor for one that has already been paid", !to.includes("late2@example.test"));
  check("nor for one whose parent has already reported payment", !to.includes("late3@example.test"));
  check("but the ordinary one is", to.includes("late4@example.test"));
  check("the skipped rows say why", (await rowFor("parent_instructions", released)).status === "skipped" && /awaiting payment/.test((await rowFor("parent_instructions", released)).last_error));
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Many workers at once never send the same email twice ===");
{
  await reset();
  for (let i = 0; i < 12; i++) await reserveOk(`par${i}`, { email: `par${i}@example.test`, weekIds: ["jul06"] });
  const seen = new Map();
  const wrapped = async (message) => { seen.set(message.to, (seen.get(message.to) ?? 0) + 1); await new Promise((r) => setTimeout(r, 15)); };
  await Promise.all(Array.from({ length: 6 }, () => processOutbox({ origin: ORIGIN, send: wrapped, adminEmails: ADMINS, coachMode: "off" })));
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  check("12 families, 6 workers: every parent was emailed", [...seen.keys()].filter((k) => k.startsWith("par")).length === 12, String(seen.size));
  check("and nobody was emailed twice", dupes.length === 0, JSON.stringify(dupes));
  check("nothing is left waiting", (await rows("status IN ('pending','sending') AND kind = 'parent_instructions'")).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. A worker that dies mid-send does not lose the email ===");
{
  await reset();
  const id = await reserveOk("crash", { email: "crash@example.test" });
  const rowBefore = await rowFor("parent_instructions", id);
  await pool.query(`UPDATE email_outbox SET status = 'sending', lease_until = now() + interval '4 minutes' WHERE id = $1`, [rowBefore.id]);
  const m1 = mailer();
  await run(m1, { coachMode: "off" });
  check("while another worker still holds it, it is left alone", m1.calls === 0);
  await pool.query(`UPDATE email_outbox SET lease_until = now() - interval '1 minute' WHERE id = $1`, [rowBefore.id]);
  const m2 = mailer();
  await run(m2, { coachMode: "off" });
  check("once that worker's time is up, the email is picked up and sent", m2.sent.length === 1 && (await rowFor("parent_instructions", id)).status === "sent");
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. The confirmation email is recorded with the payment ===");
{
  await reset();
  const id = await reserveOk("conf", { email: "conf@example.test", children: kids(2, "Cee") });
  await pool.query(`DELETE FROM email_outbox`);
  const wrong = await campDb.confirmRegistrationPayment(id, { amountReceivedCents: 1, depositAt: new Date(), method: "reference_matched", referenceEntered: "x" });
  check("a refused confirmation queues no email", !wrong.ok && (await rows()).length === 0);
  const ok = await confirmFor(id);
  check("a confirmation queues exactly one", ok.ok && (await rows("kind = 'parent_confirmation'")).length === 1);
  const again = await confirmFor(id);
  check("confirming twice still queues only one", again.ok && again.alreadyPaid && (await rows("kind = 'parent_confirmation'")).length === 1);
  const m = mailer(() => TRANSIENT());
  await run(m, { coachMode: "off" });
  check("a failed confirmation send is retried, not lost", (await rowFor("parent_confirmation", id)).status === "pending");
  const ok2 = mailer();
  await run(ok2, { coachMode: "off", now: new Date(Date.now() + 3 * MIN) });
  check("and goes out when the server recovers", ok2.sent.length === 1 && /confirmed/i.test(ok2.sent[0].subject) && ok2.sent[0].to === "conf@example.test");

  // Reinstating a released registration also confirms it.
  const lateId = await reserveOk("latepay", { email: "latepay@example.test", weekIds: ["jul13"] });
  await h.expireHold(lateId);
  await campDb.releaseExpiredReservations();
  const reinstated = await confirmFor(lateId);
  check("a late payment on a released reservation queues its confirmation too", reinstated.ok && (await rows("kind = 'parent_confirmation' AND registration_id = $1", [lateId])).length === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. The reminder: one gentle nudge, only to families who still need it ===");
{
  await reset();
  const needs = await reserveOk("needs", { email: "needs@example.test", weekIds: ["jul06"] });
  const reported = await reserveOk("repo", { email: "repo@example.test", weekIds: ["jul13"] });
  const paid = await reserveOk("paid", { email: "paid@example.test", weekIds: ["jul20"] });
  const released = await reserveOk("rel", { email: "rel@example.test", weekIds: ["jul27"] });
  await campDb.reportPayment(reported);
  await confirmFor(paid);
  await campDb.cancelRegistration(released, "x", { releaseReason: "owner_cancelled" });
  const created = new Date((await pool.query(`SELECT created_at FROM registrations WHERE id=$1`, [needs])).rows[0].created_at).getTime();
  const at = (hoursAfter) => new Date(created + hoursAfter * HOUR);

  check("8 hours in: too early, no reminder is queued", (await enqueueDueReminders(at(8))) === 0);
  check("9 hours in (3 hours before the pay-by time): only the family that still has to act gets one", (await enqueueDueReminders(at(9.05))) === 1);
  check("it is for the right reservation", Boolean(await rowFor("parent_reminder", needs)));
  check("running the check again queues no second reminder", (await enqueueDueReminders(at(9.5))) === 0 && (await enqueueDueReminders(at(11))) === 0);

  const m = mailer();
  await run(m, { now: at(9.1), coachMode: "off" });
  const reminder = m.sent.find((x) => /reminder/i.test(x.subject));
  check("the reminder goes to that parent", reminder?.to === "needs@example.test");
  check("it says when the spot is released and gives the private link", /held until/.test(reminder.subject) && /camp-registration\//.test(reminder.text) && /released automatically at/.test(reminder.text));
  check("it tells a family that already paid what to do (tap the button)", /Already sent your e-Transfer\?/i.test(reminder.text) && /I've Sent My Payment/.test(reminder.text));
  check("it contains no link that changes anything (only the private page)", (reminder.text.match(/https?:\/\/\S+/g) ?? []).every((u) => /\/camp-registration\/[^/]+$/.test(u)), reminder.text.match(/https?:\/\/\S+/g)?.join(" "));

  // A reminder queued but not yet sent loses its point if the parent reports in the meantime.
  await reset();
  const late = await reserveOk("lateReport", { email: "latereport@example.test" });
  const c2 = new Date((await pool.query(`SELECT created_at FROM registrations WHERE id=$1`, [late])).rows[0].created_at).getTime();
  await enqueueDueReminders(new Date(c2 + 9.5 * HOUR));
  await campDb.reportPayment(late);
  const m2 = mailer();
  await run(m2, { now: new Date(c2 + 9.6 * HOUR), coachMode: "off" });
  check("a reminder is skipped if the parent reported payment before it was sent", m2.sent.every((x) => !/reminder/i.test(x.subject)) && (await rowFor("parent_reminder", late)).status === "skipped");
  await reset();
  const late2 = await reserveOk("afterHold", { email: "afterhold@example.test" });
  const c3 = new Date((await pool.query(`SELECT created_at FROM registrations WHERE id=$1`, [late2])).rows[0].created_at).getTime();
  await enqueueDueReminders(new Date(c3 + 9.5 * HOUR));
  const m3 = mailer(() => TRANSIENT());
  await run(m3, { now: new Date(c3 + 9.6 * HOUR), coachMode: "off" });
  const m4 = mailer();
  await run(m4, { now: new Date(c3 + 12.5 * HOUR), coachMode: "off" });
  check("a reminder that could not be sent in time is dropped once the hold has ended, not sent late", m4.sent.every((x) => !/reminder/i.test(x.subject)));

  // The setting.
  await reset();
  await reserveOk("setting", { email: "setting@example.test" });
  await pool.query(`INSERT INTO camp_settings (key, value) VALUES ('parentReminderHours', '0')`);
  const created4 = new Date((await pool.query(`SELECT created_at FROM registrations LIMIT 1`)).rows[0].created_at).getTime();
  check("the reminder can be switched off (0 hours)", (await enqueueDueReminders(new Date(created4 + 11 * HOUR))) === 0);
  await pool.query(`UPDATE camp_settings SET value = '5' WHERE key = 'parentReminderHours'`);
  check("or moved earlier (5 hours before: at 7 hours in)", (await enqueueDueReminders(new Date(created4 + 6.9 * HOUR))) === 0 && (await enqueueDueReminders(new Date(created4 + 7.1 * HOUR))) === 1);
  await pool.query(`DELETE FROM email_outbox WHERE kind = 'parent_reminder'`);
  await pool.query(`UPDATE camp_settings SET value = '99' WHERE key = 'parentReminderHours'`);
  check("an out-of-range setting falls back to the default (3 hours before: nothing at 8 hours in, one at 9)",
    (await enqueueDueReminders(new Date(created4 + 8 * HOUR))) === 0 && (await enqueueDueReminders(new Date(created4 + 9.05 * HOUR))) === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 10. Duplicate submissions: instructions again, but not a flood ===");
{
  await reset();
  const id = await reserveOk("resend", { email: "resend@example.test" });
  await pool.query(`UPDATE email_outbox SET status = 'sent', sent_at = now()`);
  const t = new Date("2030-01-01T10:10:00Z");
  const a = await enqueueInstructionsResend(id, t);
  const b = await enqueueInstructionsResend(id, new Date(t.getTime() + 20 * MIN));
  const c = await enqueueInstructionsResend(id, new Date(t.getTime() + 80 * MIN));
  check("one re-send an hour per reservation, however often the form is submitted", a === true && b === false && c === true);
  const m = mailer();
  await run(m, { coachMode: "off" });
  check("each is a normal instructions email to the address on file", m.sent.length === 2 && m.sent.every((x) => x.to === "resend@example.test"), m.sent.map((x) => `${x.to}: ${x.subject}`).join(" | "));
}

// ---------------------------------------------------------------------------
console.log("\n=== 11. The coach hears about new registrations without flooding the mailbox ===");
{
  const SENTINEL_HEALTH = "SENTINEL-ALLERGY-PEANUT-7781";
  const SENTINEL_DOB = "2013-03-09";
  const makeMany = async (n) => {
    for (let i = 0; i < n; i++) {
      await reserveOk(`c${i}`, { email: `c${i}@example.test`, weekIds: ["jul06"], children: [{ fullName: `Kid ${i}`, dateOfBirth: SENTINEL_DOB, age: "13", healthInfo: SENTINEL_HEALTH }] });
    }
  };

  await reset();
  await makeMany(3);
  const mEach = mailer();
  await run(mEach, { coachMode: "each" });
  const coachEach = mEach.sent.filter((x) => x.to === ADMINS.join(", "));
  check("'each': one email per registration", coachEach.length === 3);
  const leaks = coachEach.flatMap((x) => [SENTINEL_HEALTH, SENTINEL_DOB, "Emergency Contact", "Aunt", "514-555-1111"].filter((needle) => x.text.includes(needle) || x.html.includes(needle)));
  check("it names the family but never the health details, birth date or emergency contact", leaks.length === 0, leaks.join(", "));

  await reset();
  await makeMany(30);
  const mDigest = mailer();
  const t0 = new Date();
  const d1 = await run(mDigest, { coachMode: "digest", now: t0, limit: 100, dailyBudget: 1000 });
  const digests = mDigest.sent.filter((x) => x.to === ADMINS.join(", "));
  check("'digest': 30 registrations make ONE email to the coach", digests.length === 1 && d1.digests === 1, String(digests.length));
  check("it says how many there are and lists the first 25", /30 new camp registrations/.test(digests[0].subject) && /and 5 more/.test(digests[0].text));
  check("and carries no health details or birth dates", !digests[0].text.includes(SENTINEL_HEALTH) && !digests[0].html.includes(SENTINEL_HEALTH) && !digests[0].text.includes(SENTINEL_DOB));
  check("every one of the 30 coach rows is marked sent", (await rows("kind = 'coach_notice' AND status = 'sent'")).length === 30);

  await reserveOk("after-digest", { email: "afterdigest@example.test", weekIds: ["jul13"] });
  const mSoon = mailer();
  await run(mSoon, { coachMode: "digest", now: new Date(t0.getTime() + 20 * MIN), coachDigestMinutes: 60 });
  check("a registration 20 minutes later waits for the next summary (the parent's email still goes at once)",
    mSoon.sent.every((x) => x.to !== ADMINS.join(", ")) && mSoon.sent.some((x) => x.to === "afterdigest@example.test"));
  const mLater = mailer();
  await run(mLater, { coachMode: "digest", now: new Date(t0.getTime() + 61 * MIN), coachDigestMinutes: 60 });
  check("an hour after the last summary, the next one goes out", mLater.sent.filter((x) => x.to === ADMINS.join(", ")).length === 1);

  await reset();
  await makeMany(2);
  const mOff = mailer();
  await run(mOff, { coachMode: "off" });
  check("'off': no coach email at all, and the rows say so", mOff.sent.every((x) => x.to !== ADMINS.join(", ")) && (await rows("kind = 'coach_notice' AND status = 'skipped'")).length === 2);

  await reset();
  await makeMany(2);
  const mRel = mailer();
  const relId = (await pool.query(`SELECT id FROM registrations ORDER BY created_at LIMIT 1`)).rows[0].id;
  await campDb.cancelRegistration(relId, "x", { releaseReason: "owner_cancelled" });
  await run(mRel, { coachMode: "digest" });
  const body = mRel.sent.find((x) => x.to === ADMINS.join(", "));
  check("a registration released before the summary is not announced", /\b1 new camp registration\b/.test(body.subject));
}

// ---------------------------------------------------------------------------
console.log("\n=== 12. The mailbox's daily allowance is protected ===");
{
  await reset();
  for (let i = 0; i < 6; i++) await reserveOk(`bud${i}`, { email: `bud${i}@example.test`, weekIds: ["jul06"] });
  const m = mailer();
  await run(m, { coachMode: "off", limit: 6, dailyBudget: 7 });
  check("six parent emails sent", m.sent.length === 6);
  const newcomer = await reserveOk("bud-new", { email: "budnew@example.test", weekIds: ["jul13"] });
  const t0 = new Date();
  const created = new Date((await pool.query(`SELECT created_at FROM registrations WHERE id=$1`, [newcomer])).rows[0].created_at).getTime();
  await enqueueDueReminders(new Date(created + 9.5 * HOUR));
  const m2 = mailer();
  const s2 = await run(m2, { coachMode: "each", dailyBudget: 7, now: new Date(Math.max(t0.getTime(), created) + 9.6 * HOUR) });
  check("at 80% of the allowance the reminder and the coach notice are held back", s2.deferred >= 2 && m2.sent.every((x) => !/reminder/i.test(x.subject) && x.to !== ADMINS.join(", ")), `${s2.deferred} deferred, sent: ${m2.sent.map((x) => x.subject).join(" | ")}`);
  const stillWaiting = await rows("status = 'pending' AND kind IN ('parent_reminder','coach_notice')");
  check("they are kept for later, not dropped", stillWaiting.length >= 2);
  const health = await getEmailHealth(new Date());
  check("the dashboard can show how much of the allowance is used", health.sentLast24h >= 6 && health.dailyBudget >= 10);
}

// ---------------------------------------------------------------------------
console.log("\n=== 13. The dashboard's view of email health ===");
{
  await reset();
  const empty = await getEmailHealth();
  check("nothing waiting on a quiet day", empty.waiting === 0 && empty.failed === 0 && empty.oldestWaitingMinutes === null);
  await reserveOk("health1", { email: "health1@example.test" });
  await pool.query(`UPDATE email_outbox SET created_at = now() - interval '45 minutes' WHERE kind = 'parent_instructions'`);
  const waiting = await getEmailHealth();
  check("an email stuck for 45 minutes is visible as such (the coach's held-back summary is not counted)", waiting.waiting === 1 && waiting.oldestWaitingMinutes >= 44, JSON.stringify(waiting));
  const noEmail = await processOutbox({ origin: ORIGIN });
  check("with no mail connection configured nothing is attempted and the rows simply wait", noEmail.skippedNoEmail === true && (await rows("status = 'pending'")).length === 2);
  const noOrigin = await processOutbox({ send: mailer().send });
  check("with no site address a run refuses to build emails with broken links", noOrigin.stoppedEarly !== null && noOrigin.sent === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 14. The release notice: the safety net for a family that paid but never tapped the button ===");
{
  await reset();
  const lapsed = await reserveOk("lapsed", { email: "lapsed@example.test", parentName: "Pat Parent", weekIds: ["jul06"] });
  const adminReleased = await reserveOk("admin-rel", { email: "adminrel@example.test", weekIds: ["jul13"] });
  const notReceived = await reserveOk("notrec", { email: "notrec@example.test", weekIds: ["jul20"] });
  await campDb.cancelRegistration(adminReleased, "family asked", { releaseReason: "owner_cancelled" });
  await campDb.reportPayment(notReceived);
  await campDb.cancelRegistration(notReceived, "nothing found", { releaseReason: "not_received" });
  await h.expireHold(lapsed, 1);
  await campDb.releaseExpiredReservations();
  const queued = await rows("kind = 'parent_release'");
  check("the 12-hour release queues one notice, for that family only (an administrator's release does not)", queued.length === 1 && queued[0].registration_id === lapsed);
  const m = mailer();
  await run(m, { coachMode: "off" });
  const notice = m.sent.find((x) => x.to === "lapsed@example.test" && /released/i.test(x.subject));
  const ref = (await campDb.getRegistrationById(lapsed)).reference;
  check("it goes to the family, with the reference and what to do if they did send the payment", Boolean(notice) && notice.text.includes(ref) && /reply to this email/i.test(notice.text) && /refund/i.test(notice.text));
  check("it contains no web link (nothing to click, nothing to forge)", !/https?:\/\//.test(notice.text) && !/href="https?:/i.test(notice.html));
  await run(m, { coachMode: "off" });
  check("it is never sent twice", m.sent.filter((x) => x.to === "lapsed@example.test" && /released/i.test(x.subject)).length === 1);

  // Reinstated before the notice went out: the notice would now be wrong.
  await reset();
  const quick = await reserveOk("quick", { email: "quick@example.test", weekIds: ["jul06"] });
  await h.expireHold(quick, 1);
  await campDb.releaseExpiredReservations();
  await confirmFor(quick);
  const m2 = mailer();
  await run(m2, { coachMode: "off" });
  check("if the owner reinstates the family before the notice is sent, no 'released' notice goes out",
    m2.sent.every((x) => !/was released/i.test(x.subject)) && (await rowFor("parent_release", quick)).status === "skipped");

  // A mistyped address must not be bounced at again and again.
  await reset();
  const typo = await reserveOk("typo2", { email: "nobody@gmial.example", weekIds: ["jul06"] });
  await h.expireHold(typo, 1);
  await campDb.releaseExpiredReservations();
  const bounce = mailer((message) => smtpError(550, `550 5.1.1 <${message.to}> User unknown`));
  for (let i = 0; i < 4; i++) await run(bounce, { coachMode: "off", now: new Date(Date.now() + (i + 1) * 40 * MIN) });
  check("a mistyped address is tried once, then left alone (no repeated bounces)", bounce.calls === 1 && (await rowFor("parent_release", typo)).status === "failed", `${bounce.calls} attempts`);

  // Many families released at once: every one is told (not just the newest hundred).
  await reset();
  const weeks = ["jun22", "jun29", "jul06", "jul13", "jul20", "jul27", "aug03", "aug10", "aug17", "aug24"];
  for (let i = 0; i < 130; i++) await reserveOk(`mass${i}`, { email: `mass${i}@example.test`, weekIds: [weeks[i % 10]] });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 hour'`);
  await campDb.releaseExpiredReservations();
  const m3 = mailer();
  await run(m3, { coachMode: "off", limit: 500, timeBudgetMs: 60_000, dailyBudget: 5000 });
  const told = new Set(m3.sent.filter((x) => /was released/i.test(x.subject)).map((x) => x.to));
  check("130 reservations released in the same minute: all 130 families are told", told.size === 130, String(told.size));
  check("and nobody was sent the original payment instructions for a spot that no longer exists", m3.sent.every((x) => !/Send your payment to hold/i.test(x.subject)));
}

await invariants("outbox");
await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("outbox"));
