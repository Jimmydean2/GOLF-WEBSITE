// French and English: the dictionaries, the formats, the registration API and every email a
// family receives. The question behind every check: does a French-speaking family get a complete,
// correct, French experience, and does an English family get exactly what they always did?

import { createTestDatabase } from "./helpers/testdb.mjs";
import { fr as frRaw } from "../../src/lib/i18n/fr.ts";
import { getMessages, formatMoney, formatMontreal, formatMontrealLong, joinNames, alternatePath, langOfPath, reservationPath } from "../../src/lib/i18n/index.ts";
import { LEGAL_REVIEW } from "../../src/lib/i18n/legal.ts";
import { parseLang } from "../../src/lib/lang.ts";
import { labelForWeekId } from "../../src/lib/season.ts";
import { readFileSync } from "node:fs";
import { renderLegalDoc } from "../../scripts/lib/legalDoc.mjs";

process.env.DB_POOL_MAX ||= "20";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const outbox = await import("../../src/lib/outbox.ts");
const templates = await import("../../src/lib/campEmailTemplates.ts");
const { handleRegistrationRequest } = await import("../../src/lib/registrationService.ts");
const { registrationIdFromToken } = await import("../../src/lib/registrationLink.ts");
const h = createHarness();
const { pool, campDb, check, resetAll, reserveOk, confirmFor, expireHold } = h;

const en = getMessages("en");
const fr = getMessages("fr");
const NBSP = " ";
const ORIGIN = "https://camp.example.test";
const ADMINS = ["owner@example.test"];
const W1 = "2027-06-21"; // the Fête nationale week: June 21, 22, 23 & 25
const W2 = "2027-07-05";

