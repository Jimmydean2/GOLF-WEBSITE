-- French and English families, and the cancellation notice.
--
--   * registrations.language: the language the family used on the registration form ('en' or
--     'fr'). Every email to the family is written in it, and the private reservation page opens
--     in it. Existing rows (there are none in production yet) are English.
--   * email_outbox.kind: adds 'parent_cancellation', the notice a family gets when the owner
--     cancels or releases their registration from the dashboard.
--
-- Idempotent. Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/006_language_and_cancellation_notice.sql

BEGIN;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_language_values;
ALTER TABLE registrations ADD CONSTRAINT registrations_language_values CHECK (language IN ('en', 'fr'));

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_values;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_values
  CHECK (kind IN ('parent_instructions', 'parent_confirmation', 'parent_reminder', 'parent_release', 'parent_cancellation', 'coach_notice'));

COMMIT;
