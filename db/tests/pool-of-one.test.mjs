// Production runs each server instance with a pool of ONE database connection (so the many
// instances serverless hosting can start do not exhaust the database). That setting turns a
// whole class of mistakes into hangs: any code that asks for a second connection while still
// holding the first waits for itself forever. This suite runs the busy paths with exactly
// one connection and a hard deadline, and checks the pool survives the database dropping it.

import pg from "pg";
import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX = "1";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const { handleRegistrationRequest } = await import("../../src/lib/registrationService.ts");
const { processOutbox } = await import("../../src/lib/outbox.ts");
const { runScheduledCheck } = await import("../../src/lib/scheduledCheck.ts");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, invariants } = h;

const within = (ms, promise, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`HUNG: ${label} did not finish in ${ms} ms`)), ms))]);

// ---------------------------------------------------------------------------
console.log("=== 1. The pool really has one connection ===");
check("max connections is 1", pool.options.max === 1, String(pool.options.max));

// ---------------------------------------------------------------------------
console.log("\n=== 2. A repeated submission caught half-way by the database does not hang the request ===");
{
  await resetAll();
  const key = "pool-of-one-key-0001";
  const body = input("rival", { idempotencyKey: key, email: "rival@example.test", weekIds: ["2027-07-05"] });

  // Another server instance has this same submission in flight: its row exists but is not yet
  // committed, so ours cannot see it, tries to insert, and has to wait for the other to finish.
  const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await other.connect();
  await other.query("BEGIN");
  const row = await other.query(
    `INSERT INTO registrations (idempotency_key, parent_name, email, primary_phone, emergency_name, emergency_relationship,
       emergency_phone, code_of_conduct_accepted, consent_accepted, health_consent_accepted, consent_version, consent_recorded_at,
       status, total_price_cents, amount_due_cents, hold_expires_at)
     VALUES ($1,'Rival','rival@example.test','514-555-0000','E','A','2',true,true,true,'test',now(),'pending_payment',38000,43700, now() + interval '12 hours') RETURNING id`,
    [key]
  );
  const child = await other.query(`INSERT INTO children (registration_id, full_name, date_of_birth, age, health_info) VALUES ($1,'Rival Kid','2017-01-01','9','none') RETURNING id`, [row.rows[0].id]);
  await other.query(`INSERT INTO registration_spots (registration_id, child_id, week_id) VALUES ($1,$2,'2027-07-05')`, [row.rows[0].id, child.rows[0].id]);
  const ours = campDb.reserveRegistration(body);
  await new Promise((r) => setTimeout(r, 400));
  await other.query("COMMIT");
  await other.end();
  let outcome;
  try {
    outcome = await within(6_000, ours, "reserveRegistration after a unique-key collision");
  } catch (err) {
    outcome = { hung: String(err.message) };
  }
  check("it answers instead of waiting on its own connection", !outcome.hung, outcome.hung);
  check("and answers with the reservation the other instance made (a repeat, not an error)", outcome.ok === true && outcome.alreadyExisted === true, JSON.stringify(outcome).slice(0, 160));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. A burst of families through the real request path, on one connection ===");
{
  await resetAll();
  await pool.query(`DELETE FROM rate_limit_counters`);
  const weeks = ["2027-06-21", "2027-06-28", "2027-07-05", "2027-07-12", "2027-07-19", "2027-07-26", "2027-08-02", "2027-08-09", "2027-08-16", "2027-08-23"];
  const call = (i) => {
    // Every fourth family is two siblings for one week; the rest are one child for two weeks:
    // 16 child-weeks per camp week on average, so nothing fills up.
    const base = input(`burst${i}`, i % 4 === 0 ? { weekIds: [weeks[i % 10]], children: kids(2, `B${i}`) } : { weekIds: [weeks[i % 10], weeks[(i + 3) % 10]], children: kids(1, `B${i}`) });
    const { weekIds, ...rest } = base;
    const body = { ...rest, idempotencyKey: base.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "").slice(-60), weeks: weekIds };
    return handleRegistrationRequest(
      new Request("http://localhost:3000/api/camp-registration", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(i % 200) + 1}` }, body: JSON.stringify(body) }),
      { defer: () => {} }
    ).then((r) => r.status);
  };
  const t0 = Date.now();
  const statuses = await within(60_000, Promise.all(Array.from({ length: 80 }, (_, i) => call(i))), "80 simultaneous registrations");
  const ok = statuses.filter((s) => s === 200).length;
  check("80 simultaneous registrations: every one answered, none hung", statuses.length === 80);
  check("all 80 succeeded (no week was close to full)", ok === 80, [...new Set(statuses)].join(","));
  check("and quickly enough to be comfortable on one connection", Date.now() - t0 < 30_000, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await invariants("burst on one connection");

  const m = [];
  const send = async (message) => { m.push(message); };
  const sent = await within(60_000, Promise.all([
    processOutbox({ origin: "https://camp.example.test", send, adminEmails: ["owner@example.test"], limit: 100, dailyBudget: 5000 }),
    processOutbox({ origin: "https://camp.example.test", send, adminEmails: ["owner@example.test"], limit: 100, dailyBudget: 5000 }),
    runScheduledCheck({ source: "cron", origin: "https://camp.example.test", send, adminEmails: ["owner@example.test"] }),
  ]), "the email workers");
  const parentMails = m.filter((x) => /Send your payment to hold/.test(x.subject));
  check("three email workers at once on one connection: every family's instructions went out exactly once", parentMails.length === 80 && new Set(parentMails.map((x) => x.to)).size === 80, `${parentMails.length}`);
  void sent;
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The database drops the connection: the server does not fall over ===");
{
  await pool.query("SELECT 1"); // make sure the pool holds an idle connection
  const killer = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await killer.connect();
  const killed = await killer.query(`SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND application_name = '' AND state = 'idle'`);
  await killer.end();
  await new Promise((r) => setTimeout(r, 300)); // let the server's notice reach the pool
  check("the server really did cut an idle connection", killed.rows.length >= 1);
  let recovered;
  try {
    // One retry is acceptable: the first query after a drop may hit the dead socket.
    try { await within(5_000, pool.query("SELECT 1 AS ok"), "first query after the drop"); } catch { /* retried below */ }
    recovered = (await within(5_000, pool.query("SELECT 1 AS ok"), "second query after the drop")).rows[0].ok === 1;
  } catch (err) {
    recovered = false;
    console.log("   ", err.message);
  }
  check("the process is still alive and the pool opens a new connection by itself", recovered === true);
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("pool-of-one"));
