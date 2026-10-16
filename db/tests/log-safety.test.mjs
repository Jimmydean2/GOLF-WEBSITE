// Logs must never carry a family's details. Database errors can include the offending row and
// mail errors repeat the recipient's address; the application logs through safeLog, which
// prints the kind of failure and where, and nothing else.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describeError, redact } from "../../src/lib/safeLog.ts";

let failures = 0;
let checks = 0;
const check = (label, ok, detail) => {
  checks++;
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
};

console.log("=== 1. What gets printed ===");
{
  const dbError = Object.assign(new Error('new row for relation "registrations" violates check constraint "registrations_paid_verified"'), {
    code: "23514",
    constraint: "registrations_paid_verified",
    detail: "Failing row contains (Pat Parent, pat.parent@example.test, 438-555-0100, Kid Sentinel, HEALTH-SENTINEL-peanut)",
    where: "SQL statement: INSERT ... Pat Parent",
    parameters: ["Pat Parent", "pat.parent@example.test"],
  });
  const printed = describeError(dbError);
  check("a database error prints its code and constraint", /code=23514/.test(printed) && /constraint=registrations_paid_verified/.test(printed), printed);
  check("but never the failing row, the statement or the parameters", !/Pat Parent|pat\.parent|438-555|Kid Sentinel|HEALTH-SENTINEL|INSERT/.test(printed), printed);
  const mailError = Object.assign(new Error("550 5.1.1 <mom.private@gmail.example>: Recipient address rejected: User unknown"), { code: "EENVELOPE", responseCode: 550 });
  const mail = describeError(mailError);
  check("a mail error prints the reply with the address removed", /Recipient address rejected/.test(mail) && !/mom\.private/.test(mail), mail);
  check("redact removes any address", redact("sent to a.b+c@sub.example.org and x@y.z") === "sent to <address> and <address>");
  check("a non-error thing is printed safely too", describeError("boom parent@example.test") === "boom <address>");
  check("a few stack frames are kept so a problem can be found", /\[at /.test(printed) || printed.includes("[at "));
}

console.log("\n=== 2. Nothing in the source logs a raw error or a request ===");
{
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  })("src");
  const offenders = [];
  for (const file of files) {
    if (file === "src/lib/safeLog.ts") continue;
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (!/console\.(log|error|warn|info|debug)\(/.test(line)) return;
      // Allowed: fixed messages, and the pool's own message (a string from the driver, no row data).
      const argsPart = line.slice(line.indexOf("console."));
      const risky = /\b(err|error|e|body|registration|input|reg|row|rows|result|request|data|payload|child|children|email|parentName)\b\s*[,)]/.test(argsPart) && !/err\.message/.test(argsPart);
      if (risky) offenders.push(`${file}:${i + 1}`);
    });
  }
  check("no console call in the application prints an error object, request, or registration", offenders.length === 0, offenders.join(", "));
  const direct = files.filter((f) => f !== "src/lib/safeLog.ts" && /console\.error\([^)]*,\s*err\)/.test(readFileSync(f, "utf8")));
  check("every error is logged through logError", direct.length === 0, direct.join(", "));
}

console.log(`\n\n${failures === 0 ? `ALL TESTS PASS (${checks} pass, 0 fail)` : `${failures} OF ${checks} CHECK(S) FAILED`} — log-safety`);
process.exit(failures === 0 ? 0 : 1);
