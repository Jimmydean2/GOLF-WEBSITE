// The optional waiting list for full weeks: it must never promise or assign a place.
//   1. Who can join: only full weeks; every form mistake is refused plainly in the family's language;
//      a repeat is harmless; flooding is limited.
//   2. It can never hold or book anything: structurally (no link to registrations or spots), by a
//      source scan (no code on the list writes registrations, spots or capacity), and by behaviour
//      (a place opening up changes nothing on the list, and the list changes nothing on the week).
//   3. The owner can email a family "a place MAY be open" only while the week really has room, only
//      to families not already registered, never more than three times; the email promises nothing.
//   4. Two families told about one free place: the ordinary registration rules decide, nobody is displaced.
//   5. The emails use the same safe queue as every other email: recorded with the request, sent once,
//      retried, skipped once the family is removed.
//   6. Privacy: the family's copy of their data includes it; erasing a family erases it; it is deleted
//      once its camp week has passed; the audit log holds no personal details.
// Real Postgres, the real service code, a fake mailer. Nothing else is mocked.

import { readFileSync } from "node:fs";
import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "10";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
process.env.SEASON_PREVIEW = "true";
process.env.WAITLIST_ENABLED = "true";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, resetAll, reserveOk, confirmFor, fill, week, reg, invariants } = h;
const { handleWaitlistRequest } = await import("../../src/lib/waitlistService.ts");
const waitlist = await import("../../src/lib/waitlist.ts");
const outbox = await import("../../src/lib/outbox.ts");
const { eraseFamily, exportFamilyData, applyRetention } = await import("../../src/lib/privacyData.ts");
const { labelForWeekId } = await import("../../src/lib/season.ts");

const W = "2027-07-19";
const W2 = "2027-07-26";
const ORIGIN = "https://camp.example.test";

let ipCounter = 0;
const join = (body, { ip, lang } = {}) =>
  handleWaitlistRequest(
    new Request("https://camp.example.test/api/camp-waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `203.0.113.${(++ipCounter % 240) + 1}` },
      body: JSON.stringify({ language: lang ?? "en", ...body }),
    })
  );
const good = (extra = {}) => ({ parentName: "Jordan Smith", email: "jordan@example.test", phone: "514-555-0100", placesWanted: 2, weeks: [W], consentAccepted: true, ...extra });
const answer = async (response) => ({ status: response.status, ...(await response.json()) });
const mailer = () => {
  const sent = [];
  return { sent, send: async (m) => void sent.push(m) };
};
const run = (m, extra = {}) => outbox.processOutbox({ origin: ORIGIN, send: m.send, adminEmails: ["owner@example.test"], coachMode: "off", ...extra });
const entries = async (where = "TRUE", params = []) => (await pool.query(`SELECT * FROM waitlist_entries WHERE ${where} ORDER BY created_at, id`, params)).rows;
const waitMails = async () => (await pool.query(`SELECT * FROM email_outbox WHERE kind IN ('waitlist_ack','waitlist_notify') ORDER BY id`)).rows;
// The filler families the tests create queue their own emails; only the list's emails matter here.
const clearFamilyMail = () => pool.query(`DELETE FROM email_outbox WHERE waitlist_entry_id IS NULL`);
const reset = async () => {
  await resetAll();
  await pool.query(`DELETE FROM waitlist_entries`);
  await pool.query(`DELETE FROM rate_limit_counters`);
};
const snapshotWeeksAndRegistrations = async () =>
  JSON.stringify([
    (await pool.query(`SELECT to_jsonb(w) AS r FROM camp_weeks w ORDER BY id`)).rows,
    (await pool.query(`SELECT to_jsonb(r) AS r FROM registrations r ORDER BY id`)).rows,
    (await pool.query(`SELECT to_jsonb(s) AS r FROM registration_spots s ORDER BY id`)).rows,
  ]);

