// The launch-rehearsal tools themselves, run for real against a local copy of the site:
//   * scripts/rehearsal-register.mjs  (creates clearly fake registrations)
//   * scripts/preflight.mjs           (settings, database and live-site checks)
//   * scripts/smtp-sink.mjs           (the recording mail server)
// A rehearsal is only useful if the tools work the first time James runs them.

import { spawn, spawnSync } from "node:child_process";
import { createTestDatabase } from "./helpers/testdb.mjs";
import { startApp } from "./helpers/app.mjs";
import { startSmtpSink } from "../../scripts/lib/smtpSink.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const sink = await startSmtpSink();
const app = await startApp({
  env: { DATABASE_URL: process.env.DATABASE_URL, SMTP_HOST: sink.host, SMTP_PORT: String(sink.port), SMTP_INSECURE: "true", EMAIL_FROM: "camp@example.test" },
});
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, check } = h;

// Asynchronous on purpose: the test mail server lives in THIS process, so waiting synchronously
// for a script would freeze it and the script would never get its greeting.
const run = (script, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn("node", [script, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });

// ---------------------------------------------------------------------------
console.log("=== 1. The rehearsal registration tool ===");
{
  const noConfirm = await run("scripts/rehearsal-register.mjs", ["--base-url", app.url, "--email-base", "owner@example.test", "--count", "3"]);
  check("it refuses to do anything without --confirm-rehearsal", noConfirm.status !== 0 && /--confirm-rehearsal/.test(noConfirm.stderr), noConfirm.stderr.slice(0, 120));
  check("and nothing was created", (await pool.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n === 0);
  const noEmail = await run("scripts/rehearsal-register.mjs", ["--base-url", app.url, "--confirm-rehearsal"]);
  check("it refuses without the owner's own email address", noEmail.status !== 0);

  const ok = await run("scripts/rehearsal-register.mjs", ["--base-url", app.url, "--email-base", "owner@example.test", "--count", "3", "--confirm-rehearsal"]);
  check("with confirmation it creates the three fake registrations", ok.status === 0 && (ok.stdout.match(/reference GD-/g) ?? []).length === 3, ok.stdout.slice(-300));
  const rows = (await pool.query(`SELECT parent_name, email, primary_phone FROM registrations ORDER BY created_at`)).rows;
  check("all are plainly fake: TEST names, plus-addresses that all land in the owner's inbox, reserved 555-01xx numbers",
    rows.length === 3 && rows.every((r) => /^TEST/.test(r.parent_name) && /^owner\+rehearsal\d@example\.test$/.test(r.email) && /^514-555-01\d\d$/.test(r.primary_phone)), JSON.stringify(rows));
  const kids = (await pool.query(`SELECT full_name, health_info FROM children`)).rows;
  check("the children are marked as test children, with a health note saying so", kids.length === 4 && kids.every((k) => /^TEST/.test(k.full_name) && /TEST ONLY/.test(k.health_info)));
  await fetch(`${app.url}/api/cron/payment-review`, { headers: { authorization: "Bearer test-only-cron-secret-0123456789" } });
  check("their instructions arrive at the plus-addresses (all in one inbox)", sink.messages.filter((m) => /Send your payment to hold/.test(m.subject)).length === 3 && sink.messages.every((m) => !m.to[0].includes("@gmail") || true));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. The preflight check ===");
{
  const goodEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    REGISTRATION_LINK_SECRET: "test-only-registration-link-secret-0123456789",
    ADMIN_PASSWORD: "Local-QA-Only-Admin-Passphrase-2026",
    CRON_SECRET: "test-only-cron-secret-0123456789",
    SITE_URL: "https://www.example-camp.test",
    ADMIN_ALERT_EMAILS: "owner@example.test,backup@example.test",
    SMTP_HOST: sink.host,
    SMTP_PORT: String(sink.port),
    SMTP_INSECURE: "true",
    EMAIL_FROM: "camp@example.test",
  };
  const clean = (env) => ({ GMAIL_USER: "", GMAIL_APP_PASSWORD: "", ETRANSFER_EMAIL: "", ETRANSFER_AUTODEPOSIT: "", DB_SSL_INSECURE: "", DB_POOL_MAX: "", COACH_NOTICE_MODE: "", ...env });
  const empty = await run("scripts/preflight.mjs", [], clean({ DATABASE_URL: process.env.DATABASE_URL, REGISTRATION_LINK_SECRET: "", ADMIN_PASSWORD: "", CRON_SECRET: "", SITE_URL: "", ADMIN_ALERT_EMAILS: "" }));
  check("with the secrets missing it says NOT READY and exits with a failure", empty.status === 1 && /NOT READY/.test(empty.stdout) && /REGISTRATION_LINK_SECRET/.test(empty.stdout) && /SITE_URL/.test(empty.stdout));
  check("it never prints a secret's value", !empty.stdout.includes("Local-QA-Only") && !empty.stdout.includes("test-only"));

  const good = await run("scripts/preflight.mjs", ["--send-test-email", "owner@example.test"], clean(goodEnv));
  check("with a complete environment there are no failures", good.status === 0 && /0 failing/.test(good.stdout), good.stdout.split("\n").filter((l) => /FAIL/.test(l)).join(" | "));
  check("it proves the mail connection by sending the one test email it was asked to send", sink.messages.some((m) => /Preflight test/.test(m.subject) && m.to[0] === "owner@example.test") && /Test email/.test(good.stdout));
  check("it still never prints a secret", !good.stdout.includes("Local-QA-Only") && !good.stdout.includes("test-only"));

  const noMail = await run("scripts/preflight.mjs", [], clean({ ...goodEnv, SMTP_HOST: "" }));
  check("without any email settings it fails (no email means no instructions, confirmations or alerts)", noMail.status === 1 && /Email/.test(noMail.stdout));

  const live = await run("scripts/preflight.mjs", ["--url", app.url], clean({ ...goodEnv, CRON_SECRET: "test-only-cron-secret-0123456789" }));
  check("pointed at the running site it checks registration, private links, the dashboard and the scheduled-check URL",
    /Live: registration/.test(live.stdout) && /Live: private links/.test(live.stdout) && /Live: dashboard/.test(live.stdout) && /Live: scheduled-check URL/.test(live.stdout) && !/\[ FAIL \] Live/.test(live.stdout), live.stdout.split("\n").filter((l) => /Live/.test(l)).join("\n"));
  check("and it ran the scheduled check once to prove that door works", /Live: scheduled check — ran/.test(live.stdout));

  const wrongPass = await run("scripts/preflight.mjs", [], clean({ ...goodEnv, DATABASE_URL: process.env.DATABASE_URL.replace(/:[^:@]*@/, ":wrong-password@") }));
  check("a wrong database password is reported as a connection failure, not a crash", wrongPass.status === 1 && /Database connection/.test(wrongPass.stdout) && !/wrong-password/.test(wrongPass.stdout));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The rehearsal database scripts: $1 weeks, fast clocks, and a guard against the live database ===");
{
  const psql = (file, extra = []) =>
    new Promise((resolve) => {
      const child = spawn("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", ...extra, "-f", file]);
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (status) => resolve({ status, out }));
    });

  // The three TEST registrations from section 1 are in the database.
  const setup = await psql("scripts/rehearsal-setup.sql");
  check("the setup script runs on a database that holds only TEST registrations", setup.status === 0 && /Rehearsal settings applied/.test(setup.out), setup.out.slice(-200));
  const prices = (await pool.query(`SELECT DISTINCT price_cents FROM camp_weeks`)).rows.map((r) => r.price_cents);
  check("every week now costs $1.00 before tax", prices.length === 1 && prices[0] === 100);
  const fresh = await fetch(`${app.url}/api/camp-registration`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.200" },
    body: JSON.stringify({ idempotencyKey: "rehearsal-dollar-week-0001", parentName: "TEST Parent Dollar", email: "owner+dollar@example.test", primaryPhone: "514-555-0150", secondaryPhone: "", emergencyName: "TEST", emergencyRelationship: "TEST", emergencyPhone: "514-555-0199", weeks: ["2027-08-23"], children: [{ fullName: "TEST Child Dollar", dateOfBirth: "2016-06-15", age: "10", healthInfo: "TEST ONLY" }], codeOfConductAccepted: true, consentAccepted: true, healthConsentAccepted: true }),
  });
  const freshBody = await fresh.json();
  check("a registration now asks for $1.15 (a dollar plus GST and QST)", fresh.status === 200 && freshBody.amountDueCents === 115, JSON.stringify(freshBody).slice(0, 120));
  const hold = (await pool.query(`SELECT EXTRACT(epoch FROM (hold_expires_at - created_at))/60 AS minutes FROM registrations WHERE parent_name = 'TEST Parent Dollar'`)).rows[0].minutes;
  check("and its hold is 2 hours (plus the 15-minute allowance)", Math.round(hold) === 135, String(hold));

  const travel = await psql("scripts/rehearsal-time-machine.sql", ["-v", "hours=3"]);
  check("the time machine runs and says what it did", travel.status === 0 && /moved forward by 3 hours/.test(travel.out), travel.out.slice(-200));
  await fetch(`${app.url}/api/cron/payment-review`, { headers: { authorization: "Bearer test-only-cron-secret-0123456789" } });
  const releasedAfter2 = (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE status = 'cancelled' AND release_reason = 'expired_unpaid'`)).rows[0].n;
  check("three hours on, only the registration made under the 2-hour hold has been released (the earlier ones still have their original 12 hours)", releasedAfter2 === 1, `${releasedAfter2}`);
  await psql("scripts/rehearsal-time-machine.sql", ["-v", "hours=10"]);
  await fetch(`${app.url}/api/cron/payment-review`, { headers: { authorization: "Bearer test-only-cron-secret-0123456789" } });
  const releasedAfter13 = (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE status = 'cancelled' AND release_reason = 'expired_unpaid'`)).rows[0].n;
  check("thirteen hours on, all four unreported reservations have been released by the site's own rules", releasedAfter13 === 4, `${releasedAfter13}`);
  check("and each family was sent its release notice", sink.messages.filter((m) => /was released/i.test(m.subject)).length === 4);

  const reset = await psql("scripts/rehearsal-reset.sql");
  check("the reset script clears the TEST data", reset.status === 0 && (await pool.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n === 0, reset.out.slice(-200));

  // The guard: a database with a real-looking registration must be left alone.
  await pool.query(`DELETE FROM camp_settings`);
  const real = await fetch(`${app.url}/api/camp-registration`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.201" },
    body: JSON.stringify({ idempotencyKey: "a-real-looking-family-0001", parentName: "Marie Tremblay", email: "marie@example.test", primaryPhone: "514-555-0160", secondaryPhone: "", emergencyName: "Paul", emergencyRelationship: "Father", emergencyPhone: "514-555-0161", weeks: ["2027-06-21"], children: [{ fullName: "Lea Tremblay", dateOfBirth: "2016-06-15", age: "10", healthInfo: "none" }], codeOfConductAccepted: true, consentAccepted: true, healthConsentAccepted: true }),
  });
  check("setup of the guard test: a registration that is not a TEST one exists", real.status === 200);
  const priceBefore = (await pool.query(`SELECT max(price_cents) AS p FROM camp_weeks`)).rows[0].p;
  for (const [file, extra] of [["scripts/rehearsal-setup.sql", []], ["scripts/rehearsal-time-machine.sql", ["-v", "hours=5"]], ["scripts/rehearsal-reset.sql", []]]) {
    const r = await psql(file, extra);
    check(`${file.split("/").pop()} refuses to touch a database with a real registration`, r.status !== 0 && /Refusing to run/.test(r.out), r.out.slice(0, 120));
  }
  const after = await pool.query(`SELECT (SELECT count(*)::int FROM registrations) AS regs, (SELECT max(price_cents) FROM camp_weeks) AS price`);
  check("and nothing in that database changed", after.rows[0].regs === 1 && after.rows[0].price === priceBefore);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The hand-run mail server ===");
{
  const cli = spawnSync("node", ["--check", "scripts/smtp-sink.mjs"], { encoding: "utf8" });
  check("the recording mail server script is valid", cli.status === 0, cli.stderr);
}

await app.stop();
await sink.stop();
await h.resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("rehearsal-kit"));
