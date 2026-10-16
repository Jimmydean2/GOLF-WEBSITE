#!/usr/bin/env node
// Safety drills for a REHEARSAL (staging) copy of the site, run through its public registration
// form's own API and the administrator's own screens' API, so what is tested is the real thing:
// the real hosting, the real database, the real mail account.
//
//   ADMIN_PASSWORD=... node scripts/staging-verify.mjs --base-url https://your-rehearsal-site \
//        --email-base you@gmail.com --confirm-rehearsal
//
// It checks, in this order:
//   1. DUPLICATES      the same submission sent again, and 6 times at the very same moment, makes ONE
//                      reservation and holds the places ONCE; a different submission for the same
//                      child and week is refused ("already registered").
//   2. FINAL SPOT      the week is set to have exactly one place left, then 8 different families
//                      register for it at the same moment: exactly one succeeds, nobody is
//                      half-registered, the week never goes over its limit. A family wanting two
//                      places when one is left is refused whole. The week is then put back.
//   3. EMAIL HEALTH    reads the dashboard's email status (emails waiting / failed).
//
//   --only duplicates,final-spot,email-health      run just some of them
//   --email-drill broken   after you have deliberately broken the mail password on the rehearsal
//                          site: registers one family and checks the parent still gets their
//                          answer while the email waits in the queue (nothing lost)
//   --email-drill fixed    after you restored the password: runs the check and requires every
//                          waiting email to go out
//
// SAFETY: needs --confirm-rehearsal; refuses a site whose camp week costs more than $5.00 (the
// rehearsal setup script, scripts/rehearsal-setup.sql, sets $1.00; the real price is $380); every
// name starts with TEST, phones are 514-555-01xx, emails are your own inbox with a +tag. The
// administrator password is read from the ADMIN_PASSWORD environment variable, never from the
// command line. Nothing is sent to real families, no payment is confirmed.

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const baseUrl = String(arg("--base-url", "")).replace(/\/+$/, "");
const emailBase = String(arg("--email-base", ""));
const confirmed = args.includes("--confirm-rehearsal");
const only = String(arg("--only", "duplicates,final-spot,email-health")).split(",").map((s) => s.trim());
const emailDrill = arg("--email-drill", null);
const weekArg = arg("--week", null);
const adminPassword = process.env.ADMIN_PASSWORD ?? "";

const stop = (message) => {
  console.error(`\n${message}\n`);
  process.exit(2);
};
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) stop("Give the rehearsal site's address: --base-url https://...");
if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(emailBase)) stop("Give YOUR email address (without a +tag): --email-base you@gmail.com");
if (!confirmed) stop(`About to run safety drills against ${baseUrl}. This is for a REHEARSAL site only. If that is what you want, run it again with --confirm-rehearsal.`);
if (!adminPassword) stop("Set the administrator password for the rehearsal site in the ADMIN_PASSWORD environment variable (not on the command line).");
if (emailDrill !== null && !["broken", "fixed"].includes(String(emailDrill))) stop("--email-drill is 'broken' or 'fixed'.");

const [local, domain] = emailBase.split("@");
let failures = 0;
const created = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
};
const run = Date.now().toString(36);
let familyCounter = 0;

async function getJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data, headers: response.headers };
}

const capacity = async () => (await getJson("/api/camp-capacity", { cache: "no-store" })).data;

function familyBody(tag, { weeks, children = 1, key } = {}) {
  const n = ++familyCounter;
  return {
    idempotencyKey: key ?? `verify-${run}-${tag}-${n}-${Math.random().toString(36).slice(2, 8)}`,
    parentName: `TEST Verify ${tag} ${n}`,
    email: `${local}+verify${run}${tag}${n}@${domain}`,
    primaryPhone: `514-555-01${String(n % 100).padStart(2, "0")}`,
    secondaryPhone: "",
    emergencyName: "TEST Emergency Contact",
    emergencyRelationship: "TEST",
    emergencyPhone: "514-555-0199",
    weeks,
    children: Array.from({ length: children }, (_, k) => ({
      fullName: `TEST Verify ${tag} ${n}${String.fromCharCode(97 + k)}`,
      dateOfBirth: "2016-06-15",
      age: "10",
      healthInfo: "TEST ONLY - no real child is involved",
    })),
    codeOfConductAccepted: true,
    consentAccepted: true,
    healthConsentAccepted: true,
    language: "en",
  };
}

