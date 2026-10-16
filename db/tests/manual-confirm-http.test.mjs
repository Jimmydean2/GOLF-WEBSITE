// The owner's side of confirming a payment the parent never reported, over HTTP against the real
// production server: the dashboard's search by amount and phone, the login, the recent-password
// check, a plain-language refusal when the week is full (nobody else is touched), and the family's
// confirmation email. (The rules themselves are tested in manual-confirm.test.mjs.)

import { createTestDatabase } from "./helpers/testdb.mjs";
import { startApp, adminSession } from "./helpers/app.mjs";
import { startSmtpSink } from "../../scripts/lib/smtpSink.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const sink = await startSmtpSink();
const app = await startApp({
  env: { DATABASE_URL: process.env.DATABASE_URL, SMTP_HOST: sink.host, SMTP_PORT: String(sink.port), SMTP_INSECURE: "true", EMAIL_FROM: "camp@example.test", COACH_NOTICE_MODE: "off" },
});
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, reserveOk, expireHold, fill, reg, week } = h;

const W = "2027-07-19";
const W2 = "2027-07-26";
const snapshotOthers = async (exceptId) =>
  JSON.stringify((await pool.query(`SELECT to_jsonb(r) AS row FROM registrations r WHERE id <> $1 ORDER BY id`, [exceptId])).rows.map((x) => x.row));

// ---------------------------------------------------------------------------
console.log("=== Over HTTP, as the owner uses it ===");
{
  await resetAll();
  await pool.query(`DELETE FROM admin_sessions`);
  let ip = 0;
  const nextIp = () => `198.51.100.${(++ip % 250) + 1}`;
  const session = await adminSession(app);
  const hdr = { cookie: session.cookie, origin: app.url, "content-type": "application/json" };
  const call = (method, path, body) => fetch(`${app.url}${path}`, { method, headers: { ...hdr, "x-forwarded-for": nextIp() }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });

  const family = await fetch(`${app.url}/api/camp-registration`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({
      idempotencyKey: `manual-${Math.random().toString(36).slice(2)}`, parentName: "Nadia Never-Tapped", email: "nadia@example.test", primaryPhone: "514-555-0166", secondaryPhone: "",
      emergencyName: "Sam", emergencyRelationship: "Uncle", emergencyPhone: "514-555-0167", weeks: [W],
      children: [{ fullName: "Noor Never-Tapped", dateOfBirth: "2017-07-07", age: "9", healthInfo: "None" }],
      codeOfConductAccepted: true, consentAccepted: true, healthConsentAccepted: true, lang: "en",
    }),
  });
  const fam = await family.json();
  const famId = fam.statusPath.split("/").pop().split(".")[0];
  const due = (fam.amountDueCents / 100).toFixed(2);

  const found = await (await call("GET", `/api/admin/camp-registrations/search?q=${encodeURIComponent(due)}`)).json();
  check("searching the amount on the dashboard finds the family that never tapped the button", found.results?.some((x) => x.id === famId), `${found.results?.length} result(s)`);
  const byPhone = await (await call("GET", `/api/admin/camp-registrations/search?q=${encodeURIComponent("5145550166")}`)).json();
  check("and so does the phone number", byPhone.results?.some((x) => x.id === famId));

  await pool.query(`UPDATE admin_sessions SET last_auth_at = now() - interval '20 minutes'`);
  const confirmBody = { verifiedDeposit: true, amountReceived: due, depositAt: new Date().toISOString(), method: "reference_matched", referenceEntered: fam.reference };
  const stale = await call("POST", `/api/admin/camp-registrations/${famId}/confirm`, confirmBody);
  check("confirming needs the password again after 15 minutes", stale.status === 403 && (await stale.json()).code === "reauth_required");
  await call("POST", "/api/admin/reauth", { password: "Local-QA-Only-Admin-Passphrase-2026" });
  sink.messages.length = 0;
  const wrong = await call("POST", `/api/admin/camp-registrations/${famId}/confirm`, { ...confirmBody, amountReceived: "1.00" });
  const wrongBody = await wrong.json();
  check("a wrong amount is refused in plain language and nothing changes", wrong.status === 409 && /doesn't match the amount due/.test(wrongBody.error) && (await reg(famId)).status === "pending_payment", wrongBody.error);
  const ok = await call("POST", `/api/admin/camp-registrations/${famId}/confirm`, confirmBody);
  check("the right deposit confirms it (the family never tapped the button)", ok.status === 200 && (await reg(famId)).status === "paid" && (await reg(famId)).payment_reported_at === null);
  await call("POST", "/api/admin/run-check", {});
  const mail = sink.to("nadia@example.test").find((m) => /confirm/i.test(m.subject));
  check("the family receives the confirmation email", Boolean(mail), sink.messages.map((m) => m.subject).join(" | "));

  // A released family whose week has filled up, over HTTP.
  const late = await reserveOk("http-late", { weekIds: [W2], children: [{ fullName: "Lou Late", dateOfBirth: "2017-08-08", age: "9", healthInfo: "None" }] });
  await expireHold(late, 2);
  await campDb.releaseExpiredReservations();
  await fill(W2, 30, "http-fill");
  const lateRef = (await reg(late)).reference_code;
  const lateDue = ((await reg(late)).amount_due_cents / 100).toFixed(2);
  const beforeAll = await snapshotOthers(late);
  const full = await call("POST", `/api/admin/camp-registrations/${late}/confirm`, { verifiedDeposit: true, amountReceived: lateDue, depositAt: new Date().toISOString(), method: "reference_matched", referenceEntered: lateRef });
  const fullBody = await full.json();
  check("a deposit for a released family whose week is now full: 409 with the owner's options spelled out", full.status === 409 && /now full/.test(fullBody.error) && /refund/.test(fullBody.error) && /authorize an extra spot/.test(fullBody.error), fullBody.error);
  check("and no one else was touched", (await snapshotOthers(late)) === beforeAll && (await week(W2)).taken_count === 30);
}

await app.stop();
await sink.stop();
await pool.end();
await testDb.drop();
process.exit(h.finish("manual-confirm-http"));
