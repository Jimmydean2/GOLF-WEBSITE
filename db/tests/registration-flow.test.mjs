// The registration form's POST, end to end below the web server: validation, rate limits,
// repeats, duplicates, races. The question behind every check: is a genuine family ever
// blocked, double-booked or sent to someone else's reservation?

import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "20";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const { handleRegistrationRequest, REGISTRATION_LIMITS } = await import("../../src/lib/registrationService.ts");
const { rateLimit } = await import("../../src/lib/rateLimit.ts");
const { registrationIdFromToken } = await import("../../src/lib/registrationLink.ts");
const h = createHarness();
const { pool, campDb, check, resetAll, input, kids, confirmFor, invariants } = h;

const freshState = async () => {
  await resetAll();
  await pool.query(`DELETE FROM rate_limit_counters`);
};

// The form's payload shape (weeks, not weekIds), built from the harness fixture.
function payload(label, overrides = {}) {
  const base = input(label, overrides);
  const { weekIds, ...rest } = base;
  // The real form sends a UUID; keep the fixture's key to the characters a UUID has.
  return { ...rest, idempotencyKey: base.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "").slice(-60), weeks: overrides.weeks ?? weekIds };
}

let ipCounter = 0;
const newIp = () => `203.0.113.${(++ipCounter % 250) + 1}`;

// Calls the service exactly as the route does, collecting what it defers so a test can
// look at it (or run it) afterwards.
async function post(body, { ip = "198.51.100.7", hooks = {}, raw, headers = {} } = {}) {
  const deferred = [];
  const calls = { created: [], duplicate: [] };
  const request = new Request("http://localhost:3000/api/camp-registration", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: raw ?? JSON.stringify(body),
  });
  const response = await handleRegistrationRequest(request, {
    defer: (task) => deferred.push(task),
    onCreated: async (info) => {
      calls.created.push(info);
      await hooks.onCreated?.(info);
    },
    onDuplicate: async (info) => {
      calls.duplicate.push(info);
      await hooks.onDuplicate?.(info);
    },
  });
  const data = await response.json().catch(() => ({}));
  await Promise.all(deferred.map((task) => task()));
  return { status: response.status, data, calls, headers: response.headers };
}

const count = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);
const registrations = () => count(`SELECT count(*) AS n FROM registrations`);
const hitsFor = async (name) => count(`SELECT COALESCE(sum(hits), 0) AS n FROM rate_limit_counters WHERE bucket LIKE $1`, [`${name}:%`]);

