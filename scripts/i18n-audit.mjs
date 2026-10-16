#!/usr/bin/env node
// Counts the English text a parent can see in the registration journey, file by file, and lists
// the places that format dates, money and language in an English-only way. It is a measuring
// tape for the French-readiness plan (docs/FRENCH_READINESS.md), not a translator.
//
//   node scripts/i18n-audit.mjs            # table
//   node scripts/i18n-audit.mjs --list     # also print every string found
//
// The counts are approximate (a heuristic reads the source), good to about +/-10%.

import { readFileSync } from "node:fs";

const SCOPES = {
  "Registration form (what a parent fills in)": ["src/components/CampRegistrationForm.tsx"],
  "Camp information pages (what a parent reads first)": ["src/app/junior-camps/page.tsx", "src/app/junior-programs/page.tsx", "src/components/JuniorCampsPromo.tsx"],
  "Parent's private reservation page": ["src/app/camp-registration/[token]/page.tsx", "src/components/ReportPaymentButton.tsx"],
  "Messages the registration API shows": ["src/lib/registrationService.ts", "src/app/api/camp-registration/report/route.ts"],
  "Payment instructions (page and email)": ["src/lib/payment.ts"],
  "Emails to parents": ["src/lib/campEmailTemplates.ts"],
  "Camp content (weeks, what to bring, safety)": ["src/lib/content.ts"],
};
const LIST = process.argv.includes("--list");

const looksTranslatable = (text) => {
  const t = text.trim();
  if (t.length < 4 || !/[A-Za-z]/.test(t)) return false;
  if (/^(https?:|\/|#|\.|[a-z]+:\/\/)/.test(t)) return false; // urls, paths
  if (/^[\w-]+(\s[\w-]+)?$/.test(t) && !/\s/.test(t)) return false; // a single token (class name, id)
  if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|BEGIN|COMMIT)\b/.test(t)) return false; // SQL
  if (/(bg-|text-|px-|py-|mt-|mb-|flex|grid|rounded|border-)/.test(t)) return false; // class names
  if (!/\s/.test(t)) return false; // one word
  if (/useState|=>|\bconst\b|\breturn\b|\bfunction\b|\.map\(|\.filter\(|\);|\bawait\b|\bimport\b|\bexport\b|\/\/ /.test(t)) return false; // code, not text
  return true;
};

function extract(file) {
  const source = readFileSync(file, "utf8");
  const found = new Set();
  // JSX text between tags.
  for (const m of source.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1].replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
    if (looksTranslatable(text)) found.add(text);
  }
  // String literals and template strings.
  for (const m of source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)) {
    const text = m[2].replace(/\$\{[^}]*\}/g, "{x}").replace(/\\./g, " ").replace(/\s+/g, " ").trim();
    if (!looksTranslatable(text)) continue;
    if (/^(use client|use server)$/.test(text)) continue;
    if (/^[a-z][\w-]*(\s[a-z][\w-]*)*$/.test(text) && /^(flex|grid|block|inline|hidden|sr-only|w-|h-)/.test(text)) continue;
    found.add(text);
  }
  return [...found];
}

let totalStrings = 0;
let totalWords = 0;
console.log("\nEnglish text a parent can see, by area (approximate)\n");
for (const [area, files] of Object.entries(SCOPES)) {
  let strings = 0;
  let words = 0;
  const all = [];
  for (const file of files) {
    for (const text of extract(file)) {
      strings++;
      words += text.split(/\s+/).length;
      all.push(`${file.split("/").pop()}: ${text}`);
    }
  }
  totalStrings += strings;
  totalWords += words;
  console.log(`${area.padEnd(56)} ${String(strings).padStart(4)} strings  ${String(words).padStart(5)} words`);
  if (LIST) for (const line of all) console.log(`      ${line.slice(0, 150)}`);
}
console.log(`${"TOTAL".padEnd(56)} ${String(totalStrings).padStart(4)} strings  ${String(totalWords).padStart(5)} words\n`);

const checks = [
  ["Page language declared as English", "src/app/layout.tsx", /lang="en"/],
  ["Dates formatted for English Canada (en-CA / en-US)", "src/lib/payment.ts", /en-CA|en-US/],
  ["Dates in admin screens use the browser's language", "src/components/AdminCampTools.tsx", /toLocaleString\(\)/],
  ["Money written as $436.91 (French Canada writes 436,91 $)", "src/lib/pricing.ts", /toFixed\(2\)/],
  ["Interac e-Transfer named in English only (French: virement Interac)", "src/lib/payment.ts", /e-Transfer/],
];
console.log("English-only formatting and wording:");
for (const [label, file, pattern] of checks) {
  const hit = pattern.test(readFileSync(file, "utf8"));
  console.log(`  ${hit ? "FOUND   " : "not found"}  ${label}  (${file})`);
}
console.log("\nThe API also returns English error messages (src/lib/registrationService.ts), each with a stable `code` that a French page could translate.\n");
