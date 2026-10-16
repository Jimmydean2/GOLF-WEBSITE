-- Stage 2 of the payment workflow: the bounded-verification policy, enforced by
-- the database. Builds on 003_capacity_integrity.sql (left unchanged).
--
-- The policy (see the Stage 2 specification):
--   * An unpaid reservation holds its spots for 12 hours, then is released.
--   * A parent's "I've Sent My Payment" moves it to payment_reported, protected
--     for a 48-hour review. At 48 hours it is flagged overdue but NEVER released
--     by the system; only an authorized administrator can confirm, release, or
--     extend it. A parent's claim is never proof of payment.
--   * Paid requires the administrator's verification record (amount received
--     equal to the amount due, a deposit time, a method).
--   * Standard capacity is 30 a week; up to 33 only with a recorded
--     administrator authorization.
--
-- What this migration reconciles from Stage 1:
--   * the status list gains payment_reported;
--   * the commit-time "holds all its spots" check now covers payment_reported;
--   * a Stage 1 "reported" marker on an awaiting row becomes a real
--     payment_reported status;
--   * capacity above 30 now needs an authorization; the audit log becomes
--     append-only.
-- The Stage 1 rule that an expiry release can never be recorded against a
-- reported registration is kept: it now guards the 12-hour release only.
--
-- Idempotent. Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/004_payment_policy.sql

BEGIN;

-- Run Stage 1's commit-time checks as each statement finishes instead of at COMMIT.
-- Without this, the data fix-ups below leave pending trigger events and Postgres
-- refuses the ALTER TABLE statements that follow them.
SET CONSTRAINTS ALL IMMEDIATE;

-- 1. Status list ----------------------------------------------------------------
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_status_check;
ALTER TABLE registrations
  ADD CONSTRAINT registrations_status_check
  CHECK (status IN ('pending_payment', 'payment_reported', 'paid', 'cancelled', 'refunded'));

-- The commit-time check from 003, now covering payment_reported.
CREATE OR REPLACE FUNCTION camp_assert_registration(p_reg UUID) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r_status TEXT;
  n_total INTEGER;
  n_active INTEGER;
BEGIN
  SELECT status INTO r_status FROM registrations WHERE id = p_reg;
  IF NOT FOUND THEN RETURN; END IF; -- deleted in this transaction
  SELECT count(*), count(*) FILTER (WHERE status = 'active')
    INTO n_total, n_active
    FROM registration_spots WHERE registration_id = p_reg;
  IF r_status IN ('pending_payment', 'payment_reported', 'paid') AND (n_total = 0 OR n_active <> n_total) THEN
    RAISE EXCEPTION 'registration % is % but holds % of % spots - it must hold all of its spots', p_reg, r_status, n_active, n_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_status_matches_spots', DETAIL = 'registration_id=' || p_reg;
  ELSIF r_status IN ('cancelled', 'refunded') AND n_active > 0 THEN
    RAISE EXCEPTION 'registration % is % but still holds % active spots', p_reg, r_status, n_active
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_status_matches_spots', DETAIL = 'registration_id=' || p_reg;
  END IF;
END $$;

-- 2. New columns ------------------------------------------------------------------
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS reference_code            TEXT,
  ADD COLUMN IF NOT EXISTS amount_due_cents          INTEGER,
  ADD COLUMN IF NOT EXISTS hold_ends_at_initial      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_due_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_count           SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reinstate_count           SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_method       TEXT,
  ADD COLUMN IF NOT EXISTS verified_reference        TEXT,
  ADD COLUMN IF NOT EXISTS amount_received_cents     INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_confirmation_number  TEXT,
  ADD COLUMN IF NOT EXISTS verification_note         TEXT,
  ADD COLUMN IF NOT EXISTS paid_on_time              BOOLEAN;

-- The old email-link token is retired (Stage 1 removed the link).
ALTER TABLE registrations ALTER COLUMN confirm_token DROP NOT NULL;

