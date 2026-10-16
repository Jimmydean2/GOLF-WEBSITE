// "Do the tests actually notice if a protection is removed?"
//
// For each mutation below this script makes a scratch copy of the project, deliberately breaks
// ONE thing (switches off a database rule, or sabotages one line of the application), runs the
// relevant test suite against the broken copy, and requires the suite to FAIL. A mutation the
// suite does not notice would mean a protection nobody is checking.
//
// Nothing in your working tree is touched: the broken copies live in a temporary folder.
// Run it with:  DATABASE_URL=postgres://user:pass@localhost:5432/anydb npm run test:mutations
// (slow: about 20-60 seconds per mutation; it is not part of `npm test`).

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL || !/@(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.DATABASE_URL)) {
  console.error("Set DATABASE_URL to a LOCAL Postgres first. This script refuses anything else.");
  process.exit(2);
}

const SUITES = {
  integrity: "db/tests/payment-integrity.test.mjs",
  policy: "db/tests/payment-policy.test.mjs",
  security: "db/tests/admin-security.test.mjs",
  alerts: "db/tests/alerts.test.mjs",
  concurrency: "db/tests/concurrency.test.mjs",
  xlsx: "db/tests/xlsx-safety.test.mjs",
};

const MIGRATION_004 = "db/migrations/004_payment_policy.sql";
const CAMPDB = "src/lib/campDb.ts";

const db = (what, sql, suites, masked) => ({ layer: "database", what, sql, suites, masked });
const code = (what, patches, suites) => ({ layer: "code", what, patches, suites });

