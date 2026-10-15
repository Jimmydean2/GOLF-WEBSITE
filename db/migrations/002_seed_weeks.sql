-- Seeds the 10 camp weeks from the site's existing content config.
-- Safe to re-run: ON CONFLICT updates nothing, so it never clobbers an
-- admin's live edits to capacity/price/dates after the first run.
--
-- NOTE: start_date/end_date use a placeholder year — update these (via
-- the admin dashboard, once built, or directly here) to match the actual
-- camp season before opening registration.

INSERT INTO camp_weeks (id, label, start_date, end_date, max_capacity, price_cents) VALUES
  ('jun22', 'June 22, 23, 25 & 26', '2027-06-22', '2027-06-26', 30, 38000),
  ('jun29', 'June 29, 30 & July 2, 3', '2027-06-29', '2027-07-03', 30, 38000),
  ('jul06', 'July 6, 7, 8 & 9',       '2027-07-06', '2027-07-09', 30, 38000),
  ('jul13', 'July 13, 14, 15 & 16',   '2027-07-13', '2027-07-16', 30, 38000),
  ('jul20', 'July 20, 21, 22 & 23',   '2027-07-20', '2027-07-23', 30, 38000),
  ('jul27', 'July 27, 28, 29 & 30',   '2027-07-27', '2027-07-30', 30, 38000),
  ('aug03', 'August 3, 4, 5 & 6',     '2027-08-03', '2027-08-06', 30, 38000),
  ('aug10', 'August 10, 11, 12 & 13', '2027-08-10', '2027-08-13', 30, 38000),
  ('aug17', 'August 17, 18, 19 & 20', '2027-08-17', '2027-08-20', 30, 38000),
  ('aug24', 'August 24, 25, 26 & 27', '2027-08-24', '2027-08-27', 30, 38000)
ON CONFLICT (id) DO NOTHING;