-- 3. Data fix-ups (before the guards below exist) ----------------------------------
-- A Stage 1 report marker on an awaiting row becomes a real payment_reported row.
UPDATE registrations
   SET status = 'payment_reported',
       review_due_at = payment_reported_at + interval '48 hours'
 WHERE status = 'pending_payment' AND payment_reported_at IS NOT NULL;

-- Reference codes: 6 characters, no look-alikes (no 0/O or 1/I).
CREATE OR REPLACE FUNCTION camp_generate_reference() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  ref TEXT;
  i INTEGER;
BEGIN
  LOOP
    ref := 'GD-';
    FOR i IN 1..6 LOOP
      ref := ref || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM registrations WHERE reference_code = ref);
  END LOOP;
  RETURN ref;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM registrations WHERE reference_code IS NULL LOOP
    UPDATE registrations SET reference_code = camp_generate_reference() WHERE id = r.id;
  END LOOP;
END $$;

UPDATE registrations
   SET amount_due_cents = (total_price_cents + round(total_price_cents * 0.05) + round(total_price_cents * 0.09975))::int
 WHERE amount_due_cents IS NULL;

-- Every unpaid reservation must have a bounded hold; give legacy rows a fresh 12 hours.
UPDATE registrations
   SET hold_expires_at = now() + interval '12 hours'
 WHERE status = 'pending_payment' AND hold_expires_at IS NULL;

UPDATE registrations
   SET hold_ends_at_initial = COALESCE(hold_expires_at, created_at + interval '12 hours')
 WHERE hold_ends_at_initial IS NULL;

