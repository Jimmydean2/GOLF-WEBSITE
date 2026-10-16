// A family's personal information, from consent to erasure (Quebec's Law 25):
//   * consent is required, split in two (privacy / health information), and recorded with the
//     registration, down to the database
//   * a family can be given a copy of what we hold, and can be erased: every table is searched
//     afterwards for any trace of them
//   * the clean-up after the season erases the right families at the right moment, and never one
//     whose payment is unresolved
// The question behind every check: is there any personal detail left that should not be?

import { createTestDatabase } from "./helpers/testdb.mjs";
import { PRIVACY_NOTICE_VERSION, RETENTION_DAYS, ACCOUNTING_RECORD_YEARS } from "../../src/lib/privacy.ts";
import { getMessages } from "../../src/lib/i18n/index.ts";

process.env.DB_POOL_MAX ||= "10";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const outbox = await import("../../src/lib/outbox.ts");
const privacyData = await import("../../src/lib/privacyData.ts");
const { handleRegistrationRequest } = await import("../../src/lib/registrationService.ts");
const { buildCampRosterWorkbook } = await import("../../src/lib/campRoster.ts");
const h = createHarness();
const { pool, campDb, check, refused, resetAll, input, reserveOk, confirmFor, invariants } = h;

const W_EARLY = "2027-07-05"; // camp days July 5 to 8; its last day is 2027-07-08
const W_LATE = "2027-08-23"; // last day 2027-08-26

// Searches EVERY text column of EVERY table for a trace of any of the tokens.
async function traces(tokens) {
  const cols = (
    await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json')`
    )
  ).rows;
  const hits = [];
  for (const { table_name, column_name } of cols) {
    for (const token of tokens) {
      const r = await pool.query(`SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}"::text ILIKE $1`, [`%${token}%`]);
      if (r.rows[0].n > 0) hits.push(`${table_name}.${column_name} has "${token}"`);
    }
  }
  return hits;
}

const FAMILY = {
  parentName: "Zanzibar Quimby",
  email: "zanzibar.quimby@example.test",
  primaryPhone: "514-555-0173",
  secondaryPhone: "514-555-0174",
  emergencyName: "Hortensia Fenwick",
  emergencyRelationship: "Godmother",
  emergencyPhone: "438-555-0188",
  children: [
    { fullName: "Ptolemy Quimby", dateOfBirth: "2016-03-09", age: "11", healthInfo: "Severe peanut allergy, EpiPen in the red bag" },
    { fullName: "Calliope Quimby", dateOfBirth: "2018-11-30", age: "8", healthInfo: "Asthma, inhaler zzz-inhaler" },
  ],
};
const TOKENS = ["Zanzibar", "Quimby", "zanzibar.quimby", "555-0173", "555-0174", "5145550173", "Hortensia", "Fenwick", "Godmother", "438-555-0188", "Ptolemy", "Calliope", "peanut", "EpiPen", "zzz-inhaler", "2016-03-09", "2018-11-30"];
// The payer's name is deliberately kept for accounting; every other token must be gone.
const TOKENS_WITHOUT_PAYER = TOKENS.filter((t) => t !== "Zanzibar" && t !== "Quimby");

