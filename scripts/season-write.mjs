#!/usr/bin/env node
// Regenerates the files derived from src/lib/season.ts.
//
//   npm run season:write            rewrite db/migrations/002_seed_weeks.sql and the calendar
//                                   table in docs/SEASON_2027.md
//   npm run season:write -- --check do not write; exit 1 if either file is out of date
//
// This never touches a database.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { renderSeedSql, spliceCalendarIntoDoc } from "./lib/seasonFiles.mjs";

const SEED = "db/migrations/002_seed_weeks.sql";
const DOC = "docs/SEASON_2027.md";
const check = process.argv.includes("--check");

const targets = [
  { path: SEED, next: renderSeedSql() },
  { path: DOC, next: existsSync(DOC) ? spliceCalendarIntoDoc(readFileSync(DOC, "utf8")) : null },
];

let stale = 0;
for (const t of targets) {
  if (t.next === null) {
    console.log(`  skipped ${t.path} (does not exist yet)`);
    continue;
  }
  const current = existsSync(t.path) ? readFileSync(t.path, "utf8") : "";
  if (current === t.next) {
    console.log(`  up to date  ${t.path}`);
  } else if (check) {
    stale++;
    console.log(`  OUT OF DATE ${t.path} — run: npm run season:write`);
  } else {
    writeFileSync(t.path, t.next);
    console.log(`  wrote       ${t.path}`);
  }
}
process.exit(stale > 0 ? 1 : 0);
