-- An optional waiting list for full camp weeks.
--
-- What it is, and is not. A family that finds a week full may leave their name, email and the
-- number of places they would want. NOTHING here holds, reserves or assigns a place: this table
-- has no link to registrations, spots or a week's capacity, and no code that reads it can change
-- any of them. When a place opens, the owner may email the family, once, to say so; the family
-- then registers through the ordinary form like anyone else, first come, first served.
--
--   * waitlist_entries: one row per family per week. Only the contact details needed to reach the
--     family, the number of places they would want, their language and the consent they gave
--     (which version of the notice, and when). batch_id ties together the weeks chosen in one request,
--     so the family gets one acknowledgement email, not one per week. No child's name, birth date or health information:
--     those are collected only if the family registers.
--   * at most one entry per email address per week (a unique index). Taking a family off the list
--     DELETES their row (the list has no accounting purpose, so nothing needs to be kept).
--   * email_outbox gets waitlist_entry_id and two kinds, 'waitlist_ack' (we received your request;
--     no place is held) and 'waitlist_notify' (a place may be open; it is not held for you), so
--     those emails use the same safe queue as every other email: recorded first, retried,
--     never lost, never sent twice.
--
-- Idempotent. Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/008_waitlist.sql

BEGIN;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id TEXT NOT NULL REFERENCES camp_weeks(id),
  parent_name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  batch_id UUID NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  places_wanted INTEGER NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'waiting',
  consent_version TEXT NOT NULL,
  consent_recorded_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  notified_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_places_range CHECK (places_wanted BETWEEN 1 AND 6),
  CONSTRAINT waitlist_language_values CHECK (language IN ('en', 'fr')),
  CONSTRAINT waitlist_status_values CHECK (status IN ('waiting', 'notified')),
  CONSTRAINT waitlist_notified_count_range CHECK (notified_count BETWEEN 0 AND 3),
  CONSTRAINT waitlist_notified_has_time CHECK (notified_count = 0 OR notified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_one_entry_per_family_week ON waitlist_entries (email_key, week_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_week ON waitlist_entries (week_id, created_at);

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS waitlist_entry_id UUID REFERENCES waitlist_entries(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_email_outbox_waitlist ON email_outbox (waitlist_entry_id) WHERE waitlist_entry_id IS NOT NULL;

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_values;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_values
  CHECK (kind IN ('parent_instructions', 'parent_confirmation', 'parent_reminder', 'parent_release', 'parent_cancellation', 'coach_notice', 'waitlist_ack', 'waitlist_notify'));

-- A waiting-list email belongs to a waiting-list entry, and nothing else does.
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_waitlist_link;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_waitlist_link
  CHECK ((kind IN ('waitlist_ack', 'waitlist_notify')) = (waitlist_entry_id IS NOT NULL));

COMMIT;
