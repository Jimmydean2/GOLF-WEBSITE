// The administrators' alerts and the parent's release notice, against a real throwaway
// Postgres and a FAKE mailer (nothing here can send real email: the test database helper
// removes the mail credentials from the environment, and every send goes through the fake).
//
// Time is simulated by passing "now" to the dispatcher; the registration clocks are real.
//
// Covers: the exact alert schedule, one email per alert even with concurrent runs and
// retries, a failed send being retried, a crashed run's claim being recovered, extensions
// restarting the schedule, an administrator away for a weekend and for ten days (the
// reservation stays held and is NEVER released by the alerts), the parent's release notice,
// recipients, and what the emails contain (and do not contain).

import { createTestDatabase } from "./helpers/testdb.mjs";
import { defaultSettings } from "../../src/lib/campSettings.ts";

process.env.DB_POOL_MAX ||= "40";
delete process.env.ADMIN_ALERT_EMAILS;
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, reserveOk, fill, week, reg, auditFor, confirmFor, expireHold, makeOverdue, invariants } = h;
const { reportPayment, grantReviewExtension, cancelRegistration, getPaymentQueue, reserveRegistration } = campDb;
const alerts = await import("../../src/lib/alerts.ts");
const { planAlerts, dispatchDueAlerts, notifyPaymentReported, maybeDispatchFromTraffic, adminAlertRecipients } = alerts;
const { business } = await import("../../src/lib/content.ts");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DASH = "https://camp.example.test/admin/camp-rosters";
const ADMINS = ["owner@example.test", "backup@example.test"];
const TO = ADMINS.join(", ");

// A fake mailer. failOn: the 1-based call numbers that should throw.
function mailer({ failOn = [] } = {}) {
  const sent = [];
  let calls = 0;
  const send = async (message) => {
    calls++;
    if (failOn.includes(calls)) throw new Error("simulated SMTP failure");
    sent.push(message);
  };
  return { send, sent, calls: () => calls };
}
const PREFIXES = [
  ["[CRITICAL]", "critical"],
  ["[ESCALATED]", "escalated"],
  ["[REMINDER]", "reminder"],
  ["[URGENT]", "overdue"],
  ["Review due soon", "due_soon"],
  ["Payment reported", "reported"],
  ["Your camp reservation", "parent_release"],
];
const tierOf = (m) => PREFIXES.find(([p]) => m.subject.startsWith(p))?.[1] ?? "?";
const tiers = (msgs) => msgs.map(tierOf).join(",");
const count = (msgs, tier) => msgs.filter((m) => tierOf(m) === tier).length;
const dispatch = (m, atMs, extra = {}) => dispatchDueAlerts({ dashboardUrl: DASH, now: new Date(atMs), send: m.send, adminEmails: ADMINS, ...extra });
const clearLedger = () => pool.query(`DELETE FROM alert_ledger`);

async function reportedAndTimes(label, overrides = {}) {
  const id = await reserveOk(label, overrides);
  await reportPayment(id);
  const row = await reg(id);
  return { id, T0: new Date(row.payment_reported_at).getTime(), DUE: new Date(row.review_due_at).getTime(), row };
}
async function snapshot(id) {
  const r = await reg(id);
  return JSON.stringify({ status: r.status, hold: r.hold_expires_at, due: r.review_due_at, ext: r.extension_count, spots: r.spotsActive, total: r.spotsTotal, reason: r.release_reason });
}