const register = async (body) => {
  const r = await getJson("/api/camp-registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok && r.data.success) created.push(r.data.reference);
  return r;
};

// --- administrator session -------------------------------------------------------------------
let cookie = "";
async function adminLogin() {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ password: adminPassword }),
  });
  if (!response.ok) stop(`Could not log in as the administrator (${response.status}). Check ADMIN_PASSWORD for that site.`);
  cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function admin(path, { method = "GET", body } = {}) {
  const send = () =>
    getJson(path, {
      method,
      headers: { "content-type": "application/json", origin: baseUrl, cookie },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  let r = await send();
  if (r.status === 403 && r.data.code === "reauth_required") {
    await getJson("/api/admin/reauth", { method: "POST", headers: { "content-type": "application/json", origin: baseUrl, cookie }, body: JSON.stringify({ password: adminPassword }) });
    r = await send();
  }
  return r;
}

// --- 0. is this really a rehearsal site? ----------------------------------------------------------
console.log(`Safety drills against ${baseUrl}\n`);
const cap0 = await capacity();
if (!cap0.configured) stop("That site's registration is not connected to a database yet.");
const weekIds = Object.keys(cap0.weeks).sort();
const openWeeks = weekIds.filter((id) => cap0.weeks[id].isOpen);
if (openWeeks.length === 0) stop("No camp week is open on that site.");
const weekId = weekArg ?? openWeeks[openWeeks.length - 1];
if (!cap0.weeks[weekId]) stop(`That site has no week "${weekId}". Weeks: ${weekIds.join(", ")}`);
if (cap0.weeks[weekId].priceCents > 500) {
  stop(
    `That site charges $${(cap0.weeks[weekId].priceCents / 100).toFixed(2)} for a week. A rehearsal site charges $1.00 (scripts/rehearsal-setup.sql). I will not run drills on what looks like the real site.`
  );
}
await adminLogin();
console.log(`Using week ${weekId}.\n`);

// --- 1. duplicates --------------------------------------------------------------------------------
if (emailDrill === null && only.includes("duplicates")) {
  console.log("=== 1. Duplicate requests ===");
  const before = (await capacity()).weeks[weekId].taken;
  const body = familyBody("dup", { weeks: [weekId] });
  const first = await register(body);
  check("a registration is accepted", first.ok && first.data.success === true, first.ok ? first.data.reference : `${first.status} ${first.data.error ?? ""}`);
  const again = await register(body);
  check("sending the identical submission again returns the SAME reservation", again.ok && again.data.reference === first.data.reference);
  const burst = await Promise.all(Array.from({ length: 6 }, () => register(body)));
  const refs = new Set(burst.filter((r) => r.ok).map((r) => r.data.reference));
  check("the same submission 6 times at the same moment: every answer names the same single reservation", refs.size === 1 && refs.has(first.data.reference), `${burst.filter((r) => r.ok).length} answered, ${refs.size} distinct reference(s)`);
  const after = (await capacity()).weeks[weekId].taken;
  check("the place is held ONCE (the week's count went up by exactly 1)", after - before === 1, `${before} -> ${after}`);
  const sameChild = { ...body, idempotencyKey: `verify-${run}-dup-other-${Math.random().toString(36).slice(2, 8)}` };
  const other = await register(sameChild);
  check("a different submission for the same child and week is refused as 'already registered'", other.status === 409 && other.data.code === "already_registered", `${other.status} ${other.data.code ?? ""}`);
  check("and holds nothing extra", (await capacity()).weeks[weekId].taken === after);
}

// --- 2. final spot --------------------------------------------------------------------------------
if (emailDrill === null && only.includes("final-spot")) {
  console.log("\n=== 2. The last place in a week, 8 families at the same moment ===");
  const taken = (await capacity()).weeks[weekId].taken;
  const originalMax = cap0.weeks[weekId].max;
  const limit = taken + 1;
  const setLimit = await admin(`/api/admin/camp-weeks/${weekId}`, { method: "PATCH", body: { maxCapacity: limit } });
  check(`the week is set to hold ${limit} (one place left)`, setLimit.ok, setLimit.ok ? "" : String(setLimit.data.error ?? setLimit.status));
  if (setLimit.ok) {
    const racers = Array.from({ length: 8 }, (_, i) => familyBody(`race${i}`, { weeks: [weekId] }));
    const results = await Promise.all(racers.map((b) => register(b)));
    const won = results.filter((r) => r.ok && r.data.success);
    const full = results.filter((r) => r.status === 409 && r.data.code === "weeks_full");
    check("exactly one family gets the last place", won.length === 1, `${won.length} succeeded`);
    check("the other seven are told the week is full (not an error)", full.length === 7, `${full.length} told it is full; statuses ${results.map((r) => r.status).join(",")}`);
    const weekNow = (await capacity()).weeks[weekId];
    check("the week is exactly at its limit, never over", weekNow.taken === limit && weekNow.remaining === 0 && weekNow.full === true, `taken ${weekNow.taken} of ${weekNow.max}`);
    const twoKids = await register(familyBody("two", { weeks: [weekId], children: 2 }));
    check("a family that needs two places is refused whole, nothing half-held", twoKids.status === 409 && (await capacity()).weeks[weekId].taken === limit, `${twoKids.status} ${twoKids.data.code ?? ""}`);
    const restore = await admin(`/api/admin/camp-weeks/${weekId}`, { method: "PATCH", body: { maxCapacity: originalMax } });
    check(`the week is put back to ${originalMax}`, restore.ok);
  }
}

// --- 3. email health ------------------------------------------------------------------------------
if (emailDrill === null && only.includes("email-health")) {
  console.log("\n=== 3. Email status on the dashboard ===");
  const run1 = await admin("/api/admin/run-check", { method: "POST", body: {} });
  check("the automatic check can be run on demand", run1.ok && run1.data.ok !== false, run1.ok ? "" : String(run1.data.error ?? run1.status));
  let health = (await admin("/api/admin/payment-queue")).data.health;
  for (let i = 0; i < 12 && health?.email?.waiting > 0; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    await admin("/api/admin/run-check", { method: "POST", body: {} });
    health = (await admin("/api/admin/payment-queue")).data.health;
  }
  check("mail is connected", health?.email?.configured === true);
  check("no email is left waiting or failed", health?.email?.waiting === 0 && health?.email?.failed === 0, `waiting ${health?.email?.waiting}, failed ${health?.email?.failed}, sent in the last 24 hours ${health?.email?.sentLast24h ?? "?"}`);
  console.log(`      Look in the inbox of ${emailBase}: you should have one instructions email per successful registration above (plus your own alerts).`);
}

// --- email drill ----------------------------------------------------------------------------------
if (emailDrill === "broken") {
  console.log("=== Email drill: mail is deliberately broken on the rehearsal site ===");
  const r = await register(familyBody("mailbroken", { weeks: [weekId] }));
  check("the parent still gets their reservation and reference (they are never told 'error')", r.ok && r.data.success === true, r.ok ? r.data.reference : `${r.status}`);
  await new Promise((res) => setTimeout(res, 4000));
  await admin("/api/admin/run-check", { method: "POST", body: {} });
  const health = (await admin("/api/admin/payment-queue")).data.health;
  check("the email is waiting in the queue, not lost", health?.email?.waiting >= 1 || health?.email?.failed >= 1, `waiting ${health?.email?.waiting}, failed ${health?.email?.failed}`);
  console.log("      Now restore the mail password, then run this again with: --email-drill fixed");
}
if (emailDrill === "fixed") {
  console.log("=== Email drill: mail has been repaired ===");
  let health = (await admin("/api/admin/payment-queue")).data.health;
  const start = health?.email?.waiting ?? 0;
  for (let i = 0; i < 24 && (health?.email?.waiting > 0); i++) {
    await admin("/api/admin/run-check", { method: "POST", body: {} });
    await new Promise((r) => setTimeout(r, 5000));
    health = (await admin("/api/admin/payment-queue")).data.health;
  }
  check(`all ${start} waiting email(s) went out`, health?.email?.waiting === 0, `waiting ${health?.email?.waiting}, failed ${health?.email?.failed}`);
  console.log(`      Look in the inbox of ${emailBase}: the instructions email for the 'mailbroken' family should now be there.`);
}

const uniqueCreated = [...new Set(created)];
console.log(`\n${uniqueCreated.length} TEST registration(s) created: ${uniqueCreated.join(", ") || "none"}.`);
console.log("Clear them with: psql \"$REHEARSAL_DATABASE_URL\" -v ON_ERROR_STOP=1 -f scripts/rehearsal-reset.sql");
console.log(failures === 0 ? "\nAll drills passed." : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
