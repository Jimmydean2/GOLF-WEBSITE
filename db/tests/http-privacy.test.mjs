// "Verify all sensitive child and parent information is inaccessible to other families."
//
// Tested the way an outsider meets the site: over HTTP, against the real production server
// (built and started), with two families holding distinctive sentinel strings in every
// sensitive field. Every place those strings could leak is searched: pages, APIs, errors,
// headers, emails, and the admin area without (and with) a login.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
    COACH_NOTICE_MODE: "digest",
  },
});
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, check } = h;

let ip = 0;
const post = (path, body, headers = {}) =>
  fetch(`${app.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(++ip % 250) + 1}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (path, headers = {}) => fetch(`${app.url}${path}`, { redirect: "manual", headers: { "x-forwarded-for": `203.0.113.${(++ip % 250) + 1}`, ...headers } });

function family(tag, weeks) {
  return {
    idempotencyKey: `privacy-${tag}-${Math.random().toString(36).slice(2, 12)}`.slice(0, 60),
    parentName: `Zelda ${tag}Parent`,
    email: `zelda.${tag.toLowerCase()}@example.test`,
    primaryPhone: `438-555-${tag === "Alpha" ? "7001" : "7002"}`,
    secondaryPhone: `438-555-${tag === "Alpha" ? "7011" : "7012"}`,
    emergencyName: `Emergency${tag}Person`,
    emergencyRelationship: `Cousin${tag}`,
    emergencyPhone: `438-555-${tag === "Alpha" ? "7021" : "7022"}`,
    weeks,
    children: [
      { fullName: `Kid${tag}One Sentinel`, dateOfBirth: tag === "Alpha" ? "2015-03-17" : "2014-11-29", age: "10", healthInfo: `HEALTH-SENTINEL-${tag}-peanut-allergy-epipen` },
    ],
    codeOfConductAccepted: true,
    consentAccepted: true,
    healthConsentAccepted: true,
  };
}
const A = family("Alpha", ["2027-07-05"]);
const B = family("Beta", ["2027-07-12"]);
const sentinelsOf = (f) => [f.parentName, f.email, f.primaryPhone, f.secondaryPhone, f.emergencyName, f.emergencyRelationship, f.emergencyPhone, f.children[0].fullName, f.children[0].dateOfBirth, f.children[0].healthInfo];
const leaks = (text, f) => sentinelsOf(f).filter((s) => text.includes(s));

// ---------------------------------------------------------------------------
console.log("=== 1. Two families register ===");
const ra = await post("/api/camp-registration", A);
const rb = await post("/api/camp-registration", B);
const da = await ra.json();
const db = await rb.json();
check("both registrations succeed", ra.status === 200 && rb.status === 200 && da.success && db.success, `${ra.status}/${rb.status}`);
const tokenOf = (d) => d.statusPath.split("/").pop();
const idOf = (d) => tokenOf(d).split(".")[0];
check("each gets a private link that is theirs alone", tokenOf(da) !== tokenOf(db) && idOf(da) !== idOf(db));
check("the registration answer itself holds only reference, amount, deadline and link", Object.keys(da).sort().join() === "amountDueCents,payByAt,reference,statusPath,success", Object.keys(da).join());

// ---------------------------------------------------------------------------
console.log("\n=== 2. A family's private page shows that family, and only that family ===");
{
  const pa = await get(da.statusPath);
  const html = await pa.text();
  check("family Alpha's link opens Alpha's page", pa.status === 200 && html.includes("KidAlpha") && html.includes(da.reference));
  check("it shows nothing of family Beta", leaks(html, B).length === 0 && !html.includes(db.reference), leaks(html, B).join(", "));
  check("it does not show the child's health notes, birth date, or any emergency contact, even to the family itself (they are not needed on this page)",
    !html.includes(A.children[0].healthInfo) && !html.includes(A.children[0].dateOfBirth) && !html.includes(A.emergencyName) && !html.includes(A.emergencyPhone));
  check("the parent's email appears only masked", !html.includes(A.email) && html.includes("z***@example.test"));
  const pb = await (await get(db.statusPath)).text();
  check("family Beta's link opens Beta's page, without Alpha", pb.includes("KidBeta") && leaks(pb, A).length === 0 && !pb.includes(da.reference));
  const hdr = Object.fromEntries(pa.headers);
  check("the page may not be stored, framed, sniffed, or leaked through the referrer",
    /no-store/.test(hdr["cache-control"] ?? "") && hdr["x-frame-options"] === "DENY" && /frame-ancestors 'none'/.test(hdr["content-security-policy"] ?? "") && hdr["x-content-type-options"] === "nosniff" && hdr["referrer-policy"] === "no-referrer", JSON.stringify({ c: hdr["cache-control"], f: hdr["x-frame-options"], r: hdr["referrer-policy"] }));
  check("and it asks search engines to stay away", /noindex/i.test(html) || /noindex/i.test(hdr["x-robots-tag"] ?? ""));
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host).filter((host) => host !== new URL(app.url).host);
  check("the private page loads nothing from other websites (its address could otherwise leak to them)", external.filter((host) => !/^(www\.)?(instagram|facebook)\.com$/.test(host)).length === 0, [...new Set(external)].join(", "));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Forged, altered and guessed links open nothing ===");
{
  const t = tokenOf(da);
  const [idA, macA] = t.split(".");
  const [idB, macB] = tokenOf(db).split(".");
  const flip = (s) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
  const candidates = {
    "Alpha's id with Beta's code": `${idA}.${macB}`,
    "Beta's id with Alpha's code": `${idB}.${macA}`,
    "one character of the code changed": `${idA}.${flip(macA)}`,
    "the code cut short": `${idA}.${macA.slice(0, -5)}`,
    "the code with extra characters": `${idA}.${macA}xx`,
    "no code at all": `${idA}.`,
    "the id alone": idA,
    "the code alone": macA,
    "upper-cased": t.toUpperCase(),
    "a made-up id": `00000000-0000-4000-8000-000000000000.${macA}`,
    "a SQL fragment": encodeURIComponent(`${idA}' OR '1'='1.${macA}`),
    "a path climb": `..%2f..%2fadmin.${macA}`,
    "a 10,000 character token": "a".repeat(10_000),
    "a null byte": `${idA}%00.${macA}`,
  };
  const opened = [];
  for (const [label, token] of Object.entries(candidates)) {
    const r = await get(`/camp-registration/${token}`);
    const body = await r.text();
    if (r.status === 200 || leaks(body, A).length || leaks(body, B).length || body.includes(da.reference) || body.includes(db.reference)) opened.push(`${label}: ${r.status}`);
    if (r.status >= 500) opened.push(`${label}: server error ${r.status}`);
  }
  check("none of 14 altered or invented links shows anything or breaks the server", opened.length === 0, opened.join("; "));
  const bare = await get("/camp-registration/");
  const bareBody = await bare.text();
  check("the bare address shows nothing", leaks(bareBody, A).length === 0 && leaks(bareBody, B).length === 0);

  const reportBad = await post("/api/camp-registration/report", { token: `${idA}.${flip(macA)}` });
  check("tapping 'I've sent my payment' with an altered link is refused and says nothing about the registration", reportBad.status === 404 && !JSON.stringify(await reportBad.json()).match(/GD-|Alpha|Beta/));
  const reportNone = await post("/api/camp-registration/report", {});
  check("and with no link at all", reportNone.status === 404);
  const reportB = await post("/api/camp-registration/report", { token: tokenOf(db) });
  const rowsAfter = (await pool.query(`SELECT id, status FROM registrations ORDER BY created_at`)).rows;
  check("a genuine report changes only that family's reservation", reportB.status === 200 && rowsAfter.find((r) => r.id === idOf(db)).status === "payment_reported" && rowsAfter.find((r) => r.id === idOf(da)).status === "pending_payment");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Public endpoints and error pages ===");
{
  const bodies = [];
  const cap = await get("/api/camp-capacity");
  bodies.push(["capacity", await cap.text()]);
  const sched = await get("/api/health/scheduler");
  bodies.push(["scheduler health", await sched.text()]);
  const cron = await get("/api/cron/payment-review");
  bodies.push(["cron without secret", await cron.text()]);
  const cronBad = await get("/api/cron/payment-review", { authorization: "Bearer wrong" });
  bodies.push(["cron with wrong secret", await cronBad.text()]);
  check("the cron URL refuses without the secret", cron.status === 401 && cronBad.status === 401);
  const badJson = await post("/api/camp-registration", "{nope");
  bodies.push(["malformed registration", await badJson.text()]);
  const dupe = await post("/api/camp-registration", { ...A, idempotencyKey: "another-key-for-the-same-child-12345" });
  const dupeBody = await dupe.text();
  check("registering Alpha's child again says 'already registered' without a link or reference", dupe.status === 409 && !dupeBody.includes("statusPath") && !dupeBody.includes(da.reference));
  // The answer repeats the child's name and the weeks exactly as the requester typed them, and nothing else.
  const echoed = leaks(dupeBody, A).filter((x) => x !== A.children[0].fullName);
  check("it repeats only what the requester typed (the child's name), and none of the stored details", echoed.length === 0 && dupeBody.includes(A.children[0].fullName), echoed.join(", "));
  const stolenKey = await post("/api/camp-registration", { ...B, idempotencyKey: A.idempotencyKey });
  const stolenBody = await stolenKey.text();
  bodies.push(["borrowed key", stolenBody]);
  check("using Alpha's submission key from Beta's email returns nothing of Alpha's", !stolenBody.includes(da.reference) && !stolenBody.includes("camp-registration/"));
  const nope = await get("/api/camp-registration");
  bodies.push(["GET on the registration API", await nope.text()]);
  const notFound = await get("/api/admin/does-not-exist");
  bodies.push(["unknown admin URL", await notFound.text()]);
  const everything = bodies.map(([, b]) => b).join("\n");
  check("none of those answers contains any family's details", leaks(everything, A).length === 0 && leaks(everything, B).length === 0, leaks(everything, A).concat(leaks(everything, B)).join(", "));
  check("none shows a stack trace, file path or SQL", !/at \w+.*\.(js|ts):\d+|node_modules|SELECT |INSERT |pg_|ECONN/i.test(everything), everything.match(/at \w+.*\.(js|ts):\d+|node_modules|SELECT |INSERT |pg_|ECONN/i)?.[0]);
  check("the capacity answer holds counts and prices only", JSON.stringify(JSON.parse(bodies[0][1])).match(/"(taken|max|remaining|full|priceCents|isOpen)"/) && !/@|GD-/.test(bodies[0][1]));
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. The administrator's area without a login ===");
{
  const routes = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(p);
    }
  })("src/app/api/admin");
  const exempt = new Set(["login", "logout"]);
  const urls = routes
    .map((p) => "/" + p.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "").replace("[id]", "00000000-0000-4000-8000-000000000001").replace("[spotId]", "00000000-0000-4000-8000-000000000002"))
    .filter((u) => !exempt.has(u.split("/").pop()));
  const exposed = [];
  let attempts = 0;
  for (const url of urls) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      for (const headers of [{}, { origin: app.url }, { cookie: "jdg_admin_session=not-a-real-session-token-0123456789", origin: app.url }]) {
        attempts++;
        const r = await fetch(`${app.url}${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(++ip % 250) + 1}`, ...headers }, body: method === "GET" ? undefined : "{}" });
        const body = await r.text();
        if (![401, 403, 405].includes(r.status) || leaks(body, A).length || leaks(body, B).length) exposed.push(`${method} ${url} -> ${r.status}`);
      }
    }
  }
  check(`${urls.length} administrator URLs x 5 methods x 3 kinds of credentials (${attempts} requests): every one refused, none revealed anything`, exposed.length === 0, exposed.slice(0, 5).join("; "));

  const page = await get("/admin/camp-rosters");
  const pageBody = await page.text();
  check("the dashboard page redirects an anonymous visitor to the login page", [302, 307, 308].includes(page.status) && /\/admin\/login/.test(page.headers.get("location") ?? ""), `${page.status} ${page.headers.get("location")}`);
  check("and contains no family's details", leaks(pageBody, A).length === 0 && leaks(pageBody, B).length === 0);
  const forged = await get("/admin/camp-rosters", { cookie: "jdg_admin_session=forged-0123456789abcdef" });
  check("a forged session cookie is no better", [302, 307, 308].includes(forged.status));
  const foreign = await post("/api/admin/login", { password: "Local-QA-Only-Admin-Passphrase-2026" }, { origin: "https://evil.example" });
  check("a login attempt from another website is refused even with the right password", foreign.status === 403);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. With the administrator's login, the same data appears (and only then) ===");
{
  const session = await adminSession(app);
  check("the administrator can log in", session.ok && session.cookie.includes("jdg_admin_session"));
  const queue = await fetch(`${app.url}/api/admin/payment-queue`, { headers: { cookie: session.cookie, origin: app.url } });
  const text = await queue.text();
  check("the review queue lists both families (this is the administrator's job)", queue.status === 200 && text.includes(da.reference) && text.includes(db.reference));
  const ask = (headers) => fetch(`${app.url}/api/admin/camp-rosters/download`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ format: "xlsx", week: "2027-07-05", profile: "full" }) });
  const download = await ask({ cookie: session.cookie, origin: app.url });
  check("the roster download works for the administrator (POST, right after the password)", download.status === 200 && /spreadsheet|octet|xlsx/i.test(download.headers.get("content-type") ?? ""), `${download.status} ${download.headers.get("content-type")}`);
  const anonymousDownload = await ask({});
  check("and refuses everyone else", anonymousDownload.status === 401);
  await fetch(`${app.url}/api/admin/logout`, { method: "POST", headers: { cookie: session.cookie, origin: app.url } });
  const afterLogout = await fetch(`${app.url}/api/admin/payment-queue`, { headers: { cookie: session.cookie, origin: app.url } });
  check("after logging out, the same cookie opens nothing", afterLogout.status === 401);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Emails: each family's, and only theirs ===");
{
  // Let the after-response work finish, then run the outbox once more through the cron URL.
  await fetch(`${app.url}/api/cron/payment-review`, { headers: { authorization: "Bearer test-only-cron-secret-0123456789" } });
  const toA = sink.to(A.email);
  const toB = sink.to(B.email);
  check("Beta received exactly one payment-instructions email", toB.length === 1, String(toB.length));
  check("Alpha received two: the original, and one re-send triggered by the repeat registration (sent to the address on file, once)", toA.length === 2 && toA.every((m) => m.to.length === 1), String(toA.length));
  check("nobody else was emailed because of the other probes (borrowed key, repeat)", new Set(sink.messages.map((m) => m.to.join())).size <= 4, [...new Set(sink.messages.map((m) => m.to.join()))].join(" | "));
  check("Alpha's email has Alpha's reference and nothing of Beta's", toA[0].text.includes(da.reference) && leaks(toA[0].text + toA[0].html, B).length === 0 && !toA[0].text.includes(db.reference));
  check("Beta's has Beta's and nothing of Alpha's", toB[0].text.includes(db.reference) && leaks(toB[0].text + toB[0].html, A).length === 0);
  const allMail = sink.messages.map((m) => `${m.subject}\n${m.text}\n${m.html}`).join("\n");
  check("no email anywhere contains a child's health notes, birth date or an emergency contact", !allMail.includes("HEALTH-SENTINEL") && !allMail.includes(A.children[0].dateOfBirth) && !allMail.includes(B.children[0].dateOfBirth) && !allMail.includes("Emergency"));
  const reportedAlert = sink.messages.find((m) => /Payment reported/i.test(m.subject));
  check("the administrators' alert about Beta's payment goes to the administrators only", Boolean(reportedAlert) && !reportedAlert.to.includes(B.email) && !reportedAlert.to.includes(A.email), reportedAlert?.to.join());
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. Public pages: nothing private, nothing sent to strangers ===");
{
  const pages = ["/", "/junior-camps", "/junior-programs", "/about", "/contact", "/lessons", "/clinics", "/book", "/admin/login"];
  const hosts = new Map();
  let leaked = 0;
  for (const p of pages) {
    const r = await get(p);
    const html = await r.text();
    if (leaks(html, A).length || leaks(html, B).length || html.includes(da.reference) || html.includes(db.reference)) leaked++;
    for (const m of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
      const host = new URL(m[1]).host;
      if (host !== new URL(app.url).host) hosts.set(host, (hosts.get(host) ?? new Set()).add(p));
    }
    for (const m of html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) hosts.set(`SCRIPT ${new URL(m[1]).host}`, new Set([p]));
  }
  check("no public page contains any family's details", leaked === 0);
  const thirdPartyScripts = [...hosts.keys()].filter((k) => k.startsWith("SCRIPT"));
  check("no public page loads a script from another website (no analytics or tracking can see the private link)", thirdPartyScripts.length === 0, thirdPartyScripts.join(", "));
  console.log(`   (links to other websites on the public pages: ${[...hosts.keys()].filter((k) => !k.startsWith("SCRIPT")).join(", ") || "none"})`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. The server's own output ===");
{
  const log = app.logs.join("");
  check("the server's log contains no child's name, health note, phone number or email address", leaks(log, A).length === 0 && leaks(log, B).length === 0 && !/example\.test/.test(log.replace(/camp@example\.test/g, "")), leaks(log, A).concat(leaks(log, B)).join(", ") || (log.match(/[\w.+-]+@example\.test/)?.[0] ?? ""));
}

await app.stop();
await sink.stop();
await h.resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("http-privacy"));