// ---------------------------------------------------------------------------
console.log("=== 1. The two dictionaries have exactly the same shape ===");
{
  const shape = (node, path = "") => {
    if (typeof node === "function") return [[path, `fn/${node.length}`]];
    if (Array.isArray(node)) return [[path, `array/${node.length}`]];
    if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => shape(v, path ? `${path}.${k}` : k));
    return [[path, typeof node]];
  };
  // The raw French dictionary: the one every message function keeps its true number of values in
  // (the version the site uses is wrapped to fix French typography).
  const a = shape(en);
  const b = shape(frRaw);
  const keysA = a.map((x) => x[0]).sort();
  const keysB = b.map((x) => x[0]).sort();
  check("same message keys in English and French", JSON.stringify(keysA) === JSON.stringify(keysB), keysA.filter((k) => !keysB.includes(k)).concat(keysB.filter((k) => !keysA.includes(k))).join(", "));
  const mism = a.filter(([k, t]) => b.find(([k2]) => k2 === k)?.[1] !== t).map(([k]) => k);
  check("same kind of message everywhere (text, list, or a message that takes the same number of values)", mism.length === 0, mism.join(", "));
  check(`${a.length} messages in each language`, a.length > 150, String(a.length));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Every French message is French, typographically correct, and complete ===");
{
  // Sample values for every message that takes arguments.
  const S = {
    "site.rights": [2027], "camp.metaTitle": [2027], "camp.metaDescription": [2027], "camp.heroEyebrow": [2027], "camp.priceLine": [380],
    "camp.maxLine": ["9:30 AM – 4:00 PM"], "camp.comingSoonTitle": [2027], "camp.comingSoonBody": [2027], "week.spotsLeft": [3, 30],
    "form.section2": [2], "form.childN": [2], "form.removeChildAria": [2], "form.hoursLine": ["Label", "9:30"], "form.childrenTimesWeeks": [2, 3],
    "form.priceFrom": [380], "form.money": [43691], "form.paySend": ["Button"], "form.notAnnouncedTitle": [2027], "form.notAnnouncedBody": [2027],
    "form.opensBanner": ["Saturday"], "form.successBody": [2], "form.successTotal": [2, 3, 43691],
    "parent.heldUntil": ["Fri"], "parent.emailedTo": ["m***@x.test", "514-816-3454"], "parent.reportedBody": ["GD-ABC123"],
    "errors.tooManyChildren": [12], "errors.invalidBirthDate": ["Léa"], "errors.duplicateChild": ["Léa"], "errors.weeksFull": [["June 21"]],
    "errors.weeksUnavailable": [["June 21"]], "errors.alreadyRegistered": [["Léa", "Marc"], ["June 21"], true], "errors.notAnnounced": [2027], "errors.opensLater": ["Sat"],
    "payment.send": ["$1.00", "a@b.test"], "payment.reference": ["GD-ABC123"], "email.hello": ["Léa"],
    "email.instructions.subject": ["Léa", "GD-ABC123"], "email.instructions.intro": ["Chantal", "Léa", "June 21", "Fri"], "email.instructions.textAmount": ["$1.00"],
    "email.reminder.subject": ["Léa", "Fri"], "email.reminder.intro": ["Chantal", "Léa", "GD-ABC123", "Fri"], "email.reminder.alreadySent": ["Button"],
    "email.reminder.notYetSent": ["$1.00", "a@b.test", "GD-ABC123"], "email.release.subject": ["Léa", "GD-ABC123"], "email.release.reference": ["GD-ABC123", "Léa"],
    "email.confirmation.subject": ["Léa"], "email.confirmation.intro": ["Léa", false, 1], "email.confirmation.confirmedWeeks": [2], "email.confirmation.closing": ["514-816-3454"],
    "email.confirmation.textClosing": ["514-816-3454"], "email.confirmation.textIntro": ["Léa", false],
    "email.cancellation.subjectCancelled": ["Léa", "GD-ABC123"], "email.cancellation.subjectNotReceived": ["Léa", "GD-ABC123"], "email.cancellation.reference": ["GD-ABC123", "Léa"],
    "email.cancellation.weeksReleased": ["June 21"], "email.cancellation.contact": ["514-816-3454"],
    "waitlist.done": ["June 21", "a@b.test"], "waitlist.errors.weekHasRoom": [["June 21"]],
    "email.waitlistAck.subject": ["June 21"], "email.waitlistAck.intro": ["Chantal", "June 21"], "email.waitlistAck.remove": ["514-816-3454"],
    "email.waitlistNotify.subject": ["June 21"], "email.waitlistNotify.intro": ["Chantal", "June 21"], "email.waitlistNotify.remove": ["514-816-3454"],
    "consent.panel": [90], "privacy.version": ["2026-10-16"], "privacy.responsible": ["James", "a@b.test", "514-816-3454"],
    "privacy.keep": [90, 6], "privacy.rightsContact": ["a@b.test", "514-816-3454"],
  };
  const flat = (node, path = "") => {
    if (typeof node === "function") return [[path, node]];
    if (Array.isArray(node)) return node.map((v, i) => [`${path}[${i}]`, v]);
    if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => flat(v, path ? `${path}.${k}` : k));
    return [[path, node]];
  };
  const unsampled = flat(fr).filter(([k, v]) => typeof v === "function" && !S[k]).map(([k]) => k);
  check("every message that takes values has sample values in this test (so none is skipped)", unsampled.length === 0, unsampled.join(", "));

  const collect = (dictionary) => {
    const out = [];
    for (const [path, v] of flat(dictionary)) {
      if (typeof v === "function") {
        const result = v(...S[path]);
        if (Array.isArray(result)) result.forEach((t, i) => out.push([`${path}[${i}]`, String(t)]));
        else out.push([path, String(result)]);
      } else if (typeof v === "string") out.push([path, v]);
    }
    return out;
  };
  const texts = collect(fr);
  const enTexts = collect(en);
  const strip = (t) => t.replace(/[]/g, "");
  check("no message is empty in either language", texts.every(([, t]) => strip(t).trim().length > 0) && enTexts.every(([, t]) => strip(t).trim().length > 0));

  // Words that mean the English was left in. (Brand names, "Interac", "Golf Dorval" are fine.)
  const ENGLISH = /\b(the|and|your|you|please|payment|thank|week|weeks|with|has been|e-transfer|spot|spots|registration|reservation|reference|child|children|email)\b/i;
  const exempt = new Set(["lang.code", "lang.htmlLang", "lang.switchLabel", "lang.switchAria"]);
  const leftovers = texts.filter(([k, t]) => !exempt.has(k) && ENGLISH.test(strip(t))).map(([k, t]) => `${k}: ${strip(t).match(ENGLISH)[0]}`);
  check("no French message contains an English word left behind", leftovers.length === 0, leftovers.slice(0, 5).join(" | "));

  const straight = texts.filter(([k, t]) => /[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/.test(strip(t)) && !exempt.has(k)).map(([k]) => k);
  check("French uses the typographic apostrophe (’) everywhere", straight.length === 0, straight.slice(0, 5).join(", "));

  const spaceColon = texts.filter(([, t]) => / [:]/.test(t) || /« | »/.test(t.replace(new RegExp(`«${NBSP}`, "g"), "").replace(new RegExp(`${NBSP}»`, "g"), ""))).map(([k]) => k);
  check("French puts a no-break space (not a plain space) before a colon and inside « »", spaceColon.length === 0, spaceColon.slice(0, 5).join(", "));
  check("and it really does (the typography pass ran)", texts.some(([, t]) => t.includes(`${NBSP}:`)) && texts.some(([, t]) => t.includes(`«${NBSP}`)) && texts.some(([k, t]) => k === "form.gst" && t.includes(`5${NBSP}%`)));
  check("tax names are the Quebec ones in French (TPS, TVQ) and the English ones in English (GST, QST)",
    fr.form.gst.startsWith("TPS") && fr.form.qst.startsWith("TVQ") && en.form.gst.startsWith("GST") && en.form.qst.startsWith("QST"));
  check("French says \"virement Interac\", never \"e-Transfer\"", texts.filter(([k]) => k.startsWith("payment.") || k.startsWith("form.pay")).every(([, t]) => !/e-?transfer/i.test(t)) && /virement Interac/.test(fr.payment.send("1", "a")));
  check("the English camp facts are exactly the owner's wording (content.ts)", en.info.hours === "9:30 AM – 4:00 PM" && en.info.whatToBring.length === 5 && fr.info.whatToBring.length === 5 && fr.info.safetyInfo.length === en.info.safetyInfo.length);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Money, dates, names and languages are written the way each language writes them ===");
{
  check("English money is unchanged ($436.91)", formatMoney(43691, "en") === "$436.91");
  check("French money is 436,91 $ with a no-break space", formatMoney(43691, "fr") === `436,91${NBSP}$`, JSON.stringify(formatMoney(43691, "fr")));
  check("French thousands: 1 234,50 $", formatMoney(123450, "fr") === `1${NBSP}234,50${NBSP}$`, JSON.stringify(formatMoney(123450, "fr")));
  check("English time is Montreal time (Fri, Oct 16, 11:28 p.m.)", formatMontreal("2026-10-17T03:28:00Z", "en") === "Fri, Oct 16, 11:28 p.m.", formatMontreal("2026-10-17T03:28:00Z", "en"));
  const frTime = formatMontreal("2026-10-17T03:28:00Z", "fr");
  check("French time is Montreal time (ven. 16 oct., 23 h 28)", frTime.startsWith("ven. 16 oct.") && /23.h.28/.test(frTime), frTime);
  check("winter and summer both use Montreal's clock", formatMontreal("2027-01-16T14:00:00Z", "en").includes("9:00 a.m.") && formatMontreal("2027-07-05T13:00:00Z", "en").includes("9:00 a.m."));
  check("the long form carries the year", formatMontrealLong("2027-01-16T14:00:00Z", "en").includes("2027") && formatMontrealLong("2027-01-16T14:00:00Z", "fr").includes("2027") && formatMontrealLong("2027-01-16T14:00:00Z", "fr").startsWith("samedi"));
  check("lists of names", joinNames(["A", "B", "C"], "en") === "A, B and C" && joinNames(["A", "B", "C"], "fr") === "A, B et C" && joinNames(["A"], "fr") === "A");
  check("only \"en\" and \"fr\" are languages; anything else is English", parseLang("fr") === "fr" && parseLang("en") === "en" && ["FR", "fr ", "de", "", null, undefined, 5, {}, "fr-CA"].every((v) => parseLang(v) === "en"));
  check("week labels in both languages", labelForWeekId(W1, "en") === "June 21, 22, 23 & 25" && labelForWeekId(W1, "fr") === "21, 22, 23 et 25 juin");
  check("a private reservation page lives at a French address for a French family", reservationPath("fr", "T") === "/fr/inscription-camp/T" && reservationPath("en", "T") === "/camp-registration/T");
  check("each page knows its other-language twin", alternatePath("/junior-camps")?.path === "/fr/camps-juniors" && alternatePath("/fr/camps-juniors")?.path === "/junior-camps"
    && alternatePath("/camp-registration/abc.def")?.path === "/fr/inscription-camp/abc.def" && alternatePath("/fr/inscription-camp/abc.def")?.path === "/camp-registration/abc.def"
    && alternatePath("/privacy")?.path === "/fr/confidentialite" && alternatePath("/fr/confidentialite/")?.path === "/privacy");
  check("pages with no translation have no twin (no switch is offered)", ["/", "/about", "/lessons", "/clinics", "/book", "/contact", "/admin/camp-rosters", "/camp-registration", "/camp-registration/a/b"].every((p) => alternatePath(p) === null));
  check("language of an address", langOfPath("/fr/camps-juniors") === "fr" && langOfPath("/fr") === "fr" && langOfPath("/junior-camps") === "en" && langOfPath("/frog") === "en");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The registration form's POST answers in the family's language ===");
{
  const firstWeek = W1;
  const body = (n, extra = {}) => ({
    idempotencyKey: `i18n-key-${n}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentName: "Chantal Côté",
    email: `chantal+${n}@example.test`,
    primaryPhone: `514-555-01${String(10 + n).slice(-2)}`,
    secondaryPhone: "",
    emergencyName: "TEST Contact",
    emergencyRelationship: "Tante",
    emergencyPhone: "514-555-0199",
    codeOfConductAccepted: true,
    consentAccepted: true,
    healthConsentAccepted: true,
    children: [{ fullName: `Émilie Côté ${n}`, dateOfBirth: "2017-04-04", age: "10", healthInfo: "Aucun" }],
    weeks: [firstWeek],
    ...extra,
  });
  const post = async (payload, ip = "198.51.100.40") => {
    const response = await handleRegistrationRequest(
      new Request("http://localhost:3000/api/camp-registration", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(payload) }),
      { defer: () => {} }
    );
    return { status: response.status, data: await response.json() };
  };
  await resetAll();
  await pool.query(`DELETE FROM rate_limit_counters`);

  const badEmail = await post(body(1, { language: "fr", email: "pas-un-courriel" }));
  check("a French form mistake is answered in French, with the same stable code", badEmail.status === 400 && badEmail.data.code === "invalid_email" && /adresse courriel/.test(badEmail.data.error), badEmail.data.error);
  const badEmailEn = await post(body(1, { language: "en", email: "not-an-email" }));
  check("the same mistake in English is answered in English exactly as before", badEmailEn.data.code === "invalid_email" && badEmailEn.data.error === "Please enter a valid email address.", badEmailEn.data.error);
  const noLang = await post(body(1, { email: "not-an-email" }));
  check("no language at all (an older form, a script) is English", noLang.data.error === "Please enter a valid email address.");
  const badPhone = await post(body(1, { language: "fr", primaryPhone: "123" }));
  check("a bad phone number, in French", badPhone.data.code === "invalid_phone" && /indicatif régional/.test(badPhone.data.error));
  const nonsense = await post(body(1, { language: "fr", weeks: ["2099-01-04"] }));
  check("an unknown week, in French", nonsense.data.code === "invalid_weeks" && /semaines de camp valides/.test(nonsense.data.error));

  const ok = await post(body(2, { language: "fr" }));
  check("a French registration is accepted and sends the family to their FRENCH page", ok.status === 200 && ok.data.success && ok.data.statusPath.startsWith("/fr/inscription-camp/"), ok.data.statusPath);
  const regId = registrationIdFromToken(ok.data.statusPath.split("/").pop());
  const stored = (await pool.query(`SELECT language FROM registrations WHERE id = $1`, [regId])).rows[0];
  check("the family's language is saved with the registration", stored?.language === "fr");
  const okEn = await post(body(3, { language: "en" }));
  check("an English registration goes to the English page and is saved as English", okEn.data.statusPath.startsWith("/camp-registration/")
    && (await pool.query(`SELECT language FROM registrations WHERE id = $1`, [registrationIdFromToken(okEn.data.statusPath.split("/").pop())])).rows[0].language === "en");
  const odd = await post(body(4, { language: "de" }));
  check("an unknown language is stored as English", odd.data.statusPath.startsWith("/camp-registration/")
    && (await pool.query(`SELECT language FROM registrations WHERE id = $1`, [registrationIdFromToken(odd.data.statusPath.split("/").pop())])).rows[0].language === "en");
  const replay = await post({ ...body(2, { language: "fr" }), idempotencyKey: (await pool.query(`SELECT idempotency_key FROM registrations WHERE id = $1`, [regId])).rows[0].idempotency_key, email: "chantal+2@example.test" });
  check("a retried French submission returns the same reservation, still at the French address", replay.status === 200 && replay.data.statusPath.startsWith("/fr/inscription-camp/") && registrationIdFromToken(replay.data.statusPath.split("/").pop()) === regId);

  const again = await post({ ...body(2, { language: "fr" }), email: "chantal+2@example.test", primaryPhone: "514-555-0112" });
  check("registering the same child for the same week again is refused politely, in French, naming the week in French",
    again.status === 409 && again.data.code === "already_registered" && /Nous avons déjà une réservation/.test(again.data.error) && again.data.error.includes("21, 22, 23 et 25 juin"), again.data.error);

  await h.fill(W2, 30, "frfill");
  const full = await post(body(5, { language: "fr", weeks: [W2] }));
  check("a full week is reported in French with its French label", full.status === 409 && full.data.code === "weeks_full" && /viennent d’être comblées/.test(full.data.error) && full.data.error.includes("5, 6, 7 et 8 juillet"), full.data.error);
  const fullEn = await post(body(5, { language: "en", weeks: [W2] }));
  check("and in English it is unchanged", fullEn.data.error.includes("These weeks just filled up") && fullEn.data.error.includes("July 5, 6, 7 & 8"), fullEn.data.error);
  await resetAll();
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Every email to a family is in that family's language ===");
{
  await resetAll();
  const sent = [];
  const send = async (message) => { sent.push(message); };
  const run = (extra = {}) => outbox.processOutbox({ origin: ORIGIN, send, adminEmails: ADMINS, coachMode: "off", ...extra });
  const latest = (to) => [...sent].reverse().find((m) => m.to === to);

  const frId = await reserveOk("fr-family", { email: "famille@example.test", language: "fr", parentName: "Chantal Côté", weekIds: [W1], children: [{ fullName: "Émilie <b>Côté</b>", dateOfBirth: "2017-04-04", age: "10", healthInfo: "Aucun" }] });
  const enId = await reserveOk("en-family", { email: "family@example.test", language: "en", parentName: "Chantal Smith", weekIds: [W1] });
  await run();
  const due = (await pool.query(`SELECT reference_code, amount_due_cents FROM registrations WHERE id = $1`, [frId])).rows[0];
  const frMail = latest("famille@example.test");
  const enMail = latest("family@example.test");

  check("the French family got payment instructions, with a French subject (and « d’Émilie » elided)", /^Envoyez votre paiement pour garder la place d’Émilie /.test(frMail.subject) && frMail.subject.includes(due.reference_code), frMail.subject);
  check("the English family's subject is exactly what it always was", /^Send your payment to hold .*'s camp spot \(GD-/.test(enMail.subject), enMail.subject);
  check("the French email says it is French (html lang=\"fr-CA\") and the English one does not", frMail.html.includes('<html lang="fr-CA">') && enMail.html.includes('<html lang="en">'));
  check("the French email greets the parent in French and in the first person plural", /Bonjour Chantal, nous gardons une place pour/.test(frMail.text) && /Hi Chantal, we're holding a spot/.test(enMail.text));
  check("amounts and the deadline are written the French way", frMail.text.includes(`${(due.amount_due_cents / 100).toFixed(2).replace(".", ",")}${NBSP}$`) && /jusqu’au \w+\./.test(frMail.text) && frMail.text.includes("(heure de Montréal)"), frMail.text.split("\n").slice(0, 8).join(" | "));
  check("the week is named in French", frMail.text.includes("21, 22, 23 et 25 juin") && !frMail.text.includes("June 21"));
  check("the payment steps are in French: virement Interac, the reference, the report button", /virement Interac/.test(frMail.text) && /J’ai envoyé mon paiement/.test(frMail.text) && !/e-Transfer/.test(frMail.text));
  check("the private link points at the FRENCH reservation page", /https:\/\/camp\.example\.test\/fr\/inscription-camp\/[\w.-]+/.test(frMail.text) && /https:\/\/camp\.example\.test\/camp-registration\/[\w.-]+/.test(enMail.text) && !enMail.text.includes("/fr/"));
  check("a child's name is escaped in the French HTML too (no markup from a form can get in)", !frMail.html.includes("<b>Côté</b>") && frMail.html.includes("&lt;b&gt;Côté&lt;/b&gt;"));
  check("no French email contains a stray English sentence", !/\b(Your spot|Send your|Please|payment|reference)\b/.test(frMail.text) && !/\b(Votre place|Envoyez|virement)\b/.test(enMail.text));
  check("both emails are sent from the same templates, so both carry the business contact line", frMail.html.includes("514-816-3454") && enMail.html.includes("514-816-3454"));

  // The reminder (time is passed in, as the outbox suite does).
  const created = new Date((await pool.query(`SELECT created_at FROM registrations WHERE id = $1`, [frId])).rows[0].created_at).getTime();
  const at = (hours) => new Date(created + hours * 3_600_000);
  const queued = await outbox.enqueueDueReminders(at(9.05));
  await run({ now: at(9.1) });
  const frReminder = latest("famille@example.test");
  const enReminder = latest("family@example.test");
  check("the reminders are queued for both families", queued === 2, String(queued));
  check("the French reminder is French and leads with « Rappel »", /^Rappel\u00a0: la place d/.test(frReminder.subject) && /Vous avez déjà envoyé votre virement Interac\?/.test(frReminder.text) && /Vous ne l’avez pas encore envoyé\?/.test(frReminder.text), frReminder.subject);
  check("the English reminder is unchanged", /^Reminder: .*'s camp spot is held until /.test(enReminder.subject) && /ALREADY SENT|Already sent your e-Transfer\?/i.test(enReminder.text));
  check("the reminder's button is the same words the page uses", frReminder.html.includes("J’ai envoyé mon paiement") && enReminder.html.includes("I’ve Sent My Payment"));

  // The release notice.
  await expireHold(frId);
  await expireHold(enId);
  await campDb.releaseExpiredReservations();
  await run();
  const frRelease = latest("famille@example.test");
  const enRelease = latest("family@example.test");
  check("the release notice is French for the French family", /a été libérée/.test(frRelease.subject) && /Votre réservation a été libérée/.test(frRelease.text) && /sinon nous vous rembourserons/.test(frRelease.text), frRelease.subject);
  check("and English for the English family, unchanged", /was released/.test(enRelease.subject) && /Your reservation was released/.test(enRelease.text));
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. The confirmation email, in both languages ===");
{
  await resetAll();
  const sent = [];
  const send = async (message) => { sent.push(message); };
  const run = () => outbox.processOutbox({ origin: ORIGIN, send, adminEmails: ADMINS, coachMode: "off" });
  const frId = await reserveOk("fr-conf", { email: "conf-fr@example.test", language: "fr", parentName: "Chantal Côté", weekIds: [W1, W2], children: [{ fullName: "Émilie Côté", dateOfBirth: "2017-04-04", age: "10", healthInfo: "Aucun" }, { fullName: "Léo Côté", dateOfBirth: "2019-02-02", age: "8", healthInfo: "Aucun" }] });
  const enId = await reserveOk("en-conf", { email: "conf-en@example.test", language: "en", weekIds: [W1] });
  await run();
  check("setup: confirm both payments", (await confirmFor(frId)).ok && (await confirmFor(enId)).ok);
  await run();
  const fr = sent.find((m) => m.to === "conf-fr@example.test" && /confirmé/.test(m.subject));
  const en = sent.find((m) => m.to === "conf-en@example.test" && /You're confirmed/.test(m.subject));
  check("the French confirmation exists, with a French subject", Boolean(fr) && /^C’est confirmé! La place d’Émilie Côté, Léo Côté au camp junior/.test(fr.subject), fr?.subject);
  check("it is French all the way down: heading, labels, tax names, drop-off, what to bring", fr && /Merci — tout est en ordre!/.test(fr.html) && /Numéro de confirmation/.test(fr.html) && /TPS \(5/.test(fr.html) && /TVQ \(9,975/.test(fr.html)
    && /Arrivée/.test(fr.html) && /Quoi apporter/.test(fr.html) && /crème solaire/.test(fr.html) && /Sécurité et responsabilité/.test(fr.html));
  check("it lists both confirmed weeks in French, in calendar order, and explains the holiday week", fr && fr.text.indexOf("21, 22, 23 et 25 juin") < fr.text.indexOf("5, 6, 7 et 8 juillet") && fr.text.includes("Fête nationale du Québec") && fr.text.includes("jeudi 24 juin"));
  check("the plural is right for two children and two weeks (« les places … sont confirmées »)", fr && /les places d’Émilie Côté, Léo Côté sont confirmées/.test(fr.text.replace(/\s+/g, " ")));
  check("its numbers are French: sub-total, taxes and total in « 123,45 $ » form", fr && new RegExp(`\\d+,\\d\\d${NBSP}\\$`).test(fr.text) && !/\$\d+\.\d\d/.test(fr.text));
  check("the English confirmation is unchanged (heading, tax names, dollars)", en && /Thank you — you(&#39;|')re all set!/.test(en.html) && /GST \(5%\)/.test(en.html) && /\$\d+\.\d\d/.test(en.text) && /DROP-OFF/.test(en.text));
  check("the English one carries the holiday note too (June 24 is in that week)", en && en.text.includes("Fête nationale du Québec (a holiday)"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Cancellation notices: one per cancellation, in the family's language, never showing the owner's note ===");
{
  await resetAll();
  const sent = [];
  const send = async (message) => { sent.push(message); };
  const run = () => outbox.processOutbox({ origin: ORIGIN, send, adminEmails: ADMINS, coachMode: "off" });
  const notices = () => sent.filter((m) => /annulée|cancelled|trouvé votre paiement|could not find/i.test(m.subject));

  const paidFr = await reserveOk("cn-paid-fr", { email: "cn1@example.test", language: "fr", weekIds: [W1] });
  const unpaidEn = await reserveOk("cn-unpaid-en", { email: "cn2@example.test", language: "en", weekIds: [W2] });
  const reportedFr = await reserveOk("cn-reported-fr", { email: "cn3@example.test", language: "fr", weekIds: [W2] });
  const quiet = await reserveOk("cn-quiet", { email: "cn4@example.test", language: "en", weekIds: [W1] });
  await run();
  await confirmFor(paidFr);
  await campDb.reportPayment(reportedFr);
  sent.length = 0;

  const SECRET = "internal note: parent was rude on the phone";
  const a = await campDb.cancelRegistration(paidFr, SECRET, { releaseReason: "owner_cancelled", notifyParent: true });
  const b = await campDb.cancelRegistration(unpaidEn, SECRET, { releaseReason: "owner_cancelled", notifyParent: true });
  const c = await campDb.cancelRegistration(reportedFr, SECRET, { releaseReason: "not_received", notifyParent: true });
  const d = await campDb.cancelRegistration(quiet, "spoke by phone", { releaseReason: "owner_cancelled" });
  check("four registrations cancelled; three asked for a notice, one did not", a.ok && b.ok && c.ok && d.ok);
  const queuedKinds = (await pool.query(`SELECT registration_id FROM email_outbox WHERE kind = 'parent_cancellation'`)).rows.map((r) => r.registration_id).sort();
  check("exactly three notices were queued (not for the one cancelled without one)", queuedKinds.length === 3 && !queuedKinds.includes(quiet), String(queuedKinds.length));
  await run();
  const out = notices();
  check("exactly three notices were sent", out.length === 3, out.map((m) => m.subject).join(" | "));
  const m1 = out.find((m) => m.to === "cn1@example.test");
  const m2 = out.find((m) => m.to === "cn2@example.test");
  const m3 = out.find((m) => m.to === "cn3@example.test");
  check("a PAID registration cancelled by the owner: French notice that mentions a possible refund", m1 && /^Votre inscription au camp pour .* a été annulée/.test(m1.subject) && /Si un remboursement est dû/.test(m1.text) && /21, 22, 23 et 25 juin/.test(m1.text), m1?.subject);
  check("an UNPAID registration cancelled by the owner: English notice that says no payment was confirmed", m2 && /^Your camp registration for .* was cancelled/.test(m2.subject) && /No payment had been confirmed/.test(m2.text) && /July 5, 6, 7 & 8/.test(m2.text), m2?.subject);
  check("a payment that could not be found: a French notice that says the money is not lost", m3 && /Nous n’avons pas trouvé votre paiement/.test(m3.subject) && /votre argent n’est pas perdu/.test(m3.text), m3?.subject);
  check("no notice ever contains the owner's private note", out.every((m) => !m.text.includes("rude") && !m.html.includes("rude")));
  check("each notice is in the right language (French html lang for French, English for English)", m1.html.includes('lang="fr-CA"') && m3.html.includes('lang="fr-CA"') && m2.html.includes('<html lang="en">'));
  check("the audit log records whether the family was told", (await h.auditFor(paidFr)).some((e) => e.action === "cancel_registration" && e.details.parentNotified === true) && (await h.auditFor(quiet)).some((e) => e.action === "cancel_registration" && e.details.parentNotified === false));

  // Reinstated before the notice goes out: the family must not be told it was cancelled.
  const fastId = await reserveOk("cn-fast", { email: "cn5@example.test", language: "en", weekIds: [W1] });
  await campDb.cancelRegistration(fastId, "oops", { releaseReason: "owner_cancelled", notifyParent: true });
  const re = await campDb.reinstateRegistration(fastId);
  sent.length = 0;
  const summary = await run();
  check("reinstated before the notice was sent: it is skipped, so the family is never told something untrue", re.ok && notices().filter((m) => m.to === "cn5@example.test").length === 0 && summary.skipped >= 1);

  // Cancelled twice (reinstated in between) is two events, and two notices.
  const twiceId = await reserveOk("cn-twice", { email: "cn6@example.test", language: "en", weekIds: [W2] });
  await campDb.cancelRegistration(twiceId, "first", { releaseReason: "owner_cancelled", notifyParent: true });
  await run();
  await campDb.reinstateRegistration(twiceId);
  await campDb.cancelRegistration(twiceId, "second", { releaseReason: "owner_cancelled", notifyParent: true });
  await run();
  check("cancel, reinstate, cancel again: the family is told both times", notices().filter((m) => m.to === "cn6@example.test").length === 2);

  // A repeated cancel is a no-op and queues nothing.
  const before = (await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE kind = 'parent_cancellation'`)).rows[0].n;
  await campDb.cancelRegistration(twiceId, "again", { releaseReason: "owner_cancelled", notifyParent: true });
  check("cancelling something already cancelled changes nothing and queues nothing", (await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE kind = 'parent_cancellation'`)).rows[0].n === before);
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. The owner's own emails stay English but say which language the family uses ===");
{
  await resetAll();
  const frId = await reserveOk("admin-fr", { email: "admin-fr@example.test", language: "fr", weekIds: [W1] });
  const enId = await reserveOk("admin-en", { email: "admin-en@example.test", language: "en", weekIds: [W1] });
  const frReg = await campDb.getRegistrationSnapshot(frId);
  const enReg = await campDb.getRegistrationSnapshot(enId);
  const coach = templates.buildCoachNotificationEmail(frReg, `${ORIGIN}/admin/camp-rosters`);
  check("the new-registration email to the owner is English and names the family's language", /^New camp registration/.test(coach.subject) && /Language: Français \(reply in French\)/.test(coach.text) && /Language: English/.test(templates.buildCoachNotificationEmail(enReg, ORIGIN).text));
  const digest = templates.buildCoachDigestEmail([frReg, enReg], { dashboardUrl: ORIGIN, omitted: 0 });
  check("the digest marks French families so the owner knows to reply in French", digest.text.includes("[Français]") && digest.text.split("[Français]").length === 2);
  check("the registration read back carries the language", frReg.language === "fr" && enReg.language === "en");
  const queue = await campDb.getPaymentQueue();
  check("the review queue carries it too", [...queue.awaiting, ...queue.reported, ...queue.released].find((q) => q.id === frId)?.language === "fr");
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. The legal-review document is exactly what the dictionaries say ===");
{
  check("docs/QUEBEC_LEGAL_REVIEW.md is up to date (run: npm run legal:write)", readFileSync("docs/QUEBEC_LEGAL_REVIEW.md", "utf8") === renderLegalDoc());
  check("review items have unique ids", new Set(LEGAL_REVIEW.map((i) => i.id)).size === LEGAL_REVIEW.length);
  const lookup = (m, key) => key.split(".").reduce((n, p) => (n == null ? undefined : n[p]), m);
  const unresolved = LEGAL_REVIEW.flatMap((i) => i.keys.filter((k) => lookup(en, k) === undefined || lookup(fr, k) === undefined).map((k) => `${i.id}:${k}`));
  check("every key it points at exists in both languages", unresolved.length === 0, unresolved.join(", "));
  check("every item says why, what to ask and what the draft does", LEGAL_REVIEW.every((i) => i.why.length > 20 && i.ask.length > 10 && i.draft.length > 10));
  check("the document says plainly that it is not legal advice and that the French is unreviewed", /not legal advice/i.test(readFileSync("docs/QUEBEC_LEGAL_REVIEW.md", "utf8")) && /not\*\* been read by a Quebec translator/.test(readFileSync("docs/QUEBEC_LEGAL_REVIEW.md", "utf8")));
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("i18n"));
