#!/usr/bin/env node
// The clean-up after the season (Quebec Law 25), from the command line. The dashboard has the
// same thing as a button ("Privacy: season clean-up"); this is for whoever maintains the site.
//
//   npm run retention                                        what WOULD be erased (changes nothing)
//   npm run retention -- --apply --confirm-retention         erase it
//   npm run retention -- --apply --confirm-retention --live  ... against a database that is not on this computer
//
// Prints counts and references only, never a name, an address or a health note.

import { previewRetention, applyRetention } from "../src/lib/privacyData.ts";
import { RETENTION_DAYS } from "../src/lib/privacy.ts";
import { getPool } from "../src/lib/db.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmed = args.includes("--confirm-retention");
const live = args.includes("--live");

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(host);
if (apply && !isLocal && !live) {
  console.error(`Refusing to erase on ${host}: that is not this computer. Add --live if you really mean the live database.`);
  process.exit(2);
}
if (apply && !confirmed) {
  console.error("Add --confirm-retention to actually erase. (Without --apply this only shows what would happen.)");
  process.exit(2);
}

const plan = await previewRetention();
console.log(`Retention period: ${RETENTION_DAYS} days after a family's last camp week. Today (Montreal): ${plan.today}.`);
console.log(`Due now: ${plan.due.length} registration(s).`);
for (const item of plan.due.slice(0, 20)) console.log(`   ${item.reference}  ${item.status}  last camp week ended ${item.lastWeekEnded}`);
if (plan.due.length > 20) console.log(`   ... and ${plan.due.length - 20} more`);
console.log(`Past the date but NOT touched (a payment is still unresolved): ${plan.blocked.length}`);
for (const item of plan.blocked.slice(0, 20)) console.log(`   ${item.reference}  ${item.status}  last camp week ended ${item.lastWeekEnded}`);

if (!apply) {
  console.log("\nDry run: nothing was changed.");
} else {
  const result = await applyRetention();
  console.log(`\nErased personal details of ${result.anonymized} registration(s); forgot ${result.purgedLoginRecords} old sign-in record(s) and ${result.purgedSessions} old session(s); deleted ${result.purgedWaitlist} finished waiting-list request(s).`);
}
await getPool().end();
