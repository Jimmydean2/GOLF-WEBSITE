// The scheduled check: what runs on a clock rather than on a click. Reservations nobody
// reported are released, reminders and alerts go out, emails waiting in the outbox are sent,
// and a run that fails or never happens is visible. Overlapping runs do no harm.

import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "20";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const { runScheduledCheck, maybeRunFromTraffic, getSchedulerHealth } = await import("../../src/lib/scheduledCheck.ts");
const cronRoute = await import("../../src/app/api/cron/payment-review/route.ts");
const healthRoute = await import("../../src/app/api/health/scheduler/route.ts");
const h = createHarness();
const { pool, campDb, check, resetAll, reserveOk, expireHold, makeOverdue, invariants } = h;

const ORIGIN = "https://camp.example.test";
const ADMINS = ["owner@example.test", "backup@example.test"];
const HOUR = 3_600_000;
const MIN = 60_000;

function mailer(failure = () => null) {
  const sent = [];
  const send = async (message) => {
    const err = failure(message);
    if (err) throw err;
    sent.push(message);
  };
  return { send, sent };
}
const run = (m, extra = {}) => runScheduledCheck({ source: "cron", origin: ORIGIN, send: m.send, adminEmails: ADMINS, ...extra });
const reset = async () => {
  await resetAll();
  await pool.query(`DELETE FROM job_runs`);
  await pool.query(`DELETE FROM alert_ledger`);
  await pool.query(`DELETE FROM camp_settings`);
  delete process.env.COACH_NOTICE_MODE;
};
const status = async (id) => (await h.reg(id)).status;
const createdAt = async (id) => new Date((await pool.query(`SELECT created_at FROM registrations WHERE id=$1`, [id])).rows[0].created_at).getTime();

