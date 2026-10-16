// The waiting list over HTTP, against the real production server and a recording mail server:
// a family joins (in English and in French) and gets its acknowledgement; the owner's three routes
// are behind the login and the same-site check; the owner can email a family only while the week
// has room; and the server's log holds no one's details.

import { createTestDatabase } from "./helpers/testdb.mjs";
import { startApp, adminSession } from "./helpers/app.mjs";
import { startSmtpSink } from "../../scripts/lib/smtpSink.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const sink = await startSmtpSink();
const app = await startApp({
  env: { DATABASE_URL: process.env.DATABASE_URL, WAITLIST_ENABLED: "true", SMTP_HOST: sink.host, SMTP_PORT: String(sink.port), SMTP_INSECURE: "true", EMAIL_FROM: "camp@example.test", COACH_NOTICE_MODE: "off" },
});
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, fill } = h;

const W = "2027-07-19";
const W2 = "2027-07-26";
let ip = 0;
const nextIp = () => `198.51.100.${(++ip % 250) + 1}`;
const post = (path, body, headers = {}) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers }, body: JSON.stringify(body) });
const cron = () => fetch(`${app.url}/api/cron/payment-review`, { headers: { authorization: "Bearer test-only-cron-secret-0123456789" } });
const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return fn();
};

await fill(W, 30, "full");
await cron();
sink.messages.length = 0;
const GOOD = { parentName: "Mélanie Côté", email: "melanie.wait@example.test", phone: "438-555-0123", placesWanted: 2, weeks: [W], consentAccepted: true };

console.log("=== 0. Who is offered the list ===");
{
  const cap = await (await fetch(`${app.url}/api/camp-capacity`)).json();
  check("only a week that is really full is offered the list", cap.weeks[W].waitlistable === true && cap.weeks[W2].waitlistable === false && cap.weeks["2027-06-21"].waitlistable === false);
  await pool.query(`UPDATE camp_weeks SET is_open = false WHERE id = $1`, [W2]);
  const closed = await (await fetch(`${app.url}/api/camp-capacity`)).json();
  check("a week the owner merely closed (with room) is shown as full but is NOT offered the list", closed.weeks[W2].full === true && closed.weeks[W2].waitlistable === false);
  await pool.query(`UPDATE camp_weeks SET is_open = true WHERE id = $1`, [W2]);

  const off = await startApp({ build: false, env: { DATABASE_URL: process.env.DATABASE_URL, WAITLIST_ENABLED: "" } });
  try {
    const capOff = await (await fetch(`${off.url}/api/camp-capacity`)).json();
    check("with the switch off the page is not offered the list for any week", Object.values(capOff.weeks).every((w) => w.waitlistable === false));
    const refused = await fetch(`${off.url}/api/camp-waitlist`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ ...{ parentName: "A B", email: "off@example.test", placesWanted: 1, weeks: [W], consentAccepted: true }, language: "en" }) });
    check("and the endpoint refuses (404, 'waitlist_off')", refused.status === 404 && (await refused.json()).code === "waitlist_off");
    const adminOff = await adminSession(off);
    const view = await (await fetch(`${off.url}/api/admin/waitlist`, { headers: { cookie: adminOff.cookie, "x-forwarded-for": nextIp() } })).json();
    check("the owner's panel says it is switched off", view.enabled === false);
  } finally {
    await off.stop();
  }
}