// ---------------------------------------------------------------------------
console.log("=== 1. Consent: required, split in two, and recorded with the registration ===");
{
  await resetAll();
  await pool.query(`DELETE FROM rate_limit_counters`);
  const body = (n, extra = {}) => ({
    idempotencyKey: `privacy-key-${n}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentName: "TEST Consent Parent",
    email: `consent+${n}@example.test`,
    primaryPhone: `514-555-01${String(20 + n).slice(-2)}`,
    secondaryPhone: "",
    emergencyName: "TEST Contact",
    emergencyRelationship: "Aunt",
    emergencyPhone: "514-555-0199",
    codeOfConductAccepted: true,
    consentAccepted: true,
    healthConsentAccepted: true,
    children: [{ fullName: `TEST Child ${n}`, dateOfBirth: "2018-05-05", age: "9", healthInfo: "none" }],
    weeks: [W_EARLY],
    ...extra,
  });
  const post = async (payload) => {
    const response = await handleRegistrationRequest(
      new Request("http://localhost:3000/api/camp-registration", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.55" }, body: JSON.stringify(payload) }),
      { defer: () => {} }
    );
    return { status: response.status, data: await response.json() };
  };
  const count = async () => (await pool.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n;

  const noHealth = await post(body(1, { healthConsentAccepted: undefined }));
  const noPrivacy = await post(body(2, { consentAccepted: undefined }));
  const noConduct = await post(body(3, { codeOfConductAccepted: false }));
  const falsy = await post(body(4, { healthConsentAccepted: "true" }));
  check("without the health-information consent the registration is refused, plainly", noHealth.status === 400 && noHealth.data.code === "consent_required" && /both consents/.test(noHealth.data.error), noHealth.data.error);
  check("without the privacy consent it is refused", noPrivacy.status === 400 && noPrivacy.data.code === "consent_required");
  check("without the code of conduct it is refused", noConduct.status === 400 && noConduct.data.code === "consent_required");
  check("a consent must be the real boolean true, not the text \"true\"", falsy.status === 400 && falsy.data.code === "consent_required");
  check("none of those created anything", (await count()) === 0);
  const frNo = await post(body(5, { healthConsentAccepted: false, language: "fr" }));
  check("the refusal is in French for a French form", frNo.data.code === "consent_required" && /deux consentements/.test(frNo.data.error), frNo.data.error);

  const ok = await post(body(6));
  check("with everything ticked it is accepted", ok.status === 200 && ok.data.success === true);
  const row = (await pool.query(`SELECT consent_accepted, health_consent_accepted, consent_version, consent_recorded_at, created_at FROM registrations`)).rows[0];
  check("both consents, the version of the notice and the time are saved", row.consent_accepted === true && row.health_consent_accepted === true && row.consent_version === PRIVACY_NOTICE_VERSION && Math.abs(new Date(row.consent_recorded_at) - new Date(row.created_at)) < 5000, JSON.stringify(row));

  // The database itself refuses a registration that lacks the record, whatever the code does.
  await refused(
    "the database refuses a registration with no recorded consent version (even from raw SQL)",
    () => pool.query(`INSERT INTO registrations (idempotency_key, parent_name, email, primary_phone, emergency_name, emergency_relationship, emergency_phone, code_of_conduct_accepted, consent_accepted, health_consent_accepted, status, total_price_cents)
                      VALUES ('raw-no-version-1','R','r@example.test','1','E','A','2',true,true,true,'pending_payment',38000)`),
    "registrations_consents_recorded"
  );
  await refused(
    "...or without the health-information consent",
    () => pool.query(`INSERT INTO registrations (idempotency_key, parent_name, email, primary_phone, emergency_name, emergency_relationship, emergency_phone, code_of_conduct_accepted, consent_accepted, health_consent_accepted, consent_version, consent_recorded_at, status, total_price_cents)
                      VALUES ('raw-no-health-1','R','r@example.test','1','E','A','2',true,true,false,'x',now(),'pending_payment',38000)`),
    "registrations_consents_recorded"
  );
  await refused("...and a recorded consent cannot be switched off afterwards", () => pool.query(`UPDATE registrations SET health_consent_accepted = false`), "registrations_consents_recorded");

  const en = getMessages("en");
  const fr = getMessages("fr");
  check("the consent texts exist in both languages and name the business and the purpose",
    /parent or legal guardian/.test(en.consent.privacyBefore) && /parent ou le tuteur légal/.test(fr.consent.privacyBefore) && /health information/.test(en.consent.health) && /renseignements de santé/.test(fr.consent.health));
  check("the 'how we use your information' box states the retention period from the one constant the clean-up job uses",
    en.consent.panel(RETENTION_DAYS).includes(`${RETENTION_DAYS} days`) && fr.consent.panel(RETENTION_DAYS).includes(`${RETENTION_DAYS} jours`)
    && en.privacy.keep(RETENTION_DAYS, ACCOUNTING_RECORD_YEARS)[0].includes(`${RETENTION_DAYS} days`) && fr.privacy.keep(RETENTION_DAYS, ACCOUNTING_RECORD_YEARS)[1].includes(`${ACCOUNTING_RECORD_YEARS} ans`));
  check("the notice's own promises are the ones the system keeps: no analytics, no marketing", /does not use analytics/.test(en.privacy.cookies) && /do not sell your information/.test(en.privacy.noMarketing));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. A family can be given a copy of what we hold ===");
{
  await resetAll();
  const id = await reserveOk("export", { ...FAMILY, weekIds: [W_EARLY, W_LATE], language: "fr" });
  await confirmFor(id, { note: "sender Zanzibar matched, 4:12 pm" });
  await campDb.recordAudit("export_family_data", id, {});
  const bundle = await privacyData.exportFamilyData(id);
  check("the export holds the parent, the children with dates of birth and health notes, and the emergency contact",
    bundle.registration.parentName === "Zanzibar Quimby" && bundle.registration.email === FAMILY.email && bundle.registration.emergencyContact.name === "Hortensia Fenwick"
    && bundle.children.length === 2 && bundle.children.some((c) => c.name === "Ptolemy Quimby" && c.dateOfBirth === "2016-03-09" && /peanut/.test(c.healthInformation)));
  check("it names the weeks in the family's language and shows the payment record", bundle.registration.weeks.includes("5, 6, 7 et 8 juillet") && bundle.registration.status === "paid" && bundle.registration.depositAt !== null && bundle.registration.amountDueCents > 0);
  check("it shows the consent record", bundle.consent.privacyConsent && bundle.consent.healthInformationConsent && bundle.consent.privacyNoticeVersion === PRIVACY_NOTICE_VERSION && bundle.consent.recordedAt !== null);
  check("it lists the emails sent to them and what has happened to the registration", bundle.emailsSent.some((e) => e.kind === "parent_instructions") && bundle.activity.some((a) => a.action === "confirm_payment") && bundle.activity.some((a) => a.action === "export_family_data"));
  const text = JSON.stringify(bundle);
  check("it does not include the owner's private notes, internal tokens or the idempotency key", !text.includes("4:12 pm") && !/confirm_token|idempotency/i.test(text));
  check("an unknown registration has no export", (await privacyData.exportFamilyData("00000000-0000-0000-0000-000000000000")) === null);
  check("downloading is recorded in the audit log without any personal detail", (await h.auditFor(id)).filter((a) => a.action === "export_family_data").every((a) => JSON.stringify(a.details) === "{}"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The audit log never holds a family's personal details (so erasing can reach everything) ===");
{
  await resetAll();
  const reported = await reserveOk("audit-clean", { ...FAMILY, email: "zanzibar.quimby+2@example.test", weekIds: [W_EARLY] });
  await campDb.reportPayment(reported);
  await campDb.grantReviewExtension(reported, { hours: 24, note: "Zanzibar's bank shows the transfer as pending" });
  await confirmFor(reported, { note: "sender Zanzibar Quimby, same amount, 4:12 pm", method: "name_amount_time", referenceEntered: undefined });
  await campDb.cancelRegistration(reported, "Zanzibar asked to cancel by phone", { releaseReason: "owner_cancelled" });
  const log = JSON.stringify((await pool.query(`SELECT details FROM admin_audit_log WHERE target_id = $1`, [reported])).rows);
  check("extension note, payment note and cancellation reason are NOT in the append-only audit log", !log.includes("Zanzibar") && !log.includes("4:12") && !log.includes("phone"), log.slice(0, 200));
  check("the audit entries say that a note exists", log.includes('"hasNote":true') && log.includes('"hasReason":true'), log.slice(0, 160));
  const notes = (await pool.query(`SELECT action, note FROM admin_notes WHERE registration_id = $1`, [reported])).rows;
  check("the extension note is kept in the erasable notes table instead", notes.length === 1 && notes[0].action === "extend_review" && /Zanzibar/.test(notes[0].note));
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Erasing a family: nothing personal is left anywhere ===");
{
  await resetAll();
  const w = async (id) => (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id = $1`, [id])).rows[0].taken_count;

  const id = await reserveOk("erase", { ...FAMILY, weekIds: [W_EARLY, W_LATE], language: "fr" });
  await campDb.reportPayment(id);
  await campDb.grantReviewExtension(id, { hours: 24, note: "Zanzibar's bank shows it as pending" });
  await campDb.cancelRegistration(id, "Zanzibar's cheque never came", { releaseReason: "not_received" }); // a strike against this contact
  await campDb.reinstateRegistration(id);
  await confirmFor(id, { note: "Zanzibar Quimby, same amount" });
  // A second family whose payment was not found: a strike stays on record against their contact.
  const strikeFamily = await reserveOk("strike", { email: "strike.family@example.test", primaryPhone: "514-555-0166", parentName: "Wilhelmina Strudwick", weekIds: [W_LATE] });
  await campDb.reportPayment(strikeFamily);
  await campDb.cancelRegistration(strikeFamily, "Strudwick: nothing arrived", { releaseReason: "not_received" });
  const other = await reserveOk("bystander", { email: "bystander@example.test", weekIds: [W_EARLY] });
  const beforeHits = await traces(TOKENS);
  check("setup: before erasing, the family's details really are in the database", beforeHits.length >= 8, `${beforeHits.length} traces`);
  check("setup: a strike is on record against the second family's contact (its keys hold their email and phone)", (await pool.query(`SELECT count(*)::int AS n FROM contact_strikes WHERE registration_id = $1`, [strikeFamily])).rows[0].n === 1
    && (await traces(["strike.family", "5145550166"])).some((x) => x.startsWith("contact_strikes")));

  const regBefore = await pool.query(`SELECT reference_code, amount_due_cents, total_price_cents, status, verified_at, deposit_at, amount_received_cents, verified_reference, bank_confirmation_number, paid_at FROM registrations WHERE id = $1`, [id]);
  const takenBefore = [await w(W_EARLY), await w(W_LATE)];
  const result = await privacyData.eraseFamily(id, { why: "test" });
  check("erasing succeeds", result.ok && result.alreadyErased === false);
  check("a PAID registration is cancelled first, so its two places go back to other families", result.releasedWeekIds.length === 2 && (await w(W_EARLY)) === takenBefore[0] - 2 && (await w(W_LATE)) === takenBefore[1] - 2, `${takenBefore} -> ${await w(W_EARLY)},${await w(W_LATE)}`);
  const after = (await pool.query(`SELECT * FROM registrations WHERE id = $1`, [id])).rows[0];
  check("the accounting record is untouched: reference, amounts, deposit, bank confirmation, verified reference",
    after.reference_code === regBefore.rows[0].reference_code && after.amount_due_cents === regBefore.rows[0].amount_due_cents && after.total_price_cents === regBefore.rows[0].total_price_cents
    && after.amount_received_cents === regBefore.rows[0].amount_received_cents && String(after.deposit_at) === String(regBefore.rows[0].deposit_at) && after.verified_reference === regBefore.rows[0].verified_reference);
  check("the status is 'cancelled' and the time of erasure is recorded", after.status === "cancelled" && after.anonymized_at !== null);
  check("the parent's contact details and the emergency contact are overwritten", after.email.startsWith("erased+") && after.email.endsWith("@invalid.example") && after.primary_phone === "" && after.secondary_phone === "" && after.emergency_name === "" && after.emergency_phone === "");
  check("by default the parent's name stays, as the payer on the accounting record", after.parent_name === "Zanzibar Quimby");
  const kids = (await pool.query(`SELECT full_name, date_of_birth, age, health_info FROM children WHERE registration_id = $1`, [id])).rows;
  check("each child is 'Erased' with no date of birth, age or health note", kids.length === 2 && kids.every((k) => k.full_name === "Erased" && k.date_of_birth === null && k.age === "" && k.health_info === ""));
  await privacyData.eraseFamily(strikeFamily);
  check("the strike against an erased family's contact is gone too, with the email and phone it held", (await traces(["strike.family", "5145550166", "Strudwick", "Wilhelmina"])).filter((x) => !x.includes("registrations.parent_name")).length === 0);
  check("their queued emails, strikes and the owner's notes are gone", (await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE registration_id = $1`, [id])).rows[0].n === 0
    && (await pool.query(`SELECT count(*)::int AS n FROM contact_strikes WHERE registration_id = $1`, [id])).rows[0].n === 0 && (await pool.query(`SELECT count(*)::int AS n FROM admin_notes WHERE registration_id = $1`, [id])).rows[0].n === 0);
  check("the free-text payment note and cancellation reason on the registration are cleared", after.verification_note === null && after.cancelled_reason === null);

  const hits = await traces(TOKENS_WITHOUT_PAYER);
  check("a search of EVERY text column of EVERY table finds no trace of the family (name of the payer aside)", hits.length === 0, hits.join(" | "));
  check("the audit log records the erasure and nothing personal", (await h.auditFor(id)).some((a) => a.action === "erase_registration" && a.details.previousStatus === "cancelled") && !JSON.stringify((await h.auditFor(id))).includes("Zanzibar"));

  check("a bystander's registration is untouched", (await pool.query(`SELECT email FROM registrations WHERE id = $1`, [other])).rows[0].email === "bystander@example.test" && (await w(W_EARLY)) === takenBefore[0] - 2);
  const again = await privacyData.eraseFamily(id);
  check("erasing twice changes nothing", again.ok && again.alreadyErased === true && (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id = $1 AND action = 'erase_registration'`, [id])).rows[0].n === 1);
  check("an unknown registration is reported as not found", (await privacyData.eraseFamily("00000000-0000-0000-0000-000000000000")).ok === false);
  check("searching the dashboard no longer finds the family", (await campDb.searchRegistrations("Ptolemy")).length === 0 && (await campDb.searchRegistrations("zanzibar.quimby")).length === 0);

  const sent = [];
  await outbox.processOutbox({ origin: "https://camp.example.test", send: async (m) => sent.push(m), adminEmails: ["owner@example.test"], coachMode: "off" });
  check("nothing is ever emailed to an erased family", sent.every((m) => !String(m.to).includes("erased+")));
  const wb = await buildCampRosterWorkbook();
  const cells = [];
  wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value ?? "")))));
  check("the roster workbook still builds and shows no trace of the family", !cells.some((c) => /Ptolemy|Calliope|Quimby|Hortensia|peanut/i.test(c)));
  const again2 = await campDb.reserveRegistration(input("rereg", { ...FAMILY, weekIds: [W_EARLY], idempotencyKey: `re-register-${Date.now()}` }));
  check("the same family can register again later, as new customers", again2.ok === true);
  await invariants("after erasing");

  // Erasing a family that has not paid; and the option to remove the payer's name too.
  const unpaid = await reserveOk("erase2", { email: "pending.family@example.test", parentName: "Octavia Marchbanks", weekIds: [W_LATE], children: [{ fullName: "Septimus Marchbanks", dateOfBirth: "2017-01-01", age: "9", healthInfo: "none" }] });
  const takenLate = await w(W_LATE);
  const res2 = await privacyData.eraseFamily(unpaid, { removePayerName: true });
  const row2 = (await pool.query(`SELECT parent_name, status FROM registrations WHERE id = $1`, [unpaid])).rows[0];
  check("an unpaid, held registration is released and erased, and the owner can also remove the parent's name", res2.ok && row2.status === "cancelled" && row2.parent_name === "Erased family" && (await w(W_LATE)) === takenLate - 1);
  check("no trace of that family either", (await traces(["Octavia", "Marchbanks", "Septimus", "pending.family"])).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. The clean-up after the season: right families, right day, never an unresolved payment ===");
{
  await resetAll();
  const dayAfter = (iso, days) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const lastDayEarly = "2027-07-08";
  const dueDate = dayAfter(lastDayEarly, RETENTION_DAYS); // the first day the clean-up applies
  const montrealMidnight = (iso) => new Date(`${iso}T05:00:00Z`); // 00:00 Montreal (EST/EDT: 05:00Z or 04:00Z, safely after midnight)

  const paid = await reserveOk("ret-paid", { ...FAMILY, email: "ret.paid@example.test", weekIds: [W_EARLY] });
  await confirmFor(paid, { note: "Zanzibar Quimby, same amount" });
  const cancelled = await reserveOk("ret-cancelled", { email: "ret.cancelled@example.test", weekIds: [W_EARLY] });
  await campDb.cancelRegistration(cancelled, "x", { releaseReason: "owner_cancelled" });
  const unresolved = await reserveOk("ret-reported", { email: "ret.reported@example.test", weekIds: [W_EARLY] });
  await campDb.reportPayment(unresolved);
  const unreportedHold = await reserveOk("ret-pending", { email: "ret.pending@example.test", weekIds: [W_EARLY] });
  const longCamp = await reserveOk("ret-two-weeks", { email: "ret.long@example.test", weekIds: [W_EARLY, W_LATE] });
  await confirmFor(longCamp);

  const dayBefore = await privacyData.previewRetention(new Date(`${dayAfter(dueDate, -1)}T18:00:00Z`));
  check(`the day before the ${RETENTION_DAYS}th day after the last camp day, nobody is due`, dayBefore.due.length === 0 && dayBefore.blocked.length === 0, JSON.stringify([dayBefore.today, dayBefore.due.length]));
  const onDay = await privacyData.previewRetention(montrealMidnight(dueDate));
  const dueRefs = onDay.due.map((x) => x.id).sort();
  check(`on the ${RETENTION_DAYS}th day, the paid and the cancelled one-week registrations are due`, onDay.today === dueDate && dueRefs.includes(paid) && dueRefs.includes(cancelled), `${onDay.today} ${dueRefs.length}`);
  check("a reported-but-unconfirmed payment and a still-pending hold are listed as blocked, never as due", onDay.blocked.map((x) => x.id).sort().join() === [unresolved, unreportedHold].sort().join() || (onDay.blocked.some((x) => x.id === unresolved) && !onDay.due.some((x) => x.id === unresolved)));
  check("a family registered for TWO weeks waits for the LAST week to be over", !onDay.due.some((x) => x.id === longCamp));

  const before = await campDb.getRegistrationSnapshot(paid);
  const spotsBefore = (await pool.query(`SELECT count(*)::int AS n FROM registration_spots WHERE status = 'active'`)).rows[0].n;
  const takenBefore = (await pool.query(`SELECT sum(taken_count)::int AS n FROM camp_weeks`)).rows[0].n;
  await pool.query(`INSERT INTO admin_login_attempts (ip, succeeded, created_at) VALUES ('203.0.113.9', false, $1), ('203.0.113.10', true, $2)`, [new Date(montrealMidnight(dueDate).getTime() - 40 * 86_400_000), new Date(montrealMidnight(dueDate).getTime() - 2 * 86_400_000)]);
  const run = await privacyData.applyRetention(montrealMidnight(dueDate));
  check("the clean-up erases exactly the families that are due", run.anonymized === onDay.due.length && run.blocked === onDay.blocked.length, JSON.stringify(run));
  const afterPaid = await campDb.getRegistrationSnapshot(paid);
  check("a paid family keeps their payment, status and places (capacity counts are not disturbed)", afterPaid.status === "paid" && afterPaid.amountDueCents === before.amountDueCents && afterPaid.weekIds.join() === before.weekIds.join()
    && (await pool.query(`SELECT count(*)::int AS n FROM registration_spots WHERE status = 'active'`)).rows[0].n === spotsBefore && (await pool.query(`SELECT sum(taken_count)::int AS n FROM camp_weeks`)).rows[0].n === takenBefore);
  check("the payer's name is kept for accounting; the contact details, children and notes are erased", afterPaid.parentName === "Zanzibar Quimby" && afterPaid.email.startsWith("erased+") && afterPaid.children.every((c) => c.fullName === "Erased" && c.healthInfo === "") && afterPaid.anonymizedAt !== null);
  check("no other trace of the family anywhere in the database", (await traces(TOKENS_WITHOUT_PAYER)).length === 0);
  check("the unresolved payment was not touched", (await campDb.getRegistrationSnapshot(unresolved)).anonymizedAt === null);
  check("the audit log says the system did it, with the reason, and nothing personal", (await h.auditFor(paid)).some((a) => a.action === "erase_registration" && a.actor === "system" && /retention/.test(a.details.why)));
  check("old administrator sign-in records are forgotten, recent ones are kept", (await pool.query(`SELECT count(*)::int AS n FROM admin_login_attempts`)).rows[0].n === 1 && run.purgedLoginRecords === 1);
  const second = await privacyData.applyRetention(montrealMidnight(dueDate));
  check("running it again does nothing", second.anonymized === 0);
  const later = await privacyData.previewRetention(montrealMidnight(dayAfter("2027-08-26", RETENTION_DAYS)));
  check("the two-week family becomes due after the later week", later.due.some((x) => x.id === longCamp));
  const counts = await privacyData.retentionDueCount(montrealMidnight(dayAfter("2027-08-26", RETENTION_DAYS)));
  check("the dashboard count agrees", counts.due === later.due.length && counts.blocked === later.blocked.length);
  await invariants("after the clean-up");

  // A short test on the guard of an unresolved payment: it is never erased, even by name.
  const tooSoon = await privacyData.applyRetention(montrealMidnight(dueDate), { retentionDays: RETENTION_DAYS });
  check("and a blocked registration stays blocked on every later run", (await campDb.getRegistrationSnapshot(unresolved)).anonymizedAt === null && tooSoon.anonymized === 0);
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("privacy"));