// ---------------------------------------------------------------------------
console.log("=== 1. The 12-hour rule, on a clock ===");
{
  await reset();
  const ignored = await reserveOk("never-reported", { email: "never@example.test", weekIds: ["2027-07-05"] });
  const reported = await reserveOk("reported-long-ago", { email: "reported@example.test", weekIds: ["2027-07-12"] });
  const fresh = await reserveOk("fresh", { email: "fresh@example.test", weekIds: ["2027-07-19"] });
  await campDb.reportPayment(reported);
  await expireHold(ignored, 1);
  // The reported one is 8 days overdue: far past every deadline.
  await makeOverdue(reported, 8 * 24);
  const m = mailer();
  const s = await run(m);
  check("the run reports success", s.ok === true && s.source === "cron");
  check("the unreported reservation past its hold was released", s.released === 1 && (await status(ignored)) === "cancelled");
  check("the reservation still inside its hold was left alone", (await status(fresh)) === "pending_payment");
  check("the REPORTED payment, 8 days overdue, was not released, confirmed or changed", (await status(reported)) === "payment_reported" && (await h.reg(reported)).spotsActive > 0);
  check("the family whose reservation was released is told, once", m.sent.filter((x) => x.to === "never@example.test").length === 1 && s.parentNotices === 1);
  check("the owner is alerted about the overdue payment (to every address)", m.sent.some((x) => x.to === ADMINS.join(", ") && /overdue|critical/i.test(x.subject)) && s.alertsSent >= 1);
  const again = await run(m);
  check("running again immediately sends and releases nothing new", again.released === 0 && again.alertsSent === 0 && again.parentNotices === 0 && again.emails.sent === 0);
  await invariants("12-hour rule");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. One run does it all: reminder queued, then sent ===");
{
  await reset();
  const a = await reserveOk("rem-a", { email: "rem-a@example.test", weekIds: ["2027-07-05"] });
  const b = await reserveOk("rem-b", { email: "rem-b@example.test", weekIds: ["2027-07-12"] });
  await pool.query(`DELETE FROM email_outbox WHERE kind <> 'parent_reminder'`);
  const t = new Date((await createdAt(a)) + 9.2 * HOUR);
  const m = mailer();
  const s = await run(m, { now: t });
  check("at nine hours the reminder is queued and sent in the same run", s.remindersQueued === 2 && s.emails.sent === 2 && m.sent.every((x) => /reminder/i.test(x.subject)));
  check("each family gets its own reminder", m.sent.map((x) => x.to).sort().join() === "rem-a@example.test,rem-b@example.test");
  void b;
  const later = await run(m, { now: new Date(t.getTime() + 30 * MIN) });
  check("it is not sent a second time", later.remindersQueued === 0 && later.emails.sent === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Overlapping runs: one does the work, nothing is done twice ===");
{
  await reset();
  for (let i = 0; i < 6; i++) {
    const id = await reserveOk(`par${i}`, { email: `par${i}@example.test`, weekIds: ["2027-07-05"] });
    await expireHold(id, 1);
  }
  const counts = new Map();
  const slow = async (message) => { counts.set(message.to, (counts.get(message.to) ?? 0) + 1); await new Promise((r) => setTimeout(r, 25)); };
  const results = await Promise.all(Array.from({ length: 5 }, () => runScheduledCheck({ source: "cron", origin: ORIGIN, send: slow, adminEmails: ADMINS })));
  const worked = results.filter((r) => !r.skipped);
  check("five runs at once: exactly one does the work, the others step aside", worked.length === 1 && results.filter((r) => r.skipped === "already_running").length === 4, results.map((r) => r.skipped ?? "ran").join());
  check("every family got its release notice exactly once", [...counts.entries()].filter(([to]) => to.startsWith("par")).every(([, n]) => n === 1) && [...counts.keys()].filter((k) => k.startsWith("par")).length === 6);
  const next = await run(mailer());
  check("afterwards the next run proceeds normally (the lease was handed back)", !next.skipped);

  await pool.query(`UPDATE camp_settings SET value = (now() + interval '2 minutes')::text WHERE key = 'scheduled_check_lease'`);
  const blocked = await run(mailer());
  check("while a run is still inside its time allowance, another is turned away", blocked.skipped === "already_running");
  await pool.query(`UPDATE camp_settings SET value = (now() - interval '1 minute')::text WHERE key = 'scheduled_check_lease'`);
  const recovered = await run(mailer());
  check("a run that died is recovered from once its time allowance has passed", !recovered.skipped);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Every run leaves a record; a failed run is visible and does not poison the next ===");
{
  await reset();
  const ok = await run(mailer());
  const rowsOk = (await pool.query(`SELECT source, ok, finished_at, summary FROM job_runs`)).rows;
  check("a run is recorded with its source, outcome and summary", rowsOk.length === 1 && rowsOk[0].source === "cron" && rowsOk[0].ok === true && rowsOk[0].finished_at && rowsOk[0].summary.released === 0 && ok.ok);

  const victim = await reserveOk("victim", { email: "victim@example.test", weekIds: ["2027-07-05"] });
  await expireHold(victim, 1);
  await pool.query(`CREATE OR REPLACE FUNCTION test_block_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'cancelled' THEN RAISE EXCEPTION 'simulated database trouble'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER test_block_release BEFORE UPDATE ON registrations FOR EACH ROW EXECUTE FUNCTION test_block_release()`);
  const bad = await run(mailer());
  check("a run that hits a database error reports failure instead of throwing", bad.ok === false && /simulated database trouble/.test(bad.error));
  const failedRow = (await pool.query(`SELECT ok, error FROM job_runs ORDER BY id DESC LIMIT 1`)).rows[0];
  check("and the failure is on record", failedRow.ok === false && /simulated/.test(failedRow.error));
  const health = await getSchedulerHealth();
  check("the dashboard can say the last run failed, and why", health.lastRunOk === false && /simulated/.test(health.lastRunError));
  await pool.query(`DROP TRIGGER test_block_release ON registrations`);
  const good = await run(mailer());
  check("once the trouble is gone the next run succeeds and does the work that was missed", good.ok && good.released === 1 && (await status(victim)) === "cancelled");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. The site-traffic fallback ===");
{
  await reset();
  const first = await maybeRunFromTraffic(ORIGIN, { send: mailer().send, adminEmails: ADMINS });
  const second = await maybeRunFromTraffic(ORIGIN, { send: mailer().send, adminEmails: ADMINS });
  check("a visit starts a check; the next visit within 5 minutes does not", first !== null && first.source === "traffic" && second === null);
  await pool.query(`UPDATE job_runs SET started_at = now() - interval '6 minutes'`);
  const third = await maybeRunFromTraffic(ORIGIN, { send: mailer().send, adminEmails: ADMINS });
  check("after 5 minutes it runs again", third !== null);
  await pool.query(`UPDATE job_runs SET started_at = now() - interval '6 minutes'`);
  const burst = await Promise.all(Array.from({ length: 12 }, () => maybeRunFromTraffic(ORIGIN, { send: mailer().send, adminEmails: ADMINS })));
  check("12 visitors at once: exactly one check runs", burst.filter((x) => x !== null).length === 1);

  await pool.query(`UPDATE job_runs SET started_at = now() - interval '6 minutes'`);
  await run(mailer());
  const afterCron = await maybeRunFromTraffic(ORIGIN, { send: mailer().send });
  check("if the real scheduler ran a minute ago, traffic does not run a duplicate", afterCron === null);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. The heartbeat the dashboard watches ===");
{
  await reset();
  const never = await getSchedulerHealth();
  check("before any run: 'never'", never.status === "never" && never.lastRunAt === null && never.minutesSinceLastCron === null);
  await run(mailer(), { source: "traffic" });
  const traffic = await getSchedulerHealth();
  check("a traffic-only history is 'ok' but shows no real scheduler yet", traffic.status === "ok" && traffic.lastRunSource === "traffic" && traffic.lastCronAt === null);
  await run(mailer());
  const cron = await getSchedulerHealth();
  check("a scheduled run shows up as the scheduler", cron.lastRunSource === "cron" && cron.lastCronAt !== null && cron.runsLastHour === 2);
  await pool.query(`UPDATE job_runs SET started_at = now() - interval '25 minutes', finished_at = now() - interval '25 minutes'`);
  const stale = await getSchedulerHealth();
  check("25 minutes of silence is 'stale'", stale.status === "stale" && stale.minutesSinceLastRun >= 24, JSON.stringify(stale));

  const okRes = await (async () => {
    await run(mailer());
    return healthRoute.GET();
  })();
  check("the optional uptime-monitor URL answers 200 while healthy", okRes.status === 200 && (await okRes.json()).status === "ok");
  await pool.query(`UPDATE job_runs SET started_at = now() - interval '45 minutes'`);
  const staleRes = await healthRoute.GET();
  check("...and 503 when the check has stopped running", staleRes.status === 503 && (await staleRes.json()).status === "stale");
  const body = JSON.stringify(await (await healthRoute.GET()).json());
  check("it reveals nothing but that", !/@|GD-|parent|child/i.test(body), body);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. The scheduler's own door: the cron URL ===");
{
  await reset();
  const url = "https://camp.example.test/api/cron/payment-review";
  const call = (headers = {}) => cronRoute.GET(new Request(url, { headers }));
  delete process.env.CRON_SECRET;
  check("without a CRON_SECRET configured the URL refuses to run", (await call()).status === 503);
  process.env.CRON_SECRET = "short";
  check("a CRON_SECRET that is too short is refused", (await call({ authorization: "Bearer short" })).status === 503);
  process.env.CRON_SECRET = "test-only-cron-secret-0123456789";
  check("no credentials: 401", (await call()).status === 401);
  check("the wrong secret: 401", (await call({ authorization: "Bearer test-only-cron-secret-0123456780" })).status === 401);
  check("the secret in the query string is not accepted", (await cronRoute.GET(new Request(`${url}?secret=test-only-cron-secret-0123456789`))).status === 401);
  check("nothing ran for the refused calls", (await pool.query(`SELECT count(*)::int AS n FROM job_runs`)).rows[0].n === 0);
  const id = await reserveOk("cron-door", { email: "crondoor@example.test", weekIds: ["2027-07-05"] });
  await expireHold(id, 1);
  const good = await call({ authorization: "Bearer test-only-cron-secret-0123456789" });
  const body = await good.json();
  check("the right secret runs the check and returns its summary", good.status === 200 && body.ok === true && body.released === 1 && body.source === "cron", JSON.stringify(body));
  check("the summary has no names, addresses or references", !/@|GD-|crondoor/i.test(JSON.stringify(body)));
  check("with no mail configured it says so (the release still happened)", body.noEmailConfigured === true && (await status(id)) === "cancelled");
  delete process.env.CRON_SECRET;
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. Load and limits ===");
{
  await reset();
  const weeks = ["2027-06-21", "2027-06-28", "2027-07-05", "2027-07-12", "2027-07-19", "2027-07-26", "2027-08-02", "2027-08-09", "2027-08-16", "2027-08-23"];
  for (let i = 0; i < 120; i++) await reserveOk(`load${i}`, { email: `load${i}@example.test`, weekIds: [weeks[i % 10]] });
  await pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 hour'`);
  const m = mailer();
  const t0 = Date.now();
  const s = await run(m, { timeBudgetMs: 60_000, maxEmails: 40 });
  await run(m, { timeBudgetMs: 60_000, maxEmails: 40 });
  await run(m, { timeBudgetMs: 60_000, maxEmails: 40 });
  const seconds = (Date.now() - t0) / 1000;
  check("120 reservations past their hold are all released in one run", s.released === 120 && (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE status='cancelled'`)).rows[0].n === 120);
  check("and the run takes seconds, not minutes", seconds < 30, `${seconds.toFixed(1)}s`);
  check("every one of those families was told (release notices) over three bounded runs, and the weeks are free again", m.sent.filter((x) => x.to.startsWith("load")).length === 120 && (await h.week("2027-07-05")).taken_count === 0);

  // A slow mail server cannot make a run overshoot its time allowance.
  await reset();
  for (let i = 0; i < 20; i++) await reserveOk(`slow${i}`, { email: `slow${i}@example.test`, weekIds: ["2027-07-05"] });
  const slowMailer = { send: async () => { await new Promise((r) => setTimeout(r, 300)); } };
  const t1 = Date.now();
  const bounded = await runScheduledCheck({ source: "cron", origin: ORIGIN, send: slowMailer.send, adminEmails: ADMINS, timeBudgetMs: 2_500 });
  check("a run with a 2.5 second allowance stops sending soon after it is spent", Date.now() - t1 < 6_000 && bounded.emails.sent < 20 && bounded.emails.sent > 0, `${Date.now() - t1}ms, ${bounded.emails.sent} sent`);
  const rest = await runScheduledCheck({ source: "cron", origin: ORIGIN, send: slowMailer.send, adminEmails: ADMINS, timeBudgetMs: 60_000 });
  check("the next run finishes the rest", (await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE kind='parent_instructions' AND status='sent'`)).rows[0].n === 20 && rest.ok);
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("scheduler"));
