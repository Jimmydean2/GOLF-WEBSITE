// The email stack against a REAL SMTP conversation: the application's own sendEmail and
// outbox, real nodemailer, real timeouts, real reply codes, talking to the local test mail
// server (scripts/lib/smtpSink.mjs). Nothing here touches Gmail or any real mailbox.

import { createTestDatabase } from "./helpers/testdb.mjs";
import { startSmtpSink } from "../../scripts/lib/smtpSink.mjs";

process.env.DB_POOL_MAX ||= "10";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const sink = await startSmtpSink();
process.env.SMTP_HOST = sink.host;
process.env.SMTP_PORT = String(sink.port);
process.env.SMTP_INSECURE = "true";
process.env.EMAIL_FROM = "camp@example.test";
process.env.EMAIL_TIMEOUT_MS = "1500";
process.env.SITE_URL = "https://camp.example.test";
process.env.COACH_NOTICE_MODE = "digest";

const { createHarness } = await import("./helpers/harness.mjs");
const { sendEmail, isEmailConfigured } = await import("../../src/lib/email.ts");
const { processOutbox, getEmailHealth } = await import("../../src/lib/outbox.ts");
const h = createHarness();
const { pool, check, resetAll, reserveOk, expireHold, campDb } = h;
const MIN = 60_000;
const reset = async () => { await resetAll(); sink.reset(); };
const subjects = () => sink.messages.map((m) => m.subject);