const MUTATIONS = [
  // --- database rules switched off, one at a time ---
  db("the guard that allows only legal status moves and freezes fixed fields", "DROP TRIGGER camp_registration_guard_insert ON registrations; DROP TRIGGER camp_registration_guard_update ON registrations;", ["integrity"]),
  db("'Paid needs a verification record' (CHECK)", "ALTER TABLE registrations DROP CONSTRAINT registrations_paid_verified;", ["integrity"]),
  db("'a reported payment can never be recorded as expired' (CHECK)", "ALTER TABLE registrations DROP CONSTRAINT registrations_expiry_never_reported;", ["integrity", "policy"]),
  db("'every Awaiting Payment registration has a hold' (CHECK)", "ALTER TABLE registrations DROP CONSTRAINT registrations_pending_has_hold;", ["integrity"]),
  db("'every Payment Reported registration has a review time' (CHECK)", "ALTER TABLE registrations DROP CONSTRAINT registrations_reported_has_review;", ["integrity"]),
  db(
    "the 33-child ceiling (CHECK)",
    "ALTER TABLE camp_weeks DROP CONSTRAINT camp_weeks_capacity_ceiling;",
    ["integrity"],
    "belt and braces: the authorization table itself only accepts 31 to 33, and the trigger needs an authorization covering the new number, so 34+ is still refused"
  ),
  db("'raising a week above 30 needs a recorded authorization' (trigger)", "DROP TRIGGER camp_guard_capacity_insert ON camp_weeks; DROP TRIGGER camp_guard_capacity_update ON camp_weeks;", ["integrity"]),
  db("the append-only audit log (triggers)", "DROP TRIGGER camp_audit_no_change ON admin_audit_log; DROP TRIGGER camp_audit_no_truncate ON admin_audit_log;", ["integrity"]),
  db("the commit-time integrity checks (counters = spots, paid holds all spots)", "DROP TRIGGER camp_integrity_spots ON registration_spots; DROP TRIGGER camp_integrity_registrations ON registrations; DROP TRIGGER camp_integrity_weeks ON camp_weeks;", ["integrity", "concurrency"]),
  db("the spot counter / capacity refusal (trigger)", "DROP TRIGGER camp_spot_counter ON registration_spots;", ["concurrency"]),
  db("one bank confirmation number can only be used once (unique index)", "DROP INDEX idx_registrations_bank_confirmation;", ["policy", "integrity"]),

  // --- application sabotaged, one line at a time ---
  code(
    "the 12-hour sweep also releases overdue REPORTED payments (the database refuses; the sweep errors)",
    [
      {
        file: CAMPDB,
        find: `      WHERE status = 'pending_payment' AND payment_reported_at IS NULL
        AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($1::timestamptz, now())
      ORDER BY hold_expires_at, id\`,`,
        replace: `      WHERE (status = 'pending_payment' AND hold_expires_at < COALESCE($1::timestamptz, now()))
         OR (status = 'payment_reported' AND review_due_at < COALESCE($1::timestamptz, now()))
      ORDER BY hold_expires_at, id\`,`,
      },
      {
        file: CAMPDB,
        find: `          WHERE id = $1 AND status = 'pending_payment' AND payment_reported_at IS NULL
            AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($2::timestamptz, now())
          FOR UPDATE\`,`,
        replace: `          WHERE id = $1 AND status IN ('pending_payment', 'payment_reported')
            AND COALESCE($2::timestamptz, now()) IS NOT NULL
          FOR UPDATE\`,`,
      },
    ],
    ["policy"]
  ),
  {
    layer: "code + database",
    what: "the same sabotage AND the database rule off (so only the application tests stand guard)",
    sql: "ALTER TABLE registrations DROP CONSTRAINT registrations_expiry_never_reported;",
    patches: [
      {
        file: CAMPDB,
        find: `      WHERE status = 'pending_payment' AND payment_reported_at IS NULL
        AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($1::timestamptz, now())
      ORDER BY hold_expires_at, id\`,`,
        replace: `      WHERE (status = 'pending_payment' AND hold_expires_at < COALESCE($1::timestamptz, now()))
         OR (status = 'payment_reported' AND review_due_at < COALESCE($1::timestamptz, now()))
      ORDER BY hold_expires_at, id\`,`,
      },
      {
        file: CAMPDB,
        find: `          WHERE id = $1 AND status = 'pending_payment' AND payment_reported_at IS NULL
            AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($2::timestamptz, now())
          FOR UPDATE\`,`,
        replace: `          WHERE id = $1 AND status IN ('pending_payment', 'payment_reported')
            AND COALESCE($2::timestamptz, now()) IS NOT NULL
          FOR UPDATE\`,`,
      },
    ],
    suites: ["policy"],
  },
  code("Confirm skips the 'amount received must equal amount due' check", [{ file: CAMPDB, find: "if (input.amountReceivedCents !== previous.amount_due_cents) {", replace: "if (false as boolean) {" }], ["policy"]),
  {
    layer: "code + database",
    what: "the same, with the database CHECK for it off too",
    sql: "ALTER TABLE registrations DROP CONSTRAINT registrations_paid_verified;",
    patches: [{ file: CAMPDB, find: "if (input.amountReceivedCents !== previous.amount_due_cents) {", replace: "if (false as boolean) {" }],
    suites: ["policy"],
  },
  code("Confirm of a released registration skips taking its spots back (the original Stage 1 bug)", [{ file: CAMPDB, find: `if (previous.status === "cancelled") {
        const reinstated`, replace: `if (false as boolean) {
        const reinstated` }], ["integrity", "policy"]),
  code("the parent's 'I've Sent My Payment' marks the registration PAID", [{ file: CAMPDB, find: "SET status = 'payment_reported', payment_reported_at = $2::timestamptz,", replace: "SET status = 'paid', payment_reported_at = $2::timestamptz," }], ["policy"]),
  code("a payment report is accepted after the 12-hour window has closed", [{ file: CAMPDB, find: "if (new Date(row.hold_expires_at as string).getTime() < nowTs.getTime()) {", replace: "if (false as boolean) {" }], ["policy"]),
  code("extensions are no longer limited in number", [{ file: CAMPDB, find: `if ((rows[0].extension_count as number) >= settings.extensionMaxCount) return { ok: false, reason: "too_many_extensions" };`, replace: "" }], ["policy"]),
  code("every release counts as a strike against the parent", [{ file: CAMPDB, find: `if (row.status === "payment_reported" && releaseReason === "not_received") {`, replace: "if (true as boolean) {" }], ["policy"]),
  code("alerts are sent without first claiming them (duplicates when runs overlap)", [{ file: "src/lib/alerts.ts", find: "if (await claim(p.key, p.tier, item.id, to)) claimed.push(p);", replace: "{ await claim(p.key, p.tier, item.id, to); claimed.push(p); }" }], ["alerts"]),
  code("the 'escalated' alert is never planned", [{ file: "src/lib/alerts.ts", find: "if (over >= s.alertEscalatedAfterHours * HOUR) {", replace: "if (false as boolean) {" }], ["alerts"]),
  code("the login never locks, however many wrong passwords", [{ file: "src/lib/adminSessions.ts", find: "if (rows.length < LOGIN_FAILURE_LIMIT) return { locked: false, retryAfterSeconds: 0 };", replace: "return { locked: false, retryAfterSeconds: 0 };" }], ["security"]),
  code("the admin password check accepts anything", [{ file: "src/lib/adminSessions.ts", find: "return timingSafeEqual(a, b);", replace: "return true;" }], ["security"]),
  code("sessions never expire when idle", [{ file: "src/lib/adminSessions.ts", find: "AND last_seen_at > COALESCE($2::timestamptz, now()) - make_interval(hours => $3)`,", replace: "AND $3::int > 0`," }], ["security"]),
  code("the same-origin check accepts everything", [{ file: "src/lib/requestGuards.ts", find: "export function isSameOriginRequest(request: Request): boolean {", replace: "export function isSameOriginRequest(request: Request): boolean {\n  if (request) return true;" }], ["security"]),
  code("payment actions no longer need a recent password check", [{ file: "src/lib/adminAuth.ts", find: "if (opts.fresh && !isFresh(session)) {", replace: "if (false as boolean) {" }], ["security"]),
  code("the admin request limit is switched off", [{ file: "src/lib/adminAuth.ts", find: "if (!limit.allowed) {", replace: "if (false as boolean) {" }], ["security"]),
  code("a parent's private link signature is not checked", [{ file: "src/lib/registrationLink.ts", find: "return timingSafeEqual(given, expected) ? id.toLowerCase() : null;", replace: "return id.toLowerCase();" }], ["security"]),
  code("the printed roster stops at 30 rows (children 31-33 would be missing)", [{ file: "src/lib/campRoster.ts", find: "const rowCount = Math.max(MAX_CAMPERS, weekRoster.capacity, weekRoster.rows.length);", replace: "const rowCount = MAX_CAMPERS;" }], ["xlsx"]),
];