// ---------------------------------------------------------------------------
console.log("=== 1. The alert schedule (pure) ===");
{
  const s = defaultSettings();
  const rid = "11111111-1111-4111-8111-111111111111";
  const due = Date.UTC(2031, 5, 8, 22, 0, 0);
  const plan = (hoursAfterDue, settings = s) => planAlerts(rid, due, due + hoursAfterDue * HOUR, settings).map((p) => p.tier).join(",");
  check("long before the review time: nothing", plan(-47) === "" && plan(-6.01) === "");
  check("6 hours before: 'due soon'", plan(-6) === "due_soon" && plan(-0.01) === "due_soon");
  check("at the review time: 'overdue'", plan(0) === "overdue" && plan(5.99) === "overdue");
  check("every 6 hours after that: a reminder", plan(6) === "overdue,reminder" && plan(23.99) === "overdue,reminder");
  check("24 hours overdue: escalated", plan(24) === "overdue,escalated,reminder" && plan(71.99) === "overdue,escalated,reminder");
  check("72 hours overdue and beyond: critical replaces reminders", plan(72) === "overdue,escalated,critical" && plan(500) === "overdue,escalated,critical");

  const key = (hrs) => planAlerts(rid, due, due + hrs * HOUR, s).map((p) => p.key);
  const reminderKeys = new Set([6, 12, 18].map((x) => key(x).find((k) => k.startsWith("reminder"))));
  check("each 6-hour reminder has its own key; the same bucket repeats the same key", reminderKeys.size === 3 && key(7).find((k) => k.startsWith("reminder")) === key(6).find((k) => k.startsWith("reminder")));
  const critKey = (x) => key(x).find((k) => k.startsWith("critical"));
  check("critical repeats every 6 hours (new key per bucket, same key inside one)", critKey(72) === critKey(77.9) && critKey(78) !== critKey(72) && critKey(84) !== critKey(78));
  const another = planAlerts("22222222-2222-4222-8222-222222222222", due, due, s)[0].key;
  check("keys include the registration (two families never share an alert)", another !== key(0)[0]);
  const extended = planAlerts(rid, due + 24 * HOUR, due + 24 * HOUR, s)[0].key;
  check("keys include the review time, so an extension starts a fresh set of alerts", extended !== key(0)[0]);
  const custom = { ...s, alertDueSoonHours: 2, alertReminderHours: 3, alertEscalatedAfterHours: 12, alertCriticalAfterHours: 30 };
  check("the schedule follows the settings", plan(-3, custom) === "" && plan(-2, custom) === "due_soon" && plan(3, custom) === "overdue,reminder" && plan(12, custom).includes("escalated") && plan(30, custom).endsWith("critical"));
  check("the planner can only ever return alerts; it has no way to release anything", [-48, -3, 0, 30, 100].every((x) => planAlerts(rid, due, due + x * HOUR, s).every((p) => typeof p.key === "string" && typeof p.tier === "string")));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. One reported payment, followed through every alert ===");
{
  await resetAll();
  await clearLedger();
  const { id, T0, DUE } = await reportedAndTimes("timeline", { weekIds: ["jul13"], parentName: "Timeline Parent" });
  check("the review time is exactly 48 hours after the report", DUE - T0 === 48 * HOUR);
  const before = await snapshot(id);
  const m = mailer();

  const n1 = await notifyPaymentReported(id, { dashboardUrl: DASH, send: m.send, adminEmails: ADMINS });
  const n2 = await notifyPaymentReported(id, { dashboardUrl: DASH, send: m.send, adminEmails: ADMINS });
  check("the 'payment reported' email goes to both administrators, once", n1 === true && n2 === false && m.sent.length === 1 && m.sent[0].to === TO && tierOf(m.sent[0]) === "reported");

  async function step(hoursAfterDue) {
    const sentBefore = m.sent.length;
    await dispatch(m, DUE + hoursAfterDue * HOUR);
    return tiers(m.sent.slice(sentBefore));
  }
  check("40 hours early: nothing", (await step(-40)) === "");
  check("6.5 hours early: nothing", (await step(-6.5)) === "");
  check("6 hours early: 'due soon'", (await step(-6)) === "due_soon");
  check("...and not again on the next runs", (await step(-5.5)) === "" && (await step(-1)) === "");
  check("at the review time: 'overdue' (the urgent one)", (await step(0)) === "overdue");
  check("...once", (await step(0.5)) === "" && (await step(5.9)) === "");
  check("6 hours overdue: a reminder", (await step(6)) === "reminder" && (await step(6.1)) === "");
  check("12 and 18 hours overdue: a reminder each", (await step(12)) === "reminder" && (await step(18)) === "reminder");
  check("24 hours overdue: ESCALATED (one email, even though a reminder was also due)", (await step(24)) === "escalated" && (await step(25)) === "");
  const superseded = (await pool.query(`SELECT alert_key, error, sent_at FROM alert_ledger WHERE registration_id=$1 AND error='superseded'`, [id])).rows;
  check("the reminder that fell due at the same moment is recorded as superseded, not emailed", superseded.length === 1 && superseded[0].alert_key.startsWith("reminder:") && superseded[0].sent_at !== null);
  check("reminders continue every 6 hours until 72 hours overdue", (await step(30)) === "reminder" && (await step(36)) === "reminder" && (await step(66)) === "reminder" && (await step(71)) === "");
  check("72 hours overdue: CRITICAL", (await step(72)) === "critical" && (await step(77)) === "");
  check("...and every 6 hours after that", (await step(78)) === "critical" && (await step(84)) === "critical" && (await step(84)) === "");

  check("every email went to both administrators and links only to the review queue", m.sent.every((x) => x.to === TO && (x.text.match(/https?:\/\/\S+/g) ?? []).every((u) => u === DASH)));
  check("through all of that, the registration was not touched: same status, same clocks, same spots", (await snapshot(id)) === before);
  const keys = (await pool.query(`SELECT alert_key FROM alert_ledger WHERE registration_id=$1`, [id])).rows.map((r) => r.alert_key);
  check("every alert key is unique (the ledger enforces it)", new Set(keys).size === keys.length);
  const unsent = (await pool.query(`SELECT count(*)::int AS n FROM alert_ledger WHERE registration_id=$1 AND sent_at IS NULL`, [id])).rows[0].n;
  check("no claim was left unsent", unsent === 0);
  await invariants("alert timeline");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. An extension restarts the schedule ===");
{
  await resetAll();
  await clearLedger();
  const id = await reserveOk("ext", { weekIds: ["jul20"] });
  await reportPayment(id);
  await makeOverdue(id, 5);
  const m = mailer();
  await dispatch(m, Date.now());
  check("5 hours overdue: the overdue alert goes out", tiers(m.sent) === "overdue");
  const ext = await grantReviewExtension(id, { hours: 24, note: "bank shows the transfer as pending" });
  const due2 = new Date((await reg(id)).review_due_at).getTime();
  check("an extension of 24 hours was granted from now", ext.ok && due2 > Date.now() + 23 * HOUR && due2 < Date.now() + 25 * HOUR);
  await dispatch(m, Date.now());
  check("immediately afterwards: no alert (it is no longer overdue)", tiers(m.sent) === "overdue");
  await dispatch(m, due2 - 7 * HOUR);
  check("7 hours before the new time: nothing", tiers(m.sent) === "overdue");
  await dispatch(m, due2 - 6 * HOUR);
  check("6 hours before the new time: a fresh 'due soon'", tiers(m.sent) === "overdue,due_soon");
  await dispatch(m, due2);
  check("at the new time: a fresh 'overdue' (the schedule really restarted)", tiers(m.sent) === "overdue,due_soon,overdue");
  const overdueKeys = (await pool.query(`SELECT count(*)::int AS n FROM alert_ledger WHERE registration_id=$1 AND kind='overdue'`, [id])).rows[0].n;
  check("the ledger holds two different overdue alerts for this registration", overdueKeys === 2);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The administrator is away for a weekend ===");
{
  // Friday 18:00: a parent reports an e-Transfer. The administrator sees nothing until Monday 09:00.
  await resetAll();
  await clearLedger();
  const A = await reserveOk("wk-A", { weekIds: ["jul27"], children: kids(2, "Wk"), parentName: "Weekend Family" });
  const paid = await fill("jul27", 27, "wk-paid");
  for (const id of paid) await confirmFor(id);
  const B = await reserveOk("wk-B", { weekIds: ["jul27"], parentName: "Unreported Family" });
  check("Friday: the week is full (27 paid + 2 children awaiting + 1 unreported hold)", (await week("jul27")).taken_count === 30);
  const full = await reserveRegistration(input("wk-C-early", { weekIds: ["jul27"] }));
  check("Friday: another family is told the week is full", !full.ok && full.reason === "weeks_full");

  await reportPayment(A);
  const rowA = await reg(A);
  const T0 = new Date(rowA.payment_reported_at).getTime();
  const m = mailer();
  await notifyPaymentReported(A, { dashboardUrl: DASH, send: m.send, adminEmails: ADMINS });
  check("Friday 18:00: the administrators are told straight away", tiers(m.sent) === "reported" && m.sent[0].subject.includes(rowA.reference_code));

  const timeline = [];
  let cTook = null;
  for (let hour = 0; hour <= 63; hour++) {
    const sentBefore = m.sent.length;
    const run = await dispatch(m, T0 + hour * HOUR + 5 * MIN); // a scheduled check five minutes past every hour
    const fresh = m.sent.slice(sentBefore);
    if (fresh.length) timeline.push(`${hour}h:${tiers(fresh)}`);
    if (hour === 13) {
      check("Saturday ~07:00: the family that never reported has been released by the 12-hour rule", run.released.includes(B) && (await reg(B)).status === "cancelled" && (await reg(B)).release_reason === "expired_unpaid");
      cTook = await reserveRegistration(input("wk-C-takes-freed", { weekIds: ["jul27"] }));
      check("...and its spot went to another family at once", cTook.ok && (await week("jul27")).taken_count === 30);
      if (cTook.ok) await confirmFor(cTook.registrationId);
    }
    if (hour === 24 || hour === 47 || hour === 48 || hour === 60) {
      const r = await reg(A);
      check(`+${hour}h: the reported payment is still protected, holding both spots`, r.status === "payment_reported" && r.spotsActive === 2, r.status);
    }
  }
  check("alerts over the weekend: parent notice for the released family, then due-soon, overdue, and two reminders — each exactly once", timeline.join(" | ") === "13h:parent_release | 42h:due_soon | 48h:overdue | 54h:reminder | 60h:reminder", timeline.join(" | "));
  check("the 'unreported family' notice went to that parent, not to the administrators", m.sent.filter((x) => tierOf(x) === "parent_release").length === 1 && m.sent.find((x) => tierOf(x) === "parent_release").to === (await reg(B)).email);

  const q = await getPaymentQueue(new Date(T0 + 63 * HOUR + 5 * MIN));
  const itemA = q.reported.find((i) => i.id === A);
  check("Monday 09:00: the queue shows the claim 15 hours overdue and the 2 spots it is blocking", itemA.overdue && itemA.overdueHours === 15 && q.overdueCount === 1 && q.blockedSpots === 2);
  check("nothing was released while the administrator was away", (await reg(A)).spotsActive === 2 && (await reg(A)).status === "payment_reported");

  const confirmed = await confirmFor(A, { depositAt: new Date(T0 - 3 * MIN) });
  const after = await reg(A);
  check("Monday: the administrator sees the deposit in the bank and confirms — it works, no capacity was lost", confirmed.ok && after.status === "paid" && after.spotsActive === 2 && after.paid_on_time === true);
  const sentBefore = m.sent.length;
  await dispatch(m, T0 + 70 * HOUR);
  check("after it is confirmed, the alerts stop", m.sent.length === sentBefore);
  const systemReleases = (await auditFor(A)).filter((e) => /cancel|release|expire/i.test(e.action));
  check("the audit log shows no release of this registration at any point", systemReleases.length === 0, JSON.stringify(systemReleases));
  await invariants("weekend away");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. The administrator is away for TEN days ===");
{
  await resetAll();
  await clearLedger();
  const { id, T0 } = await reportedAndTimes("away10", { weekIds: ["aug03"], parentName: "Ten Day Family" });
  const before = await snapshot(id);
  const m = mailer();
  await notifyPaymentReported(id, { dashboardUrl: DASH, send: m.send, adminEmails: ADMINS });
  for (let hour = 0; hour <= 240; hour++) await dispatch(m, T0 + hour * HOUR + 5 * MIN);

  const msgs = m.sent;
  check("ten days: 1 reported + 1 due-soon + 1 overdue + 10 reminders + 1 escalated + 21 critical", count(msgs, "reported") === 1 && count(msgs, "due_soon") === 1 && count(msgs, "overdue") === 1 && count(msgs, "reminder") === 10 && count(msgs, "escalated") === 1 && count(msgs, "critical") === 21, `reported ${count(msgs, "reported")}, due_soon ${count(msgs, "due_soon")}, overdue ${count(msgs, "overdue")}, reminder ${count(msgs, "reminder")}, escalated ${count(msgs, "escalated")}, critical ${count(msgs, "critical")}`);
  check("no alert was ever sent twice", new Set(msgs.map((x) => x.subject + x.text)).size === msgs.length);
  const order = tiers(msgs).replace(/(\b\w+\b)(,\1)+/g, "$1");
  check("they came in the right order, getting louder", order === "reported,due_soon,overdue,reminder,escalated,reminder,critical", order);

  const q = await getPaymentQueue(new Date(T0 + 240 * HOUR + 5 * MIN));
  check("day 10: the queue shows it 192 hours overdue, still blocking its spot", q.reported[0].overdueHours === 192 && q.blockedSpots === 1 && q.longestOverdueHours === 192);
  check("day 10: the registration is exactly as it was — still Payment Reported, still holding the spot, nothing released", (await snapshot(id)) === before);
  const rows = (await auditFor(id)).filter((e) => /cancel|release|expire|paid|confirm/i.test(e.action));
  check("the audit log shows no release or confirmation by the system", rows.length === 0, JSON.stringify(rows));

  const released = await cancelRegistration(id, "Nothing in the bank after ten days; parent did not reply", { releaseReason: "not_received" });
  check("only the administrator can release it", released.ok && (await reg(id)).status === "cancelled" && (await reg(id)).release_reason === "not_received");
  const sentBefore = m.sent.length;
  await dispatch(m, T0 + 245 * HOUR);
  check("once released, the alerts for it stop (and no parent notice is sent for an administrator release)", m.sent.length === sentBefore);
  await invariants("ten days away");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Each alert is sent once, even with simultaneous runs, failures and crashes ===");
{
  await resetAll();
  await clearLedger();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const id = await reserveOk(`conc-${i}`, { weekIds: ["aug10"] });
    await reportPayment(id);
    await makeOverdue(id, 5);
    ids.push(id);
  }
  const m = mailer();
  const now = Date.now();
  const runs = await Promise.all(Array.from({ length: 8 }, () => dispatch(m, now)));
  check("8 dispatchers at the same instant: each of the 3 overdue alerts is sent exactly once", m.sent.length === 3 && runs.reduce((n, r) => n + r.alerts.length, 0) === 3 && runs.every((r) => r.failures === 0), `${m.sent.length} sent`);
  const rows = (await pool.query(`SELECT count(*)::int AS n FROM alert_ledger WHERE kind='overdue'`)).rows[0].n;
  check("...and the ledger holds exactly three", rows === 3);
  await dispatch(m, now + 1000);
  check("running again changes nothing", m.sent.length === 3);

  // A failed send is retried by the next run; the other alerts are not held up by it.
  await clearLedger();
  const m2 = mailer({ failOn: [2] });
  const r1 = await dispatch(m2, now);
  check("one of three sends fails: the other two still go out, and the failure is counted", r1.failures === 1 && m2.sent.length === 2 && r1.alerts.length === 2);
  const claimed = (await pool.query(`SELECT count(*)::int AS n FROM alert_ledger WHERE kind='overdue'`)).rows[0].n;
  check("the failed alert's claim was removed so that it can be retried (2 remain in the ledger)", claimed === 2);
  const r2 = await dispatch(m2, now + 1000);
  check("the next run sends exactly the one that failed", r2.alerts.length === 1 && m2.sent.length === 3 && new Set(m2.sent.map((x) => x.subject)).size === 3);

  // A run that crashed between claiming and sending leaves an unsent claim; it is recovered.
  await clearLedger();
  const target = ids[0];
  const dueEpoch = Math.floor(new Date((await reg(target)).review_due_at).getTime() / 1000);
  await pool.query(`INSERT INTO alert_ledger (alert_key, kind, registration_id, recipients, created_at) VALUES ($1,'overdue',$2,$3, now() - interval '11 minutes')`, [`overdue:${target}:${dueEpoch}`, target, TO]);
  const other = ids[1];
  const otherEpoch = Math.floor(new Date((await reg(other)).review_due_at).getTime() / 1000);
  await pool.query(`INSERT INTO alert_ledger (alert_key, kind, registration_id, recipients, created_at) VALUES ($1,'overdue',$2,$3, now() - interval '2 minutes')`, [`overdue:${other}:${otherEpoch}`, other, TO]);
  const m3 = mailer();
  await dispatch(m3, now);
  const targetRef = (await reg(target)).reference_code;
  const otherRef = (await reg(other)).reference_code;
  const mentionsTarget = m3.sent.filter((x) => x.subject.includes(targetRef));
  const mentionsOther = m3.sent.filter((x) => x.subject.includes(otherRef));
  check("a claim abandoned 11 minutes ago (a crashed run) is recovered and sent", mentionsTarget.length === 1);
  check("a claim made 2 minutes ago is left alone (another run may be sending it right now)", mentionsOther.length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Who receives the alerts ===");
{
  delete process.env.ADMIN_ALERT_EMAILS;
  check("with nothing configured, the business address is used", adminAlertRecipients().join() === business.email);
  process.env.ADMIN_ALERT_EMAILS = " owner@example.test , ,backup@example.test,";
  check("a configured list is split, trimmed and cleaned", adminAlertRecipients().join() === "owner@example.test,backup@example.test");

  await resetAll();
  await clearLedger();
  const id = await reserveOk("recipients", { weekIds: ["jul06"] });
  await reportPayment(id);
  await makeOverdue(id, 1);
  const m = mailer();
  await dispatchDueAlerts({ dashboardUrl: DASH, now: new Date(), send: m.send });
  check("the dispatcher uses the configured list when none is passed in", m.sent.length === 1 && m.sent[0].to === "owner@example.test, backup@example.test");
  delete process.env.ADMIN_ALERT_EMAILS;
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. What the emails say (and do not say) ===");
{
  await resetAll();
  await clearLedger();
  const nasty = await reserveOk("nasty", {
    weekIds: ["jul06"],
    parentName: `Evil <script>alert(1)</script> & "Quote"`,
    children: [{ fullName: `<img src=x onerror=alert(1)>`, dateOfBirth: "2018-01-01", age: "8", healthInfo: "none" }],
  });
  await reportPayment(nasty);
  await makeOverdue(nasty, 30);
  const row = await reg(nasty);
  const m = mailer();
  await dispatch(m, Date.now());
  const email = m.sent.at(-1);
  check("30 hours overdue: the escalated email goes out", tierOf(email) === "escalated" && email.subject.startsWith("[ESCALATED]"));
  check("it names the reference and the exact amount due", email.text.includes(row.reference_code) && email.text.includes(`$${(row.amount_due_cents / 100).toFixed(2)}`));
  check("it says plainly that the spot is STILL HELD and what to do", email.text.includes("STILL HELD") && /confirm, release or extend/i.test(email.text) && /check your bank/i.test(email.text));
  check("a parent's name or a child's name cannot inject HTML into it", !email.html.includes("<script>") && !email.html.includes("<img src=x") && email.html.includes("&lt;script&gt;"));
  check("the plain-text version carries the names as plain text", email.text.includes("<script>alert(1)</script>"));
  const hrefs = [...email.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1]);
  const webLinks = hrefs.filter((u) => /^https?:/i.test(u));
  check("the only web link is the review queue (which needs the administrator's login); the footer has just the business phone and email", webLinks.length === 1 && webLinks[0] === DASH && hrefs.every((u) => u === DASH || /^(tel|mailto):/i.test(u)), hrefs.join(", "));
  const everything = m.sent.map((x) => x.subject + x.html + x.text).join("\n");
  check("no email contains a parent's private link, a token, or any 'mark as paid' link", !/camp-registration\//i.test(everything) && !/token/i.test(everything) && !/mark[ -]?as[ -]?paid/i.test(everything) && !/\/confirm/i.test(everything));

  const e2 = await reserveOk("tiers", { weekIds: ["jul06"] });
  await reportPayment(e2);
  const dueMs = new Date((await reg(e2)).review_due_at).getTime();
  const m2 = mailer();
  for (const x of [-6, 0, 6, 24, 72]) await dispatch(m2, dueMs + x * HOUR);
  const e2ref = (await reg(e2)).reference_code;
  const own = m2.sent.filter((x) => x.subject.includes(e2ref));
  check("the five alert levels have five clearly different subjects", own.length === 5 && new Set(own.map((x) => x.subject.split(":")[0])).size === 5, own.map((x) => x.subject.split(":")[0]).join(" | "));
  check("overdue levels all begin with a bracketed label so they stand out in an inbox", own.slice(1).every((x) => /^\[(URGENT|REMINDER|ESCALATED|CRITICAL)\]/.test(x.subject)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. The parent's notice when an unreported reservation is released ===");
{
  await resetAll();
  await clearLedger();
  const P = await reserveOk("notice-p", { weekIds: ["jul06"], parentName: "Pat Parent" });
  const Q = await reserveOk("notice-q", { weekIds: ["jul06"] });
  await reportPayment(Q);
  await cancelRegistration(Q, "no deposit found", { releaseReason: "not_received" });
  const R = await reserveOk("notice-r", { weekIds: ["jul06"] });
  await cancelRegistration(R, "family asked to cancel", { releaseReason: "owner_cancelled" });
  await expireHold(P, 1);

  const m = mailer();
  const run = await dispatch(m, Date.now());
  const rowP = await reg(P);
  const notices = m.sent.filter((x) => tierOf(x) === "parent_release");
  check("the released family gets one notice, at its own email address", run.parentNotices.join() === P && notices.length === 1 && notices[0].to === rowP.email);
  check("it carries the reference and tells the parent what to do if they did send payment", notices[0].text.includes(rowP.reference_code) && /reply to this email/i.test(notices[0].text) && /refund/i.test(notices[0].text));
  check("it contains no web link (nothing to click, nothing to forge)", !/https?:\/\//.test(notices[0].text) && !/href="https?:/i.test(notices[0].html));
  check("a release the administrator did (not received, or cancelled) sends no automatic notice — the administrator is in touch with that family", m.sent.length === 1);
  await dispatch(m, Date.now() + 1000);
  check("the notice is never sent twice", m.sent.length === 1);
  await invariants("parent notice");
}

// ---------------------------------------------------------------------------
console.log("\n=== 10. No mail configured, and the fallback that runs from site traffic ===");
{
  await resetAll();
  await clearLedger();
  const stale = await reserveOk("no-mail", { weekIds: ["jul06"] });
  await expireHold(stale, 1);
  const none = await dispatchDueAlerts({ dashboardUrl: DASH });
  check("without email configured the dispatcher reports that it skipped sending", none.skipped === "email_not_configured");
  check("...but the 12-hour release still happened", none.released.includes(stale) && (await reg(stale)).status === "cancelled");
  check("the traffic fallback does nothing at all without email configured", (await maybeDispatchFromTraffic(DASH)) === null);

  await pool.query(`DELETE FROM camp_settings WHERE key='last_alert_dispatch'`);
  const m = mailer();
  const first = await maybeDispatchFromTraffic(DASH, { send: m.send, adminEmails: ADMINS });
  const second = await maybeDispatchFromTraffic(DASH, { send: m.send, adminEmails: ADMINS });
  check("the fallback runs once, then not again within 5 minutes", first !== null && second === null);
  await pool.query(`UPDATE camp_settings SET value = (now() - interval '6 minutes')::text WHERE key='last_alert_dispatch'`);
  const third = await maybeDispatchFromTraffic(DASH, { send: m.send, adminEmails: ADMINS });
  check("after 5 minutes it runs again", third !== null);
  await pool.query(`UPDATE camp_settings SET value = (now() - interval '6 minutes')::text WHERE key='last_alert_dispatch'`);
  const burst = await Promise.all(Array.from({ length: 12 }, () => maybeDispatchFromTraffic(DASH, { send: m.send, adminEmails: ADMINS })));
  check("12 visitors at once: exactly one of them runs it", burst.filter((x) => x !== null).length === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 11. Alerts stop when the claim is resolved; they never resolve it ===");
{
  await resetAll();
  await clearLedger();
  const keep = await reportedAndTimes("resolve-keep", { weekIds: ["jul13"] });
  const paid = await reportedAndTimes("resolve-paid", { weekIds: ["jul13"] });
  const gone = await reportedAndTimes("resolve-gone", { weekIds: ["jul13"] });
  await confirmFor(paid.id);
  await cancelRegistration(gone.id, "nothing found", { releaseReason: "not_received" });
  const m = mailer();
  await dispatch(m, keep.DUE + 100 * HOUR);
  const refs = {};
  for (const [k, v] of Object.entries({ keep, paid, gone })) refs[k] = (await reg(v.id)).reference_code;
  const forRef = (r) => m.sent.filter((x) => x.subject.includes(r)).length;
  check("only the claim still waiting gets alerts; a confirmed one and a released one get none", forRef(refs.keep) === 1 && forRef(refs.paid) === 0 && forRef(refs.gone) === 0);
  check("a claim 100 hours overdue is alerted at the CRITICAL level and is still held", tierOf(m.sent.find((x) => x.subject.includes(refs.keep))) === "critical" && (await reg(keep.id)).status === "payment_reported" && (await reg(keep.id)).spotsActive === 1);
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("alerts"));
