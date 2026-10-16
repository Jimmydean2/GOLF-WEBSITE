// "Verify that reported payments are never automatically released simply because I have not
// checked my bank for several days."
//
// Three independent proofs:
//   1. The source code has exactly two places that can release a reservation, and the
//      automatic one cannot reach a reported payment (a scan that fails if anyone adds a third
//      path, such as a cleanup job).
//   2. Every entry point that runs on its own (page reads, the capacity API, the scheduled
//      check, the cron URL, the traffic fallback, the dashboard) is run repeatedly against
//      families whose deadlines are many days in the past.
//   3. The administrator comes back after ten days away and everything is exactly as it was
//      left, and can still be confirmed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "20";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const { runScheduledCheck, maybeRunFromTraffic } = await import("../../src/lib/scheduledCheck.ts");
const { processOutbox } = await import("../../src/lib/outbox.ts");
const cronRoute = await import("../../src/app/api/cron/payment-review/route.ts");
const h = createHarness();
const { pool, campDb, check, resetAll, reserveOk, confirmFor, makeOverdue, invariants } = h;

const ORIGIN = "https://camp.example.test";
const ALL_WEEKS = ["jun22", "jun29", "jul06", "jul13", "jul20", "jul27", "aug03", "aug10", "aug17", "aug24"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
console.log("=== 1. The source has exactly two ways to release, and only one is automatic ===");
{
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  })("src");
  const text = new Map(files.map((p) => [p, readFileSync(p, "utf8")]));

  const writers = files.filter((p) => /status\s*=\s*'cancelled'/.test(text.get(p)) || /release_reason\s*=\s*['$]/.test(text.get(p)));
  check("only campDb.ts writes a cancelled status or a release reason", writers.length === 1 && writers[0] === "src/lib/campDb.ts", writers.join(", "));

  const campDb = text.get("src/lib/campDb.ts");
  const functionOf = (needle, from = 0) => {
    const at = campDb.indexOf(needle, from);
    const start = campDb.lastIndexOf("\nexport async function", at);
    return campDb.slice(start + 1, start + 1 + 80).split("(")[0].replace("export async function ", "");
  };
  // Assignments only (an UPDATE of registrations whose SET clause makes the status 'cancelled'),
  // not the many reads that merely filter on that status.
  const assignments = [...campDb.matchAll(/UPDATE\s+registrations\s+SET[^`;]*?status\s*=\s*'cancelled'/g)].map((m) => functionOf(m[0], m.index));
  check("within it, exactly two functions release: releaseExpiredReservations and cancelRegistration",
    new Set(assignments).size === 2 && assignments.includes("releaseExpiredReservations") && assignments.includes("cancelRegistration"), assignments.join(", "));

  const autoStart = campDb.indexOf("export async function releaseExpiredReservations");
  const autoEnd = campDb.indexOf("// ---", autoStart + 10);
  const auto = campDb.slice(autoStart, autoEnd);
  const guards = (auto.match(/status = 'pending_payment' AND payment_reported_at IS NULL/g) ?? []).length;
  check("the automatic release selects, and then re-checks under the row lock, only unreported pending reservations", guards === 2, `${guards} guarded queries`);
  check("it contains no mention of the reported status", !/payment_reported'/.test(auto.replace(/payment_reported_at/g, "")));

  const callers = files.filter((p) => /\bcancelRegistration\b/.test(text.get(p)) && p !== "src/lib/campDb.ts");
  check("cancelRegistration (the administrator's release) is only reachable from admin routes", callers.length > 0 && callers.every((p) => p.startsWith("src/app/api/admin/")), callers.join(", "));
  const autonomous = ["src/lib/scheduledCheck.ts", "src/lib/outbox.ts", "src/lib/outboxQueue.ts", "src/lib/alerts.ts", "src/lib/registrationService.ts", "src/lib/registrationEffects.ts", "src/app/api/cron/payment-review/route.ts", "src/app/api/camp-capacity/route.ts", "src/app/camp-registration/[token]/page.tsx", "src/app/api/camp-registration/report/route.ts"];
  const touching = autonomous.filter((p) => /\b(cancelRegistration|confirmRegistrationPayment|reinstateRegistration|grantReviewExtension|authorizeWeekCapacity)\b|status\s*=\s*'(cancelled|paid|refunded)'|DELETE FROM registrations/.test(text.get(p)));
  check("nothing that runs on its own (scheduler, outbox, alerts, cron, traffic, parent pages) can release, confirm, extend or delete", touching.length === 0, touching.join(", "));
  check("nothing in the application ever deletes a registration", files.every((p) => !/DELETE\s+FROM\s+registrations/i.test(text.get(p))));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Ten days away: every automatic entry point, run over and over ===");
{
  await resetAll();
  await pool.query(`DELETE FROM job_runs`);
  await pool.query(`DELETE FROM alert_ledger`);
  const reportedIds = [];
  const weeks = ["jul06", "jul13", "jul20", "jul27", "aug03"];
  for (let i = 0; i < 20; i++) reportedIds.push(await reserveOk(`away${i}`, { email: `away${i}@example.test`, weekIds: [weeks[i % 5]], children: [{ fullName: `Away Kid ${i}`, dateOfBirth: "2017-01-01", age: "9", healthInfo: "none" }] }));
  const silentIds = [];
  for (let i = 0; i < 5; i++) silentIds.push(await reserveOk(`silent${i}`, { email: `silent${i}@example.test`, weekIds: [weeks[i % 5]] }));
  for (const id of reportedIds) await campDb.reportPayment(id);

  const spotsHeldBefore = (await pool.query(`SELECT count(*)::int AS n FROM registration_spots WHERE status='active'`)).rows[0].n;
  check("setup: 25 reservations hold 25 spots (20 reported, 5 never reported)", spotsHeldBefore === 25);

  // Ten days pass with nobody looking at a bank account: every deadline is long gone.
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '10 days' WHERE status IN ('payment_reported','pending_payment')`);
  for (const id of reportedIds) await makeOverdue(id, 8 * 24);

  const mails = [];
  const send = async (message) => { mails.push(message); };
  const hits = [];
  const record = (label, fn) => hits.push([label, fn]);
  record("a page that lists the weeks (capacity)", () => campDb.getCampWeeks());
  record("a parent opening their reservation page", () => campDb.getRegistrationById(reportedIds[0]));
  record("another family trying to register", () => campDb.reserveRegistration(h.input("newcomer", { weekIds: ["aug10"] })));
  record("the administrator's queue", () => campDb.getPaymentQueue());
  record("the scheduled check", () => runScheduledCheck({ source: "cron", origin: ORIGIN, send, adminEmails: ["owner@example.test"] }));
  record("the traffic fallback", () => maybeRunFromTraffic(ORIGIN, { send }));
  record("the mail sender", () => processOutbox({ origin: ORIGIN, send, adminEmails: ["owner@example.test"] }));
  record("the release sweep itself", () => campDb.releaseExpiredReservations());
  record("the release sweep, a year from now", () => campDb.releaseExpiredReservations(new Date(Date.now() + 365 * DAY)));
  process.env.CRON_SECRET = "test-only-cron-secret-0123456789";
  record("the cron URL", async () => (await cronRoute.GET(new Request("https://camp.example.test/api/cron/payment-review", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))).status);

  for (let round = 0; round < 3; round++) {
    for (const [, fn] of hits) await Promise.resolve(fn()).catch(() => {});
    await pool.query(`UPDATE job_runs SET started_at = started_at - interval '10 minutes'`); // so the traffic fallback runs again
  }
  delete process.env.CRON_SECRET;

  const stillReported = (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE id = ANY($1::uuid[]) AND status = 'payment_reported' AND release_reason IS NULL`, [reportedIds])).rows[0].n;
  check("all 20 reported payments are exactly as the parents left them: Payment Reported", stillReported === 20);
  const heldByReported = (await pool.query(`SELECT count(*)::int AS n FROM registration_spots WHERE registration_id = ANY($1::uuid[]) AND status = 'active'`, [reportedIds])).rows[0].n;
  check("and every one of their 20 spots is still held", heldByReported === 20);
  const silentReleased = (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE id = ANY($1::uuid[]) AND status = 'cancelled' AND release_reason = 'expired_unpaid'`, [silentIds])).rows[0].n;
  check("the 5 that never reported were released by the 12-hour rule", silentReleased === 5);
  const capacity = await campDb.getCampWeeks();
  check("the capacity shown to the public still counts the 20 held spots (no week is shown as freer than it is)", capacity.reduce((n, w) => n + w.takenCount, 0) === 20, String(capacity.reduce((n, w) => n + w.takenCount, 0)));
  const systemAudit = (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id = ANY($1::text[]) AND action IN ('release_expired','cancel','release','cancel_registration','confirm_payment')`, [reportedIds])).rows[0].n;
  check("the audit log shows no release or confirmation of any reported payment", systemAudit === 0);
  const alertMails = mails.filter((m) => /^\[(URGENT|REMINDER|ESCALATED|CRITICAL)\]/.test(m.subject));
  check("the owner is told, loudly, about the overdue payments", alertMails.length >= 20 && alertMails.some((m) => m.subject.startsWith("[CRITICAL]")), `${alertMails.length} alert emails`);
  const reportedFamilies = new Set(reportedIds.map((_, i) => `away${i}@example.test`));
  check("none of the 20 reported families received a 'your reservation was released' email", mails.every((m) => !(reportedFamilies.has(m.to) && /released/i.test(m.subject))));
  await invariants("ten days away");

  // The owner comes back.
  const queue = await campDb.getPaymentQueue();
  check("back at the dashboard: 20 payments to verify, all flagged overdue, 20 spots blocked", queue.reported.length === 20 && queue.overdueCount === 20 && queue.blockedSpots === 20);
  const results = [];
  for (const id of reportedIds.slice(0, 15)) results.push(await confirmFor(id));
  check("15 are found in the bank and confirmed: every one works, none lost its spot", results.every((r) => r.ok && r.registration.status === "paid" && r.registration.weekIds.length === 1));
  for (const id of reportedIds.slice(15)) {
    const r = await campDb.cancelRegistration(id, "No deposit found after ten days; parent contacted", { releaseReason: "not_received" });
    results.push(r);
  }
  check("5 are not found and the owner releases them: only now do their spots free up", results.slice(15).every((r) => r.ok) && (await pool.query(`SELECT count(*)::int AS n FROM registration_spots WHERE status='active'`)).rows[0].n === 15);
  await invariants("owner back");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. A report that arrives as the hold ends is never lost to a release running at the same moment ===");
{
  await resetAll();
  let released = 0;
  let reported = 0;
  const problems = [];
  for (let i = 0; i < 40; i++) {
    const id = await reserveOk(`race${i}`, { email: `race${i}@example.test`, weekIds: [ALL_WEEKS[i % 10]] });
    // The hold ends between 0 and 11 milliseconds from now, so some parents' reports land just
    // before the deadline (and win) and some just after (and are turned away, the reservation
    // then being released): the one outcome that must never happen is both.
    await pool.query(`UPDATE registrations SET hold_expires_at = clock_timestamp() + make_interval(secs => $2) WHERE id = $1`, [id, ((i * 7) % 12) / 1000]);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([
      campDb.reportPayment(id),
      (async () => { await wait(25); await campDb.releaseExpiredReservations(); await campDb.releaseExpiredReservations(); })(),
    ]);
    const row = await h.reg(id);
    if (row.status === "payment_reported") {
      reported++;
      if (row.release_reason !== null || row.spotsActive !== 1 || !row.payment_reported_at) problems.push(`${i}: reported but inconsistent`);
    } else if (row.status === "cancelled" && row.release_reason === "expired_unpaid") {
      released++;
      if (row.payment_reported_at) problems.push(`${i}: released AND reported`);
    } else {
      problems.push(`${i}: unexpected ${row.status}`);
    }
  }
  check("40 races between a parent's report and the automatic release: each ended in exactly one clean state", problems.length === 0 && reported + released === 40, `${reported} reported, ${released} released ${problems.join("; ")}`);
  check("both outcomes actually occurred (the test really straddles the boundary)", reported > 0 && released > 0, `${reported}/${released}`);
  await invariants("report vs release");
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("no-auto-release"));
