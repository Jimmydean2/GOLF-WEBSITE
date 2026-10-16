-- Undoes db/migrations/003_capacity_integrity.sql. Not run by `npm run db:migrate`.
-- After this, taken_count is again maintained by application code only, and the
-- Stage 1 application code (which no longer updates taken_count itself) must be
-- reverted too - do not run this against a database serving the Stage 1 app.
--
-- The new columns are intentionally kept (dropping them could lose data);
-- remove them by hand if you really want them gone.

BEGIN;
DROP TRIGGER IF EXISTS camp_integrity_weeks ON camp_weeks;
DROP TRIGGER IF EXISTS camp_integrity_registrations ON registrations;
DROP TRIGGER IF EXISTS camp_integrity_spots ON registration_spots;
DROP TRIGGER IF EXISTS camp_spot_counter ON registration_spots;
DROP FUNCTION IF EXISTS camp_check_week_row();
DROP FUNCTION IF EXISTS camp_check_registration_row();
DROP FUNCTION IF EXISTS camp_check_spot_row();
DROP FUNCTION IF EXISTS camp_assert_registration(UUID);
DROP FUNCTION IF EXISTS camp_assert_week(TEXT);
DROP FUNCTION IF EXISTS camp_spot_counter();
DROP FUNCTION IF EXISTS camp_free_spot(TEXT);
DROP FUNCTION IF EXISTS camp_take_spot(TEXT);
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_expiry_never_reported;
DROP INDEX IF EXISTS idx_registrations_hold_expiry;
COMMIT;
