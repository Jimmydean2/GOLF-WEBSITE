// Launch preparation, tested the way a family and the owner meet the site: over HTTP, against the
// real production build.
//   * the English and French camp pages, the privacy notice in both languages, the language switch
//   * a French family registering, reaching their French page, reporting payment, getting French email
//   * the owner's privacy tools (copy of a family's data, erase, season clean-up) and the cancellation
//     notice, behind the login and the recent-password check

import { createTestDatabase } from "./helpers/testdb.mjs";
import { startApp, adminSession } from "./helpers/app.mjs";
import { startSmtpSink } from "../../scripts/lib/smtpSink.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const sink = await startSmtpSink();
const app = await startApp({
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    SMTP_HOST: sink.host,
    SMTP_PORT: String(sink.port),
    SMTP_INSECURE: "true",
    EMAIL_FROM: "camp@example.test",
    COACH_NOTICE_MODE: "off",
  },
});
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, check } = h;

let ip = 0;
const nextIp = () => `203.0.113.${(++ip % 250) + 1}`;
const get = (path, headers = {}) => fetch(`${app.url}${path}`, { redirect: "manual", headers: { "x-forwarded-for": nextIp(), ...headers } });
const post = (path, body, headers = {}) =>
  fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const cron = () => fetch(`${app.url}/api/cron/payment-review`, { headers: { authorization: "Bearer test-only-cron-secret-0123456789" } });

