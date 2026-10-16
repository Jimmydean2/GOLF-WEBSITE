#!/usr/bin/env node
// Launch preflight: checks the settings a deployment needs and, optionally, the live site.
// It reads the SAME environment variables the site reads and prints PASS / WARN / FAIL for
// each, with what to do about it. It never prints a secret, never changes anything, and sends
// an email only if you ask it to (--send-test-email you@example.com).
//
//   node --env-file=.env.rehearsal scripts/preflight.mjs
//   node --env-file=.env.rehearsal scripts/preflight.mjs --url https://rehearsal.example.com --send-test-email you@gmail.com
//
// Exit code 0 = no FAIL (WARNs are things to decide), 1 = at least one FAIL.

import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const baseUrl = flag("--url");
const testEmailTo = flag("--send-test-email");
// --production: this is the REAL site. Rehearsal-only settings become failures.
const production = args.includes("--production");

const results = [];
const add = (level, title, detail = "") => results.push({ level, title, detail });
const pass = (t, d) => add("PASS", t, d);
const warn = (t, d) => add("WARN", t, d);
const fail = (t, d) => add("FAIL", t, d);
const env = (name) => (process.env[name] ?? "").trim();
const describeSecret = (value) => `set (${value.length} characters)`;

// --- secrets and settings ---------------------------------------------------------------
function checkSecrets() {
  const link = env("REGISTRATION_LINK_SECRET");
  if (!link) fail("REGISTRATION_LINK_SECRET", "Not set. Registration refuses to run without it (parents' private links are signed with it). Use 32+ random characters.");
  else if (link.length < 16) fail("REGISTRATION_LINK_SECRET", `Only ${link.length} characters; the site refuses anything under 16.`);
  else if (link.length < 32) warn("REGISTRATION_LINK_SECRET", `${describeSecret(link)}; 32 or more is better. Changing it later breaks every link already emailed.`);
  else pass("REGISTRATION_LINK_SECRET", describeSecret(link));

  const admin = env("ADMIN_PASSWORD");
  if (!admin) fail("ADMIN_PASSWORD", "Not set: nobody can log in to the dashboard.");
  else if (admin.length < 12) fail("ADMIN_PASSWORD", `Only ${admin.length} characters. Use a long passphrase (a few random words).`);
  else if (admin.length < 16) warn("ADMIN_PASSWORD", `${describeSecret(admin)}; 16+ characters is better.`);
  else pass("ADMIN_PASSWORD", describeSecret(admin));
  if (/^(password|admin|letmein|golf|jimmy|camp)/i.test(admin)) warn("ADMIN_PASSWORD", "Looks guessable.");

  const cron = env("CRON_SECRET");
  if (!cron) warn("CRON_SECRET", "Not set: the scheduled check URL is switched off. Reminders, alerts and email retries then only run when someone visits the site. See docs/SCHEDULING.md.");
  else if (cron.length < 16) fail("CRON_SECRET", "Under 16 characters; the URL refuses to run.");
  else pass("CRON_SECRET", describeSecret(cron));

  const alerts = env("ADMIN_ALERT_EMAILS").split(",").map((s) => s.trim()).filter(Boolean);
  if (alerts.length === 0) warn("ADMIN_ALERT_EMAILS", "Not set: alerts go to the business address only. Add a second person's address as a backup.");
  else if (alerts.length === 1) warn("ADMIN_ALERT_EMAILS", "One address. Add a backup so an alert is never seen by only one inbox.");
  else pass("ADMIN_ALERT_EMAILS", `${alerts.length} addresses`);
  const bad = alerts.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (bad.length) fail("ADMIN_ALERT_EMAILS", `Not valid email addresses: ${bad.length} of them.`);

  const site = env("SITE_URL");
  if (!site) fail("SITE_URL", "Not set. Emails sent by the scheduled check have no visitor to take the site's address from, so their links would be broken. Example: https://www.yourdomain.com");
  else {
    try {
      const u = new URL(site);
      if (u.protocol !== "https:") warn("SITE_URL", `${site} is not https. Parents' private links must be https in production.`);
      else if (/localhost|127\.0\.0\.1|vercel\.app$/.test(u.hostname)) warn("SITE_URL", `${u.origin} is a temporary address. Use the real domain once it exists, so emailed links keep working.`);
      else pass("SITE_URL", u.origin);
      if (u.pathname !== "/" || u.search) warn("SITE_URL", "Should be just the address (no path).");
    } catch {
      fail("SITE_URL", "Not a valid URL.");
    }
  }

  const transfer = env("ETRANSFER_EMAIL");
  if (!transfer) warn("ETRANSFER_EMAIL", "Not set: parents are told to send e-Transfers to the business email address. Fine, but a dedicated address makes the bank easier to read.");
  else pass("ETRANSFER_EMAIL", "set");
  const auto = env("ETRANSFER_AUTODEPOSIT");
  if (auto !== "true") warn("ETRANSFER_AUTODEPOSIT", "Not 'true': parents are told to call if their bank asks for a security question. Turn on auto-deposit with your bank, test it, then set this to true.");
  else pass("ETRANSFER_AUTODEPOSIT", "true");

  if (env("DB_SSL_INSECURE") === "true") warn("DB_SSL_INSECURE", "The database connection is NOT verifying the server's certificate. Remove this unless the check below shows you need it.");
  const pool = env("DB_POOL_MAX");
  if (pool && pool !== "1") warn("DB_POOL_MAX", `Set to ${pool}. Production should leave it unset (1 connection per server instance).`);

  const mode = env("COACH_NOTICE_MODE");
  if (mode && !["digest", "each", "off"].includes(mode)) fail("COACH_NOTICE_MODE", `'${mode}' is not digest, each or off.`);
  else pass("COACH_NOTICE_MODE", mode || "digest (default)");
}

