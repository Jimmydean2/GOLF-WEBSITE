-- Seeds the camp weeks for the 2027 season.
--
-- GENERATED from src/lib/season.ts by `npm run season:write`. Change the calendar THERE (and
-- run the command again); a test fails if this file and the calendar disagree.
--
-- A week's id is the ISO date of its Monday. This file was rewritten before the first
-- deployment. Once it has been applied to a real database it must never change again: a later
-- season is a new migration. Safe to re-run: ON CONFLICT updates nothing, so it never
-- clobbers an administrator's live edits to capacity, price or open/closed state.

INSERT INTO camp_weeks (id, label, start_date, end_date, max_capacity, price_cents) VALUES
  ('2027-06-21', 'June 21, 22, 23 & 25', '2027-06-21', '2027-06-25', 30, 38000),
  ('2027-06-28', 'June 28, 29, 30 & July 2', '2027-06-28', '2027-07-02', 30, 38000),
  ('2027-07-05', 'July 5, 6, 7 & 8', '2027-07-05', '2027-07-08', 30, 38000),
  ('2027-07-12', 'July 12, 13, 14 & 15', '2027-07-12', '2027-07-15', 30, 38000),
  ('2027-07-19', 'July 19, 20, 21 & 22', '2027-07-19', '2027-07-22', 30, 38000),
  ('2027-07-26', 'July 26, 27, 28 & 29', '2027-07-26', '2027-07-29', 30, 38000),
  ('2027-08-02', 'August 2, 3, 4 & 5', '2027-08-02', '2027-08-05', 30, 38000),
  ('2027-08-09', 'August 9, 10, 11 & 12', '2027-08-09', '2027-08-12', 30, 38000),
  ('2027-08-16', 'August 16, 17, 18 & 19', '2027-08-16', '2027-08-19', 30, 38000),
  ('2027-08-23', 'August 23, 24, 25 & 26', '2027-08-23', '2027-08-26', 30, 38000)
ON CONFLICT (id) DO NOTHING;