function applyPatch(workDir, { file, find, replace }) {
  const path = join(workDir, file);
  const text = readFileSync(path, "utf8");
  const parts = text.split(find);
  if (parts.length !== 2) throw new Error(`Mutation patch for ${file} matched ${parts.length - 1} times (expected 1): ${find.slice(0, 70)}…`);
  writeFileSync(path, parts.join(replace));
}

function prepare(m) {
  const work = mkdtempSync(join(tmpdir(), "golf-mutation-"));
  cpSync("src", join(work, "src"), { recursive: true });
  cpSync("db", join(work, "db"), { recursive: true });
  for (const f of ["package.json", "tsconfig.json", "next.config.ts", "next-env.d.ts"]) if (existsSync(f)) cpSync(f, join(work, f));
  symlinkSync(resolve("node_modules"), join(work, "node_modules"));
  if (m.sql) {
    const path = join(work, MIGRATION_004);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n-- MUTATION: ${m.what}\n${m.sql}\n`);
  }
  for (const patch of m.patches ?? []) applyPatch(work, patch);
  return work;
}

function runSuite(work, suite) {
  const result = spawnSync("npx", ["tsx", SUITES[suite]], {
    cwd: work,
    env: { ...process.env },
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    timeout: 300_000,
  });
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const fails = out.split("\n").filter((l) => /^\s*\[FAIL\]/.test(l)).map((l) => l.replace(/^\s*\[FAIL\]\s*/, "").slice(0, 150));
  const passes = (out.match(/\[PASS\]/g) ?? []).length;
  const crashed = result.status !== 0 && fails.length === 0;
  // The local database running out of connections (other jobs at the same time) or dropping one
  // is not a detection: it says nothing about the protection under test.
  const infra = result.status !== 0 && /53300|too many clients|remaining connection slots|ECONNREFUSED|ECONNRESET|terminating connection/.test(out);
  // The first line that names the error (a database message or a stack header), for the summary.
  const lastError = crashed
    ? (out.split("\n").find((l) => /^\s*(error|Error|\w*Error): /.test(l)) ?? out.split("\n").find((l) => /violates|duplicate key/.test(l)) ?? "").trim().slice(0, 160)
    : "";
  return { suite, status: result.status, timedOut: result.error?.code === "ETIMEDOUT", fails, passes, crashed, infra, lastError, tail: out.split("\n").slice(-30).join("\n") };
}

// A run disturbed by the database environment is repeated (up to 3 times) instead of being
// counted as a detection; if it never gets a clean run the mutation is reported as inconclusive.
function runSuiteReliably(work, suite) {
  let r;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = runSuite(work, suite);
    if (!r.infra) return r;
    process.stdout.write(`      (the database was overloaded during ${suite}; repeating, attempt ${attempt + 1})\n`);
  }
  return { ...r, inconclusive: true };
}

async function dropLeftoverTestDatabases(startedAtMs) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT datname FROM pg_database WHERE datname LIKE 'golf_test_%'`);
    for (const { datname } of rows) {
      const created = Number(datname.split("_")[2]);
      if (created >= startedAtMs) await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  } finally {
    await client.end();
  }
}