// ---------------------------------------------------------------------------
console.log("=== 1. Who can join, and what is refused ===");
{
  await reset();
  await fill(W, 30, "full");
  check("setup: the week is full", (await week(W)).taken_count === 30);

  const ok = await answer(await join(good()));
  check("a family joins the waiting list for a full week", ok.status === 200 && ok.success === true && ok.added === 1, JSON.stringify(ok));
  check("the confirmation says it is not a registration and nothing is held", /not a registration/.test(ok.message) && /no place/i.test(ok.message), ok.message);
  const row = (await entries())[0];
  check("only contact details, the number of places, the language and the consent are stored", row.parent_name === "Jordan Smith" && row.places_wanted === 2 && row.language === "en" && row.consent_version.length > 3 && row.consent_recorded_at !== null && !("child_name" in row) && !("health_info" in row));

  const again = await answer(await join(good({ email: "JORDAN@example.test " })));
  check("joining twice (even with capital letters) is harmless: still one entry", again.status === 200 && again.alreadyOnList === 1 && (await entries()).length === 1);

  const room = await answer(await join(good({ email: "other@example.test", weeks: [W, W2] })));
  check("a week that still has room is refused: register instead", room.status === 409 && room.code === "week_has_room" && room.weekIds.join() === W2 && /still has places/.test(room.error), JSON.stringify(room));
  check("...and nothing was added for the full week either", (await entries()).length === 1);

  const bad = {
    "no name": good({ parentName: "" }),
    "no email": good({ email: "" }),
    "a bad email": good({ email: "not-an-email" }),
    "no week": good({ weeks: [] }),
    "an unknown week": good({ weeks: ["2099-01-01"] }),
    "a phone with letters": good({ phone: "call me" }),
    "a short phone": good({ phone: "555" }),
    "no consent": good({ consentAccepted: false }),
    "zero places": good({ placesWanted: 0 }),
    "seven places": good({ placesWanted: 7 }),
    "a name that is too long": good({ parentName: "x".repeat(200) }),
  };
  const results = {};
  for (const [label, body] of Object.entries(bad)) results[label] = await answer(await join({ ...body, email: body.email === "" || body.email === "not-an-email" ? body.email : `bad${++ipCounter}@example.test` }));
  check("every mistake is a plain 400 with a reason and a code", Object.values(results).every((r) => r.status === 400 && r.code && r.error), Object.entries(results).map(([k, v]) => `${k}:${v.status}`).join(" "));
  check("a family that leaves the phone blank is fine (it is optional)", (await join(good({ email: "nophone@example.test", phone: "" }))).status === 200);

  const fr = await answer(await join(good({ email: "famille@example.test", parentName: "", }), { lang: "fr" }));
  check("the same mistake in French is answered in French", fr.status === 400 && /veuillez/i.test(fr.error), fr.error);
  const frRoom = await answer(await join(good({ email: "famille2@example.test", weeks: [W2] }), { lang: "fr" }));
  check("a week with room, in French", frRoom.status === 409 && /Bonne nouvelle/.test(frRoom.error) && /formulaire/.test(frRoom.error), frRoom.error);

  const garbage = await join("not json at all");
  check("garbage in the request is a plain 400", garbage.status === 400);

  const flood = [];
  for (let i = 0; i < 8; i++) flood.push((await join(good({ email: "flood@example.test", weeks: [W] }), { ip: `198.51.100.${i + 1}` })).status);
  check("one email address cannot hammer the form: after 6 requests an hour it is slowed down (429)", flood.includes(429) && flood.slice(0, 6).every((s) => s === 200), flood.join());
  const ipFlood = [];
  for (let i = 0; i < 12; i++) ipFlood.push((await join(good({ email: `ipflood${i}@example.test`, weeks: [W] }), { ip: "192.0.2.77" })).status);
  check("one connection cannot hammer it either: after 10 an hour (429)", ipFlood.slice(0, 10).every((s) => s === 200) && ipFlood.slice(10).every((s) => s === 429), ipFlood.join());

  await pool.query(`UPDATE camp_weeks SET is_open = false WHERE id = $1`, [W]);
  const closedStill = await answer(await join(good({ email: "closed@example.test" })));
  check("a week that is merely closed but full can still be waited for", closedStill.status === 200);
  await pool.query(`UPDATE camp_weeks SET is_open = true WHERE id = $1`, [W]);

  const saved = process.env.SEASON_PREVIEW;
  delete process.env.SEASON_PREVIEW;
  const notOpen = await answer(await join(good({ email: "early@example.test" })));
  process.env.SEASON_PREVIEW = saved;
  check("while registration itself is not open, there is no waiting list either", notOpen.status === 403 && notOpen.code === "registration_not_open");

  const savedSwitch = process.env.WAITLIST_ENABLED;
  const countBefore = (await entries()).length;
  for (const off of [undefined, "", "false", "1", "yes", "TRUE"]) {
    if (off === undefined) delete process.env.WAITLIST_ENABLED;
    else process.env.WAITLIST_ENABLED = off;
    const refused = await answer(await join(good({ email: `off${++ipCounter}@example.test` })));
    check(`switched off (${off === undefined ? "not set" : JSON.stringify(off)}): the waiting list refuses, in plain words, and stores nothing`, refused.status === 404 && refused.code === "waitlist_off" && /not available/.test(refused.error) && (await entries()).length === countBefore, JSON.stringify(refused));
  }
  process.env.WAITLIST_ENABLED = savedSwitch;
  check("only the exact word 'true' switches it on", waitlist.isWaitlistEnabled({ WAITLIST_ENABLED: "true" }) && !["", "1", "yes", "TRUE", " true", undefined].some((v) => waitlist.isWaitlistEnabled({ WAITLIST_ENABLED: v })));
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. It can never hold or book a place ===");
{
  await reset();
  await fill(W, 30, "full");
  const before = await snapshotWeeksAndRegistrations();
  for (let i = 0; i < 5; i++) await join(good({ email: `wait${i}@example.test`, parentName: `Waiter ${i}` }));
  check("five families join: not a single week, registration or spot changed", (await snapshotWeeksAndRegistrations()) === before && (await entries()).length === 5);

  const fks = (await pool.query(
    `SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid = 'waitlist_entries'::regclass AND contype = 'f'`
  )).rows.map((r) => r.target);
  check("the table's only link is to the week's name: none to registrations, spots or capacity counters", fks.length === 1 && fks[0] === "camp_weeks", fks.join());
  const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'waitlist_entries'`)).rows.map((r) => r.column_name);
  check("it has no column for a child, a date of birth or a health note", !cols.some((c) => /child|birth|health|emergency|reference/.test(c)), cols.join());

  const files = ["src/lib/waitlist.ts", "src/lib/waitlistService.ts", "src/app/api/camp-waitlist/route.ts", "src/app/api/admin/waitlist/route.ts", "src/app/api/admin/waitlist/[id]/notify/route.ts", "src/app/api/admin/waitlist/[id]/remove/route.ts"];
  const code = files.map((f) => readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "")).join("\n");
  const writesBookings = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(registrations|registration_spots|children|contact_strikes)\b|UPDATE\s+camp_weeks|reserveRegistration|confirmRegistrationPayment|cancelRegistration|reinstateRegistration|authorizeWeekCapacity|adjustWeekCapacity|setWeekOpen/i.test(code);
  check("no waiting-list code writes a registration, a spot, a child or a week's capacity, and none calls the booking functions", !writesBookings);
  const outboxCode = readFileSync("src/lib/outbox.ts", "utf8");
  const waitBranch = outboxCode.slice(outboxCode.indexOf('if (row.kind === "waitlist_ack"'), outboxCode.indexOf("const registration = row.registration_id"));
  check("the part of the email queue that handles the list only builds and sends an email", !/UPDATE\s+(registrations|registration_spots|camp_weeks)|reserveRegistration|confirmRegistrationPayment/i.test(waitBranch) && waitBranch.length > 200);
  const scheduled = readFileSync("src/lib/scheduledCheck.ts", "utf8") + readFileSync("src/lib/alerts.ts", "utf8");
  check("nothing that runs on its own (the scheduled check, alerts) reads or acts on the waiting list", !/waitlist/i.test(scheduled));

  // A place opens up. Nothing may happen by itself.
  const holder = (await pool.query(`SELECT registration_id FROM registration_spots WHERE week_id = $1 AND status = 'active' LIMIT 1`, [W])).rows[0].registration_id;
  await campDb.cancelRegistration(holder, "family withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  check("setup: one place opens up", (await week(W)).taken_count === 29);
  await clearFamilyMail();
  const m = mailer();
  await run(m);
  await outbox.enqueueDueReminders();
  await run(m);
  check("when a place opens, no email goes to the list and nobody on it changes status", !m.sent.some((x) => /place may have opened|may be available/i.test(x.subject)) && (await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE kind = 'waitlist_notify'`)).rows[0].n === 0 && (await entries()).every((e) => e.status === "waiting" && e.notified_count === 0));
  const onlyAcks = (await waitMails()).every((r) => r.kind === "waitlist_ack");
  check("(the only emails queued for the list are the acknowledgements of joining)", onlyAcks);
  check("and the week still has exactly one free place and no registration was created for the list", (await week(W)).taken_count === 29 && (await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE parent_name LIKE 'Waiter%'`)).rows[0].n === 0);
  await invariants("after the list was used");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The owner's one action: tell a family a place MAY be open ===");
{
  await reset();
  const fillers = await fill(W, 30, "fullagain");
  await join(good({ email: "a@example.test", parentName: "Alex A" }));
  await join(good({ email: "b@example.test", parentName: "Blair B", weeks: [W] }));
  await join(good({ email: "c@example.test", parentName: "Chris C", weeks: [W] }));
  const list = await waitlist.listWaitlist();
  const entriesList = list[0].entries;
  check("the list is in the order families joined, with the week's state", list.length === 1 && entriesList.map((e) => e.parentName).join() === "Alex A,Blair B,Chris C" && list[0].remaining === 0 && list[0].taken === 30);
  const [a, b, c] = entriesList;
  const before = await snapshotWeeksAndRegistrations();

  const full = await waitlist.notifyWaitlistEntry(a.id);
  check("while the week is full the owner cannot email anyone", !full.ok && full.reason === "week_full" && (await waitMails()).filter((r) => r.kind === "waitlist_notify").length === 0);

  await campDb.cancelRegistration(fillers[0], "withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  const afterRelease = await snapshotWeeksAndRegistrations();
  check("a place opens: the list shows the week has room now", (await waitlist.listWaitlist())[0].remaining === 1);

  const first = await waitlist.notifyWaitlistEntry(a.id);
  check("now the owner can email the first family", first.ok && first.notifiedCount === 1);
  check("it queued exactly one email and changed no registration, spot or week", (await waitMails()).filter((r) => r.kind === "waitlist_notify").length === 1 && (await snapshotWeeksAndRegistrations()) === afterRelease);
  const tooSoon = await waitlist.notifyWaitlistEntry(a.id);
  check("the same family cannot be emailed again within 12 hours", !tooSoon.ok && tooSoon.reason === "too_soon");
  const later = new Date(Date.now() + 13 * 3600_000);
  const second = await waitlist.notifyWaitlistEntry(a.id, later);
  const third = await waitlist.notifyWaitlistEntry(a.id, new Date(later.getTime() + 13 * 3600_000));
  const fourth = await waitlist.notifyWaitlistEntry(a.id, new Date(later.getTime() + 26 * 3600_000));
  check("later it may be repeated, but never more than three times in all", second.ok && third.ok && !fourth.ok && fourth.reason === "too_many", `${second.ok}/${third.ok}/${fourth.reason}`);
  check("the database says so too (the count cannot exceed 3)", await pool.query(`UPDATE waitlist_entries SET notified_count = 4 WHERE id = $1`, [a.id]).then(() => false, (e) => e.code === "23514"));

  const unknown = await waitlist.notifyWaitlistEntry("00000000-0000-4000-8000-000000000000");
  check("an unknown entry is 'not found'", !unknown.ok && unknown.reason === "not_found");

  // Blair is already registered (a spot is free now and she took it the normal way).
  await reserveOk("blair-registered", { weekIds: [W], email: "b@example.test" });
  check("the week is full again", (await week(W)).taken_count === 30);
  await campDb.cancelRegistration(fillers[1], "withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  const registered = await waitlist.notifyWaitlistEntry(b.id);
  check("a family that already holds a place this week is not emailed", !registered.ok && registered.reason === "already_registered");
  const listNow = (await waitlist.listWaitlist())[0].entries.find((e) => e.id === b.id);
  check("and the list says so", listNow.alreadyRegistered === true);

  await pool.query(`UPDATE camp_weeks SET is_open = false WHERE id = $1`, [W]);
  const closed = await waitlist.notifyWaitlistEntry(c.id);
  check("a closed week cannot be announced", !closed.ok && closed.reason === "week_closed");
  await pool.query(`UPDATE camp_weeks SET is_open = true WHERE id = $1`, [W]);
  void before;
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. One free place, two families told: the ordinary rules decide, nobody is displaced ===");
{
  await reset();
  const fillers = await fill(W, 30, "race");
  const keep = await confirmFor(fillers[1]);
  void keep;
  await join(good({ email: "p@example.test", parentName: "Pat P", placesWanted: 1 }));
  await join(good({ email: "q@example.test", parentName: "Quinn Q", placesWanted: 1 }));
  const [p, q] = (await waitlist.listWaitlist())[0].entries;
  await campDb.cancelRegistration(fillers[0], "withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  check("one place is free and the owner tells both families", (await waitlist.notifyWaitlistEntry(p.id)).ok && (await waitlist.notifyWaitlistEntry(q.id)).ok);
  const snapshotHolders = JSON.stringify((await pool.query(`SELECT id, status FROM registrations WHERE id <> ALL($1::uuid[]) ORDER BY id`, [[]])).rows);
  const [x, y] = await Promise.allSettled([
    campDb.reserveRegistration(h.input("pat", { email: "p@example.test", weekIds: [W], children: [{ fullName: "Pat Child", dateOfBirth: "2017-01-01", age: "9", healthInfo: "None" }] })),
    campDb.reserveRegistration(h.input("quinn", { email: "q@example.test", weekIds: [W], children: [{ fullName: "Quinn Child", dateOfBirth: "2017-02-02", age: "9", healthInfo: "None" }] })),
  ]);
  const outcomes = [x, y].map((r) => (r.status === "fulfilled" && r.value.ok ? "registered" : r.status === "fulfilled" ? r.value.reason : "error"));
  check("they register the ordinary way: exactly one gets the place, the other is told the week is full", outcomes.filter((o) => o === "registered").length === 1 && outcomes.includes("weeks_full"), outcomes.join());
  check("the week is exactly full, and the confirmed family still holds its place", (await week(W)).taken_count === 30 && (await reg(fillers[1])).status === "paid" && (await reg(fillers[1])).spotsActive === 1);
  void snapshotHolders;
  await invariants("after two families were told about one place");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. The two emails: safe queue, honest wording, both languages ===");
{
  await reset();
  await fill(W, 30, "mail");
  await fill(W2, 30, "mail");
  await clearFamilyMail();
  const res = await answer(await join(good({ email: "mom@example.test", parentName: "Mélanie Côté", weeks: [W, W2], placesWanted: 2 }, ), { lang: "fr" }));
  check("a French family joins two full weeks in one request", res.status === 200 && res.added === 2, JSON.stringify(res));
  const queued = await waitMails();
  check("ONE acknowledgement is recorded with the request (not one per week)", queued.length === 1 && queued[0].kind === "waitlist_ack" && queued[0].status === "pending" && queued[0].registration_id === null);
  const m = mailer();
  const summary = await run(m);
  check("it is sent once, to the family", summary.sent === 1 && m.sent.length === 1 && m.sent[0].to === "mom@example.test", JSON.stringify(summary));
  const ack = m.sent[0];
  check("in French, naming both weeks", /Vous êtes sur la liste d’attente/.test(ack.subject) && ack.text.includes(labelForWeekId(W, "fr")) && ack.text.includes(labelForWeekId(W2, "fr")), ack.subject);
  check("and it promises nothing: not a registration, no place held, no guarantee, first come first served", /Il ne s’agit pas d’une inscription/.test(ack.text) && /aucune place ne vous est réservée/.test(ack.text) && /ne pouvons pas promettre/.test(ack.text) && /ordre des inscriptions/.test(ack.text));
  check("it carries no child or health detail and no private link", !/dateOfBirth|health|santé|camp-registration|inscription-camp\//i.test(ack.text.replace(/inscription-camp/g, "")));
  check("running the queue again sends nothing more (once only)", (await run(m)).sent === 0 && m.sent.length === 1);

  const entry = (await waitlist.listWaitlist())[0].entries[0];
  const w1 = (await waitlist.listWaitlist())[0];
  void w1;
  const holder = (await pool.query(`SELECT registration_id FROM registration_spots WHERE week_id = $1 AND status = 'active' LIMIT 1`, [W])).rows[0].registration_id;
  await campDb.cancelRegistration(holder, "withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  check("the owner emails her", (await waitlist.notifyWaitlistEntry(entry.id)).ok);
  const m2 = mailer();
  await run(m2);
  const notice = m2.sent.find((x) => /s’est peut-être libérée/.test(x.subject));
  check("the notice is in French and about that one week", Boolean(notice) && notice.text.includes(labelForWeekId(W, "fr")) && !notice.text.includes(labelForWeekId(W2, "fr")));
  check("it says nothing is held and nothing is promised, and links to the camp page", /Aucune place ne vous est réservée/.test(notice.text) && /ne pouvons pas promettre/.test(notice.text) && /\/fr\/camps-juniors/.test(notice.text) && !/camp-registration|inscription-camp\//.test(notice.text.replace(/\/fr\/camps-juniors/g, "")));

  // English version and failure handling.
  await join(good({ email: "dad@example.test", parentName: "Dan D", weeks: [W2] }));
  const dan = (await waitlist.listWaitlist()).find((x) => x.weekId === W2).entries.find((e) => e.email === "dad@example.test");
  const flaky = mailer();
  let calls = 0;
  const failing = { sent: flaky.sent, send: async (msg) => { calls++; if (calls <= 1) throw Object.assign(new Error("421 try later"), { responseCode: 421, response: "421 4.7.0 try later" }); flaky.sent.push(msg); } };
  const first = await run(failing);
  check("a mail server that is down does not lose the acknowledgement: it stays queued", first.sent === 0 && (await waitMails()).some((r) => r.status === "pending" && r.attempts >= 1));
  await pool.query(`UPDATE email_outbox SET next_attempt_at = now() - interval '1 minute' WHERE status = 'pending'`);
  const second = await run(failing);
  check("and goes out when the server recovers", second.sent >= 1 && flaky.sent.some((x) => x.to === "dad@example.test" && /You are on the waiting list/.test(x.subject)), JSON.stringify(second));

  // Removed before the email is sent.
  await join(good({ email: "gone@example.test", parentName: "Gone G", weeks: [W2] }));
  const gone = (await waitlist.listWaitlist()).find((x) => x.weekId === W2).entries.find((e) => e.email === "gone@example.test");
  check("removing a family deletes its entry", await waitlist.removeWaitlistEntry(gone.id));
  check("...and the email still waiting for it disappears with it", (await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE waitlist_entry_id = $1`, [gone.id])).rows[0].n === 0);
  const m3 = mailer();
  await run(m3);
  check("nothing is sent to a family that was removed", !m3.sent.some((x) => x.to === "gone@example.test"));
  check("removing again says it is gone", (await waitlist.removeWaitlistEntry(gone.id)) === false);
  void dan;

  const health = await outbox.getEmailHealth();
  check("the dashboard's email health still works with list emails in the queue", typeof health.waiting === "number");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Privacy: copy, erase, delete after the week, no personal details in the log ===");
{
  await reset();
  await fill(W, 30, "priv");
  const family = await reserveOk("priv-family", { weekIds: [W2], email: "same@example.test", parentName: "Sam Same", children: [{ fullName: "Same Child", dateOfBirth: "2017-03-03", age: "9", healthInfo: "None" }] });
  await join(good({ email: "same@example.test", parentName: "Sam Same", weeks: [W] }));
  await join(good({ email: "other@example.test", parentName: "Olive Other", weeks: [W] }));
  const copy = await exportFamilyData(family);
  check("a family's copy of their data lists their waiting-list request", copy.waitingList.length === 1 && copy.waitingList[0].placesWanted === 2 && copy.waitingList[0].week.includes("July"), JSON.stringify(copy.waitingList));
  const [mine] = (await waitlist.listWaitlist())[0].entries.filter((e) => e.email === "same@example.test");
  await waitlist.notifyWaitlistEntry(mine.id).catch(() => {});
  const holder = (await pool.query(`SELECT registration_id FROM registration_spots WHERE week_id = $1 AND status = 'active' LIMIT 1`, [W])).rows[0].registration_id;
  await campDb.cancelRegistration(holder, "withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  await waitlist.notifyWaitlistEntry(mine.id);
  await waitlist.removeWaitlistEntry((await waitlist.listWaitlist())[0].entries.find((e) => e.email === "other@example.test").id);
  const audit = JSON.stringify((await pool.query(`SELECT action, target_type, target_id, details FROM admin_audit_log WHERE action LIKE 'waitlist_%'`)).rows);
  check("the activity log records that the owner emailed and removed, with no names, emails or phones", /waitlist_notify/.test(audit) && /waitlist_remove/.test(audit) && !/Sam|Same|Olive|Other|example\.test|514/.test(audit), audit.slice(0, 200));

  await reserveOk("refill", { weekIds: [W] }); // the place that opened is taken again, so the week is full
  await join(good({ email: "other@example.test", parentName: "Olive Other", weeks: [W] }));
  await eraseFamily(family);
  check("erasing a family also erases a waiting-list request made with their email", (await entries("email_key = $1", ["same@example.test"])).length === 0 && (await entries("email_key = $1", ["other@example.test"])).length === 1);
  check("...and the emails queued for it", (await pool.query(`SELECT count(*)::int AS n FROM email_outbox o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id WHERE w.email_key = 'same@example.test'`)).rows[0].n === 0);

  const endDate = (await pool.query(`SELECT to_char(end_date, 'YYYY-MM-DD') AS d FROM camp_weeks WHERE id = $1`, [W])).rows[0].d;
  const noon = (iso, plusDays = 0) => new Date(Date.parse(`${iso}T16:00:00Z`) + plusDays * 86_400_000);
  const early = await applyRetention(noon(endDate, -3));
  check("the season clean-up keeps a request while its week has not passed", (await entries()).length === 1 && early.purgedWaitlist === 0);
  const during = await applyRetention(noon(endDate, 0));
  check("...including the week's own last day", (await entries()).length === 1 && during.purgedWaitlist === 0, endDate);
  const after = await applyRetention(noon(endDate, 1));
  check("once the camp week has passed it is deleted", (await entries()).length === 0 && after.purgedWaitlist === 1);
  const leftovers = JSON.stringify([(await pool.query(`SELECT * FROM waitlist_entries`)).rows, (await pool.query(`SELECT * FROM email_outbox WHERE waitlist_entry_id IS NOT NULL`)).rows]);
  check("nothing of it is left anywhere", !/other@example|Olive/.test(leftovers));
}

await pool.end();
await testDb.drop();
process.exit(h.finish("waitlist"));