ALTER TABLE registrations ALTER COLUMN reference_code SET NOT NULL;
ALTER TABLE registrations ALTER COLUMN amount_due_cents SET NOT NULL;
ALTER TABLE registrations ALTER COLUMN reference_code SET DEFAULT camp_generate_reference();
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_reference ON registrations (reference_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_bank_confirmation
  ON registrations (upper(bank_confirmation_number)) WHERE bank_confirmation_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registrations_review_due
  ON registrations (review_due_at) WHERE status = 'payment_reported';
CREATE INDEX IF NOT EXISTS idx_registrations_open_by_email
  ON registrations (lower(email)) WHERE status IN ('pending_payment', 'payment_reported');

-- 4. Constraints --------------------------------------------------------------------
-- (NOT VALID where legacy rows could not satisfy them: enforced for every new or
-- changed row, without rewriting history.)
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_pending_has_hold;
ALTER TABLE registrations ADD CONSTRAINT registrations_pending_has_hold
  CHECK (status <> 'pending_payment' OR (hold_expires_at IS NOT NULL AND payment_reported_at IS NULL));

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_reported_has_review;
ALTER TABLE registrations ADD CONSTRAINT registrations_reported_has_review
  CHECK (status <> 'payment_reported' OR (payment_reported_at IS NOT NULL AND review_due_at IS NOT NULL));

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_extension_cap;
ALTER TABLE registrations ADD CONSTRAINT registrations_extension_cap CHECK (extension_count BETWEEN 0 AND 3);

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_reinstate_cap;
ALTER TABLE registrations ADD CONSTRAINT registrations_reinstate_cap CHECK (reinstate_count BETWEEN 0 AND 2);

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_verification_method_values;
ALTER TABLE registrations ADD CONSTRAINT registrations_verification_method_values
  CHECK (verification_method IS NULL OR verification_method IN ('reference_matched', 'name_amount_time'));

-- Paid needs verified receipt: the amount received must equal the amount due.
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_paid_verified;
ALTER TABLE registrations ADD CONSTRAINT registrations_paid_verified
  CHECK (status <> 'paid' OR (
    verified_at IS NOT NULL AND verification_method IS NOT NULL AND deposit_at IS NOT NULL
    AND amount_received_cents IS NOT NULL AND amount_received_cents = amount_due_cents
  )) NOT VALID;

-- 5. The guard: legal moves, immutable fields, bounded clocks --------------------
CREATE OR REPLACE FUNCTION camp_registration_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_payment' THEN
      RAISE EXCEPTION 'a registration can only be created as pending_payment, not %', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_creation_state';
    END IF;
    IF NEW.hold_expires_at IS NULL THEN NEW.hold_expires_at := now() + interval '12 hours'; END IF;
    NEW.hold_ends_at_initial := NEW.hold_expires_at;
    IF NEW.amount_due_cents IS NULL THEN
      NEW.amount_due_cents := (NEW.total_price_cents + round(NEW.total_price_cents * 0.05) + round(NEW.total_price_cents * 0.09975))::int;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------------
  IF NEW.reference_code IS DISTINCT FROM OLD.reference_code
     OR NEW.amount_due_cents IS DISTINCT FROM OLD.amount_due_cents
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.hold_ends_at_initial IS DISTINCT FROM OLD.hold_ends_at_initial THEN
    RAISE EXCEPTION 'reference, amount due, creation time and the original hold are fixed once a reservation exists'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_fixed_fields';
  END IF;

  IF OLD.payment_reported_at IS NOT NULL AND NEW.payment_reported_at IS DISTINCT FROM OLD.payment_reported_at THEN
    RAISE EXCEPTION 'the time a payment was reported cannot be changed or cleared'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_fixed_fields';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'pending_payment'  AND NEW.status IN ('payment_reported', 'paid', 'cancelled'))
      OR (OLD.status = 'payment_reported' AND NEW.status IN ('paid', 'cancelled'))
      OR (OLD.status = 'paid'             AND NEW.status IN ('cancelled', 'refunded'))
      OR (OLD.status = 'cancelled'        AND NEW.status IN ('pending_payment', 'payment_reported', 'paid', 'refunded'))
    ) THEN
      RAISE EXCEPTION 'a registration cannot move from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_legal_transition';
    END IF;
    IF OLD.status = 'cancelled' AND NEW.status IN ('pending_payment', 'payment_reported') THEN
      IF NEW.reinstate_count <> OLD.reinstate_count + 1 THEN
        RAISE EXCEPTION 'a reinstatement must be counted'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_reinstate_counted';
      END IF;
    ELSIF NEW.reinstate_count <> OLD.reinstate_count THEN
      RAISE EXCEPTION 'reinstate_count changes only when a released registration is reinstated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_reinstate_counted';
    END IF;
    IF NEW.extension_count <> OLD.extension_count THEN
      RAISE EXCEPTION 'extension_count changes only through an extension'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_extension_counted';
    END IF;
  ELSE
    IF NEW.reinstate_count <> OLD.reinstate_count THEN
      RAISE EXCEPTION 'reinstate_count changes only when a released registration is reinstated'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_reinstate_counted';
    END IF;
    IF NEW.status = 'pending_payment' THEN
      -- A hold can only move earlier, never later or away.
      IF OLD.hold_expires_at IS NOT NULL AND (NEW.hold_expires_at IS NULL OR NEW.hold_expires_at > OLD.hold_expires_at) THEN
        RAISE EXCEPTION 'a hold can only move earlier'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_hold_bounded';
      END IF;
    END IF;
    IF NEW.status = 'payment_reported' THEN
      IF NEW.review_due_at > OLD.review_due_at THEN
        IF NEW.extension_count <> OLD.extension_count + 1 THEN
          RAISE EXCEPTION 'the review time can only move later through a counted extension'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_extension_counted';
        END IF;
        IF NEW.review_due_at > GREATEST(OLD.review_due_at, now()) + interval '72 hours' THEN
          RAISE EXCEPTION 'an extension can be at most 72 hours'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_extension_bounded';
        END IF;
      ELSIF NEW.extension_count <> OLD.extension_count THEN
        RAISE EXCEPTION 'extension_count changes only through an extension'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_extension_counted';
      END IF;
    ELSIF NEW.extension_count <> OLD.extension_count THEN
      RAISE EXCEPTION 'extension_count changes only through an extension'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_extension_counted';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS camp_registration_guard_insert ON registrations;