// --- email ------------------------------------------------------------------------------
async function checkEmail() {
  const gmailUser = env("GMAIL_USER");
  const gmailPass = env("GMAIL_APP_PASSWORD");
  const smtp = env("SMTP_HOST");
  if (smtp) {
    warn("Email", `Using SMTP_HOST=${smtp}. That is for rehearsals and tests; production normally uses the Gmail settings.`);
  } else if (!gmailUser || !gmailPass) {
    fail("Email", "GMAIL_USER and GMAIL_APP_PASSWORD are not both set. Without them no email can be sent: no payment instructions, no confirmations, no alerts.");
    return;
  } else {
    if (gmailPass.replace(/\s/g, "").length !== 16) warn("GMAIL_APP_PASSWORD", `Looks like ${gmailPass.replace(/\s/g, "").length} characters; Google app passwords are 16 (spaces don't matter).`);
    else pass("GMAIL_APP_PASSWORD", "16 characters");
    pass("GMAIL_USER", gmailUser.replace(/^(.).*(@.*)$/, "$1***$2"));
    if (/@gmail\.com$/i.test(gmailUser)) {
      warn("Daily email limit", "A personal @gmail.com account can send roughly 500 emails a day (Google Workspace: about 2,000). A busy opening day can come close: the site keeps its own count (EMAIL_DAILY_BUDGET, default 400) and holds back reminders and coach summaries near the limit. See docs/LAUNCH_CHECKLIST.md.");
    }
  }
  if (testEmailTo && testEmailTo !== true) {
    try {
      const nodemailer = (await import("nodemailer")).default;
      const transport = smtp
        ? nodemailer.createTransport({ host: smtp, port: Number(env("SMTP_PORT")) || 587, secure: Number(env("SMTP_PORT")) === 465, ignoreTLS: env("SMTP_INSECURE") === "true", auth: env("SMTP_USER") ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") } : undefined, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 })
        : nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
      const from = env("EMAIL_FROM") || gmailUser || "camp@localhost";
      const info = await transport.sendMail({ from: `"James Dean Golf" <${from}>`, to: testEmailTo, subject: "Preflight test: you can ignore this", text: "This is a test message from scripts/preflight.mjs. If you can read it, the website can send email." });
      pass("Test email", `accepted by the mail server for ${testEmailTo.replace(/^(.).*(@.*)$/, "$1***$2")} (id ${String(info.messageId).slice(0, 24)}…). Check that it arrived in the INBOX, not spam.`);
    } catch (err) {
      fail("Test email", `The mail server refused or could not be reached: ${String(err.message).slice(0, 160)}`);
    }
  } else {
    warn("Test email", "Not sent. Add --send-test-email you@example.com to prove the credentials work.");
  }
}

// --- the season calendar ---------------------------------------------------------------
// Loaded from the same file the site uses (src/lib/season.ts). Plain Node 22.18+ reads
// TypeScript directly; the harmless "module type" notice it prints is silenced.
let seasonModule = null;
async function loadSeason() {
  try {
    process.removeAllListeners("warning");
    seasonModule = await import("../src/lib/season.ts");
  } catch (err) {
    warn("Season calendar", `Could not read src/lib/season.ts here (${String(err.message).slice(0, 80)}). Needs Node 22.18 or newer, or run this through tsx.`);
  }
}

function checkSeason() {
  if (!seasonModule) return;
  const { season, parseOpensAt } = seasonModule;
  const preview = env("SEASON_PREVIEW") === "true";

  if (season.confirmed) {
    pass("Season calendar", `${season.year}: ${season.weeks.length} weeks, confirmed by the owner`);
    if (preview) (production ? fail : warn)("SEASON_PREVIEW", "Set to true, but the calendar is already confirmed, so it does nothing here. Remove it from the real site: it is for rehearsal sites only.");
  } else if (preview) {
    (production ? fail : warn)("Season calendar", `${season.year} is a DRAFT calendar, shown only because SEASON_PREVIEW=true. Fine for a rehearsal; the real site must not use it. Confirm the dates (docs/SEASON_2027.md) and set confirmed: true in src/lib/season.ts.`);
  } else {
    fail("Season calendar", `${season.year} dates are not confirmed yet, so the site says 'dates coming soon' and registration refuses. Confirm the dates (docs/SEASON_2027.md), then set confirmed: true in src/lib/season.ts. (A rehearsal site sets SEASON_PREVIEW=true.)`);
  }

  const fromEnv = parseOpensAt(env("REGISTRATION_OPENS_AT"));
  const fromCalendar = parseOpensAt(season.registrationOpensAt);
  if (!fromEnv.ok) fail("REGISTRATION_OPENS_AT", "Not a time the site can read. Write it like 2027-01-16T09:00:00-05:00 (date, time, and the offset from UTC: -05:00 in winter, -04:00 in summer). Until fixed, registration stays CLOSED.");
  else if (!fromCalendar.ok) fail("Registration opening time", "season.registrationOpensAt in src/lib/season.ts is not a time the site can read. Until fixed, registration stays CLOSED.");
  else {
    const opens = fromEnv.iso ?? fromCalendar.iso;
    if (fromEnv.iso) (production ? fail : warn)("REGISTRATION_OPENS_AT", `Overrides the calendar${production ? ", and this is meant to be the real site: remove it" : " (fine for rehearsing the opening moment)"}.`);
    if (!opens) warn("Registration opening time", "Not set: registration opens the moment the site goes live. If you plan to announce a date and time, set season.registrationOpensAt in src/lib/season.ts.");
    else if (Date.parse(opens) > Date.now()) pass("Registration opening time", `${new Date(opens).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "full", timeStyle: "short" })} (Montreal time)`);
    else warn("Registration opening time", `${opens} is in the past, so registration is already open.`);
  }
}

// --- database ---------------------------------------------------------------------------
async function checkDatabase() {
  const url = env("DATABASE_URL");
  if (!url) {
    fail("DATABASE_URL", "Not set.");
    return;
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    fail("DATABASE_URL", "Not a valid connection string.");
    return;
  }
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(host);
  if (isLocal) warn("DATABASE_URL", "Points at this computer: fine for local work, not for a deployment.");
  else pass("DATABASE_URL", `host ${host}`);
  if (/neon\.tech$/.test(host) && !/-pooler\./.test(host)) warn("DATABASE_URL", "A Neon host without '-pooler': use the pooled connection string so many serverless instances share connections.");
  if (/-pooler\./.test(host)) pass("Pooled connection", "using Neon's pooler (transaction mode); the site only uses transaction-level locks, which work there");

  const client = new pg.Client({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: env("DB_SSL_INSECURE") !== "true" },
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  });
  const t0 = Date.now();
  try {
    await client.connect();
  } catch (err) {
    fail("Database connection", `${String(err.message).slice(0, 200)}${/certificate|self.signed|unable to verify/i.test(err.message) ? " — the server's certificate could not be verified. If you trust this host, set DB_SSL_INSECURE=true (weaker); otherwise fix the connection string." : ""}`);
    return;
  }
  try {
    pass("Database connection", `connected over ${isLocal ? "a local socket" : "verified TLS"} in ${Date.now() - t0} ms (a first connection to a sleeping Neon database can take a second or two)`);
    const version = (await client.query("SHOW server_version")).rows[0].server_version;
    pass("PostgreSQL", version);
    const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
    const needed = ["camp_weeks", "registrations", "children", "registration_spots", "admin_audit_log", "camp_settings", "alert_ledger", "rate_limit_counters", "admin_sessions", "admin_login_attempts", "contact_strikes", "capacity_authorizations", "email_outbox", "job_runs"];
    const missing = needed.filter((t) => !tables.includes(t));
    if (missing.length) fail("Migrations", `Missing tables: ${missing.join(", ")}. Run all of db/migrations (001 to 005) with: npm run db:migrate`);
    else pass("Migrations", "all expected tables exist (001 to 005)");
    if (!missing.length) {
      const weekRows = (await client.query(`SELECT id, label, start_date::text AS start_date, end_date::text AS end_date, max_capacity, price_cents FROM camp_weeks ORDER BY start_date`)).rows;
      const weeks = {
        n: weekRows.length,
        lo: Math.min(...weekRows.map((w) => w.max_capacity)),
        hi: Math.max(...weekRows.map((w) => w.max_capacity)),
        pmin: Math.min(...weekRows.map((w) => w.price_cents)),
        pmax: Math.max(...weekRows.map((w) => w.price_cents)),
      };
      if (weekRows.length === 0) fail("Camp weeks", "No weeks in the database. Run all of db/migrations (npm run db:migrate).");
      else {
        pass("Camp weeks", `${weeks.n} weeks, capacity ${weeks.lo}${weeks.lo === weeks.hi ? "" : "–" + weeks.hi}, price $${(weeks.pmin / 100).toFixed(2)}${weeks.pmin === weeks.pmax ? "" : "–" + (weeks.pmax / 100).toFixed(2)} a week before tax`);
        if (seasonModule) {
          const byId = new Map(weekRows.map((w) => [w.id, w]));
          const calendar = seasonModule.season.weeks;
          const missing = calendar.filter((w) => !byId.has(w.id)).map((w) => w.id);
          const wrong = calendar.filter((w) => byId.has(w.id) && (byId.get(w.id).start_date !== w.startDate || byId.get(w.id).end_date !== w.endDate)).map((w) => w.id);
          const extra = weekRows.filter((w) => !calendar.some((c) => c.id === w.id)).map((w) => w.id);
          if (missing.length) fail("Camp weeks vs calendar", `Not in the database: ${missing.join(", ")}. The calendar (src/lib/season.ts) and the database have drifted apart.`);
          if (wrong.length) fail("Camp weeks vs calendar", `Different dates in the database for: ${wrong.join(", ")}.`);
          if (extra.length) warn("Camp weeks vs calendar", `In the database but not in the ${seasonModule.season.year} calendar: ${extra.join(", ")} (an older season?). They are ignored by the site.`);
          if (!missing.length && !wrong.length) pass("Camp weeks vs calendar", `all ${calendar.length} calendar weeks are in the database with the same dates`);
        }
      }
      if (weekRows.length && weeks.pmin < 5000) warn("Camp weeks", "A week costs under $50: this looks like a rehearsal price. Make sure it is set back before launch.");
      const regs = (await client.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n;
      if (regs > 0) warn("Registrations", `${regs} registrations already exist in this database. If this is meant to be a clean launch database, clear the rehearsal data first (docs/LAUNCH_REHEARSAL.md, section 8). If it is the live one, these are REAL families.`);
      else pass("Registrations", "none yet (a clean database)");
      const outbox = (await client.query(`SELECT count(*) FILTER (WHERE status IN ('pending','sending'))::int AS waiting, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM email_outbox`)).rows[0];
      if (outbox.failed > 0) warn("Email queue", `${outbox.failed} emails could not be delivered; they are listed on the dashboard.`);
      if (outbox.waiting > 0) warn("Email queue", `${outbox.waiting} emails are waiting to be sent.`);
      const lastRun = (await client.query(`SELECT source, started_at FROM job_runs ORDER BY started_at DESC LIMIT 1`)).rows[0];
      if (!lastRun) warn("Scheduled check", "Has never run against this database.");
      else {
        const minutes = Math.round((Date.now() - new Date(lastRun.started_at).getTime()) / 60000);
        (minutes > 20 ? warn : pass)("Scheduled check", `last ran ${minutes} minutes ago (${lastRun.source})`);
      }
      const trg = (await client.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('camp_registration_guard_insert','camp_registration_guard_update','camp_audit_no_change','camp_spot_counter')`)).rows[0].n;
      if (trg < 4) fail("Database safeguards", "The triggers that enforce capacity, payment state and the append-only audit log are not all installed. Re-run the migrations.");
      else pass("Database safeguards", "capacity, payment-state and audit-log triggers are installed");
    }
    const conns = (await client.query(`SELECT current_setting('max_connections')::int AS max, (SELECT count(*)::int FROM pg_stat_activity) AS used`)).rows[0];
    pass("Database connections", `${conns.used} in use of ${conns.max}`);
  } catch (err) {
    fail("Database checks", String(err.message).slice(0, 200));
  } finally {
    await client.end().catch(() => {});
  }
}

// --- the repository ---------------------------------------------------------------------
function checkRepo() {
  if (existsSync("vercel.json")) {
    const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons ?? [];
    if (crons.length) pass("Scheduler", `vercel.json schedules ${crons.length} job(s): ${crons.map((c) => `${c.path} ${c.schedule}`).join("; ")}`);
    else warn("Scheduler", "vercel.json has no cron. See docs/SCHEDULING.md.");
  } else {
    warn("Scheduler", "Nothing in the repository schedules the check (no vercel.json cron). Decide how it will run: docs/SCHEDULING.md.");
  }
}

// --- the live site ----------------------------------------------------------------------
async function checkLive(url) {
  const base = url.replace(/\/+$/, "");
  const get = (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20000), ...init });
  try {
    const r = await get("/api/camp-capacity");
    const body = await r.json().catch(() => ({}));
    if (r.status === 200 && body.configured) pass("Live: registration", `capacity API answers (${Object.keys(body.weeks ?? {}).length} weeks)`);
    else fail("Live: registration", `capacity API says ${r.status} ${JSON.stringify(body).slice(0, 120)}. The database is probably not connected.`);

    const page = await get("/camp-registration/not-a-real-link");
    if (page.status === 404) pass("Live: private links", "an invalid link shows 'not found'");
    else fail("Live: private links", `an invalid link answered ${page.status}`);
    const headers = Object.fromEntries(page.headers);
    const sec = ["x-frame-options", "x-content-type-options", "referrer-policy"].filter((h) => !headers[h]);
    if (sec.length) warn("Live: security headers", `missing on the private page: ${sec.join(", ")}`);
    else pass("Live: security headers", "private pages are not cacheable, framable or sniffable");
    if (!/no-store/.test(headers["cache-control"] ?? "")) warn("Live: caching", `Cache-Control is '${headers["cache-control"]}' on a private page (expected no-store).`);

    const admin = await get("/admin/camp-rosters");
    if ([302, 307, 308].includes(admin.status) && /login/.test(admin.headers.get("location") ?? "")) pass("Live: dashboard", "sends a visitor without a login to the login page");
    else fail("Live: dashboard", `answered ${admin.status} without a login`);

    const cronNo = await get("/api/cron/payment-review");
    if (cronNo.status === 401) pass("Live: scheduled-check URL", "refuses callers without the secret");
    else if (cronNo.status === 503) warn("Live: scheduled-check URL", "switched off (CRON_SECRET not set on the site)");
    else fail("Live: scheduled-check URL", `answered ${cronNo.status} without credentials`);
    if (env("CRON_SECRET")) {
      const cronYes = await get("/api/cron/payment-review", { headers: { authorization: `Bearer ${env("CRON_SECRET")}` } });
      const body = await cronYes.json().catch(() => ({}));
      if (cronYes.status === 200 && body.ok) pass("Live: scheduled check", `ran: ${body.released ?? 0} released, ${body.emails?.sent ?? 0} email(s) sent, ${body.noEmailConfigured ? "EMAIL NOT CONNECTED" : "email connected"}`);
      else fail("Live: scheduled check", `answered ${cronYes.status} ${JSON.stringify(body).slice(0, 150)}`);
      if (body.noEmailConfigured) fail("Live: email", "the live site reports email is not connected");
    }
    if (base.startsWith("https://")) {
      const plain = await fetch(base.replace("https://", "http://"), { redirect: "manual", signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!plain) pass("Live: http", "plain http is not served");
      else if ([301, 302, 307, 308].includes(plain.status) && /^https:/.test(plain.headers.get("location") ?? "")) pass("Live: http", "redirects to https");
      else warn("Live: http", `plain http answered ${plain.status}`);
    }
  } catch (err) {
    fail("Live site", `could not be checked: ${String(err.message).slice(0, 160)}`);
  }
}

checkSecrets();
await loadSeason();
checkSeason();
checkRepo();
await checkEmail();
await checkDatabase();
if (baseUrl && baseUrl !== true) await checkLive(baseUrl);
else warn("Live site", "Not checked. Add --url https://your-site to check the deployed site.");

const icon = { PASS: "  ok  ", WARN: " WARN ", FAIL: " FAIL " };
console.log("\nLaunch preflight\n");
for (const r of results) console.log(`[${icon[r.level]}] ${r.title}${r.detail ? ` — ${r.detail}` : ""}`);
const counts = { PASS: 0, WARN: 0, FAIL: 0 };
for (const r of results) counts[r.level]++;
console.log(`\n${counts.PASS} ok, ${counts.WARN} to decide, ${counts.FAIL} failing.`);
console.log(counts.FAIL === 0 ? "No failures. Read each WARN and decide." : "NOT READY: fix the failures above.");
process.exit(counts.FAIL === 0 ? 0 : 1);