// ---------------------------------------------------------------------------
console.log("=== 1. The application's own sender, over real SMTP ===");
{
  await reset();
  check("the application sees mail as configured", isEmailConfigured());
  await sendEmail({ to: "maman@example.test", subject: "Réservation confirmée pour Émilie Côté", html: "<p>Allô — €5 <b>gras</b></p>", text: "Allô — François a une réservation à 9 h 30." });
  const m = sink.messages[0];
  check("one message arrives", sink.messages.length === 1 && m.to.includes("maman@example.test"));
  check("accented characters survive in the subject", m.subject === "Réservation confirmée pour Émilie Côté", m.subject);
  check("and in both the plain-text and HTML bodies", m.text.includes("Allô — François a une réservation à 9 h 30.") && m.html.includes("Allô — €5"), m.text);
  check("it is sent from the configured address, under the business name", m.envelopeFrom === "camp@example.test" && m.from.includes("James Dean Golf") && m.from.includes("camp@example.test"), `${m.envelopeFrom} / ${m.from}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. A family's whole email journey, through the outbox and real SMTP ===");
{
  await reset();
  const id = await reserveOk("journey", { email: "journey.mom@example.test", parentName: "Chantal Côté", children: [{ fullName: "Émilie Côté", dateOfBirth: "2016-04-04", age: "10", healthInfo: "none" }] });
  const first = await processOutbox({});
  const parentMail = sink.to("journey.mom@example.test")[0];
  check("the payment instructions arrive, with the child's accented name intact", Boolean(parentMail) && parentMail.subject.includes("Émilie Côté") && parentMail.text.includes("Émilie Côté"), subjects().join(" | "));
  check("they carry a private link on the site's address", /https:\/\/camp\.example\.test\/camp-registration\/[A-Za-z0-9._-]+/.test(parentMail.text));
  check("the coach's summary arrives separately and names no health details", sink.messages.some((m) => /new camp registration/i.test(m.subject) && !/Health|allerg/i.test(m.text)));
  check("nothing failed", first.failed === 0 && first.retried === 0, JSON.stringify(first));

  await h.confirmFor(id);
  await processOutbox({});
  check("the confirmation arrives after the owner confirms the payment", sink.to("journey.mom@example.test").some((m) => /confirmed/i.test(m.subject)));
  check("exactly one email of each kind went to the parent", sink.to("journey.mom@example.test").length === 2);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The mail server is down for a while ===");
{
  await reset();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await reserveOk(`down${i}`, { email: `down${i}@example.test`, weekIds: ["2027-07-05"] }));
  await sink.pause();
  const t0 = Date.now();
  const outage = await processOutbox({ coachMode: "off" });
  check("with the server refusing connections, a run fails fast and politely", Date.now() - t0 < 6_000 && outage.sent === 0 && outage.retried >= 1, `${Date.now() - t0}ms ${JSON.stringify(outage)}`);
  check("it stops after a few tries instead of hammering the dead server", outage.stoppedEarly !== null && outage.retried <= 3);
  const health = await getEmailHealth(new Date());
  check("the dashboard can see the emails waiting", health.waiting === 6);
  await sink.resume();
  const sooner = await processOutbox({ coachMode: "off", now: new Date(Date.now() + 30_000) });
  check("an early retry respects the delay", sooner.sent <= 3);
  const recovered = await processOutbox({ coachMode: "off", now: new Date(Date.now() + 40 * MIN) });
  check("when the server is back every family's email goes out", sink.messages.filter((m) => /Send your payment to hold/.test(m.subject)).length === 6, `${sink.messages.length} messages, ${JSON.stringify(recovered)}`);
  check("and each family got exactly one", new Set(sink.messages.map((m) => m.to[0])).size === 6);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. A busy server that says 'try again later' ===");
{
  await reset();
  for (let i = 0; i < 9; i++) await reserveOk(`busy${i}`, { email: `busy${i}@example.test`, weekIds: ["2027-07-12"] });
  sink.set({ failEvery: 3 });
  let rounds = 0;
  let now = Date.now();
  while (sink.messages.filter((m) => /Send your payment to hold/.test(m.subject)).length < 9 && rounds < 12) {
    await processOutbox({ coachMode: "off", now: new Date(now) });
    now += 35 * MIN;
    rounds++;
  }
  const delivered = sink.messages.filter((m) => /Send your payment to hold/.test(m.subject));
  check("with every third message refused (451), all nine families still get theirs", delivered.length === 9, `${delivered.length} after ${rounds} rounds`);
  check("none twice", new Set(delivered.map((m) => m.to[0])).size === 9);
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. A slow server, and a connection cut in the middle of a message ===");
{
  await reset();
  await reserveOk("slow", { email: "slow@example.test", weekIds: ["2027-07-19"] });
  sink.set({ delayMs: 4_000 });
  const t0 = Date.now();
  const slow = await processOutbox({ coachMode: "off" });
  check("a server that takes 4 seconds to answer is given up on after the 1.5 second timeout", Date.now() - t0 < 4_000 && slow.sent === 0 && slow.retried === 1, `${Date.now() - t0}ms`);
  sink.set({ delayMs: 0, dropOnData: true });
  const dropped = await processOutbox({ coachMode: "off", now: new Date(Date.now() + 5 * MIN) });
  check("a connection cut during the message counts as a failed send (retried later)", dropped.sent === 0 && dropped.retried === 1 && sink.messages.length === 0);
  sink.set({ dropOnData: false });
  const ok = await processOutbox({ coachMode: "off", now: new Date(Date.now() + 60 * MIN) });
  check("and the next try delivers it", ok.sent === 1 && sink.messages.length === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. A mistyped address ===");
{
  await reset();
  const typo = await reserveOk("typo", { email: "parent@gmial.example", weekIds: ["2027-07-26"] });
  const fine = await reserveOk("fine", { email: "fine@example.test", weekIds: ["2027-08-02"] });
  sink.set({ rejectRecipients: new Set(["parent@gmial.example"]) });
  const run = await processOutbox({ coachMode: "off" });
  check("the rejected address is marked undeliverable, and the next family is unaffected", run.failed === 1 && sink.to("fine@example.test").length === 1);
  const health = await getEmailHealth();
  check("it is on the dashboard with the family's phone number so the owner can call", health.failedItems.length === 1 && health.failedItems[0].reference === (await campDb.getRegistrationById(typo)).reference && health.failedItems[0].primaryPhone.length > 5);
  check("the error shown does not repeat the address", !health.failedItems[0].error.includes("gmial.example"), health.failedItems[0].error);
  void fine;
  const again = await processOutbox({ coachMode: "off", now: new Date(Date.now() + 90 * MIN) });
  check("it is not tried again", again.sent === 0 && again.retried === 0 && again.failed === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. A release notice and a reminder, over real SMTP ===");
{
  await reset();
  const lapsed = await reserveOk("lapse", { email: "lapse@example.test", weekIds: ["2027-08-09"] });
  await pool.query(`DELETE FROM email_outbox`);
  await expireHold(lapsed, 1);
  await campDb.releaseExpiredReservations();
  await processOutbox({ coachMode: "off" });
  const notice = sink.to("lapse@example.test")[0];
  check("the family is told its reservation was released, with what to do if they did pay", Boolean(notice) && /released/i.test(notice.subject) && /reply to this email/i.test(notice.text));
  check("the notice has no web link", !/https?:\/\//.test(notice.text));
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. A large batch ===");
{
  await reset();
  const weeks = ["2027-06-21", "2027-06-28", "2027-07-05", "2027-07-12", "2027-07-19", "2027-07-26", "2027-08-02", "2027-08-09", "2027-08-16", "2027-08-23"];
  for (let i = 0; i < 100; i++) await reserveOk(`batch${i}`, { email: `batch${i}@example.test`, weekIds: [weeks[i % 10]] });
  const t0 = Date.now();
  let total = 0;
  for (let pass = 0; pass < 6 && total < 100; pass++) total += (await processOutbox({ coachMode: "digest", limit: 40, timeBudgetMs: 30_000, dailyBudget: 5000 })).sent;
  const instr = sink.messages.filter((m) => /Send your payment to hold/.test(m.subject));
  check("100 families' instructions are delivered in a few bounded runs", instr.length === 100 && new Set(instr.map((m) => m.to[0])).size === 100, `${instr.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check("the coach got one summary, not 100 emails", sink.messages.filter((m) => /new camp registration/i.test(m.subject)).length === 1);
}

await resetAll();
await sink.stop();
await pool.end();
await testDb.drop();
process.exit(h.finish("smtp-stack"));
