#!/usr/bin/env node
// Regenerates docs/QUEBEC_LEGAL_REVIEW.md.   npm run legal:write [-- --check]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { renderLegalDoc } from "./lib/legalDoc.mjs";

const PATH = "docs/QUEBEC_LEGAL_REVIEW.md";
const next = renderLegalDoc();
const current = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";
if (current === next) {
  console.log(`  up to date  ${PATH}`);
} else if (process.argv.includes("--check")) {
  console.log(`  OUT OF DATE ${PATH} — run: npm run legal:write`);
  process.exit(1);
} else {
  writeFileSync(PATH, next);
  console.log(`  wrote       ${PATH}`);
}
