// The camp calendar (src/lib/season.ts) and everything derived from it.
//
// Why this suite exists: the site was written for the 2026 camps, and its week labels no longer
// matched the 2027 weekdays. The calendar is now written down once; this suite proves that the
// labels, the database seed, the owner's document, the registration gate and the preflight all
// agree with it, and that the calendar itself obeys the rules of the real 2027 calendar.

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase } from "./helpers/testdb.mjs";
import {
  season,
  SEASON_YEAR,
  isoWeekday,
  mondayOf,
  addDaysIso,
  parseIsoDate,
  labelEn,
  labelFr,
  shortLabel,
  formatDayLong,
  labelForWeekId,
  seasonRange,
  quebecSummerHolidays,
  parseOpensAt,
} from "../../src/lib/season.ts";
import { juniorCamps } from "../../src/lib/content.ts";
import { registrationWindow, isSeasonPublic, configuredOpensAt } from "../../src/lib/registrationWindow.ts";
import { renderSeedSql, spliceCalendarIntoDoc } from "../../scripts/lib/seasonFiles.mjs";

process.env.DB_POOL_MAX ||= "5";
process.env.REGISTRATION_LINK_SECRET = "test-only-registration-link-secret-0123456789";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const { handleRegistrationRequest } = await import("../../src/lib/registrationService.ts");
const h = createHarness();
const { pool, check } = h;

