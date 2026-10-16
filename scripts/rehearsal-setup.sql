-- REHEARSAL DATABASE ONLY. Prepares a separate copy of the database (a Neon branch) so the whole
-- journey can be tried with real e-Transfers of about $1 and fast clocks.
--
--   psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rehearsal-setup.sql
--
-- It refuses to run if the database already holds any registration that is not a TEST one, so it
-- cannot be pointed at the live database by mistake. Never run it on the live database.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM registrations WHERE parent_name NOT LIKE 'TEST %') THEN
    RAISE EXCEPTION 'Refusing to run: this database holds registrations that are not TEST registrations. This script is for the rehearsal database only.';
  END IF;
END $$;

BEGIN;
-- A week costs $1.00 before tax ($1.15 with GST and QST): small enough to send for real.
UPDATE camp_weeks SET price_cents = 100;
-- A reservation is held for 2 hours instead of 12, and the reminder goes out 1 hour before it ends,
-- so a whole cycle (register, remind, release) can be watched in a little over 2 hours, or in
-- minutes with scripts/rehearsal-time-machine.sql.
INSERT INTO camp_settings (key, value) VALUES ('holdHours', '2'), ('parentReminderHours', '1')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
COMMIT;

SELECT 'Rehearsal settings applied: weeks cost $1.00 + tax, holds last 2 hours, reminders 1 hour before.' AS result;
