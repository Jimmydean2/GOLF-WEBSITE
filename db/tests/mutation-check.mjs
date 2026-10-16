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

import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  families: "db/tests/families.test.mjs",
  flow: "db/tests/registration-flow.test.mjs",
  outbox: "db/tests/outbox.test.mjs",
  scheduler: "db/tests/scheduler.test.mjs",
  noauto: "db/tests/no-auto-release.test.mjs",
  pool1: "db/tests/pool-of-one.test.mjs",
  smtp: "db/tests/smtp-stack.test.mjs",
  logsafety: "db/tests/log-safety.test.mjs",
  season: "db/tests/season.test.mjs",
  i18n: "db/tests/i18n.test.mjs",
  privacy: "db/tests/privacy.test.mjs",
  roster: "db/tests/roster-export.test.mjs",
  rosterhttp: "db/tests/roster-http.test.mjs",
  manual: "db/tests/manual-confirm.test.mjs",
  manualhttp: "db/tests/manual-confirm-http.test.mjs",
  waitlist: "db/tests/waitlist.test.mjs",
  waitlisthttp: "db/tests/waitlist-http.test.mjs",
};
// Suites that start the real production server need the site built inside the scratch copy.
const SERVER_SUITES = new Set(["rosterhttp", "manualhttp", "waitlisthttp"]);

const MIGRATION_004 = "db/migrations/004_payment_policy.sql";
const MIGRATION_007 = "db/migrations/007_consent_and_erasure.sql";
const CAMPDB = "src/lib/campDb.ts";
const PRIVACYDATA = "src/lib/privacyData.ts";
const WINDOW = "src/lib/registrationWindow.ts";
const EMAILS = "src/lib/campEmailTemplates.ts";
const ROSTER_EXPORT = "src/lib/rosterExport.ts";
const WAITLIST = "src/lib/waitlist.ts";
const ROSTER_ROUTE = "src/app/api/admin/camp-rosters/download/route.ts";
const SERVICE = "src/lib/registrationService.ts";
const OUTBOX = "src/lib/outbox.ts";
const SCHEDULED = "src/lib/scheduledCheck.ts";