CREATE TRIGGER camp_registration_guard_insert
  BEFORE INSERT ON registrations
  FOR EACH ROW EXECUTE FUNCTION camp_registration_guard();

DROP TRIGGER IF EXISTS camp_registration_guard_update ON registrations;
CREATE TRIGGER camp_registration_guard_update
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION camp_registration_guard();

-- 6. Capacity: 30 standard, up to 33 with a recorded authorization -----------------
ALTER TABLE camp_weeks DROP CONSTRAINT IF EXISTS camp_weeks_capacity_ceiling;
ALTER TABLE camp_weeks ADD CONSTRAINT camp_weeks_capacity_ceiling CHECK (max_capacity <= 33);

CREATE TABLE IF NOT EXISTS capacity_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id TEXT NOT NULL REFERENCES camp_weeks(id),
  authorized_capacity INTEGER NOT NULL CHECK (authorized_capacity BETWEEN 31 AND 33),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  authorized_by TEXT NOT NULL DEFAULT 'owner',
  txid BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capacity_authorizations_week ON capacity_authorizations (week_id, created_at);

CREATE OR REPLACE FUNCTION camp_guard_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.max_capacity > 30 THEN
      RAISE EXCEPTION 'a new camp week starts at 30 or fewer; raise it with an authorization'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'camp_week_capacity_authorization';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.max_capacity > 30 AND NEW.max_capacity > OLD.max_capacity THEN
    IF NOT EXISTS (
      SELECT 1 FROM capacity_authorizations
       WHERE week_id = NEW.id AND authorized_capacity = NEW.max_capacity AND txid = txid_current()
    ) THEN
      RAISE EXCEPTION 'raising week % above 30 needs a recorded administrator authorization', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'camp_week_capacity_authorization';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS camp_guard_capacity_insert ON camp_weeks;
CREATE TRIGGER camp_guard_capacity_insert
  BEFORE INSERT ON camp_weeks
  FOR EACH ROW EXECUTE FUNCTION camp_guard_capacity();

DROP TRIGGER IF EXISTS camp_guard_capacity_update ON camp_weeks;
CREATE TRIGGER camp_guard_capacity_update
  BEFORE UPDATE OF max_capacity ON camp_weeks
  FOR EACH ROW EXECUTE FUNCTION camp_guard_capacity();

-- 7. The audit log is append-only -----------------------------------------------------
CREATE OR REPLACE FUNCTION camp_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only'
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'audit_append_only';
END $$;

DROP TRIGGER IF EXISTS camp_audit_no_change ON admin_audit_log;
CREATE TRIGGER camp_audit_no_change
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION camp_audit_immutable();

DROP TRIGGER IF EXISTS camp_audit_no_truncate ON admin_audit_log;
CREATE TRIGGER camp_audit_no_truncate
  BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION camp_audit_immutable();

-- 8. Supporting tables -----------------------------------------------------------------
-- Settings (clock lengths etc.); the code supplies defaults and validates ranges.
CREATE TABLE IF NOT EXISTS camp_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each administrator alert is recorded before it is sent, so it is sent once.
CREATE TABLE IF NOT EXISTS alert_ledger (
  id BIGSERIAL PRIMARY KEY,
  alert_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  recipients TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_ledger_registration ON alert_ledger (registration_id);

-- Fixed-window counters for rate limiting public and admin endpoints.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Admin sessions: random tokens (only a hash is stored), revocable, expiring.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_auth_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip ON admin_login_attempts (ip, created_at);

-- A strike is recorded when an administrator releases a REPORTED claim as
-- "payment not received"; confirming that registration later removes it.
CREATE TABLE IF NOT EXISTS contact_strikes (
  id BIGSERIAL PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  email_key TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_strikes_email ON contact_strikes (email_key, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_strikes_phone ON contact_strikes (phone_key, created_at);

COMMIT;
