// The roster download route, over HTTP against the real production server: the login, a recent
// password check, same-origin, no caching, a recorded download that holds no personal details,
// and the old no-password link being gone. (What the files contain is in roster-export.test.mjs.)

import ExcelJS from "exceljs";
import { createTestDatabase } from "./helpers/testdb.mjs";
import { startApp, adminSession } from "./helpers/app.mjs";

process.env.DB_POOL_MAX ||= "5";
const testDb = await createTestDatabase();
const app = await startApp({ env: { DATABASE_URL: process.env.DATABASE_URL } });
const { createHarness } = await import("./helpers/harness.mjs");
const h = createHarness();
const { pool, campDb, check, reserveOk, confirmFor } = h;

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

const A = "2027-06-28";
const B = "2027-07-05";
const fam1 = await reserveOk("one", {
  weekIds: [A, B],
  parentName: "Chantal Côté-Tremblay",
  email: "sentinel-email-7f3@example.test",
  emergencyName: "Mireille Tremblay SENTINEL-EMERG-7f3",
  children: [{ fullName: "Émilie Côté-Bélanger", dateOfBirth: "2016-03-03", age: "10", healthInfo: "Allergie: arachides SENTINEL-HEALTH-7f3" }],
});
await confirmFor(fam1);
const fam2 = await reserveOk("two", { weekIds: [A], children: [{ fullName: "Bb Reported", dateOfBirth: "2017-01-01", age: "9", healthInfo: "None" }] });
await campDb.reportPayment(fam2);
await reserveOk("three", { weekIds: [A], children: [{ fullName: "Cc Pending", dateOfBirth: "2017-02-02", age: "9", healthInfo: "None" }] });
const fam7 = await reserveOk("seven", { weekIds: [B], children: [{ fullName: "Gg Weekb", dateOfBirth: "2017-06-06", age: "9", healthInfo: "None" }] });
await confirmFor(fam7);
check("setup: 3 places held in the first week and 2 in the second", (await pool.query(`SELECT count(*)::int AS n FROM registration_spots WHERE status = 'active'`)).rows[0].n === 5);

// ---------------------------------------------------------------------------
console.log("=== Over HTTP: login, recent password, same site, no caching, a recorded download ===");
{
  let ip = 0;
  const nextIp = () => `198.51.100.${(++ip % 250) + 1}`;
  const url = "/api/admin/camp-rosters/download";
  const plain = (method, headers = {}, body) => fetch(`${app.url}${url}`, { method, headers: { "x-forwarded-for": nextIp(), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  check("without a login: 401 (every way of asking)", (await Promise.all([plain("POST", {}, { format: "csv", week: "all", profile: "full" }), plain("GET"), plain("PUT", {}, {})])).every((r) => r.status === 401 || r.status === 405));
  const session = await adminSession(app);
  const hdr = { cookie: session.cookie, origin: app.url };
  const ask = (body, extra = {}) => plain("POST", { ...hdr, ...extra }, body);

  const get = await plain("GET", hdr);
  check("the old plain link (which needed no recent password) no longer serves the roster", get.status === 405 || get.status === 404, String(get.status));

  await pool.query(`UPDATE admin_sessions SET last_auth_at = now() - interval '20 minutes'`);
  const stale = await ask({ format: "csv", week: "all", profile: "full" });
  check("20 minutes after the last password check, a download needs the password again", stale.status === 403 && (await stale.json()).code === "reauth_required");
  const noAuditYet = (await pool.query(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'roster_download'`)).rows[0].n;
  check("a refused download leaves no download record", noAuditYet === 0);
  const reauth = await fetch(`${app.url}/api/admin/reauth`, { method: "POST", headers: { "content-type": "application/json", ...hdr, "x-forwarded-for": nextIp() }, body: JSON.stringify({ password: "Local-QA-Only-Admin-Passphrase-2026" }) });
  check("the password check works", reauth.status === 200);

  const cross = await ask({ format: "csv", week: "all", profile: "full" }, { origin: "https://evil.example" });
  check("a request from another website is refused", cross.status === 403);

  const csv = await ask({ format: "csv", week: A, profile: "signin" });
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  const csvText = csvBytes.toString("utf8"); // keeps the byte-order mark as a character, unlike Response.text()
  check("a CSV comes back with the right type, as a download, never cached", csv.status === 200 && /^text\/csv; charset=utf-8/.test(csv.headers.get("content-type") ?? "") && /attachment/.test(csv.headers.get("content-disposition") ?? "") && csv.headers.get("cache-control") === "no-store" && csv.headers.get("x-content-type-options") === "nosniff", `${csv.headers.get("content-type")} | ${csv.headers.get("content-disposition")} | ${csv.headers.get("cache-control")}`);
  check("the file name says it is confidential and which week and contents", /filename="CONFIDENTIAL-[^"]*2027-06-28[^"]*signin[^"]*\.csv"/i.test(csv.headers.get("content-disposition") ?? ""), csv.headers.get("content-disposition"));
  check("the body is the sign-in CSV for that week (BOM bytes EF BB BF, three families)", csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && asObjects(parseCsv(csvText)).length === 3);

  const xlsx = await ask({ format: "xlsx", week: "all", profile: "full" });
  const xbuf = Buffer.from(await xlsx.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xbuf);
  check("an Excel workbook comes back that opens, with the cover and the ten weeks", xlsx.status === 200 && /spreadsheetml/.test(xlsx.headers.get("content-type") ?? "") && wb.worksheets.length === 11 && /CONFIDENTIAL-.*\.xlsx/.test(xlsx.headers.get("content-disposition") ?? ""));

  const bad = await Promise.all([ask({ format: "pdf", week: "all", profile: "full" }), ask({ format: "csv", week: "not-a-week", profile: "full" }), ask({ format: "csv", week: "all", profile: "everything" }), ask("not json")]);
  check("an unknown format, week or contents is refused with a plain 400", bad.every((r) => r.status === 400), bad.map((r) => r.status).join(","));

  const audit = (await pool.query(`SELECT action, target_type, target_id, details FROM admin_audit_log WHERE action = 'roster_download' ORDER BY created_at`)).rows;
  check("each successful download is in the audit log: what, which week, how many rows", audit.length === 2 && audit[0].details.format === "csv" && audit[0].details.profile === "signin" && audit[0].details.rows === 3 && audit[1].details.format === "xlsx" && audit[1].details.rows === 5, JSON.stringify(audit.map((a) => a.details)));
  const auditText = JSON.stringify(audit);
  check("and the log entry holds no family's details", !/Chantal|Émilie|SENTINEL|example\.test|GD-/.test(auditText));
  const logs = app.logs.join("");
  check("the server's own log holds none either", !/Chantal|Émilie|SENTINEL|sentinel-email/.test(logs));
}


await app.stop();
await pool.end();
await testDb.drop();
process.exit(h.finish("roster-http"));
