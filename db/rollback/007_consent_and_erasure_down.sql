-- Undoes db/migrations/007_consent_and_erasure.sql. Not run by `npm run db:migrate`.
-- Consent records and erasure markers are forgotten. Erased children (no date of birth) are given
-- 1900-01-01 so the column can be NOT NULL again: that date is a placeholder, not a real birth date.
BEGIN;
DROP TABLE IF EXISTS admin_notes;
DROP INDEX IF EXISTS idx_registrations_not_anonymized;
UPDATE children SET date_of_birth = DATE '1900-01-01' WHERE date_of_birth IS NULL;
ALTER TABLE children ALTER COLUMN date_of_birth SET NOT NULL;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_consents_recorded;
ALTER TABLE registrations
  DROP COLUMN IF EXISTS anonymized_at,
  DROP COLUMN IF EXISTS consent_recorded_at,
  DROP COLUMN IF EXISTS consent_version,
  DROP COLUMN IF EXISTS health_consent_accepted;
COMMIT;
