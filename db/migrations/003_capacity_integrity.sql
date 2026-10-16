-- Stage 1 of the payment workflow: make capacity and "paid" impossible to get
-- wrong, even for code that bypasses the app. Before this migration the
-- 30-spot rule and the "a paid registration holds its spots" rule lived only
-- in application code (src/lib/campDb.ts), which allowed:
--
--   1. A released (cancelled) registration to be marked paid while holding
--      zero spots — the family believed they were booked, the week showed the
--      space as free, and the camp could be overbooked.
--   2. Spots to be reactivated directly in SQL on a full week, giving 31/30
--      active spots while taken_count still said 30.
--
-- What this migration adds (all enforced by Postgres itself):
--
--   A. camp_weeks.taken_count is now maintained by a trigger on
--      registration_spots, never by application code. Activating a spot
--      (new registration, reinstatement, anything) takes the week's row lock
--      and refuses if the week is full. Concurrent attempts queue on that lock.
--   B. Deferred integrity checks that run at COMMIT and refuse the whole
--      transaction if, for any touched week or registration:
--        - taken_count differs from the number of active spots, or exceeds
--          max_capacity; or
--        - a 'pending_payment' or 'paid' registration does not hold ALL of its
--          spots (at least one spot, none cancelled); or
--        - a 'cancelled' or 'refunded' registration still holds an active spot.
--      Together these mean no registration can be Confirmed without valid
--      allocated capacity, and no released registration can quietly keep a
--      spot.
--   C. New registrations columns used by the release/report logic:
--        hold_expires_at      when an UNREPORTED reservation may be released
--                             (NULL = never expires; nothing sets it yet, so
--                             today's behaviour is unchanged until Stage 2)
--        payment_reported_at  the parent's "I've sent it" marker (a marker,
--                             never a status; Stage 3 adds the parent's button)
--        release_reason       why a reservation was released
--      plus a CHECK that an 'expired_unpaid' release can never be recorded
--      against a registration the parent has reported.
--   D. admin_audit_log.actor ('owner' or 'system').
--
-- Safe to re-run (idempotent). It FAILS LOUDLY, changing nothing, if existing
-- data already violates the rules above, so a bad row is never papered over.
--
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_capacity_integrity.sql

BEGIN;

-- 0. Preflight -------------------------------------------------------------
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(w.id || ' (' || s.n || ' active spots > capacity ' || w.max_capacity || ')', ', ')
    INTO bad
    FROM camp_weeks w
    JOIN (SELECT week_id, count(*) AS n FROM registration_spots WHERE status = 'active' GROUP BY week_id) s
      ON s.week_id = w.id
   WHERE s.n > w.max_capacity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed - weeks already over capacity: %', bad;
  END IF;

  SELECT string_agg(r.id::text || ' [' || r.status || ']', ', ')
    INTO bad
    FROM registrations r
    LEFT JOIN LATERAL (
      SELECT count(*) AS total, count(*) FILTER (WHERE status = 'active') AS active
        FROM registration_spots WHERE registration_id = r.id
    ) s ON TRUE
   WHERE (r.status IN ('pending_payment', 'paid') AND (s.total = 0 OR s.active <> s.total))
      OR (r.status IN ('cancelled', 'refunded') AND s.active > 0);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight failed - registrations whose status does not match their spots (for example paid with no spots): %. Review and fix these before migrating.', bad;
  END IF;
END $$;

-- C/D. New columns ----------------------------------------------------------
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS hold_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_reason      TEXT;

ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'owner';

CREATE INDEX IF NOT EXISTS idx_registrations_hold_expiry
  ON registrations (hold_expires_at)
  WHERE status = 'pending_payment' AND payment_reported_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_expiry_never_reported') THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_expiry_never_reported
      CHECK (release_reason IS DISTINCT FROM 'expired_unpaid' OR payment_reported_at IS NULL);
  END IF;
END $$;

-- A. Counter maintained by the database ------------------------------------
-- Bring the counters in line with the spots before the trigger takes over.
-- (The preflight above guarantees this cannot exceed any week's capacity.)
UPDATE camp_weeks w
   SET taken_count = (SELECT count(*) FROM registration_spots s WHERE s.week_id = w.id AND s.status = 'active')
 WHERE taken_count <> (SELECT count(*) FROM registration_spots s WHERE s.week_id = w.id AND s.status = 'active');

CREATE OR REPLACE FUNCTION camp_take_spot(p_week TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- The UPDATE takes the week's row lock, so concurrent activations of spots in
  -- the same week queue here and each re-checks against the committed count.
  UPDATE camp_weeks
     SET taken_count = taken_count + 1, updated_at = now()
   WHERE id = p_week AND taken_count < max_capacity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'camp week % is at capacity', p_week
      USING ERRCODE = 'check_violation', CONSTRAINT = 'camp_week_capacity', DETAIL = 'week_id=' || p_week;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION camp_free_spot(p_week TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE camp_weeks
     SET taken_count = taken_count - 1, updated_at = now()
   WHERE id = p_week AND taken_count > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'camp week % has no taken spot to free (counter out of sync)', p_week
      USING ERRCODE = 'check_violation', CONSTRAINT = 'camp_week_counter', DETAIL = 'week_id=' || p_week;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION camp_spot_counter() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN PERFORM camp_take_spot(NEW.week_id); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN PERFORM camp_free_spot(OLD.week_id); END IF;
    RETURN OLD;
  END IF;
  -- UPDATE of status and/or week_id
  IF OLD.status = 'active' AND (NEW.status <> 'active' OR NEW.week_id <> OLD.week_id) THEN
    PERFORM camp_free_spot(OLD.week_id);
  END IF;
  IF NEW.status = 'active' AND (OLD.status <> 'active' OR NEW.week_id <> OLD.week_id) THEN
    PERFORM camp_take_spot(NEW.week_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS camp_spot_counter ON registration_spots;
CREATE TRIGGER camp_spot_counter
  AFTER INSERT OR DELETE OR UPDATE OF status, week_id ON registration_spots
  FOR EACH ROW EXECUTE FUNCTION camp_spot_counter();

-- B. Deferred integrity checks (run at COMMIT) ------------------------------
CREATE OR REPLACE FUNCTION camp_assert_week(p_week TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  w RECORD;
  n INTEGER;
BEGIN
  SELECT taken_count, max_capacity INTO w FROM camp_weeks WHERE id = p_week;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO n FROM registration_spots WHERE week_id = p_week AND status = 'active';
  IF n <> w.taken_count THEN
    RAISE EXCEPTION 'camp week % counter says % taken but % spots are active', p_week, w.taken_count, n
      USING ERRCODE = 'check_violation', CONSTRAINT = 'camp_week_counter', DETAIL = 'week_id=' || p_week;
  END IF;
  IF n > w.max_capacity THEN
    RAISE EXCEPTION 'camp week % has % active spots, over its capacity of %', p_week, n, w.max_capacity
      USING ERRCODE = 'check_violation', CONSTRAINT = 'camp_week_capacity', DETAIL = 'week_id=' || p_week;
  END IF;
END $$;

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
  IF r_status IN ('pending_payment', 'paid') AND (n_total = 0 OR n_active <> n_total) THEN
    RAISE EXCEPTION 'registration % is % but holds % of % spots - it must hold all of its spots', p_reg, r_status, n_active, n_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_status_matches_spots', DETAIL = 'registration_id=' || p_reg;
  ELSIF r_status IN ('cancelled', 'refunded') AND n_active > 0 THEN
    RAISE EXCEPTION 'registration % is % but still holds % active spots', p_reg, r_status, n_active
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_status_matches_spots', DETAIL = 'registration_id=' || p_reg;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION camp_check_spot_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM camp_assert_week(OLD.week_id);
    PERFORM camp_assert_registration(OLD.registration_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM camp_assert_week(NEW.week_id);
    PERFORM camp_assert_registration(NEW.registration_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION camp_check_registration_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM camp_assert_registration(NEW.id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION camp_check_week_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM camp_assert_week(NEW.id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS camp_integrity_spots ON registration_spots;
CREATE CONSTRAINT TRIGGER camp_integrity_spots
  AFTER INSERT OR UPDATE OR DELETE ON registration_spots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION camp_check_spot_row();

DROP TRIGGER IF EXISTS camp_integrity_registrations ON registrations;
CREATE CONSTRAINT TRIGGER camp_integrity_registrations
  AFTER INSERT OR UPDATE ON registrations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION camp_check_registration_row();

DROP TRIGGER IF EXISTS camp_integrity_weeks ON camp_weeks;
CREATE CONSTRAINT TRIGGER camp_integrity_weeks
  AFTER INSERT OR UPDATE ON camp_weeks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION camp_check_week_row();

COMMIT;
