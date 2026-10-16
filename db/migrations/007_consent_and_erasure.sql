-- Proof of consent, and a way to erase a family's personal data (Quebec's Law 25).
--
--   * registrations.health_consent_accepted / consent_version / consent_recorded_at: a family's
--     consent is recorded with the registration: that they agreed to the privacy notice, that
--     they separately agreed to the collection of their child's health information, WHICH
--     VERSION of the notice that was, and when. A CHECK refuses any new registration without
--     all of it (it is NOT VALID so it applies to new and changed rows only; there are no
--     older rows to bring into line before launch).
--   * registrations.anonymized_at: set when a family's personal details have been erased
--     (on request, or by the retention clean-up after the season). The accounting record
--     (reference, amounts, dates, bank confirmation) stays.
--   * children.date_of_birth may be empty, because an erased child has none.
--   * admin_notes: the owner's free-text notes (why a review was extended, ...) live here, NOT in
--     the append-only audit log, so that erasing a family can erase what the owner wrote about
--     them. The audit log keeps only that a note exists.
--
-- Idempotent. Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/007_consent_and_erasure.sql

BEGIN;

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS health_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_version TEXT,
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_consents_recorded;
ALTER TABLE registrations ADD CONSTRAINT registrations_consents_recorded
  CHECK (
    consent_accepted AND health_consent_accepted
    AND consent_version IS NOT NULL AND consent_recorded_at IS NOT NULL
  ) NOT VALID;

ALTER TABLE children ALTER COLUMN date_of_birth DROP NOT NULL;

CREATE TABLE IF NOT EXISTS admin_notes (
  id BIGSERIAL PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_registration ON admin_notes (registration_id);

CREATE INDEX IF NOT EXISTS idx_registrations_not_anonymized ON registrations (created_at) WHERE anonymized_at IS NULL;

COMMIT;