const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------------------
console.log("=== 1. The calendar arithmetic is right (the facts that made the old labels wrong) ===");
{
  check("June 21, 2027 is a Monday", isoWeekday("2027-06-21") === 1);
  check("June 22, 2027 is a TUESDAY (the old label began the first week there)", isoWeekday("2027-06-22") === 2);
  check("June 22, 2026 was a Monday (so the old labels were right for 2026)", isoWeekday("2026-06-22") === 1);
  check("Fête nationale, June 24, 2027 is a Thursday", isoWeekday("2027-06-24") === 4);
  check("Canada Day, July 1, 2027 is a Thursday", isoWeekday("2027-07-01") === 4);
  check("August 26, 2027 is a Thursday", isoWeekday("2027-08-26") === 4);
  check("the Monday of a Friday is that week's Monday", mondayOf("2027-07-02") === "2027-06-28");
  check("the Monday of a Sunday is the Monday six days before", mondayOf("2027-06-27") === "2027-06-21");
  check("a Monday is its own Monday", mondayOf("2027-06-21") === "2027-06-21");
  check("adding days crosses a month end correctly", addDaysIso("2027-06-29", 3) === "2027-07-02");
  check("a date that does not exist is refused, not rolled over", throws(() => parseIsoDate("2027-02-30")) && throws(() => parseIsoDate("2027-6-1")) && throws(() => parseIsoDate("tomorrow")));
  check("the holidays are June 24 and July 1 (July 2 only when July 1 is a Sunday)",
    quebecSummerHolidays(2027).map((x) => x.date).join() === "2027-06-24,2027-07-01" && quebecSummerHolidays(2018).map((x) => x.date).join() === "2018-06-24,2018-07-02");
  check("day names in both languages", formatDayLong("2027-06-24", "en") === "Thursday, June 24" && formatDayLong("2027-07-01", "fr") === "jeudi 1er juillet" && formatDayLong("2027-06-24", "fr") === "jeudi 24 juin");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Every week obeys the calendar rules ===");
{
  const weeks = season.weeks;
  const holidays = quebecSummerHolidays(SEASON_YEAR);
  check("the season is 2027", season.year === 2027 && SEASON_YEAR === 2027);
  check("there is at least one week and ids are unique", weeks.length > 0 && new Set(weeks.map((w) => w.id)).size === weeks.length);

  for (const w of weeks) {
    const days = w.days;
    const tag = `week ${w.id}`;
    let real = true;
    try {
      days.forEach(parseIsoDate);
    } catch {
      real = false;
    }
    check(`${tag}: every day is a real date in ${SEASON_YEAR}`, real && days.every((d) => d.startsWith(`${SEASON_YEAR}-`)));
    check(`${tag}: days are in order with no repeats`, days.every((d, i) => i === 0 || d > days[i - 1]));
    check(`${tag}: the id is the Monday of the week`, w.id === mondayOf(days[0]) && isoWeekday(w.id) === 1);
    check(`${tag}: every day is Monday to Friday of that one week`, days.every((d) => isoWeekday(d) >= 1 && isoWeekday(d) <= 5 && mondayOf(d) === w.id));
    check(`${tag}: three to five camp days`, days.length >= 3 && days.length <= 5);
    check(`${tag}: start and end are the first and last camp day`, w.startDate === days[0] && w.endDate === days[days.length - 1]);

    const holidaysThisWeek = holidays.filter((hol) => mondayOf(hol.date) === w.id);
    check(`${tag}: no camp day lands on a statutory holiday by accident`, days.every((d) => !holidays.some((hol) => hol.date === d)), days.join());

    const unusual = days.length !== 4 || days.some((d, i) => isoWeekday(d) !== i + 1) || holidaysThisWeek.length > 0;
    if (unusual) {
      check(`${tag}: a week that is not the usual Monday-to-Thursday has a note for parents, in both languages`, Boolean(w.note?.en) && Boolean(w.note?.fr));
    }
    for (const hol of holidaysThisWeek) {
      check(`${tag}: the note names the holiday (${hol.date}) in English and in French`,
        Boolean(w.note) && w.note.en.includes(formatDayLong(hol.date, "en")) && w.note.fr.includes(formatDayLong(hol.date, "fr")), w.note?.en);
    }
  }
  const order = weeks.map((w) => w.id);
  check("weeks are in calendar order and do not overlap", order.every((id, i) => i === 0 || (id > order[i - 1] && weeks[i].startDate > weeks[i - 1].endDate)));
  check("both 2027 holidays fall inside the draft season, so both holiday weeks are handled",
    holidays.every((hol) => weeks.some((w) => mondayOf(hol.date) === w.id)));
  check("the two holiday weeks (draft) skip the Thursday and use the Friday",
    ["2027-06-21", "2027-06-28"].every((id) => {
      const w = weeks.find((x) => x.id === id);
      return w && w.days.length === 4 && isoWeekday(w.days[3]) === 5 && !w.days.some((d) => isoWeekday(d) === 4);
    }));
  check("the calendar is still marked as a proposal (it must not be confirmed by accident)", season.confirmed === false);
  check("the range sentence is right in both languages", seasonRange("en") === "June 21 – August 26, 2027" && seasonRange("fr") === "du 21 juin au 26 août 2027", `${seasonRange("en")} | ${seasonRange("fr")}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Labels are derived from the days, in English and in French ===");
{
  check("a plain week", labelEn(["2027-07-05", "2027-07-06", "2027-07-07", "2027-07-08"]) === "July 5, 6, 7 & 8" && labelFr(["2027-07-05", "2027-07-06", "2027-07-07", "2027-07-08"]) === "5, 6, 7 et 8 juillet");
  check("a holiday week (Friday instead of Thursday)", labelEn(["2027-06-21", "2027-06-22", "2027-06-23", "2027-06-25"]) === "June 21, 22, 23 & 25" && labelFr(["2027-06-21", "2027-06-22", "2027-06-23", "2027-06-25"]) === "21, 22, 23 et 25 juin");
  check("a week that crosses a month end", labelEn(["2027-06-28", "2027-06-29", "2027-06-30", "2027-07-02"]) === "June 28, 29, 30 & July 2" && labelFr(["2027-06-28", "2027-06-29", "2027-06-30", "2027-07-02"]) === "28, 29, 30 juin et 2 juillet");
  check("the same month-end shape the 2026 site used", labelEn(["2027-06-29", "2027-06-30", "2027-07-01", "2027-07-02"]) === "June 29, 30 & July 1, 2");
  check("French writes the first of the month as 1er", labelFr(["2027-06-30", "2027-07-01"]) === "30 juin et 1er juillet" && labelFr(["2027-08-01"]) === "1er août");
  check("one day and two days", labelEn(["2027-08-02"]) === "August 2" && labelEn(["2027-08-02", "2027-08-03"]) === "August 2 & 3" && labelFr(["2027-08-02", "2027-08-03"]) === "2 et 3 août");
  check("the spreadsheet tab names are short", shortLabel(["2027-06-21", "2027-06-25"]) === "Jun 21-25" && shortLabel(["2027-06-28", "2027-07-02"]) === "Jun 28-Jul 2");
  for (const w of season.weeks) {
    check(`week ${w.id}: label, French label and tab are exactly what the days say`, w.label === labelEn(w.days) && w.labelFr === labelFr(w.days) && w.shortLabel === shortLabel(w.days) && w.shortLabel.length <= 31);
    check(`week ${w.id}: each camp day's number is in the label, in order`, w.days.every((d) => w.label.includes(String(Number(d.slice(8)))) && w.labelFr.includes(Number(d.slice(8)) === 1 ? "1er" : String(Number(d.slice(8))))));
  }
  check("the site's own week list is the calendar (content.ts derives from it, nothing retyped)", JSON.stringify(juniorCamps.weeks) === JSON.stringify(season.weeks) && juniorCamps.year === 2027);
  check("labelForWeekId answers in each language and passes an unknown id through", labelForWeekId("2027-06-28", "fr") === "28, 29, 30 juin et 2 juillet" && labelForWeekId("2027-06-28") === "June 28, 29, 30 & July 2" && labelForWeekId("nope") === "nope");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The files derived from the calendar are up to date ===");
{
  check("db/migrations/002_seed_weeks.sql is exactly what the calendar generates (run: npm run season:write)", readFileSync("db/migrations/002_seed_weeks.sql", "utf8") === renderSeedSql());
  const doc = readFileSync("docs/SEASON_2027.md", "utf8");
  check("the calendar table in docs/SEASON_2027.md is exactly what the calendar generates", doc === spliceCalendarIntoDoc(doc));
  check("the document lists every date question the owner must answer (S1 to S10)", Array.from({ length: 10 }, (_, i) => `| S${i + 1} |`).every((s) => doc.includes(s)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. A fresh database starts with exactly the calendar's weeks ===");
{
  const rows = (await pool.query(`SELECT id, label, start_date::text AS start_date, end_date::text AS end_date, max_capacity, taken_count, price_cents, is_open FROM camp_weeks ORDER BY start_date`)).rows;
  check("same number of weeks", rows.length === season.weeks.length, `${rows.length} vs ${season.weeks.length}`);
  check("same ids, labels and dates", season.weeks.every((w, i) => rows[i]?.id === w.id && rows[i].label === w.label && rows[i].start_date === w.startDate && rows[i].end_date === w.endDate));
  check("every week starts at capacity 30, empty, open, at the page's price", rows.every((r) => r.max_capacity === 30 && r.taken_count === 0 && r.is_open === true && r.price_cents === Math.round(juniorCamps.pricePerWeek * 100)));
  check("a camp day's weekday agrees with its label in the database too (no week starts on a weekend)", rows.every((r) => isoWeekday(r.start_date) >= 1 && isoWeekday(r.start_date) <= 5 && isoWeekday(r.end_date) <= 5));
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. No stale year or old-style week id anywhere in the source ===");
{
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      // season.ts is the calendar itself; privacy.ts holds the notice's version date and legal.ts
      // is prose for a lawyer: both may mention other years.
      else if (/\.(ts|tsx)$/.test(name) && !p.endsWith("src/lib/season.ts") && !p.endsWith("src/lib/privacy.ts") && !p.endsWith("src/lib/i18n/legal.ts")) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/\b(20[2-3]\d)\b/g)) if (Number(m[1]) !== SEASON_YEAR) hits.push(`${p}: ${m[1]}`);
        for (const m of text.matchAll(/["'`](jun|jul|aug)\d\d["'`]/g)) hits.push(`${p}: old week id ${m[0]}`);
      }
    }
  };
  walk("src");
  check("outside season.ts no source file mentions another season's year or an old-style week id", hits.length === 0, hits.join("; "));
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. Is registration open? (the one answer the page, the capacity API and the endpoint share) ===");
{
  const now = new Date("2027-01-10T15:00:00Z");
  check("a draft calendar on a real site is NOT public: 'not announced'", isSeasonPublic({}) === false && registrationWindow(now, {}).state === "not_announced");
  check("SEASON_PREVIEW=true (a rehearsal site) makes it public and open", isSeasonPublic({ SEASON_PREVIEW: "true" }) && registrationWindow(now, { SEASON_PREVIEW: "true" }).state === "open");
  check("only the exact word 'true' counts as preview", ["1", "yes", "TRUE", "True", " true"].every((v) => registrationWindow(now, { SEASON_PREVIEW: v }).state === "not_announced"));

  const opens = "2027-01-16T09:00:00-05:00";
  const preview = { SEASON_PREVIEW: "true", REGISTRATION_OPENS_AT: opens };
  const w1 = registrationWindow(new Date("2027-01-16T13:59:59.999Z"), preview);
  check("one millisecond before the opening moment: opens_later, with the exact instant", w1.state === "opens_later" && w1.opensAt === "2027-01-16T14:00:00.000Z", JSON.stringify(w1));
  check("at the opening moment: open", registrationWindow(new Date("2027-01-16T14:00:00.000Z"), preview).state === "open");
  check("long after: still open", registrationWindow(new Date("2027-05-01T00:00:00Z"), preview).state === "open");
  check("winter and summer offsets both read correctly", parseOpensAt("2027-07-05T09:00:00-04:00").iso === "2027-07-05T13:00:00.000Z" && parseOpensAt("2027-01-16T14:00Z").iso === "2027-01-16T14:00:00.000Z");
  const garbage = ["tomorrow at nine", "2027-01-16T09:00:00", "2027-01-16 09:00", "01/16/2027", "2027-13-45T99:00:00-05:00", "2027-01-16"];
  check("a time with no offset, or one that is not a time, keeps the doors SHUT (never open early)",
    garbage.every((g) => registrationWindow(new Date("2030-01-01T00:00:00Z"), { SEASON_PREVIEW: "true", REGISTRATION_OPENS_AT: g }).state === "not_announced"), garbage.map((g) => registrationWindow(new Date("2030-01-01T00:00:00Z"), { SEASON_PREVIEW: "true", REGISTRATION_OPENS_AT: g }).state).join());
  check("an empty setting means no opening time", configuredOpensAt({ REGISTRATION_OPENS_AT: "  " }).iso === null);

  // The confirmed path, with calendars that say so.
  const confirmed = { confirmed: true, registrationOpensAt: null };
  check("once confirmed, no preview switch is needed", isSeasonPublic({}, confirmed) && registrationWindow(now, {}, confirmed).state === "open");
  const scheduled = { confirmed: true, registrationOpensAt: "2027-02-01T09:00:00-05:00" };
  check("the calendar's own opening time works the same way", registrationWindow(now, {}, scheduled).state === "opens_later" && registrationWindow(new Date("2027-02-01T14:00:00Z"), {}, scheduled).state === "open");
  check("and the environment can override it for a rehearsal", registrationWindow(now, { REGISTRATION_OPENS_AT: "2027-01-01T00:00:00Z" }, scheduled).state === "open");
  check("a mistyped time in the calendar also keeps the doors shut", registrationWindow(now, {}, { confirmed: true, registrationOpensAt: "next spring" }).state === "not_announced");
  check("a confirmed calendar with a preview switch still follows the opening time", registrationWindow(now, { SEASON_PREVIEW: "true" }, scheduled).state === "opens_later");
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. The registration endpoint enforces it, and a refused attempt costs the family nothing ===");
{
  const firstWeek = season.weeks[0].id;
  const body = (n) => ({
    idempotencyKey: `season-test-key-${n}-${Date.now()}`,
    parentName: "TEST Season Parent",
    email: `season+${n}@example.test`,
    primaryPhone: "514-555-0101",
    secondaryPhone: "",
    emergencyName: "TEST Contact",
    emergencyRelationship: "Aunt",
    emergencyPhone: "514-555-0102",
    codeOfConductAccepted: true,
    consentAccepted: true,
    healthConsentAccepted: true,
    children: [{ fullName: `TEST Child ${n}`, dateOfBirth: "2018-05-05", age: "9", healthInfo: "none" }],
    weeks: [firstWeek],
  });
  const post = async (payload, now) => {
    const response = await handleRegistrationRequest(
      new Request("http://localhost:3000/api/camp-registration", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" }, body: JSON.stringify(payload) }),
      { defer: () => {}, ...(now ? { now } : {}) }
    );
    return { status: response.status, data: await response.json() };
  };
  const registrations = async () => (await pool.query(`SELECT count(*)::int AS n FROM registrations`)).rows[0].n;
  const counters = async () => (await pool.query(`SELECT count(*)::int AS n FROM rate_limit_counters`)).rows[0].n;

  const savedPreview = process.env.SEASON_PREVIEW;
  const savedOpens = process.env.REGISTRATION_OPENS_AT;
  try {
    delete process.env.SEASON_PREVIEW;
    const closed = await post(body(1));
    check("a draft calendar on a real site: refused with registration_not_open (403)", closed.status === 403 && closed.data.code === "registration_not_open" && /not opened yet/.test(closed.data.error), JSON.stringify(closed));
    check("nothing was created and no rate-limit allowance was used", (await registrations()) === 0 && (await counters()) === 0);

    process.env.SEASON_PREVIEW = "true";
    process.env.REGISTRATION_OPENS_AT = "2027-01-16T09:00:00-05:00";
    const early = await post(body(2), new Date("2027-01-16T13:59:59.999Z"));
    check("one millisecond before the opening moment: refused, and the answer carries the moment", early.status === 403 && early.data.code === "registration_not_open" && early.data.opensAt === "2027-01-16T14:00:00.000Z" && /opens/.test(early.data.error), JSON.stringify(early));
    check("still nothing created, nothing counted", (await registrations()) === 0 && (await counters()) === 0);
    const onTime = await post(body(3), new Date("2027-01-16T14:00:00.000Z"));
    check("at the opening moment the same request is accepted", onTime.status === 200 && onTime.data.success === true && /^GD-/.test(onTime.data.reference), JSON.stringify(onTime));

    process.env.REGISTRATION_OPENS_AT = "not a time";
    const bad = await post(body(4));
    check("a mistyped opening time keeps registration closed", bad.status === 403 && bad.data.code === "registration_not_open");

    delete process.env.REGISTRATION_OPENS_AT;
    const open = await post(body(5));
    check("a rehearsal site with no opening time accepts registrations", open.status === 200 && open.data.success === true, JSON.stringify(open));
    check("exactly the two accepted registrations exist", (await registrations()) === 2);
  } finally {
    if (savedPreview === undefined) delete process.env.SEASON_PREVIEW;
    else process.env.SEASON_PREVIEW = savedPreview;
    if (savedOpens === undefined) delete process.env.REGISTRATION_OPENS_AT;
    else process.env.REGISTRATION_OPENS_AT = savedOpens;
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. The preflight check reports the season honestly ===");
{
  // Asynchronous on purpose (see rehearsal-kit.test.mjs): never block this process on a child.
  const run = (args, env) =>
    new Promise((resolve) => {
      const child = spawn("node", ["scripts/preflight.mjs", ...args], { env: { ...process.env, ...env } });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout }); });
    });
  const base = {
    DATABASE_URL: process.env.DATABASE_URL,
    REGISTRATION_LINK_SECRET: "test-only-registration-link-secret-0123456789",
    ADMIN_PASSWORD: "Local-QA-Only-Admin-Passphrase-2026",
    CRON_SECRET: "test-only-cron-secret-0123456789",
    SITE_URL: "https://www.example-camp.test",
    ADMIN_ALERT_EMAILS: "owner@example.test,backup@example.test",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2525",
    GMAIL_USER: "", GMAIL_APP_PASSWORD: "", ETRANSFER_EMAIL: "", ETRANSFER_AUTODEPOSIT: "", DB_SSL_INSECURE: "", DB_POOL_MAX: "", COACH_NOTICE_MODE: "",
    SEASON_PREVIEW: "", REGISTRATION_OPENS_AT: "",
  };
  const line = (out, title) => out.split("\n").find((l) => l.includes(title)) ?? "";

  const real = await run([], base);
  check("a real site with an unconfirmed calendar FAILS the preflight, and says why", real.status === 1 && /FAIL.*Season calendar.*not confirmed/.test(line(real.stdout, "Season calendar")), line(real.stdout, "Season calendar"));
  const rehearsal = await run([], { ...base, SEASON_PREVIEW: "true" });
  check("a rehearsal site (SEASON_PREVIEW=true) only gets a warning", /WARN.*Season calendar.*DRAFT/.test(line(rehearsal.stdout, "Season calendar")), line(rehearsal.stdout, "Season calendar"));
  const prod = await run(["--production"], { ...base, SEASON_PREVIEW: "true" });
  check("--production turns that into a failure (SEASON_PREVIEW must never be on the real site)", prod.status === 1 && /FAIL.*Season calendar.*DRAFT/.test(line(prod.stdout, "Season calendar")), line(prod.stdout, "Season calendar"));
  check("the database check confirms all calendar weeks are present with the same dates", new RegExp(`ok.*Camp weeks vs calendar.*all ${season.weeks.length} calendar weeks`).test(rehearsal.stdout), line(rehearsal.stdout, "Camp weeks vs calendar"));

  const badTime = await run([], { ...base, SEASON_PREVIEW: "true", REGISTRATION_OPENS_AT: "2027-01-16T09:00:00" });
  check("an opening time without its offset FAILS (and says it keeps registration closed)", badTime.status === 1 && /FAIL.*REGISTRATION_OPENS_AT.*CLOSED/.test(line(badTime.stdout, "REGISTRATION_OPENS_AT")), line(badTime.stdout, "REGISTRATION_OPENS_AT"));
  const goodTime = await run([], { ...base, SEASON_PREVIEW: "true", REGISTRATION_OPENS_AT: "2099-01-16T09:00:00-05:00" });
  check("a good future opening time is shown in Montreal time", /ok.*Registration opening time.*2099.*Montreal/.test(line(goodTime.stdout, "Registration opening time")), line(goodTime.stdout, "Registration opening time"));

  await pool.query(`UPDATE camp_weeks SET start_date = start_date + 1 WHERE id = $1`, [season.weeks[2].id]);
  await pool.query(`DELETE FROM camp_weeks WHERE id = $1`, [season.weeks[3].id]);
  const drift = await run([], { ...base, SEASON_PREVIEW: "true" });
  check("if the database drifts from the calendar (a week missing, a date moved) the preflight FAILS and names them",
    drift.status === 1 && /FAIL.*Camp weeks vs calendar/.test(drift.stdout) && drift.stdout.includes(season.weeks[3].id) && drift.stdout.includes(season.weeks[2].id), drift.stdout.split("\n").filter((l) => /vs calendar/.test(l)).join(" | "));
}

await pool.end();
await testDb.drop();
process.exit(h.finish("season"));
