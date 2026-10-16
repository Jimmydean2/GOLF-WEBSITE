-- REHEARSAL DATABASE ONLY. Clears the TEST registrations (and what hangs off them: children,
-- spots, queued emails) so the rehearsal can be run again from the start. The audit log is
-- append-only by design and stays. Refuses if any registration is not a TEST one.
--
--   psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rehearsal-reset.sql
--
-- For the REAL launch, do not reuse the rehearsal database: create a fresh database (or delete
-- the rehearsal Neon branch) and run db/migrations on it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM registrations WHERE parent_name NOT LIKE 'TEST %') THEN
    RAISE EXCEPTION 'Refusing to run: this database holds registrations that are not TEST registrations.';
  END IF;
END $$;

BEGIN;
DELETE FROM registrations WHERE parent_name LIKE 'TEST %';
DELETE FROM contact_strikes;
DELETE FROM rate_limit_counters;
DELETE FROM job_runs;
DELETE FROM camp_settings WHERE key IN ('scheduled_check_lease', 'coach_digest_slot');
COMMIT;

SELECT 'Rehearsal data cleared.' AS result;
