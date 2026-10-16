-- Undoes db/migrations/006_language_and_cancellation_notice.sql. Not run by `npm run db:migrate`.
-- Cancellation notices still waiting in the outbox are forgotten, and every family's language is
-- forgotten (all emails would then be English): only run this against a database that is not
-- serving families.
BEGIN;
DELETE FROM email_outbox WHERE kind = 'parent_cancellation';
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_values;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_values
  CHECK (kind IN ('parent_instructions', 'parent_confirmation', 'parent_reminder', 'parent_release', 'coach_notice'));
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_language_values;
ALTER TABLE registrations DROP COLUMN IF EXISTS language;
COMMIT;