const verbose = process.argv.includes("--verbose");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const startedAt = Date.now();
const results = [];
let index = 0;
for (const m of MUTATIONS) {
  index++;
  if (only.length && !only.some((o) => m.what.toLowerCase().includes(o.toLowerCase()) || String(index) === o)) continue;
  process.stdout.write(`[${index}/${MUTATIONS.length}] ${m.layer}: ${m.what}\n`);
  const work = prepare(m);
  let caught = false;
  let inconclusive = false;
  const evidence = [];
  try {
    for (const suite of m.suites) {
      const r = runSuiteReliably(work, suite);
      if (r.inconclusive) {
        inconclusive = true;
        evidence.push(r);
        break;
      }
      if (r.fails.length > 0 || r.crashed || r.timedOut) {
        caught = true;
        evidence.push(r);
        break; // one failing suite is enough
      }
      evidence.push(r);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const last = evidence[evidence.length - 1];
  if (verbose && caught && last.fails.length === 0) console.log(`      --- end of output ---\n${last.tail.split("\n").map((l) => "      | " + l).join("\n")}`);
  const how = inconclusive
    ? `INCONCLUSIVE: the local database kept running out of connections during ${last.suite}`
    : caught
    ? last.fails.length > 0
      ? `CAUGHT by ${last.suite}: ${last.fails.length} failing check(s), e.g. "${last.fails[0]}"`
      : `CAUGHT by ${last.suite}: the suite crashed (${last.timedOut ? "timed out" : last.lastError || "error"})`
    : `NOT CAUGHT (${m.suites.join(", ")} still pass)`;
  console.log(`      -> ${how}${!caught && m.masked ? `\n         (expected: ${m.masked})` : ""}`);
  results.push({ m, caught: caught && !inconclusive, how });
}

await dropLeftoverTestDatabases(startedAt);

const missed = results.filter((r) => !r.caught && !r.m.masked);
const masked = results.filter((r) => !r.caught && r.m.masked);
console.log(`\n${results.length - missed.length - masked.length} of ${results.length} mutations were caught by the tests.`);
if (masked.length) {
  console.log(`${masked.length} switched off a rule that another layer duplicates (nothing could slip through):`);
  for (const r of masked) console.log(`  - ${r.m.what}: ${r.m.masked}`);
}
if (missed.length) {
  console.log("NOT caught:");
  for (const r of missed) console.log(`  - ${r.m.layer}: ${r.m.what}`);
}
process.exit(missed.length === 0 ? 0 : 1);