// ---------------------------------------------------------------------------
console.log("=== 1. A mistake in the form costs the family nothing ===");
{
  await freshState();
  const ip = newIp();
  const good = payload("typos", { email: "careful.parent@example.test" });
  const mistakes = [
    { ...good, parentName: "" },
    { ...good, email: "not-an-email" },
    { ...good, codeOfConductAccepted: false },
    { ...good, weeks: [] },
    { ...good, children: [{ ...good.children[0], dateOfBirth: "yesterday" }] },
    { ...good, weeks: ["not-a-week"] },
  ];
  const statuses = [];
  for (const m of mistakes) statuses.push((await post(m, { ip })).status);
  check("six different form mistakes are each answered with a plain 400", statuses.every((s) => s === 400), statuses.join(","));
  check("mistakes used none of the family's allowance (no counters touched)", (await hitsFor("register")) === 0);
  const ok = await post(good, { ip });
  check("the corrected form goes straight through", ok.status === 200 && ok.data.success === true, `${ok.status} ${ok.data.error ?? ""}`);
  check("exactly one reservation exists", (await registrations()) === 1);
  check("the successful attempt used one place of each allowance", (await hitsFor("register-ip")) === 1 && (await hitsFor("register-email")) === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Retrying the same submission is free and returns the same reservation ===");
{
  await freshState();
  const ip = newIp();
  const body = payload("retry", { email: "retry.parent@example.test" });
  const first = await post(body, { ip });
  const repeats = [];
  for (let i = 0; i < 12; i++) repeats.push(await post(body, { ip }));
  check("the first submission is accepted", first.status === 200);
  check("12 retries all succeed (nothing is 429)", repeats.every((r) => r.status === 200), repeats.map((r) => r.status).join(","));
  check("every retry returns the same reference and the same private link",
    repeats.every((r) => r.data.reference === first.data.reference && r.data.statusPath === first.data.statusPath));
  check("still exactly one reservation", (await registrations()) === 1);
  check("only the first attempt counted against the allowances", (await hitsFor("register-ip")) === 1 && (await hitsFor("register-email")) === 1);
  check("the follow-up (emails, sheets) ran once, not 13 times", first.calls.created.length === 1 && repeats.every((r) => r.calls.created.length === 0));

  // The key is not a password, but a retry from a different email must not hand out the link.
  const hijack = await post({ ...body, email: "someone.else@example.test" }, { ip });
  check("the same key with a different email gets no link and no reservation details",
    hijack.status === 400 && !hijack.data.statusPath && !hijack.data.reference, `${hijack.status} ${JSON.stringify(hijack.data)}`);
  const sameEmailOtherCase = await post({ ...body, email: "RETRY.Parent@Example.TEST" }, { ip });
  check("capital letters in the email do not stop a genuine retry", sameEmailOtherCase.status === 200 && sameEmailOtherCase.data.reference === first.data.reference);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Trying while a week is full never locks a family out ===");
{
  await freshState();
  await h.fill("jul06", 30, "full");
  const ip = newIp();
  const email = "waiting.family@example.test";
  const statuses = [];
  for (let i = 0; i < 40; i++) {
    statuses.push((await post(payload(`wait${i}`, { email, weeks: ["jul06"], children: kids(1, `W${i}`) }), { ip })).status);
  }
  check("40 attempts at a full week are each told the week is full", statuses.every((s) => s === 409), [...new Set(statuses)].join(","));
  check("none of them used any allowance", (await hitsFor("register-ip")) === 0 && (await hitsFor("register-email")) === 0);
  const other = await post(payload("waitok", { email, weeks: ["jul13"], children: kids(1, "WOK") }), { ip });
  check("the same family and connection can then reserve another week", other.status === 200, `${other.status} ${other.data.error ?? ""}`);
  const closed = await post(payload("closed", { email: "other.family@example.test", weeks: ["jul06", "jul13"], children: kids(1, "C") }), { ip: newIp() });
  check("a multi-week request including the full week is refused as a whole", closed.status === 409 && closed.data.code === "weeks_full" && closed.data.weekIds.join() === "jul06", JSON.stringify(closed.data));
  check("and no partial reservation was left behind", (await registrations()) === 30 + 1);
  await invariants("full week");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The allowances still stop a runaway script ===");
{
  await freshState();
  // One connection making reservations for many different families.
  const ip = newIp();
  const statuses = [];
  for (let i = 0; i < REGISTRATION_LIMITS.newPerIpPerHour + 3; i++) {
    statuses.push(
      (await post(payload(`bot${i}`, { weeks: ["aug24"], children: kids(1, `B${i}`) }), { ip })).status
    );
  }
  const created = statuses.filter((s) => s === 200).length;
  const limited = statuses.filter((s) => s === 429).length;
  check(`one connection can make ${REGISTRATION_LIMITS.newPerIpPerHour} reservations an hour, then is slowed down`, created === REGISTRATION_LIMITS.newPerIpPerHour && limited === 3, `${created} created, ${limited} limited`);
  const limitedAnswer = await post(payload("bot-late", { weeks: ["aug17"], children: kids(1, "BL") }), { ip });
  check("the slow-down answer tells the family how long to wait", limitedAnswer.status === 429 && Number(limitedAnswer.headers.get("retry-after")) > 0 && limitedAnswer.data.code === "rate_limited");
  const elsewhere = await post(payload("neighbour", { weeks: ["aug17"], children: kids(1, "N") }), { ip: newIp() });
  check("another connection is not affected", elsewhere.status === 200);
  check("hitting the limit created no extra reservations", (await registrations()) === REGISTRATION_LIMITS.newPerIpPerHour + 1);
  check("refused attempts did not push the counter past the limit", (await hitsFor("register-ip")) <= REGISTRATION_LIMITS.newPerIpPerHour + 1);

  // An hour later the window has rolled over.
  await pool.query(`UPDATE rate_limit_counters SET window_start = window_start - interval '1 hour'`);
  const later = await post(payload("bot-after-hour", { weeks: ["aug10"], children: kids(1, "BH") }), { ip });
  check("an hour later the same connection can register again", later.status === 200, `${later.status}`);

  // A family cannot be hit by the per-email limit before the 8-unpaid limit, and paying resets nothing it should not.
  await freshState();
  const email = "very.busy@example.test";
  const phone = "438-555-0100";
  const results = [];
  for (let i = 0; i < REGISTRATION_LIMITS.newPerEmailPerHour + 1; i++) {
    const r = await post(payload(`busy${i}`, { email, primaryPhone: phone, weeks: ["jul13"], children: kids(1, `Busy${i}`) }), { ip: newIp() });
    results.push(r);
    if (r.data.reference) {
      const id = (await pool.query(`SELECT id FROM registrations WHERE reference_code = $1`, [r.data.reference])).rows[0].id;
      await confirmFor(id); // pay as they go, so the unpaid limit never applies
    }
  }
  const okCount = results.filter((r) => r.status === 200).length;
  check(`one email address can make ${REGISTRATION_LIMITS.newPerEmailPerHour} reservations an hour (paying as they go)`, okCount === REGISTRATION_LIMITS.newPerEmailPerHour, results.map((r) => r.status).join(","));
  check("the next one in the same hour is slowed down, politely", results.at(-1).status === 429 && results.at(-1).data.code === "rate_limited");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. A second registration for the same child and week is not created ===");
{
  await freshState();
  const family = { email: "tremblay.family@example.test", primaryPhone: "514-555-0177" };
  const emile = { fullName: "Émile Tremblay", dateOfBirth: "2016-05-05", age: "10", healthInfo: "none" };
  const first = await post(payload("dup", { ...family, children: [emile], weeks: ["jul06", "jul13"] }));
  check("the first registration is accepted", first.status === 200);

  // The parent never got the email, so they fill the form in again (a brand-new idempotency key).
  const again = await post(payload("dup-again", { ...family, children: [{ ...emile, fullName: "emile  TREMBLAY" }], weeks: ["jul06", "jul13"] }));
  check("registering the same child for the same weeks again is refused, politely", again.status === 409 && again.data.code === "already_registered", `${again.status} ${again.data.error}`);
  check("the refusal gives no link and no reference", !again.data.statusPath && !again.data.reference);
  check("it names the child as the parent typed them, and both weeks",
    again.data.error.includes("emile  TREMBLAY") && again.data.error.includes("July 6, 7, 8 & 9") && again.data.error.includes("July 13, 14, 15 & 16"), again.data.error);
  check("no second reservation was made", (await registrations()) === 1);
  check("the first reservation's payment instructions are to be re-sent (to the address on file)",
    again.calls.duplicate.length === 1 && again.calls.duplicate[0].registrationIds.length === 1);
  check("the refused attempt used none of the allowance", (await hitsFor("register-ip")) === 1 && (await hitsFor("register-email")) === 1);

  const partial = await post(payload("dup-partial", { ...family, children: [emile], weeks: ["jul13", "jul20"] }));
  check("overlapping on just one week is refused too (a child cannot attend a week twice)", partial.status === 409 && partial.data.code === "already_registered");
  const newWeek = await post(payload("dup-newweek", { ...family, children: [emile], weeks: ["jul20", "jul27"] }));
  check("the same child for different weeks is fine", newWeek.status === 200, `${newWeek.status} ${newWeek.data.error ?? ""}`);
  const sibling = await post(payload("dup-sibling", { ...family, children: [{ fullName: "Zoé Tremblay", dateOfBirth: "2018-03-03", age: "8", healthInfo: "none" }], weeks: ["jul06", "jul13"] }));
  check("a sibling in the same weeks is fine", sibling.status === 200, `${sibling.status} ${sibling.data.error ?? ""}`);
  const phoneOnly = await post(payload("dup-phone", { email: "other.address@example.test", primaryPhone: "(514) 555-0177", children: [emile], weeks: ["jul06"] }));
  check("the same phone number with another email is still the same family", phoneOnly.status === 409 && phoneOnly.data.code === "already_registered");
  const stranger = await post(payload("dup-stranger", { email: "unrelated@example.test", primaryPhone: "514-555-0999", children: [emile], weeks: ["jul06"] }));
  check("an unrelated family with a same-named child is not affected", stranger.status === 200);

  // Paid and released reservations.
  const firstId = (await pool.query(`SELECT id FROM registrations WHERE reference_code = $1`, [first.data.reference])).rows[0].id;
  await confirmFor(firstId);
  const afterPaid = await post(payload("dup-paid", { ...family, children: [emile], weeks: ["jul06"] }));
  check("a child who has already PAID for a week cannot be registered for it again", afterPaid.status === 409 && afterPaid.data.code === "already_registered");
  check("and since it is paid, nothing is re-sent", afterPaid.calls.duplicate.length === 0 && /unpaid/.test(afterPaid.data.error) === false);
  await campDb.cancelRegistration(firstId, "family changed plans", { releaseReason: "owner_cancelled" });
  const afterRelease = await post(payload("dup-released", { ...family, children: [emile], weeks: ["jul06"] }));
  check("once that reservation is released the child can be registered again", afterRelease.status === 200, `${afterRelease.status} ${afterRelease.data.error ?? ""}`);
  await invariants("duplicates");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Double-clicks and races ===");
{
  await freshState();
  const body = payload("race", { email: "double.click@example.test", children: kids(2, "Race"), weeks: ["jul06", "jul13", "jul20"] });
  const same = await Promise.all(Array.from({ length: 6 }, () => post(body, { ip: newIp() })));
  check("six simultaneous copies of one submission all succeed", same.every((r) => r.status === 200), same.map((r) => r.status).join(","));
  check("they all return the same reservation", new Set(same.map((r) => r.data.reference)).size === 1);
  check("exactly one reservation holds 2 children x 3 weeks = 6 spots", (await registrations()) === 1 && (await h.activeSpots("jul06")) === 2);
  check("the follow-up ran exactly once", same.reduce((n, r) => n + r.calls.created.length, 0) === 1);

  await freshState();
  const base = payload("race2", { email: "impatient.parent@example.test", children: kids(1, "Imp"), weeks: ["aug03"] });
  const copies = await Promise.all(Array.from({ length: 5 }, (_, i) => post({ ...base, idempotencyKey: `impatient-copy-${i}-aaaaaaaa` }, { ip: newIp() })));
  const created = copies.filter((r) => r.status === 200).length;
  const refusedAsDuplicate = copies.filter((r) => r.status === 409 && r.data.code === "already_registered").length;
  check("five different-key copies of one submission: exactly one reservation is made", created === 1 && refusedAsDuplicate === 4, copies.map((r) => r.status).join(","));
  check("and the week holds exactly one place", (await h.activeSpots("aug03")) === 1 && (await registrations()) === 1);
  await invariants("races");
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Bad requests are turned away cleanly ===");
{
  await freshState();
  const good = payload("hygiene", { email: "hygiene@example.test" });
  const ip = newIp();
  const r1 = await post(null, { ip, raw: "{not json" });
  check("malformed JSON is a 400", r1.status === 400);
  const r2 = await post(null, { ip, raw: JSON.stringify([1, 2, 3]) });
  check("a JSON array instead of an object is a 400", r2.status === 400);
  const r3 = await post(good, { ip, headers: { "content-length": String(REGISTRATION_LIMITS.maxBodyBytes + 1) } });
  check("an oversize body is refused", r3.status === 413);
  const cases = {
    "a key with odd characters": { ...good, idempotencyKey: "bad key!" },
    "a key that is too short": { ...good, idempotencyKey: "abc" },
    "a future birth date": { ...good, children: [{ ...good.children[0], dateOfBirth: "2999-01-01" }] },
    "a birth date that is not a date": { ...good, children: [{ ...good.children[0], dateOfBirth: "2018-02-31" }] },
    "a birth date 60 years ago": { ...good, children: [{ ...good.children[0], dateOfBirth: "1960-01-01" }] },
    "13 children": { ...good, children: kids(13, "Many") },
    "the same child listed twice": { ...good, children: [good.children[0], { ...good.children[0], fullName: good.children[0].fullName.toUpperCase() }] },
    "a 10,000-character health note": { ...good, children: [{ ...good.children[0], healthInfo: "x".repeat(10_000) }] },
    "a non-string email": { ...good, email: { a: 1 } },
    "consent given as the string 'true'": { ...good, consentAccepted: "true" },
  };
  for (const [label, body] of Object.entries(cases)) {
    const r = await post(body, { ip });
    check(`${label}: a 400 with a plain message`, r.status === 400 && typeof r.data.error === "string" && typeof r.data.code === "string", `${r.status} ${r.data.code}`);
  }
  check("none of that created a reservation or used any allowance", (await registrations()) === 0 && (await hitsFor("register")) === 0);
  const twelve = await post(payload("twelve", { email: "twelve@example.test", children: kids(12, "Tw"), weeks: ["jul06"] }), { ip });
  check("exactly 12 children in one registration is accepted", twelve.status === 200, `${twelve.status} ${twelve.data.error ?? ""}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. Follow-up work can never fail or delay the reservation ===");
{
  await freshState();
  const ip = newIp();
  const throwing = await post(payload("throwing", { email: "hooks@example.test" }), {
    ip,
    hooks: {
      onCreated: async () => {
        throw new Error("sheets and email are both down");
      },
    },
  });
  check("an exception in the follow-up still returns the parent's reservation", throwing.status === 200 && Boolean(throwing.data.statusPath));
  check("the reservation is committed regardless", (await registrations()) === 1);
  const token = throwing.data.statusPath.split("/").pop();
  check("the private link in the answer is genuine", registrationIdFromToken(token) !== null);
  check("a tampered link is not", registrationIdFromToken(token.slice(0, -2) + "xx") === null);

  const secret = process.env.REGISTRATION_LINK_SECRET;
  const nodeEnv = process.env.NODE_ENV;
  delete process.env.REGISTRATION_LINK_SECRET;
  process.env.NODE_ENV = "production";
  const noSecret = await post(payload("nosecret", { email: "nosecret@example.test" }), { ip });
  process.env.REGISTRATION_LINK_SECRET = secret;
  process.env.NODE_ENV = nodeEnv;
  check("without the link secret in production, registration is switched off instead of making unreachable reservations", noSecret.status === 503 && (await registrations()) === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. The flood limit ===");
{
  await freshState();
  const ip = newIp();
  for (let i = 0; i < REGISTRATION_LIMITS.floodPerIpPerHour; i++) await rateLimit("register-flood", ip, REGISTRATION_LIMITS.floodPerIpPerHour, 3600);
  const r = await post(payload("flood", { email: "flood@example.test" }), { ip });
  check("a connection that has made 300 well-formed attempts this hour is stopped", r.status === 429);
  const mistake = await post({ ...payload("flood2"), parentName: "" }, { ip });
  check("form mistakes are still answered plainly (they never reach the counters)", mistake.status === 400);
}

await resetAll();
await pool.end();
await testDb.drop();
process.exit(h.finish("registration-flow"));
