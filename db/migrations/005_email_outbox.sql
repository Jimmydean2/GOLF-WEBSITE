-- Reliable email, and a record of the scheduled checks.
--
--   * email_outbox: every email the parents (and the coach) are owed is written down in the SAME
--     transaction that creates the reason for it (a reservation, a confirmed payment). Sending
--     happens afterwards and can fail, be retried with a growing delay, and be inspected; it
--     can never be lost because a server stopped between "saved" and "sent". Each email has a
--     unique dedupe_key, so it is sent once however many workers run at the same time.
--   * job_runs: one row per run of the scheduled check (and per traffic-triggered run), so the
--     dashboard can say "last ran 4 minutes ago" or "has not run for 2 hours".
--
-- The email bodies are NOT stored: they are built from the registration at send time, so a
-- late retry always reflects the current state (and no extra copy of personal data exists).
--
-- Idempotent. Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/005_email_outbox.sql

BEGIN;

CREATE TABLE IF NOT EXISTS email_outbox (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT email_outbox_kind_values
    CHECK (kind IN ('parent_instructions', 'parent_confirmation', 'parent_reminder', 'parent_release', 'coach_notice')),
  CONSTRAINT email_outbox_status_values
    CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  CONSTRAINT email_outbox_sent_has_time
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox (next_attempt_at) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS idx_email_outbox_registration ON email_outbox (registration_id);
CREATE INDEX IF NOT EXISTS idx_email_outbox_sent ON email_outbox (sent_at) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,
  summary JSONB,
  error TEXT,
  CONSTRAINT job_runs_source_values CHECK (source IN ('cron', 'traffic', 'manual'))
);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs (started_at DESC);

COMMIT;