// ---------------------------------------------------------------------------
console.log("=== 1. The camp pages, in English and in French ===");
{
  const en = await get("/junior-camps");
  const enHtml = await en.text();
  check("the English camp page is English: <html lang=\"en\">, 2027, the 2027 week labels", en.status === 200 && /<html lang="en"/.test(enHtml) && /Summer Day Camps[^<]*2027/.test(enHtml.replace(/<!-- -->/g, "")) && enHtml.includes("June 21, 22, 23 &amp; 25"), `${en.status}`);
  check("it offers the French page (the language switch points at /fr/camps-juniors)", /href="\/fr\/camps-juniors"[^>]*lang="fr"|lang="fr"[^>]*href="\/fr\/camps-juniors"/.test(enHtml));
  check("it links to the privacy notice", enHtml.includes('href="/privacy"'));
  check("search engines are told the pages are twins (hreflang)", /rel="alternate"[^>]*hrefLang="fr-CA"[^>]*\/fr\/camps-juniors|hrefLang="fr-CA"[^>]*href="[^"]*\/fr\/camps-juniors"/i.test(enHtml));

  const fr = await get("/fr/camps-juniors");
  const frHtml = await fr.text();
  const frText = frHtml.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/\s+/g, " ");
  check("the French camp page declares French Canada: <html lang=\"fr-CA\">", fr.status === 200 && /<html lang="fr-CA"/.test(frHtml), `${fr.status}`);
  check("it is French: title, headings, week labels, the Fête nationale week explained", /Camps juniors/.test(frText) && /Inscrire votre enfant/.test(frText) && /21, 22, 23 et 25 juin/.test(frText) && /28, 29, 30 juin et 2 juillet/.test(frText) && /Fête nationale du Québec/.test(frText));
  check("no English interface text is left on it", !/Register Your Child|Parent\/Guardian|Select as many weeks|Method of Payment|Register Now|June 21, 22/.test(frText), frText.match(/Register Your Child|Parent\/Guardian|Select as many weeks|Method of Payment|Register Now|June 21, 22/)?.[0]);
  check("it offers the way back to English", /href="\/junior-camps"[^>]*lang="en"|lang="en"[^>]*href="\/junior-camps"/.test(frHtml));
  const hrefs = [...frHtml.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const englishOnly = hrefs.filter((href) => ["/about", "/lessons", "/clinics", "/book", "/contact", "/junior-programs"].some((p) => href === p || href.startsWith(`${p}/`)));
  check("the French pages do not send a French-speaking parent into English-only pages", englishOnly.length === 0, englishOnly.join(", "));
  check("and its privacy link is the French notice", hrefs.includes("/fr/confidentialite"));

  const fr2 = await get("/fr");
  check("/fr on its own goes to the French camp page", [307, 308].includes(fr2.status) && /\/fr\/camps-juniors$/.test(fr2.headers.get("location") ?? ""), `${fr2.status} ${fr2.headers.get("location")}`);
  const nope = await get("/fr/inconnu");
  check("an unknown French address is a plain 404", nope.status === 404);

  const frPriv = await (await get("/fr/confidentialite")).text();
  const enPriv = await (await get("/privacy")).text();
  const plain = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("the French privacy notice is French, in a French page, with the retention period and the Commission", /<html lang="fr-CA"/.test(frPriv) && /Avis de confidentialité/.test(plain(frPriv)) && /90 jours/.test(plain(frPriv)) && /Commission d’accès à l’information/.test(plain(frPriv)));
  check("the English privacy notice is English, with the same promises", /<html lang="en"/.test(enPriv) && /Privacy notice/.test(plain(enPriv)) && /90 days/.test(plain(enPriv)) && /six years|6 years/.test(plain(enPriv)));
  check("an unreviewed notice says DRAFT on this rehearsal site, in both languages", /DRAFT/.test(plain(enPriv)) && /ÉBAUCHE/.test(plain(frPriv)));
  check("the notice names the providers and says nothing is sold", /Vercel/.test(plain(enPriv)) && /Neon/.test(plain(enPriv)) && /Google/.test(plain(enPriv)) && /do not sell your information/.test(plain(enPriv)));
  const home = await (await get("/")).text();
  check("the rest of the site is still English", /<html lang="en"/.test(home));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. A French-speaking family, from the form to the email ===");
const FAMILY = {
  idempotencyKey: `launch-fr-${Math.random().toString(36).slice(2, 12)}`,
  language: "fr",
  parentName: "Chantal Côté",
  email: "chantal.cote@example.test",
  primaryPhone: "438-555-0188",
  secondaryPhone: "",
  emergencyName: "Mireille Tremblay",
  emergencyRelationship: "Tante",
  emergencyPhone: "438-555-0199",
  weeks: ["2027-06-21"],
  children: [{ fullName: "Émilie Côté", dateOfBirth: "2016-04-04", age: "10", healthInfo: "Allergie aux arachides (EpiPen)" }],
  codeOfConductAccepted: true,
  consentAccepted: true,
  healthConsentAccepted: true,
};
let reg;
{
  const noHealth = await post("/api/camp-registration", { ...FAMILY, healthConsentAccepted: false });
  const noHealthBody = await noHealth.json();
  check("without the second consent the French form is refused in French", noHealth.status === 400 && noHealthBody.code === "consent_required" && /deux consentements/.test(noHealthBody.error), noHealthBody.error);

  const res = await post("/api/camp-registration", FAMILY);
  reg = await res.json();
  check("the registration is accepted and points at the French reservation page", res.status === 200 && reg.success && reg.statusPath.startsWith("/fr/inscription-camp/"), reg.statusPath);

  const page = await get(reg.statusPath);
  const html = await page.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/\s+/g, " ");
  check("the family's page is French and says so", page.status === 200 && /<html lang="fr-CA"/.test(html) && /Envoyez votre paiement/.test(text) && /J’ai envoyé mon paiement/.test(html) && /heure de Montréal/.test(text), `${page.status}`);
  check("amounts are written the French way (123,45 $) and the week in French", /\d+,\d\d.\$/.test(text) && text.includes("21, 22, 23 et 25 juin") && text.includes(reg.reference));
  check("it shows the masked email and never the health note, date of birth or emergency contact", text.includes("c***@example.test") && !text.includes("arachides") && !text.includes("2016-04-04") && !text.includes("Mireille") && !text.includes("438-555-0199"));
  const hdr = Object.fromEntries(page.headers);
  check("the French private page may not be stored, framed or leaked through the referrer, and is not indexed",
    /no-store/.test(hdr["cache-control"] ?? "") && hdr["x-frame-options"] === "DENY" && hdr["referrer-policy"] === "no-referrer" && /noindex/i.test(html), JSON.stringify({ c: hdr["cache-control"], f: hdr["x-frame-options"] }));
  const token = reg.statusPath.split("/").pop();
  const sameInEnglish = await get(`/camp-registration/${token}`);
  check("the same private link also opens in English (the twin page)", sameInEnglish.status === 200 && /Send your payment/.test(await sameInEnglish.text()));
  const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  check("an altered link opens nothing on the French address either", (await get(`/fr/inscription-camp/${flipped}`)).status === 404 && (await get("/fr/inscription-camp/n-importe-quoi")).status === 404);

  const bad = await post("/api/camp-registration/report", { token: flipped, language: "fr" });
  const badBody = await bad.json();
  check("reporting with an altered link is refused in French", bad.status === 404 && badBody.error === "Ce lien n’est pas valide.", badBody.error);
  const ok = await post("/api/camp-registration/report", { token, language: "fr" });
  check("reporting the payment works", ok.status === 200 && (await ok.json()).success === true);
  const after = await (await get(reg.statusPath)).text();
  check("the page then thanks the family in French", /Merci — nous vérifions votre paiement/.test(after.replace(/<!-- -->/g, "")), "");
  const row = (await pool.query(`SELECT status, language, consent_version, health_consent_accepted FROM registrations WHERE reference_code = $1`, [reg.reference])).rows[0];
  check("the database holds French, the reported status, and the consent record", row.language === "fr" && row.status === "payment_reported" && row.health_consent_accepted === true && Boolean(row.consent_version));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The emails ===");
{
  await cron();
  const toFamily = sink.to(FAMILY.email);
  const instructions = toFamily.find((m) => /Envoyez votre paiement/.test(m.subject));
  check("the family received payment instructions in French", Boolean(instructions) && instructions.html.includes('lang="fr-CA"') && /virement Interac/.test(instructions.text), toFamily.map((m) => m.subject).join(" | "));
  const link = instructions?.text.match(/https?:\/\/[^\s]+\/fr\/inscription-camp\/[\w.-]+/)?.[0];
  check("its link is the French reservation page, and it opens", Boolean(link) && (await fetch(link.replace(/^https?:\/\/[^/]+/, app.url))).status === 200, link);
  const all = sink.messages.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join("\n");
  check("no email contains the child's health note, date of birth or the emergency contact", !all.includes("arachides") && !all.includes("2016-04-04") && !all.includes("Mireille") && !all.includes("438-555-0199"));
  const alert = sink.messages.find((m) => /Payment reported/i.test(m.subject));
  check("the owner's alert about the payment is English", Boolean(alert) && /A parent says they have sent an e-Transfer/.test(alert.text));
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The owner's privacy tools: behind the login, the recent password, and the reference typed back ===");
{
  const id = reg.statusPath.split("/").pop().split(".")[0];
  const urls = [
    ["POST", `/api/admin/camp-registrations/${id}/export`],
    ["POST", `/api/admin/camp-registrations/${id}/erase`],
    ["GET", "/api/admin/retention"],
    ["POST", "/api/admin/retention"],
  ];
  let allRefused = true;
  for (const [method, path] of urls) {
    const r = await fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: method === "GET" ? undefined : "{}" });
    if (r.status !== 401) allRefused = false;
  }
  check("without a login, every privacy URL answers 401", allRefused);

  const session = await adminSession(app);
  const hdrs = { cookie: session.cookie, origin: app.url, "content-type": "application/json", "x-forwarded-for": nextIp() };
  const call = (method, path, body) => fetch(`${app.url}${path}`, { method, headers: hdrs, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });

  await pool.query(`UPDATE admin_sessions SET last_auth_at = now() - interval '20 minutes'`);
  const stale = await call("POST", `/api/admin/camp-registrations/${id}/export`);
  check("20 minutes after the last password check, exporting a family's data needs the password again", stale.status === 403 && (await stale.json()).code === "reauth_required");
  const staleErase = await call("POST", `/api/admin/camp-registrations/${id}/erase`, { confirmReference: reg.reference });
  check("and so does erasing", staleErase.status === 403);
  const reauth = await call("POST", "/api/admin/reauth", { password: "Local-QA-Only-Admin-Passphrase-2026" });
  check("the password check works", reauth.status === 200);

  const exp = await call("POST", `/api/admin/camp-registrations/${id}/export`);
  const expBody = await exp.json();
  check("the export returns everything held about that one family", exp.status === 200 && expBody.data.registration.parentName === "Chantal Côté" && expBody.data.children[0].healthInformation.includes("arachides") && expBody.data.consent.healthInformationConsent === true);
  check("the download is recorded in the audit log", (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'export_family_data' AND target_id = $1`, [id])).rows[0].n === 1);

  const wrong = await call("POST", `/api/admin/camp-registrations/${id}/erase`, { confirmReference: "GD-WRONG1" });
  check("erasing with the wrong reference is refused and changes nothing", wrong.status === 400 && (await pool.query(`SELECT anonymized_at FROM registrations WHERE id = $1`, [id])).rows[0].anonymized_at === null);

  const ret = await call("GET", "/api/admin/retention");
  const retBody = await ret.json();
  check("the season clean-up reports who is due (nobody yet: the weeks are in 2027)", ret.status === 200 && retBody.retentionDays === 90 && retBody.due === 0);
  const noConfirm = await call("POST", "/api/admin/retention", { confirm: "yes" });
  check("the clean-up needs the words CLEAN UP typed", noConfirm.status === 400);
  const run = await call("POST", "/api/admin/retention", { confirm: "CLEAN UP" });
  check("and with them it runs (and finds nothing to do today)", run.status === 200 && (await run.json()).anonymized === 0);

  // Cancel with and without telling the family.
  const loud = await post("/api/camp-registration", { ...FAMILY, idempotencyKey: `launch-fr-2-${Math.random().toString(36).slice(2, 10)}`, email: "famille2@example.test", primaryPhone: "438-555-0144", weeks: ["2027-07-05"], children: [{ fullName: "Léo Gagnon", dateOfBirth: "2018-02-02", age: "8", healthInfo: "Aucun" }] });
  const loudReg = await loud.json();
  const loudId = loudReg.statusPath.split("/").pop().split(".")[0];
  sink.messages.length = 0;
  const cancel = await call("POST", `/api/admin/camp-registrations/${loudId}/cancel`, { reason: "parent asked by phone" });
  check("the owner cancels a registration (the default tells the family)", cancel.status === 200 && (await cancel.json()).success === true);
  await cron();
  const notice = sink.to("famille2@example.test").find((m) => /annulée/.test(m.subject));
  check("the family gets the cancellation notice in French, without the owner's note", Boolean(notice) && /Cette réservation a été annulée/.test(notice.text) && !/phone|asked by/.test(notice.text + notice.html), sink.messages.map((m) => m.subject).join(" | "));

  const quiet = await post("/api/camp-registration", { ...FAMILY, idempotencyKey: `launch-fr-3-${Math.random().toString(36).slice(2, 10)}`, email: "famille3@example.test", primaryPhone: "438-555-0155", weeks: ["2027-07-12"], children: [{ fullName: "Zoé Pelletier", dateOfBirth: "2018-03-03", age: "8", healthInfo: "Aucun" }] });
  const quietId = (await quiet.json()).statusPath.split("/").pop().split(".")[0];
  sink.messages.length = 0;
  await call("POST", `/api/admin/camp-registrations/${quietId}/cancel`, { reason: "spoke by phone", notifyParent: false });
  await cron();
  check("with the tick box off, nothing is sent", sink.to("famille3@example.test").filter((m) => /annul/.test(m.subject)).length === 0);

  // Erase the first family, as the dashboard would.
  const erase = await call("POST", `/api/admin/camp-registrations/${id}/erase`, { confirmReference: reg.reference.toLowerCase(), removePayerName: false });
  const eraseBody = await erase.json();
  check("with the reference typed back, the family is erased and its place released", erase.status === 200 && eraseBody.success && eraseBody.releasedWeekIds.length === 1, JSON.stringify(eraseBody));
  const page = await (await get(reg.statusPath)).text();
  check("their private page no longer shows the child, and says the reservation is not active", !page.includes("Émilie") && /n’est plus active/.test(page.replace(/<!-- -->/g, "")));
  const queue = await (await call("GET", "/api/admin/payment-queue")).text();
  check("nothing of the erased family is on the dashboard", !queue.includes("Émilie") && !queue.includes("arachides") && !queue.includes("438-555-0188"));
}

await sink.stop?.();
await app.stop();
await pool.end();
await testDb.drop();
process.exit(h.finish("launch-http"));