const db = (what, sql, suites, masked, sqlFile) => ({ layer: "database", what, sql, suites, masked, sqlFile });
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

  // --- the production-readiness review: registration path, outbox, scheduler ---
  code("form mistakes use up the family's hourly allowance (validation after the rate limit)", [{ file: SERVICE, find: "const parsed = validateRegistrationBody(body as Record<string, unknown>, hooks.now, lang);", replace: "await rateLimit(\"register-ip\", clientIp(request), REGISTRATION_LIMITS.newPerIpPerHour, 3600);\n  const parsed = validateRegistrationBody(body as Record<string, unknown>, hooks.now, lang);" }], ["flow"]),
  code("an attempt that creates nothing keeps its allowance (a family trying for a full week locks itself out)", [{ file: SERVICE, find: "await Promise.allSettled(taken.map((hit) => rateLimitRefund(hit)));", replace: "void taken;" }], ["flow"]),
  code("a second reservation for the same child and week is allowed", [{ file: CAMPDB, find: "if (overlap.size > 0) {", replace: "if (false as boolean) {" }], ["flow", "families"]),
  code("a submission key is honoured for any email (another family's link could be returned)", [{ file: CAMPDB, find: `if (emailKey(row.email as string) !== emailKey(email)) return { ok: false, reason: "idempotency_conflict" };`, replace: "" }], ["policy", "flow"]),
  code("the open-reservation limit is not applied", [{ file: CAMPDB, find: "if ((open.rows[0].n as number) >= settings.openReservationsPerContact) {", replace: "if (false as boolean) {" }], ["families", "policy"]),
  code("the same child listed twice in one registration is accepted", [{ file: SERVICE, find: "if (seen.has(key)) {", replace: "if (false as boolean) {" }], ["flow"]),
  code("an oversize request body is accepted", [{ file: SERVICE, find: "if (Number(request.headers.get(\"content-length\") ?? 0) > REGISTRATION_LIMITS.maxBodyBytes) {", replace: "if (false as boolean) {" }], ["flow"]),
  code("the allowance hand-back does nothing", [{ file: "src/lib/rateLimit.ts", find: "SET hits = GREATEST(hits - 1, 0) WHERE bucket", replace: "SET hits = hits WHERE bucket" }], ["flow"]),
  code("a repeated submission caught by the database waits for its own connection (pool of one)", [{ file: CAMPDB, find: `    await client.query("ROLLBACK").catch(() => {});
    release();
    // Defence in depth`, replace: `    await client.query("ROLLBACK").catch(() => {});
    // Defence in depth` }], ["pool1"]),
  code("a dropped idle database connection stops the server (no error handler on the pool)", [{ file: "src/lib/db.ts", find: "pool.on(\"error\", (err) => {", replace: "void ((err: Error) => {" }], ["pool1"]),
  code("emails are sent without checking the registration still needs them", [{ file: OUTBOX, find: "function skipReason(kind: OutboxKind, reg: RegistrationDetail, now: Date): string | null {", replace: "function skipReason(kind: OutboxKind, reg: RegistrationDetail, now: Date): string | null {\n  if (kind) return null;" }], ["outbox"]),
  code("a failed send is recorded as sent (the email is lost)", [{ file: OUTBOX, find: "await reschedule([row.id], now, backoffMinutes(row.attempts + 1), note);\n      summary.retried++;", replace: "await finish([row.id], \"sent\", now);\n      summary.retried++;" }], ["outbox", "smtp"]),
  code("a run keeps hammering a dead mail server (no circuit breaker)", [{ file: OUTBOX, find: "if (consecutiveFailures >= BREAKER_FAILURES) {", replace: "if (false as boolean) {" }], ["outbox", "smtp"]),
  code("two workers can claim the same email (no row lock when claiming)", [{ file: OUTBOX, find: "LIMIT 1 FOR UPDATE SKIP LOCKED)", replace: "LIMIT 1)" }], ["outbox"]),
  code("the coach summary can be sent by several workers at once (no slot)", [{ file: OUTBOX, find: "const slot = await claimDigestSlot(now, digestMinutes);\n        if (!slot.claimed) {", replace: "const slot = { claimed: true } as Awaited<ReturnType<typeof claimDigestSlot>>;\n        if (!slot.claimed) {" }], ["outbox"]),
  code("reminders are also queued for families who already reported payment", [{ file: OUTBOX, find: "WHERE r.status = 'pending_payment' AND r.payment_reported_at IS NULL\n        AND r.hold_ends_at_initial IS NOT NULL", replace: "WHERE r.status IN ('pending_payment', 'payment_reported')\n        AND r.hold_ends_at_initial IS NOT NULL" }], ["outbox"]),
  code("reminders go out far too early", [{ file: OUTBOX, find: "<= $1::timestamptz\n     ON CONFLICT (dedupe_key) DO NOTHING`,\n    [now.toISOString(), settings.reportAllowanceMinutes, settings.parentReminderHours]", replace: "<= $1::timestamptz + interval '10 hours'\n     ON CONFLICT (dedupe_key) DO NOTHING`,\n    [now.toISOString(), settings.reportAllowanceMinutes, settings.parentReminderHours]" }], ["outbox"]),
  code("the optional emails are not held back near the daily limit", [{ file: OUTBOX, find: "if (policy.priority > 0 && sentToday >= lowPriorityCutoff) {", replace: "if (false as boolean) {" }], ["outbox"]),
  code("a rejected (mistyped) address is retried forever", [{ file: "src/lib/email.ts", find: "return { permanent: Boolean(permanent), summary: detail };", replace: "return { permanent: false, summary: detail };" }], ["outbox", "smtp"]),
  code("releasing an unreported reservation queues no notice for the family", [{ file: CAMPDB, find: `      await enqueueEmail(client, "parent_release", id);\n`, replace: "" }], ["outbox", "alerts"]),
  code("confirming a payment queues no confirmation email", [{ file: CAMPDB, find: `      await enqueueEmail(client, "parent_confirmation", registrationId);\n`, replace: "" }], ["outbox"]),
  code("making a reservation queues no payment-instructions email", [{ file: CAMPDB, find: `    await enqueueEmail(client, "parent_instructions", registrationId);\n`, replace: "" }], ["outbox"]),
  code("several scheduled checks can run at the same moment (no lease)", [{ file: SCHEDULED, find: "if (!(await claimLease())) {", replace: "if (false as boolean) {" }], ["scheduler"]),
  code("site visits start a scheduled check every time (no throttle)", [{ file: SCHEDULED, find: "if ((recent.rowCount ?? 0) > 0) return null;", replace: "" }], ["scheduler"]),
  code("a scheduled check that fails is not recorded", [{ file: SCHEDULED, find: "await pool.query(`UPDATE job_runs SET finished_at = now(), ok = false, error = $2, summary = $3 WHERE id = $1`, [runId, message, JSON.stringify(summary)]).catch(() => {});", replace: "" }], ["scheduler"]),
  code("the scheduled check releases a reported payment as well (the sweep, source-scan and database all object)", [{ file: CAMPDB, find: "WHERE id = $1 AND status = 'pending_payment' AND payment_reported_at IS NULL\n            AND hold_expires_at IS NOT NULL AND hold_expires_at < COALESCE($2::timestamptz, now())\n          FOR UPDATE", replace: "WHERE id = $1 AND status IN ('pending_payment', 'payment_reported')\n          FOR UPDATE" }], ["noauto", "policy"]),
  code("a 'payment reported' email that failed to send is never retried", [{ file: "src/lib/alerts.ts", find: "if (planned.length === 0 && !alreadyAlerted.has(item.id)) planned.push(", replace: "if (false as boolean) planned.push(" }], ["alerts"]),
  code("a payment the administrators already heard about is announced again later", [{ file: "src/lib/alerts.ts", find: "if (planned.length === 0 && !alreadyAlerted.has(item.id)) planned.push(", replace: "if (planned.length === 0) planned.push(" }], ["alerts"]),
  code("with no client address, one shared limit throttles the whole site", [{ file: SERVICE, find: 'const ipKnown = ip !== "unknown";', replace: "const ipKnown = true;" }], ["flow"]),
  code("weeks are shown in the order of their internal codes (August before June)", [{ file: "src/lib/weeks.ts", find: "export const inCalendarOrder = (ids: string[]): string[] => [...ids].sort(calendarOrder);", replace: "export const inCalendarOrder = (ids: string[]): string[] => [...ids].sort();" }], ["outbox"]),
  code("any number of emails can be in flight at once (no cluster-wide cap)", [{ file: OUTBOX, find: "if ((active.rows[0].n as number) >= cap) {", replace: "if (false as boolean) {" }], ["outbox"]),
  code("phone numbers are not checked (a family with no usable number to call)", [{ file: SERVICE, find: "if (badPhone(primaryPhone, true) || badPhone(emergencyPhone, true) || badPhone(secondaryPhone, false)) {", replace: "if (false as boolean) {" }], ["flow"]),
  code("an error log includes the database row", [{ file: "src/lib/safeLog.ts", find: "redact(err.message).slice(0, 300),", replace: "redact(err.message + ' ' + String((err as { detail?: string }).detail)).slice(0, 300)," }], ["logsafety"]),
  // --- privacy, season and language protections (added with the launch-preparation work) ---
  db("'a registration needs both consents recorded with the notice version' (CHECK)", "ALTER TABLE registrations DROP CONSTRAINT registrations_consents_recorded;", ["privacy"], undefined, MIGRATION_007),
  code("a registration is accepted without the health-information consent", [{ file: SERVICE, find: "if (body.codeOfConductAccepted !== true || body.consentAccepted !== true || body.healthConsentAccepted !== true) {", replace: "if (body.codeOfConductAccepted !== true || body.consentAccepted !== true) {" }], ["privacy"]),
  code("erasing a family leaves the child's health information", [{ file: PRIVACYDATA, find: "date_of_birth = NULL, age = '', health_info = ''", replace: "date_of_birth = NULL, age = ''" }], ["privacy"]),
  code("erasing a family leaves the emergency contact", [{ file: PRIVACYDATA, find: "emergency_name = '', emergency_relationship = '', emergency_phone = '',", replace: "emergency_relationship = '', emergency_phone = '',"}], ["privacy"]),
  code("erasing a family leaves the owner's private notes", [{ file: PRIVACYDATA, find: "  await client.query(`DELETE FROM admin_notes WHERE registration_id = $1`, [registrationId]);\n", replace: "" }], ["privacy"]),
  code("erasing a family leaves emails queued for it", [{ file: PRIVACYDATA, find: "  await client.query(`DELETE FROM email_outbox WHERE registration_id = $1`, [registrationId]);\n", replace: "" }], ["privacy"]),
  code("the season clean-up erases families whose payment is still unresolved", [{ file: PRIVACYDATA, find: '(item.status === "pending_payment" || item.status === "payment_reported" ? plan.blocked : plan.due).push(item);', replace: "plan.due.push(item);" }], ["privacy"]),
  code("the season clean-up does not wait the retention period", [{ file: PRIVACYDATA, find: "HAVING max(w.end_date) + $1::int <= $2::date", replace: "HAVING max(w.end_date) + $1::int <= $2::date + 400" }], ["privacy"]),
  code("registration opens although the owner has not approved the dates", [{ file: WINDOW, find: "return calendar.confirmed || isSeasonPreview(env);", replace: "return true;" }], ["season"]),
  code("a mistyped opening time opens the doors", [{ file: WINDOW, find: 'if (!opens.ok) return { state: "not_announced" };', replace: "" }], ["season"]),
  code("registration opens before the opening time", [{ file: WINDOW, find: 'if (opens.iso && now.getTime() < Date.parse(opens.iso)) return { state: "opens_later", opensAt: opens.iso };', replace: "" }], ["season"]),
  code("the registration endpoint ignores whether registration is open", [{ file: SERVICE, find: 'if (opening.state !== "open") {', replace: "if (false as boolean) {" }], ["season"]),
  code("the cancellation notice is always written in English", [{ file: EMAILS, find: "const e = getMessages(lang).email.cancellation;", replace: 'const e = getMessages("en").email.cancellation;' }], ["i18n"]),
  // --- roster downloads and the Google Sheets switch ---
  code("a CSV cell that starts with = + - @ is not neutralised (formula injection)", [{ file: ROSTER_EXPORT, find: "if (/^[=+\\-@\\t\\r]/.test(text)) text = `'${text}`;", replace: "" }], ["roster"]),
  code("the sign-in sheet includes the health notes", [{ file: ROSTER_EXPORT, find: '{ header: "Medical note on file", value: (r) => r.medicalNoteOnFile }', replace: '{ header: "Medical note on file", value: (r) => r.healthInfo }' }], ["roster"]),
  code("a roster download does not need a recent password", [{ file: ROSTER_ROUTE, find: "const guard = await requireAdmin(request, { fresh: true });", replace: "const guard = await requireAdmin(request);" }], ["rosterhttp"]),
  code("a CSV download is not recorded in the audit log", [{ file: ROSTER_ROUTE, find: 'await recordAudit("roster_download", week, { format, profile, weeks: result.weekCount, rows: result.rowCount }, "roster");', replace: "" }], ["rosterhttp"]),
  code("the Google Sheets copy is on whenever Google is set up (no separate switch)", [{ file: "src/lib/googleSheets.ts", find: 'return process.env.CAMP_SHEETS_COPY === "true" && isGoogleSheetsConfigured();', replace: "return isGoogleSheetsConfigured();" }], ["roster"]),
  {
    layer: "code",
    what: "the roster query lists released places too",
    patches: [{ file: CAMPDB, find: "WHERE rs.week_id = $1 AND rs.status = 'active'\n     ORDER BY c.full_name", replace: "WHERE rs.week_id = $1\n     ORDER BY c.full_name" }],
    suites: ["roster", "xlsx"],
    masked: "the roster also drops every cancelled registration by its status, so a released family never shows; the two layers must both fail for a family to leak",
  },
  code("asking for one week gives every week", [{ file: "src/lib/campRoster.ts", find: "if (onlyWeekId && week.id !== onlyWeekId) continue;", replace: "" }], ["roster"]),
  // --- confirming a payment the parent never reported: finding the family from what the bank shows ---
  code("the dashboard search no longer finds a registration by the amount of a deposit", [{ file: CAMPDB, find: "        OR ($3::int IS NOT NULL AND r.amount_due_cents = $3 AND r.status IN ('pending_payment', 'payment_reported', 'cancelled'))\n", replace: "" }], ["manual"]),
  code("an amount search also lists registrations that are already paid", [{ file: CAMPDB, find: "r.amount_due_cents = $3 AND r.status IN ('pending_payment', 'payment_reported', 'cancelled'))", replace: "r.amount_due_cents = $3)" }], ["manual"]),
  code("the dashboard search no longer finds a registration by phone number", [{ file: CAMPDB, find: "OR ($4::text IS NOT NULL AND (regexp_replace(r.primary_phone, '\\\\D', '', 'g') LIKE '%' || $4 || '%'", replace: "OR ($4::text IS NULL AND (regexp_replace(r.primary_phone, '\\\\D', '', 'g') LIKE '%' || $4 || '%'" }], ["manual"]),
  // --- the waiting list: it must never promise or assign a place ---
  code("the waiting list accepts a week that still has room", [{ file: WAITLIST, find: 'if (withRoom.length > 0) return { ok: false, reason: "week_has_room", weekIds: withRoom };', replace: "" }], ["waitlist"]),
  code("the owner can email a waiting family while the week is full", [{ file: WAITLIST, find: 'if ((e.taken_count as number) >= (e.max_capacity as number)) return { ok: false, reason: "week_full" };', replace: "" }], ["waitlist"]),
  code("a family that already holds a place is emailed as if it were waiting", [{ file: WAITLIST, find: 'if (registered.rows.length > 0) return { ok: false, reason: "already_registered" };', replace: "" }], ["waitlist"]),
  code("a family can be emailed over and over (no limit of three)", [{ file: WAITLIST, find: 'if ((e.notified_count as number) >= WAITLIST_LIMITS.maxNotifications) return { ok: false, reason: "too_many" };', replace: "" }], ["waitlist"]),
  code("a family can be emailed twice within minutes (no cool-down)", [{ file: WAITLIST, find: "if (e.notified_at && now.getTime() - new Date(e.notified_at as string).getTime() < WAITLIST_LIMITS.renotifyAfterHours * 3600_000) {", replace: "if (false as boolean) {" }], ["waitlist"]),
  code("taking a family off the list does not delete it", [{ file: WAITLIST, find: "`DELETE FROM waitlist_entries WHERE id = $1`", replace: "`UPDATE waitlist_entries SET status = status WHERE id = $1`" }], ["waitlist"]),
  code("finished waiting-list requests are kept after their week", [{ file: WAITLIST, find: "WHERE w.id = e.week_id AND w.end_date < $1::date`", replace: "WHERE w.id = e.week_id AND w.end_date < $1::date - 100000`" }], ["waitlist"]),
  code("erasing a family leaves their waiting-list request", [{ file: PRIVACYDATA, find: "  await client.query(`DELETE FROM waitlist_entries WHERE email_key = lower(btrim($1))`, [locked.rows[0].email]);\n", replace: "" }], ["waitlist"]),
  code("the French 'a place may be open' email says a place is reserved", [{ file: "src/lib/i18n/fr.ts", find: '"Aucune place ne vous est réservée, et nous ne pouvons pas promettre qu’il en reste une', replace: '"Une place vous est réservée, et nous ne pouvons pas promettre qu’il en reste une' }], ["waitlist"]),
  code("the owner's waiting-list notice route does not need a login", [{ file: "src/app/api/admin/waitlist/[id]/notify/route.ts", find: "  if (!guard.ok) return guard.response;\n", replace: "" }], ["waitlisthttp"]),
  code("the waiting list is on although the owner has not switched it on", [{ file: WAITLIST, find: 'return env.WAITLIST_ENABLED === "true";', replace: "return true;" }], ["waitlist"]),
  code("a week the owner merely closed (it still has room) is offered the waiting list", [{ file: "src/app/api/camp-capacity/route.ts", find: "waitlistable: waitlistOn && remaining === 0,", replace: "waitlistable: waitlistOn && (remaining === 0 || !week.isOpen)," }], ["waitlisthttp"]),
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
  cpSync("scripts", join(work, "scripts"), { recursive: true });
  cpSync("docs", join(work, "docs"), { recursive: true }); // the season and legal-review tests compare generated documents
  for (const f of ["package.json", "tsconfig.json", "next.config.ts", "next-env.d.ts", "postcss.config.mjs", "public", "assets"]) if (existsSync(f)) cpSync(f, join(work, f), { recursive: true }); // enough to build the site, for the suites that talk to the real server
  if ((m.suites ?? []).some((s) => SERVER_SUITES.has(s))) {
    // The site builder refuses a symlinked node_modules that points outside the project; hard links cost no space or time.
    const linked = spawnSync("cp", ["-al", realpathSync("node_modules"), join(work, "node_modules")], { encoding: "utf8" });
    if (linked.status !== 0) symlinkSync(resolve("node_modules"), join(work, "node_modules"));
  } else {
    symlinkSync(resolve("node_modules"), join(work, "node_modules"));
  }
  if (m.sql) {
    const path = join(work, m.sqlFile ?? MIGRATION_004);
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
  // ("terminating connection" is also what the pool-of-one suite makes the database say ON PURPOSE, and what
  // the process dies of when the pool's error handler is removed, so it only counts as trouble when
  // the suite neither reported a failed check nor crashed on an unhandled error.)
  const infra =
    result.status !== 0 &&
    (/53300|too many clients|remaining connection slots|ECONNREFUSED|ECONNRESET/.test(out) ||
      (fails.length === 0 && /terminating connection/.test(out) && !/Unhandled 'error' event/.test(out)));
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
const fromArg = process.argv.indexOf("--from");
const from = fromArg > -1 ? Number(process.argv[fromArg + 1]) : 1;
const only = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--from");

// --check-patches: only prove that every sabotage applies cleanly (exactly one match), without running any suite.
if (process.argv.includes("--check-patches")) {
  let bad = 0;
  for (const [i, m] of MUTATIONS.entries()) {
    const work = mkdtempSync(join(tmpdir(), "golf-mutation-check-"));
    try {
      cpSync("src", join(work, "src"), { recursive: true });
      for (const patch of m.patches ?? []) applyPatch(work, patch);
    } catch (err) {
      bad++;
      console.log(`[${i + 1}] ${m.what}\n    ${err.message}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  console.log(bad === 0 ? `All ${MUTATIONS.length} mutations apply cleanly.` : `${bad} mutation(s) do not apply.`);
  process.exit(bad === 0 ? 0 : 1);
}
const startedAt = Date.now();
const results = [];
let index = 0;
for (const m of MUTATIONS) {
  index++;
  if (index < from) continue;
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
