// Renders the files that are derived from the season calendar (src/lib/season.ts):
//   - db/migrations/002_seed_weeks.sql  (the rows the database starts with)
//   - the calendar table inside docs/SEASON_2027.md (what the owner reads and approves)
// `npm run season:write` writes them; the test suite calls the same functions and fails if
// the files on disk differ, so the calendar, the seed and the document cannot disagree.

import { season, weekdaySummary } from "../../src/lib/season.ts";
import { juniorCamps } from "../../src/lib/content.ts";

export function renderSeedSql() {
  const priceCents = Math.round(juniorCamps.pricePerWeek * 100);
  const rows = season.weeks.map(
    (w) => `  ('${w.id}', '${w.label.replace(/'/g, "''")}', '${w.startDate}', '${w.endDate}', ${juniorCamps.maxPerWeek}, ${priceCents})`
  );
  return `-- Seeds the camp weeks for the ${season.year} season.
--
-- GENERATED from src/lib/season.ts by \`npm run season:write\`. Change the calendar THERE (and
-- run the command again); a test fails if this file and the calendar disagree.
--
-- A week's id is the ISO date of its Monday. This file was rewritten before the first
-- deployment. Once it has been applied to a real database it must never change again: a later
-- season is a new migration. Safe to re-run: ON CONFLICT updates nothing, so it never
-- clobbers an administrator's live edits to capacity, price or open/closed state.

INSERT INTO camp_weeks (id, label, start_date, end_date, max_capacity, price_cents) VALUES
${rows.join(",\n")}
ON CONFLICT (id) DO NOTHING;
`;
}

export function renderCalendarTable() {
  const lines = [
    `Season year: **${season.year}** · Status: **${season.confirmed ? "confirmed by the owner" : "PROPOSED — not yet confirmed"}** · Registration opens: **${season.registrationOpensAt ?? "not set (opens as soon as the site is live)"}**`,
    "",
    "| # | Week id | Camp days | English label | French label | Note for parents |",
    "|---|---------|-----------|---------------|--------------|------------------|",
  ];
  season.weeks.forEach((w, i) => {
    const note = w.note ? w.note.en : "—";
    lines.push(`| ${i + 1} | \`${w.id}\` | ${weekdaySummary(w.days, "en")} (${w.startDate} → ${w.endDate}) | ${w.label} | ${w.labelFr} | ${note} |`);
  });
  return lines.join("\n");
}

export const DOC_BEGIN = "<!-- season:begin -->";
export const DOC_END = "<!-- season:end -->";

export function spliceCalendarIntoDoc(docText) {
  const a = docText.indexOf(DOC_BEGIN);
  const b = docText.indexOf(DOC_END);
  if (a === -1 || b === -1 || b < a) throw new Error(`docs/SEASON_2027.md is missing the ${DOC_BEGIN} ... ${DOC_END} markers`);
  return `${docText.slice(0, a + DOC_BEGIN.length)}\n${renderCalendarTable()}\n${docText.slice(b)}`;
}
