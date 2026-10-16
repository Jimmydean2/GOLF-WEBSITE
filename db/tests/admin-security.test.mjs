// Admin authentication hardening, rate limiting, and the private registration link — against a
// real throwaway Postgres. Uses an obviously fake admin password set by this test itself (it
// never reads or needs the real one).
//
// Covers: random server-side sessions (only a hash is stored), idle / absolute expiry,
// revocation, the 5-failures-in-15-minutes lockout per address (a correct password is refused
// while locked; other addresses are unaffected; the lock lifts), the shared lockout on the
// "confirm your password" step-up, rate-limit windows and independence under real concurrency,
// the same-origin check, the safe post-login redirect, and the HMAC-signed parent link.

import { createHash } from "node:crypto";
import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "40";
const TEST_PASSWORD = "Fake-Test-Only Password #1 (not a real credential)";
process.env.ADMIN_PASSWORD = TEST_PASSWORD;
process.env.REGISTRATION_LINK_SECRET = "test-only-link-secret-0123456789";

const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, check } = h;

const sessions = await import("../../src/lib/adminSessions.ts");
const { rateLimit, clientIp } = await import("../../src/lib/rateLimit.ts");
const { isSameOriginRequest, safeAdminNextPath } = await import("../../src/lib/requestGuards.ts");
const links = await import("../../src/lib/registrationLink.ts");
const {
  attemptLogin, checkLoginLock, getSessionByToken, isFresh, revokeSession, revokeAllSessions, reauthenticate,
  verifyAdminPassword, hashToken, SESSION_IDLE_HOURS, SESSION_MAX_HOURS, FRESH_AUTH_MINUTES, LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_MINUTES,
} = sessions;

const MIN = 60_000;
const HOUR = 60 * MIN;

