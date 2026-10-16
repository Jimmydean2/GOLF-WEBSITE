#!/usr/bin/env node
// Creates a few CLEARLY FAKE registrations on a REHEARSAL copy of the site, through its public
// registration form's own API, so you can walk the whole journey (instructions email, paying a
// real $1-ish e-Transfer, tapping the button, confirming, the confirmation email) with data
// that belongs to no family.
//
//   node scripts/rehearsal-register.mjs --base-url https://your-rehearsal-site.vercel.app \
//        --email-base you@gmail.com --count 3 --confirm-rehearsal
//
// Every parent email is "you+rehearsal1@gmail.com", "you+rehearsal2@gmail.com", ...: Gmail
// delivers all of them to YOUR inbox. Names say TEST, phone numbers are the reserved 555-01xx
// range, and the health note says no real child is involved.
//
// SAFETY: this refuses to run without --confirm-rehearsal, never runs against a site whose
// address you did not type, and prints exactly what it is about to do first. Do NOT point it at
// the live site: use a separate Neon branch/database and a preview deployment (docs/LAUNCH_REHEARSAL.md).

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const baseUrl = String(arg("--base-url", "")).replace(/\/+$/, "");
const emailBase = String(arg("--email-base", ""));
const count = Math.min(Math.max(Number(arg("--count", 3)) || 3, 1), 10);
const weeksArg = String(arg("--weeks", "2027-07-05"));
const confirmed = args.includes("--confirm-rehearsal");

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) stop("Give the rehearsal site's address: --base-url https://...");
if (!/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(emailBase)) stop("Give YOUR email address (without a +tag): --email-base you@gmail.com");
if (!confirmed) {
  stop(
    `About to create ${count} fake registration(s) at ${baseUrl}, with parent emails ${emailBase.replace("@", "+rehearsalN@")}.\n` +
      "This is for a REHEARSAL site only (a separate database from the real one). If that is what you want, run it again with --confirm-rehearsal."
  );
}

const [local, domain] = emailBase.split("@");
console.log(`Creating ${count} test registration(s) at ${baseUrl}\n`);
for (let n = 1; n <= count; n++) {
  const body = {
    idempotencyKey: `rehearsal-${Date.now().toString(36)}-${n}-${Math.random().toString(36).slice(2, 8)}`,
    parentName: `TEST Parent ${n}`,
    email: `${local}+rehearsal${n}@${domain}`,
    primaryPhone: `514-555-01${String(n).padStart(2, "0")}`,
    secondaryPhone: "",
    emergencyName: "TEST Emergency Contact",
    emergencyRelationship: "TEST",
    emergencyPhone: "514-555-0199",
    weeks: weeksArg.split(",").map((w) => w.trim()).filter(Boolean),
    children: Array.from({ length: n === 2 ? 2 : 1 }, (_, k) => ({
      fullName: `TEST Child ${n}${String.fromCharCode(97 + k)}`,
      dateOfBirth: "2016-06-15",
      age: "10",
      healthInfo: "TEST ONLY - no real child is involved",
    })),
    codeOfConductAccepted: true,
    consentAccepted: true,
    healthConsentAccepted: true,
  };
  const response = await fetch(`${baseUrl}/api/camp-registration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.success) {
    console.log(`  #${n}  ${body.email}  ${body.children.length} child(ren)  reference ${data.reference}  amount due $${(data.amountDueCents / 100).toFixed(2)}`);
    console.log(`      private page: ${baseUrl}${data.statusPath}`);
  } else {
    console.log(`  #${n}  ${response.status} ${data.error ?? "failed"}`);
  }
}
console.log("\nNow check your inbox for the instructions emails, then follow docs/LAUNCH_REHEARSAL.md.");
