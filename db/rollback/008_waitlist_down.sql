-- Undoes db/migrations/008_waitlist.sql. Not run by `npm run db:migrate`.
-- Everything on the waiting list is forgotten, and so are the emails queued for it.
BEGIN;
DELETE FROM email_outbox WHERE kind IN ('waitlist_ack', 'waitlist_notify');
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_waitlist_link;
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_values;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_values
  CHECK (kind IN ('parent_instructions', 'parent_confirmation', 'parent_reminder', 'parent_release', 'parent_cancellation', 'coach_notice'));
DROP INDEX IF EXISTS idx_email_outbox_waitlist;
ALTER TABLE email_outbox DROP COLUMN IF EXISTS waitlist_entry_id;
DROP TABLE IF EXISTS waitlist_entries;
COMMIT;