console.log("\n=== 1. A family joins the waiting list ===");
{
  const fr = await post("/api/camp-waitlist", { ...GOOD, language: "fr" });
  const frBody = await fr.json();
  check("a French family joins a full week", fr.status === 200 && frBody.success === true && /Il ne s’agit pas d’une inscription/.test(frBody.message), JSON.stringify(frBody));
  const ack = await waitFor(() => sink.to("melanie.wait@example.test")[0]);
  check("the acknowledgement arrives within seconds, in French, and holds nothing", Boolean(ack) && /liste d’attente/.test(ack.subject) && /aucune place ne vous est réservée/.test(ack.text), ack?.subject);

  const en = await post("/api/camp-waitlist", { ...GOOD, parentName: "Jordan Smith", email: "jordan.wait@example.test", language: "en" });
  const enAck = await waitFor(() => sink.to("jordan.wait@example.test")[0]);
  check("an English family gets an English acknowledgement", en.status === 200 && Boolean(enAck) && /You are on the waiting list/.test(enAck.subject) && /no place is being held/.test(enAck.text), enAck?.subject);

  const room = await post("/api/camp-waitlist", { ...GOOD, email: "room@example.test", weeks: [W2], language: "en" });
  const roomBody = await room.json();
  check("a week with room is refused: register instead", room.status === 409 && roomBody.code === "week_has_room");
  const noConsent = await post("/api/camp-waitlist", { ...GOOD, email: "nc@example.test", consentAccepted: false });
  check("without the tick box it is refused", noConsent.status === 400 && (await noConsent.json()).code === "consent_required");
  const big = await fetch(`${app.url}/api/camp-waitlist`, { method: "POST", headers: { "content-type": "application/json", "content-length": "99999", "x-forwarded-for": nextIp() }, body: JSON.stringify({ x: "y" }) }).catch(() => null);
  check("an oversized request is refused", big === null || big.status === 413 || big.status === 400);
  check("GET is not a way in", (await fetch(`${app.url}/api/camp-waitlist`)).status === 405);
  check("nothing on the week changed", (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id = $1`, [W])).rows[0].taken_count === 30);
}

console.log("\n=== 2. The owner's three routes ===");
{
  const entries = (await pool.query(`SELECT id FROM waitlist_entries WHERE week_id = $1 ORDER BY created_at`, [W])).rows.map((r) => r.id);
  const [first, second] = entries;
  const noLogin = await Promise.all([
    fetch(`${app.url}/api/admin/waitlist`, { headers: { "x-forwarded-for": nextIp() } }),
    post(`/api/admin/waitlist/${first}/notify`, {}),
    post(`/api/admin/waitlist/${first}/remove`, {}),
  ]);
  check("without the owner's login all three answer 401", noLogin.every((r) => r.status === 401), noLogin.map((r) => r.status).join());

  const session = await adminSession(app);
  const hdr = { cookie: session.cookie, origin: app.url };
  const admin = (method, path, body, extra = {}) =>
    fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...hdr, ...extra }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });

  const list = await (await admin("GET", "/api/admin/waitlist")).json();
  check("the list shows the families in order, the week full", list.weeks.length === 1 && list.weeks[0].entries.length === 2 && list.weeks[0].remaining === 0 && list.weeks[0].entries[0].parentName === "Mélanie Côté");

  const full = await admin("POST", `/api/admin/waitlist/${first}/notify`);
  const fullBody = await full.json();
  check("while the week is full the owner cannot send: 409, in plain words, nothing sent", full.status === 409 && fullBody.code === "week_full" && /Nothing was sent/.test(fullBody.error));
  const cross = await admin("POST", `/api/admin/waitlist/${first}/notify`, {}, { origin: "https://evil.example" });
  check("a request from another website is refused", cross.status === 403);
  const badId = await admin("POST", `/api/admin/waitlist/not-an-id/notify`);
  check("a made-up id is a 404", badId.status === 404);

  const holder = (await pool.query(`SELECT registration_id FROM registration_spots WHERE week_id = $1 AND status = 'active' LIMIT 1`, [W])).rows[0].registration_id;
  await campDb.cancelRegistration(holder, "withdrew", { releaseReason: "owner_cancelled", notifyParent: false });
  sink.messages.length = 0;
  const sent = await admin("POST", `/api/admin/waitlist/${first}/notify`);
  check("a place opens: the owner can email the first family", sent.status === 200 && (await sent.json()).notifiedCount === 1);
  const notice = await waitFor(() => sink.to("melanie.wait@example.test")[0]);
  check("the family receives the notice, in French, with nothing held and no promise", Boolean(notice) && /s’est peut-être libérée/.test(notice.subject) && /Aucune place ne vous est réservée/.test(notice.text) && /ne pouvons pas promettre/.test(notice.text), notice?.subject);
  check("and it links to the camp page, not to any private page", /\/fr\/camps-juniors/.test(notice.text) && !/inscription-camp\/|camp-registration\//.test(notice.text));
  check("the other family was not emailed", sink.to("jordan.wait@example.test").length === 0);
  const taken = (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id = $1`, [W])).rows[0].taken_count;
  check("the week still has its free place: telling a family held nothing", taken === 29);
  const again = await admin("POST", `/api/admin/waitlist/${first}/notify`);
  check("the same family cannot be emailed again straight away", again.status === 409 && (await again.json()).code === "too_soon");

  const removed = await admin("POST", `/api/admin/waitlist/${second}/remove`);
  check("the owner removes the second family", removed.status === 200);
  const gone = await admin("POST", `/api/admin/waitlist/${second}/remove`);
  check("removing twice says it is gone (404)", gone.status === 404);
  const after = await (await admin("GET", "/api/admin/waitlist")).json();
  check("the list now has one family, week with one free place", after.weeks[0].entries.length === 1 && after.weeks[0].remaining === 1);
}

console.log("\n=== 3. What the server's log holds ===");
{
  await cron();
  const logs = app.logs.join("");
  check("no name, email address or phone number appears in the server's log", !/Mélanie|Jordan|Côté|melanie\.wait|jordan\.wait|438-555-0123/.test(logs));
}

await app.stop();
await sink.stop();
await pool.end();
await testDb.drop();
process.exit(h.finish("waitlist-http"));