async function resetAuthTables() {
  await pool.query(`DELETE FROM admin_sessions`);
  await pool.query(`DELETE FROM admin_login_attempts`);
}
async function login(ip, password = TEST_PASSWORD, extra = {}) {
  return attemptLogin({ password, ip, userAgent: "test-agent", ...extra });
}
async function failTimes(ip, n) {
  let last;
  for (let i = 0; i < n; i++) last = await login(ip, "wrong password " + i);
  return last;
}
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
console.log("=== 1. The password check ===");
{
  check("the right password is accepted", verifyAdminPassword(TEST_PASSWORD));
  check("a wrong password, an empty one, and a near-miss are refused", !verifyAdminPassword("nope") && !verifyAdminPassword("") && !verifyAdminPassword(TEST_PASSWORD + " ") && !verifyAdminPassword(TEST_PASSWORD.toLowerCase()));
  check("a very long wrong password is refused without error", !verifyAdminPassword("x".repeat(100_000)));
  delete process.env.ADMIN_PASSWORD;
  check("with no admin password configured, nothing is accepted (not even an empty string)", !verifyAdminPassword("") && !verifyAdminPassword("anything") && !sessions.isAdminConfigured());
  const r = await login("10.9.9.9");
  check("login reports 'not configured' instead of letting anyone in", !r.ok && r.reason === "not_configured");
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
  check("configured again: the right password works", verifyAdminPassword(TEST_PASSWORD) && sessions.isAdminConfigured());
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. A login creates a random server-side session; only a hash is stored ===");
{
  await resetAuthTables();
  const bad = await login("10.0.0.1", "wrong");
  check("a wrong password creates no session", !bad.ok && bad.reason === "invalid" && Number((await pool.query(`SELECT count(*) FROM admin_sessions`)).rows[0].count) === 0);

  const a = await login("10.0.0.1");
  const b = await login("10.0.0.2");
  check("the right password creates a session with a 64-hex-character random token", a.ok && b.ok && /^[0-9a-f]{64}$/.test(a.token) && a.token !== b.token);
  const rows = (await pool.query(`SELECT token_hash, ip, user_agent, expires_at, revoked_at FROM admin_sessions ORDER BY created_at`)).rows;
  check("two sessions stored, each by the SHA-256 hash of its token", rows.length === 2 && rows.some((r) => r.token_hash === sha(a.token)) && rows.some((r) => r.token_hash === sha(b.token)) && hashToken(a.token) === sha(a.token));
  const plaintext = (await pool.query(`SELECT count(*)::int AS n FROM admin_sessions WHERE token_hash = $1 OR token_hash = $2`, [a.token, b.token])).rows[0].n;
  check("the token itself is never stored (a copy of the database cannot be turned into a working cookie)", plaintext === 0);
  const span = new Date(a.expiresAt).getTime() - Date.now();
  check(`the absolute limit is ${SESSION_MAX_HOURS} hours`, Math.abs(span - SESSION_MAX_HOURS * HOUR) < 2 * MIN);

  const audit = (await pool.query(`SELECT details::text AS d, action FROM admin_audit_log WHERE action IN ('admin_login','admin_login_locked') ORDER BY created_at`)).rows;
  check("the log records that logins happened", audit.some((r) => r.action === "admin_login"));
  const leaked = (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE details::text LIKE $1 OR details::text LIKE $2 OR details::text LIKE $3`, [`%${TEST_PASSWORD}%`, `%${a.token}%`, `%wrong%`])).rows[0].n;
  check("...and neither the password, a wrong guess, nor a session token ever lands in the audit log", leaked === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Sessions: lookup, idle and absolute expiry, revocation ===");
{
  await resetAuthTables();
  const a = await login("10.1.0.1");
  const s = await getSessionByToken(a.token);
  check("a live token finds its session", s && typeof s.id === "string");
  check("an unknown token, an empty one, and a tampered one find nothing", (await getSessionByToken("0".repeat(64))) === null && (await getSessionByToken("")) === null && (await getSessionByToken(a.token.slice(0, -1) + (a.token.endsWith("0") ? "1" : "0"))) === null);

  const t0 = Date.now();
  check(`idle just under ${SESSION_IDLE_HOURS} hours: still valid`, (await getSessionByToken(a.token, new Date(t0 + SESSION_IDLE_HOURS * HOUR - 5 * MIN))) !== null);
  // That lookup moved last_seen_at forward only if >1 minute older; use a fresh session for the idle cut-off.
  const b = await login("10.1.0.2");
  check(`idle for more than ${SESSION_IDLE_HOURS} hours: refused`, (await getSessionByToken(b.token, new Date(Date.now() + SESSION_IDLE_HOURS * HOUR + 5 * MIN))) === null);

  // Sliding idle window, fixed absolute limit.
  const c = await login("10.1.0.3");
  let t = Date.now();
  let alive = true;
  for (let step = 1; step <= 7 && alive; step++) {
    t += 3 * HOUR; // activity every 3 hours keeps the idle window open
    alive = (await getSessionByToken(c.token, new Date(t))) !== null;
  }
  check("activity every 3 hours keeps a session alive (the idle clock slides)", alive);
  check(`...but nothing extends it past ${SESSION_MAX_HOURS} hours in total`, (await getSessionByToken(c.token, new Date(Date.now() + (SESSION_MAX_HOURS + 1) * HOUR))) === null);

  const d = await login("10.1.0.4");
  const e = await login("10.1.0.5");
  await revokeSession(d.token);
  check("a revoked session stops working immediately; another session is unaffected", (await getSessionByToken(d.token)) === null && (await getSessionByToken(e.token)) !== null);
  await revokeSession(d.token); // idempotent
  await revokeSession("not-a-real-token");
  check("revoking twice, or an unknown token, is harmless", (await getSessionByToken(e.token)) !== null);

  const f = await login("10.1.0.6");
  const count = await revokeAllSessions();
  check("'log out everywhere' ends every live session", count >= 2 && (await getSessionByToken(e.token)) === null && (await getSessionByToken(f.token)) === null);
  const logged = (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'admin_sessions_revoked'`)).rows[0].n;
  check("...and that is written to the audit log", logged >= 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Lockout: 5 wrong passwords from one address in 15 minutes ===");
{
  await resetAuthTables();
  const ip = "10.2.0.1";
  const fourth = await failTimes(ip, LOGIN_FAILURE_LIMIT - 1);
  check(`${LOGIN_FAILURE_LIMIT - 1} wrong passwords: refused, but not yet locked`, !fourth.ok && fourth.reason === "invalid");
  const fifth = await login(ip, "wrong again");
  check(`the ${LOGIN_FAILURE_LIMIT}th wrong password locks the address and says how long to wait`, !fifth.ok && fifth.reason === "locked" && fifth.retryAfterSeconds > 0 && fifth.retryAfterSeconds <= LOGIN_WINDOW_MINUTES * 60);
  const locks = (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'admin_login_locked' AND details->>'ip' = $1`, [ip])).rows[0].n;
  check("the lockout is written to the audit log with the address", locks >= 1);

  const correctWhileLocked = await login(ip);
  check("while locked, even the CORRECT password is refused (so guessing can't win after the limit)", !correctWhileLocked.ok && correctWhileLocked.reason === "locked");
  check("no session was created for that refused correct password", Number((await pool.query(`SELECT count(*) FROM admin_sessions WHERE ip = $1`, [ip])).rows[0].count) === 0);
  const other = await login("10.2.0.2");
  check("a different address is not affected", other.ok);

  check("the lock status is visible without trying a password", (await checkLoginLock(ip)).locked && !(await checkLoginLock("10.2.0.77")).locked);
  const later = new Date(Date.now() + (LOGIN_WINDOW_MINUTES + 1) * MIN);
  check(`after ${LOGIN_WINDOW_MINUTES} minutes the lock lifts`, !(await checkLoginLock(ip, later)).locked);
  const justBefore = new Date(Date.now() + (LOGIN_WINDOW_MINUTES - 1) * MIN);
  check("one minute before that it is still locked", (await checkLoginLock(ip, justBefore)).locked);
  const afterLift = await login(ip, TEST_PASSWORD, { now: later });
  check("and the right password then works", afterLift.ok);
  check("a successful login clears that address's recorded failures", Number((await pool.query(`SELECT count(*) FROM admin_login_attempts WHERE ip = $1 AND succeeded = false`, [ip])).rows[0].count) === 0);

  // Failures followed by a success do not accumulate toward a later lock.
  const ip2 = "10.2.0.3";
  await failTimes(ip2, 3);
  const ok = await login(ip2);
  await failTimes(ip2, 3);
  check("3 wrong, then a right one, then 3 wrong again: not locked (the success reset the count)", ok.ok && !(await checkLoginLock(ip2)).locked);

  // Failures older than the window do not count.
  const ip3 = "10.2.0.4";
  await failTimes(ip3, LOGIN_FAILURE_LIMIT - 1);
  await pool.query(`UPDATE admin_login_attempts SET created_at = now() - interval '20 minutes' WHERE ip = $1`, [ip3]);
  const agedOut = await login(ip3, "wrong");
  check("failures older than the window don't count toward a lock", !agedOut.ok && agedOut.reason === "invalid");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Guessing from many addresses at once is slowed down ===");
{
  await resetAuthTables();
  // 6 addresses x 5 failures = 30 failures in the window (each address ends up locked).
  for (let i = 0; i < 6; i++) await failTimes(`10.3.0.${i + 1}`, LOGIN_FAILURE_LIMIT);
  const t0 = Date.now();
  const slow = await login("10.3.0.99", "wrong");
  const took = Date.now() - t0;
  check("with 30+ recent failures from anywhere, each further wrong guess takes extra time", !slow.ok && took >= 1400, `${took} ms`);
  const t1 = Date.now();
  const fine = await login("10.3.0.100");
  check("the right password is not slowed down", fine.ok && Date.now() - t1 < 1400, `${Date.now() - t1} ms`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. 'Confirm your password' (step-up) before any payment action ===");
{
  await resetAuthTables();
  const ip = "10.4.0.1";
  const a = await login(ip);
  const s = await getSessionByToken(a.token);
  check("right after logging in, the session counts as freshly authenticated", isFresh(s));
  check(`${FRESH_AUTH_MINUTES - 1} minutes later: still fresh; ${FRESH_AUTH_MINUTES + 1} minutes later: not`, isFresh(s, new Date(s.lastAuthAt.getTime() + (FRESH_AUTH_MINUTES - 1) * MIN)) && !isFresh(s, new Date(s.lastAuthAt.getTime() + (FRESH_AUTH_MINUTES + 1) * MIN)));

  await pool.query(`UPDATE admin_sessions SET last_auth_at = now() - interval '2 hours' WHERE id = $1`, [s.id]);
  const stale = await getSessionByToken(a.token);
  check("a session whose last password check was 2 hours ago is not fresh", !isFresh(stale));

  const wrong = await reauthenticate({ sessionId: s.id, password: "nope", ip });
  const stillStale = await getSessionByToken(a.token);
  check("a wrong password at the step-up is refused and does not refresh the session", !wrong.ok && wrong.reason === "invalid" && !isFresh(stillStale));
  const good = await reauthenticate({ sessionId: s.id, password: TEST_PASSWORD, ip });
  const refreshed = await getSessionByToken(a.token);
  check("the right password refreshes it", good.ok && isFresh(refreshed));

  // The step-up shares the login lockout: it can't be used to guess the password.
  await pool.query(`UPDATE admin_sessions SET last_auth_at = now() - interval '2 hours' WHERE id = $1`, [s.id]);
  let last;
  for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) last = await reauthenticate({ sessionId: s.id, password: "guess " + i, ip });
  check(`${LOGIN_FAILURE_LIMIT} wrong passwords at the step-up lock the address`, !last.ok && last.reason === "locked");
  const lockedGood = await reauthenticate({ sessionId: s.id, password: TEST_PASSWORD, ip });
  check("while locked, the correct password at the step-up is refused too", !lockedGood.ok && lockedGood.reason === "locked" && !isFresh(await getSessionByToken(a.token)));
  const loginWhileLocked = await login(ip);
  check("and the lock covers login from the same address as well", !loginWhileLocked.ok && loginWhileLocked.reason === "locked");
  const lateAgain = await reauthenticate({ sessionId: s.id, password: TEST_PASSWORD, ip, now: new Date(Date.now() + (LOGIN_WINDOW_MINUTES + 1) * MIN) });
  check("after the window it works again", lateAgain.ok);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Rate limiting (Postgres counters; works across server instances) ===");
{
  await pool.query(`DELETE FROM rate_limit_counters`);
  const fixed = new Date("2031-03-05T10:00:10Z");
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await rateLimit("t-basic", "203.0.113.5", 3, 60, fixed)).allowed);
  check("3 allowed, then refused", results.join() === "true,true,true,false,false");
  const blocked = await rateLimit("t-basic", "203.0.113.5", 3, 60, fixed);
  check("the refusal says how long to wait (1..60 s)", !blocked.allowed && blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60, String(blocked.retryAfterSeconds));
  check("another identifier is counted separately", (await rateLimit("t-basic", "203.0.113.6", 3, 60, fixed)).allowed);
  check("another limit name is counted separately", (await rateLimit("t-other", "203.0.113.5", 3, 60, fixed)).allowed);
  check("the next window starts clean", (await rateLimit("t-basic", "203.0.113.5", 3, 60, new Date(fixed.getTime() + 60_000))).allowed);
  const firstMail = await rateLimit("t-mail", "A@Example.test", 1, 60, fixed);
  const secondMail = await rateLimit("t-mail", " a@example.TEST ", 1, 60, fixed);
  check("identifiers are matched case-insensitively and trimmed (an email can't dodge by changing case)", firstMail.allowed && !secondMail.allowed);

  const buckets = (await pool.query(`SELECT bucket FROM rate_limit_counters`)).rows.map((r) => r.bucket);
  check("the counters table holds no raw IP address or email (identifiers are hashed)", buckets.every((b) => !b.includes("203.0.113") && !b.includes("@") && !b.includes("example")), buckets.slice(0, 3).join(" | "));

  await pool.query(`DELETE FROM rate_limit_counters`);
  const burst = await Promise.all(Array.from({ length: 60 }, () => rateLimit("t-burst", "198.51.100.1", 10, 3600, fixed)));
  const allowedCount = burst.filter((r) => r.allowed).length;
  check("60 simultaneous requests against a limit of 10: exactly 10 get through", allowedCount === 10, String(allowedCount));
  const hits = Number((await pool.query(`SELECT hits FROM rate_limit_counters WHERE bucket LIKE 't-burst:%'`)).rows[0].hits);
  check("...and every one of them was counted", hits === 60, String(hits));

  check("clientIp takes the first x-forwarded-for entry", clientIp(new Request("http://x.test", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } })) === "203.0.113.9");
  check("clientIp falls back to x-real-ip, then 'unknown'", clientIp(new Request("http://x.test", { headers: { "x-real-ip": "198.51.100.7" } })) === "198.51.100.7" && clientIp(new Request("http://x.test")) === "unknown");
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. Same-origin check on admin changes ===");
{
  const req = (headers, url = "https://camp.example.test/api/admin/x") => new Request(url, { method: "POST", headers });
  check("a page on this site (Origin matches Host) is accepted", isSameOriginRequest(req({ origin: "https://camp.example.test", host: "camp.example.test" })));
  check("another site is refused", !isSameOriginRequest(req({ origin: "https://evil.example.test", host: "camp.example.test" })));
  check("a look-alike host (suffix trick) is refused", !isSameOriginRequest(req({ origin: "https://camp.example.test.evil.test", host: "camp.example.test" })));
  check("a different port is refused", !isSameOriginRequest(req({ origin: "https://camp.example.test:8443", host: "camp.example.test" })));
  check("Origin: null (sandboxed frame / file page) is refused", !isSameOriginRequest(req({ origin: "null", host: "camp.example.test" })));
  check("an unparsable Origin is refused", !isSameOriginRequest(req({ origin: "::::", host: "camp.example.test" })));
  check("behind a proxy, x-forwarded-host is the host that counts", isSameOriginRequest(req({ origin: "https://camp.example.test", host: "internal:3000", "x-forwarded-host": "camp.example.test" })) && !isSameOriginRequest(req({ origin: "https://internal:3000", host: "internal:3000", "x-forwarded-host": "camp.example.test" })));
  check("no Origin, but Sec-Fetch-Site: same-origin -> accepted", isSameOriginRequest(req({ "sec-fetch-site": "same-origin" })));
  check("no Origin, Sec-Fetch-Site: none (typed address) -> accepted", isSameOriginRequest(req({ "sec-fetch-site": "none" })));
  check("Sec-Fetch-Site: cross-site and same-site -> refused", !isSameOriginRequest(req({ "sec-fetch-site": "cross-site" })) && !isSameOriginRequest(req({ "sec-fetch-site": "same-site" })));
  check("neither header present (a script or another server) -> refused", !isSameOriginRequest(req({})));
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. Where the login page sends you afterwards ===");
{
  const fb = "/admin/camp-rosters";
  check("a normal admin path is kept", safeAdminNextPath("/admin/camp-rosters") === "/admin/camp-rosters" && safeAdminNextPath("/admin") === "/admin" && safeAdminNextPath("/admin/x?y=1#z") === "/admin/x?y=1#z");
  check("nothing -> the default", safeAdminNextPath(null) === fb && safeAdminNextPath(undefined) === fb && safeAdminNextPath("") === fb);
  const bad = ["https://evil.test", "//evil.test", "/\\evil.test", "/admin\\..\\evil", "/administrator", "/adminx/y", "/admin/../evil", "/admin/x/../../evil", "/admin/%2e%2e/evil", "/admin/%2E./evil", "/admin/.%2e/evil", "http://evil.test/admin", "javascript:alert(1)", "/admin\nSet-Cookie: x=1", "/admin\r\nLocation: https://evil.test", "/admin\u0000", "/admin://evil.test", "evil", "/other/admin"];
  const leaked = bad.filter((b) => safeAdminNextPath(b) !== fb);
  check("every off-site, look-alike, traversal or malformed target falls back to the default", leaked.length === 0, leaked.join(" | "));
  check("dots inside a query string are just text, not a path (kept)", safeAdminNextPath("/admin/camp-rosters?q=a..b") === "/admin/camp-rosters?q=a..b" && safeAdminNextPath("/admin?a=1/../b") === "/admin?a=1/../b");
}

// ---------------------------------------------------------------------------
console.log("\n=== 10. The parent's private link ===");
{
  const id = "3f2b1c4e-9a7d-4e21-8c55-0a1b2c3d4e5f";
  const token = links.makeAccessToken(id);
  check("the token is the registration id plus a signature, nothing personal", /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token), token);
  check("it round-trips to the registration id", links.registrationIdFromToken(token) === id);
  check("it is stable (a retried submission rebuilds the same link)", links.makeAccessToken(id) === token);
  check("different registrations get different links", links.makeAccessToken("3f2b1c4e-9a7d-4e21-8c55-0a1b2c3d4e60") !== token);

  const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  check("a changed signature is refused", links.registrationIdFromToken(flipped) === null);
  const otherId = "3f2b1c4e-9a7d-4e21-8c55-0a1b2c3d4e60";
  check("another registration's id with this signature is refused (can't read a neighbour's page)", links.registrationIdFromToken(otherId + token.slice(36)) === null);
  const bads = ["", ".", "garbage", id, id + ".", id + ".abc", token + "x", token.slice(0, 40), "x" + token, token.replace(".", ":"), "../../etc/passwd", `${id}.${"A".repeat(43)}`, "not-a-uuid-not-a-uuid-not-a-uuid-xxxx." + token.slice(37)];
  const accepted = bads.filter((b) => links.registrationIdFromToken(b) !== null);
  check("empty, truncated, extended, malformed and forged tokens are all refused", accepted.length === 0, accepted.join(" | "));
  check("the id may be written in capitals; it resolves to the same registration", links.registrationIdFromToken(id.toUpperCase() + token.slice(36)) === id);

  const saved = process.env.REGISTRATION_LINK_SECRET;
  process.env.REGISTRATION_LINK_SECRET = "a-completely-different-secret-value";
  check("with a different secret the old link stops working (rotating the secret revokes every link)", links.registrationIdFromToken(token) === null && links.registrationIdFromToken(links.makeAccessToken(id)) === id);
  process.env.REGISTRATION_LINK_SECRET = saved;
  check("restoring the secret restores the link", links.registrationIdFromToken(token) === id);

  const env = process.env;
  const savedEnv = env.NODE_ENV;
  delete env.REGISTRATION_LINK_SECRET;
  env.NODE_ENV = "production";
  let threw = false;
  try {
    links.makeAccessToken(id);
  } catch {
    threw = true;
  }
  check("in production a missing secret stops the app instead of falling back to a guessable one", threw);
  check("...the registration route can see that (so it refuses reservations up front), and a visitor's link just shows 'not found'", links.isRegistrationLinkConfigured() === false && links.registrationIdFromToken(token) === null);
  env.REGISTRATION_LINK_SECRET = "short";
  let threwShort = false;
  try {
    links.makeAccessToken(id);
  } catch {
    threwShort = true;
  }
  check("...and a too-short secret is rejected the same way", threwShort && links.isRegistrationLinkConfigured() === false);
  env.REGISTRATION_LINK_SECRET = saved;
  check("with a proper secret in production it is configured and works", links.isRegistrationLinkConfigured() === true && links.registrationIdFromToken(token) === id);
  delete env.REGISTRATION_LINK_SECRET;
  env.NODE_ENV = "development";
  check("outside production, with no secret, the fixed development key is used (nothing to set up locally)", links.isRegistrationLinkConfigured() === true && links.registrationIdFromToken(links.makeAccessToken(id)) === id);
  env.NODE_ENV = savedEnv;
  env.REGISTRATION_LINK_SECRET = saved;
}

// ---------------------------------------------------------------------------
console.log("\n=== 11. The session cookie ===");
{
  const { sessionCookieOptions, ADMIN_COOKIE_NAME } = await import("../../src/lib/adminAuth.ts");
  const o = sessionCookieOptions();
  check("HttpOnly (page scripts can't read it), Secure (HTTPS only), SameSite=Lax, whole site", o.httpOnly === true && o.secure === true && o.sameSite === "lax" && o.path === "/");
  check(`the cookie lives no longer than the ${SESSION_MAX_HOURS}-hour session`, o.maxAge === SESSION_MAX_HOURS * 3600);
  check("it has a specific name, not a generic one", /^[a-z_]+$/i.test(ADMIN_COOKIE_NAME) && ADMIN_COOKIE_NAME.length > 8);
}

// ---------------------------------------------------------------------------
console.log("\n=== 12. The gate in front of every admin route ===");
{
  const { evaluateAdminRequest } = await import("../../src/lib/adminAuth.ts");
  await resetAuthTables();
  const A = await login("10.12.0.1");
  const B = await login("10.12.0.2");
  const url = "https://camp.example.test/api/admin/anything";
  const get = () => new Request(url, { method: "GET" });
  const post = (headers = { origin: "https://camp.example.test", host: "camp.example.test" }) => new Request(url, { method: "POST", headers });
  const body = async (guard) => (guard.ok ? null : await guard.response.json());

  const none = await evaluateAdminRequest(get(), null);
  const junk = await evaluateAdminRequest(get(), "f".repeat(64));
  check("no session cookie -> 401 (nothing is readable without logging in)", !none.ok && none.response.status === 401);
  check("a made-up session cookie -> 401", !junk.ok && junk.response.status === 401);
  const ok = await evaluateAdminRequest(get(), A.token);
  check("a live session can read", ok.ok && typeof ok.session.id === "string");

  const crossSite = await evaluateAdminRequest(post({ origin: "https://evil.example.test", host: "camp.example.test" }), A.token);
  check("a change requested from another website is refused (403 'Request blocked'), even with a valid session", !crossSite.ok && crossSite.response.status === 403 && (await body(crossSite)).error === "Request blocked.");
  const noOrigin = await evaluateAdminRequest(post({ "sec-fetch-site": "cross-site", host: "camp.example.test" }), A.token);
  check("...and so is a change with no Origin that the browser marks cross-site", !noOrigin.ok && noOrigin.response.status === 403);
  const sameSite = await evaluateAdminRequest(post(), A.token);
  check("a change from this site's own page is accepted", sameSite.ok);
  const crossGet = await evaluateAdminRequest(new Request(url, { method: "GET", headers: { origin: "https://evil.example.test", host: "camp.example.test" } }), A.token);
  check("a plain read does not need the same-origin header (nothing is changed by a read)", crossGet.ok);

  const fresh = await evaluateAdminRequest(post(), A.token, { fresh: true });
  check("a payment action is allowed right after a password check", fresh.ok);
  await pool.query(`UPDATE admin_sessions SET last_auth_at = now() - interval '20 minutes' WHERE token_hash = $1`, [hashToken(A.token)]);
  const stale = await evaluateAdminRequest(post(), A.token, { fresh: true });
  const staleBody = await body(stale);
  check("20 minutes after the last password check, a payment action is refused with 'reauth_required'", !stale.ok && stale.response.status === 403 && staleBody.code === "reauth_required");
  const staleOrdinary = await evaluateAdminRequest(post(), A.token);
  check("...while an ordinary action (not a payment) is still allowed", staleOrdinary.ok);
  const session = await getSessionByToken(A.token);
  await reauthenticate({ sessionId: session.id, password: TEST_PASSWORD, ip: "10.12.0.1" });
  const again = await evaluateAdminRequest(post(), A.token, { fresh: true });
  check("after typing the password again the payment action goes through", again.ok);

  await revokeSession(B.token);
  const revoked = await evaluateAdminRequest(get(), B.token);
  check("a logged-out session is refused straight away", !revoked.ok && revoked.response.status === 401);
  const C = await login("10.12.0.3");
  await pool.query(`UPDATE admin_sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [hashToken(C.token)]);
  const expired = await evaluateAdminRequest(get(), C.token);
  check("a session past its 24-hour life is refused", !expired.ok && expired.response.status === 401);
  const D = await login("10.12.0.4");
  await pool.query(`UPDATE admin_sessions SET last_seen_at = now() - interval '5 hours' WHERE token_hash = $1`, [hashToken(D.token)]);
  const idle = await evaluateAdminRequest(get(), D.token);
  check("a session idle for more than 4 hours is refused", !idle.ok && idle.response.status === 401);

  // Per-session request limit (120 a minute). Start early in a minute so the window can't roll over mid-test.
  const second = new Date().getSeconds();
  if (second > 40) await new Promise((r) => setTimeout(r, (62 - second) * 1000));
  const E = await login("10.12.0.5");
  const F = await login("10.12.0.6");
  let allowed = 0;
  let firstRefusal = null;
  for (let i = 0; i < 125; i++) {
    const g = await evaluateAdminRequest(get(), E.token);
    if (g.ok) allowed++;
    else if (!firstRefusal) firstRefusal = g.response;
  }
  check("a session making 125 requests in a minute is stopped after 120 (429 with Retry-After)", allowed === 120 && firstRefusal?.status === 429 && Number(firstRefusal.headers.get("retry-after")) >= 1, `${allowed} allowed`);
  check("another session is not affected by that limit", (await evaluateAdminRequest(get(), F.token)).ok);

  await revokeAllSessions();
  check("'log out everywhere' shuts the gate for every session", !(await evaluateAdminRequest(get(), F.token)).ok && !(await evaluateAdminRequest(get(), E.token)).ok);
}

// ---------------------------------------------------------------------------
console.log("\n=== 13. Page headers: no framing, no caching of private pages ===");
{
  const config = (await import("../../next.config.ts")).default;
  const rules = await config.headers();
  const forPath = (source) => rules.find((r) => r.source === source);
  const value = (rule, key) => rule?.headers.find((x) => x.key.toLowerCase() === key.toLowerCase())?.value;
  const privatePaths = ["/admin/:path*", "/api/admin/:path*", "/camp-registration/:path*", "/api/camp-registration/:path*"];
  for (const source of privatePaths) {
    const r = forPath(source);
    check(`${source}: another website cannot frame it (clickjacking): X-Frame-Options and CSP frame-ancestors`, value(r, "X-Frame-Options") === "DENY" && /frame-ancestors 'none'/.test(value(r, "Content-Security-Policy") ?? ""));
    check(`${source}: never cached by the browser or a shared computer, never sniffed, no referrer`, value(r, "Cache-Control") === "no-store" && value(r, "X-Content-Type-Options") === "nosniff" && value(r, "Referrer-Policy") === "no-referrer");
  }
  check("the public pages are untouched (no rule covers them)", rules.every((r) => privatePaths.includes(r.source)));
}

await resetAuthTables();
await pool.end();
await testDb.drop();
process.exit(h.finish("admin-security"));
