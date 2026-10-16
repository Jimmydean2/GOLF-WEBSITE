-- ============================================================================================
-- DESIGN SKETCH, NOT A MIGRATION.  Lessons and clinics: the database protections.
--
-- This file lives in docs/design/ on purpose. `npm run db:migrate` applies every file in
-- db/migrations/ and nothing here. It is the executable form of the rules described in
-- docs/LESSONS_AND_CLINICS_DESIGN.md, written so they can be tried on a scratch database
-- BEFORE any real migration exists. It is attacked on PostgreSQL 16 by
-- db/tests/lessons-clinics-sketch.test.mjs (npm run test:lessons-clinics-sketch: races on real
-- parallel connections, raw-SQL attacks, deliberate breakage); the real migrations (009 and up)
-- will be derived from it, additive only, and tested like the camp's.
--
-- Nothing here touches the camp's tables. The only shared object it will ever extend is
-- email_outbox (a new nullable booking_id column and more email kinds), the same way
-- migration 008 extended it for the waiting list.
--
-- Money is integer cents. Times are timestamptz (exact instants). A booking's wall-clock time
-- in America/Toronto is stored beside the instant because weekly series are built from the
-- wall-clock time, not from "+7 x 24 hours" (which is wrong across a clock change).
-- ============================================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Settings: one row. Every number James may want to change lives here or in a product. ----
CREATE TABLE IF NOT EXISTS booking_settings (
  id                            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Money. 'unset' blocks every public booking until James confirms (decision B2).
  tax_mode                      TEXT NOT NULL DEFAULT 'unset' CHECK (tax_mode IN ('unset', 'none', 'added', 'included')),
  tax_confirmed_at              TIMESTAMPTZ,
  gst_rate                      NUMERIC(6,5) NOT NULL DEFAULT 0.05000 CHECK (gst_rate >= 0 AND gst_rate < 0.5),
  qst_rate                      NUMERIC(6,5) NOT NULL DEFAULT 0.09975 CHECK (qst_rate >= 0 AND qst_rate < 0.5),
  gst_number                    TEXT,
  qst_number                    TEXT,
  -- Holds, in minutes (decision C1: short lesson holds, 12-hour clinic holds).
  lesson_hold_minutes           INTEGER NOT NULL DEFAULT 180   CHECK (lesson_hold_minutes BETWEEN 15 AND 4320),
  lesson_hold_near_minutes      INTEGER NOT NULL DEFAULT 60    CHECK (lesson_hold_near_minutes BETWEEN 15 AND 4320),
  series_hold_minutes           INTEGER NOT NULL DEFAULT 360   CHECK (series_hold_minutes BETWEEN 15 AND 4320),
  clinic_hold_minutes           INTEGER NOT NULL DEFAULT 720   CHECK (clinic_hold_minutes BETWEEN 15 AND 4320),
  clinic_hold_near_minutes      INTEGER NOT NULL DEFAULT 180   CHECK (clinic_hold_near_minutes BETWEEN 15 AND 4320),
  near_window_hours             INTEGER NOT NULL DEFAULT 48    CHECK (near_window_hours BETWEEN 1 AND 336),
  min_notice_hours              INTEGER NOT NULL DEFAULT 24    CHECK (min_notice_hours BETWEEN 0 AND 336),
  max_advance_days              INTEGER NOT NULL DEFAULT 60    CHECK (max_advance_days BETWEEN 1 AND 366),
  max_open_holds_per_contact    INTEGER NOT NULL DEFAULT 2     CHECK (max_open_holds_per_contact BETWEEN 1 AND 20),
  -- Google Calendar fail-safe (decision G1 adjustment): see section 8 of the design.
  calendar_refresh_minutes      INTEGER NOT NULL DEFAULT 5     CHECK (calendar_refresh_minutes BETWEEN 1 AND 60),
  calendar_stale_after_minutes  INTEGER NOT NULL DEFAULT 10    CHECK (calendar_stale_after_minutes BETWEEN 2 AND 240),
  -- Packages stay off until James approves their rules (decision C3).
  packages_approved_at          TIMESTAMPTZ,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tax_confirmed_when_set CHECK (tax_mode = 'unset' OR tax_confirmed_at IS NOT NULL),
  CONSTRAINT calendar_stale_after_refresh CHECK (calendar_stale_after_minutes > calendar_refresh_minutes)
);
INSERT INTO booking_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 2. Places, working hours, products, prices ----------------------------------------------
CREATE TABLE IF NOT EXISTS booking_locations (
  id        SMALLSERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  name_fr   TEXT,
  address   TEXT NOT NULL DEFAULT '',
  active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- Working hours: one row per weekday window, valid for a date range (a summer course, a winter one).
CREATE TABLE IF NOT EXISTS availability_rules (
  id          SERIAL PRIMARY KEY,
  location_id SMALLINT NOT NULL REFERENCES booking_locations(id),
  weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),     -- 0 = Sunday
  opens       TIME NOT NULL,
  closes      TIME NOT NULL,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (closes > opens),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS lesson_products (
  id                   SERIAL PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name_en              TEXT NOT NULL,
  name_fr              TEXT NOT NULL,
  -- B1: a 60-minute appointment slot by default; all of these are adjustable in the dashboard.
  slot_minutes         INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 240),
  lesson_minutes       INTEGER NOT NULL DEFAULT 55 CHECK (lesson_minutes BETWEEN 5 AND 240),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0  CHECK (buffer_after_minutes BETWEEN 0 AND 120),
  step_minutes         INTEGER NOT NULL DEFAULT 60 CHECK (step_minutes BETWEEN 5 AND 240),
  max_participants     SMALLINT NOT NULL DEFAULT 3 CHECK (max_participants BETWEEN 1 AND 12),
  tax_treatment        TEXT NOT NULL DEFAULT 'taxable' CHECK (tax_treatment IN ('taxable', 'exempt')),
  published            BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (lesson_minutes <= slot_minutes)
);

-- Prices by date range. Two prices for one product on one day cannot exist.
CREATE TABLE IF NOT EXISTS price_periods (
  id                 SERIAL PRIMARY KEY,
  product_id         INTEGER NOT NULL REFERENCES lesson_products(id),
  valid_from         DATE NOT NULL,
  valid_to           DATE,
  price_cents        INTEGER NOT NULL CHECK (price_cents >= 0),
  extra_person_cents INTEGER NOT NULL DEFAULT 0 CHECK (extra_person_cents >= 0),
  CONSTRAINT price_periods_no_overlap
    EXCLUDE USING gist (product_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);

-- 3. The coach's time: ONE table of occupied time, ONE rule ----------------------------------
-- A lesson (with its buffer), a clinic session and an owner block each occupy a range of the
-- coach's time. PostgreSQL itself refuses two active ranges that overlap. [start, end) means
-- one range may end at the exact instant the next begins.
CREATE TABLE IF NOT EXISTS schedule_occupancy (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id           SMALLINT NOT NULL DEFAULT 1,                 -- the coach; room for more
  kind                  TEXT NOT NULL CHECK (kind IN ('lesson', 'clinic_session', 'block')),
  span                  TSTZRANGE NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  lesson_appointment_id UUID UNIQUE,
  clinic_session_id     UUID UNIQUE,
  time_block_id         UUID UNIQUE,
  reason                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT occupancy_span_is_closed_open
    CHECK (NOT isempty(span) AND lower_inc(span) AND NOT upper_inc(span) AND NOT lower_inf(span) AND NOT upper_inf(span)),
  CONSTRAINT occupancy_one_owner CHECK (
    (kind = 'lesson'         AND lesson_appointment_id IS NOT NULL AND clinic_session_id IS NULL AND time_block_id IS NULL) OR
    (kind = 'clinic_session' AND clinic_session_id     IS NOT NULL AND lesson_appointment_id IS NULL AND time_block_id IS NULL) OR
    (kind = 'block'          AND time_block_id         IS NOT NULL AND lesson_appointment_id IS NULL AND clinic_session_id IS NULL)),
  CONSTRAINT schedule_no_overlap
    EXCLUDE USING gist (resource_id WITH =, span WITH &&) WHERE (active)
);
CREATE INDEX IF NOT EXISTS idx_occupancy_active_span ON schedule_occupancy USING gist (span) WHERE active;

-- 4. Bookings: one customer's reservation, payment and money --------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                     TEXT NOT NULL CHECK (kind IN ('lesson', 'clinic')),
  created_by               TEXT NOT NULL DEFAULT 'customer' CHECK (created_by IN ('customer', 'owner')),
  idempotency_key          TEXT NOT NULL UNIQUE,
  reference_code           TEXT NOT NULL UNIQUE,                      -- GL-XXXXXX / GC-XXXXXX
  customer_name            TEXT NOT NULL,
  email                    TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  language                 TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  privacy_consent_at       TIMESTAMPTZ NOT NULL,
  privacy_notice_version   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'reserved'
                           CHECK (status IN ('reserved', 'payment_reported', 'paid', 'expired', 'cancelled', 'refunded')),
  -- The money, frozen at the moment of booking. 'unset' can never be stored (decision B2).
  tax_mode                 TEXT NOT NULL CHECK (tax_mode IN ('none', 'added', 'included')),
  gst_rate                 NUMERIC(6,5) NOT NULL,
  qst_rate                 NUMERIC(6,5) NOT NULL,
  subtotal_cents           INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  gst_cents                INTEGER NOT NULL CHECK (gst_cents >= 0),
  qst_cents                INTEGER NOT NULL CHECK (qst_cents >= 0),
  total_cents              INTEGER NOT NULL CHECK (total_cents >= 0),
  -- The clocks.
  hold_expires_at          TIMESTAMPTZ,
  hold_ends_at_initial     TIMESTAMPTZ,
  payment_reported_at      TIMESTAMPTZ,
  review_due_at            TIMESTAMPTZ,
  extension_count          SMALLINT NOT NULL DEFAULT 0 CHECK (extension_count BETWEEN 0 AND 3),
  -- Verification by the owner (a customer's claim is never proof of payment).
  verified_at              TIMESTAMPTZ,
  verification_method      TEXT CHECK (verification_method IN ('reference_matched', 'name_amount_time', 'cash_or_other')),
  deposit_at               TIMESTAMPTZ,
  amount_received_cents    INTEGER,
  bank_confirmation_number TEXT,
  verification_note        TEXT,
  -- Things that need a human, kept in view until resolved.
  payment_issue            TEXT NOT NULL DEFAULT 'none'
                           CHECK (payment_issue IN ('none', 'late_unavailable', 'amount_mismatch', 'duplicate', 'refund_due')),
  cancelled_at             TIMESTAMPTZ,
  cancelled_by             TEXT CHECK (cancelled_by IN ('customer', 'owner', 'system')),
  cancel_reason            TEXT,
  refund_status            TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'due', 'issued', 'declined')),
  -- Lesson fail-safe: every lesson reservation records a live Google Calendar check made
  -- moments before. 'manual_override' is only for a booking James himself makes (by phone,
  -- while the calendar cannot be reached).
  calendar_checked_at      TIMESTAMPTZ,
  calendar_check_result    TEXT CHECK (calendar_check_result IN ('clear', 'manual_override')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bookings_total_is_sum CHECK (total_cents = subtotal_cents + gst_cents + qst_cents),
  CONSTRAINT bookings_no_tax_when_none CHECK (tax_mode <> 'none' OR (gst_cents = 0 AND qst_cents = 0)),
  CONSTRAINT bookings_reserved_has_hold
    CHECK (status <> 'reserved' OR (hold_expires_at IS NOT NULL AND payment_reported_at IS NULL)),
  CONSTRAINT bookings_reported_has_review
    CHECK (status <> 'payment_reported' OR (payment_reported_at IS NOT NULL AND review_due_at IS NOT NULL)),
  -- A reported payment is never expired by the system.
  CONSTRAINT bookings_expiry_never_reported
    CHECK (status <> 'expired' OR payment_reported_at IS NULL),
  CONSTRAINT bookings_paid_verified
    CHECK (status <> 'paid' OR (verified_at IS NOT NULL AND verification_method IS NOT NULL AND deposit_at IS NOT NULL
           AND amount_received_cents IS NOT NULL AND amount_received_cents = total_cents)),
  CONSTRAINT bookings_cancelled_has_time
    CHECK (status NOT IN ('cancelled') OR cancelled_at IS NOT NULL),
  -- The fail-safe, in the data: no lesson exists without a recent calendar check.
  CONSTRAINT bookings_lesson_calendar_checked CHECK (
    kind <> 'lesson' OR (
      calendar_check_result IN ('clear', 'manual_override')
      AND calendar_checked_at IS NOT NULL
      AND calendar_checked_at <= created_at + interval '1 second'
      AND created_at - calendar_checked_at <= interval '30 seconds')),
  CONSTRAINT bookings_override_is_owner_only CHECK (calendar_check_result IS DISTINCT FROM 'manual_override' OR created_by = 'owner')
);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings (lower(email));
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_hold ON bookings (hold_expires_at) WHERE status = 'reserved';

-- Legal moves between statuses; the clocks and the money cannot be edited after the fact.
CREATE OR REPLACE FUNCTION booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind OR NEW.reference_code <> OLD.reference_code OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.created_at <> OLD.created_at OR NEW.tax_mode <> OLD.tax_mode OR NEW.total_cents <> OLD.total_cents
     OR NEW.subtotal_cents <> OLD.subtotal_cents OR NEW.gst_cents <> OLD.gst_cents OR NEW.qst_cents <> OLD.qst_cents THEN
    RAISE EXCEPTION 'booking % : fixed fields cannot change (cancel and book again instead)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_fixed_fields';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'reserved'         AND NEW.status IN ('payment_reported', 'paid', 'expired', 'cancelled')) OR
       (OLD.status = 'payment_reported' AND NEW.status IN ('paid', 'cancelled')) OR           -- never 'expired'
       (OLD.status = 'paid'             AND NEW.status IN ('cancelled', 'refunded')) OR
       (OLD.status = 'expired'          AND NEW.status IN ('paid', 'cancelled')) OR           -- a late payment, re-reserved if still free
       (OLD.status = 'cancelled'        AND NEW.status = 'refunded' AND OLD.verified_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'booking % : % -> % is not a legal move', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_legal_move';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS booking_guard ON bookings;
CREATE TRIGGER booking_guard BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION booking_guard();

-- 5. Private lessons: appointments ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_appointments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES lesson_products(id),
  location_id    SMALLINT NOT NULL REFERENCES booking_locations(id),
  series_index   SMALLINT NOT NULL DEFAULT 1 CHECK (series_index >= 1),
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,                  -- start + the product's slot_minutes
  occupied_until TIMESTAMPTZ NOT NULL,                  -- ends_at + the product's buffer
  local_date     DATE NOT NULL,                         -- wall-clock date in America/Toronto
  local_start    TIME NOT NULL,                         -- wall-clock start in America/Toronto
  participants   SMALLINT NOT NULL DEFAULT 1 CHECK (participants >= 1),
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed', 'no_show')),
  UNIQUE (booking_id, series_index),
  CHECK (ends_at > starts_at AND occupied_until >= ends_at),
  CONSTRAINT appointment_wall_clock_matches CHECK (starts_at = ((local_date + local_start) AT TIME ZONE 'America/Toronto'))
);
ALTER TABLE schedule_occupancy
  DROP CONSTRAINT IF EXISTS occupancy_lesson_fk;
ALTER TABLE schedule_occupancy
  ADD CONSTRAINT occupancy_lesson_fk FOREIGN KEY (lesson_appointment_id) REFERENCES lesson_appointments(id) ON DELETE CASCADE;

-- 6. Group clinics: offerings, sessions, spots ------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_offerings (
  id                SERIAL PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title_en          TEXT NOT NULL,
  title_fr          TEXT NOT NULL,
  location_id       SMALLINT REFERENCES booking_locations(id),
  kind              TEXT NOT NULL DEFAULT 'series' CHECK (kind IN ('series', 'single')),
  standard_capacity INTEGER NOT NULL DEFAULT 10 CHECK (standard_capacity BETWEEN 1 AND 40),
  capacity          INTEGER NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 1 AND 40),
  taken_count       INTEGER NOT NULL DEFAULT 0 CHECK (taken_count >= 0),
  price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
  tax_treatment     TEXT NOT NULL DEFAULT 'taxable' CHECK (tax_treatment IN ('taxable', 'exempt')),
  published         BOOLEAN NOT NULL DEFAULT FALSE,
  registration_opens_at TIMESTAMPTZ,
  CONSTRAINT clinic_taken_within_capacity CHECK (taken_count <= capacity)
);

-- Raising a clinic above its standard capacity needs a recorded written authorization, as for the camp.
CREATE TABLE IF NOT EXISTS booking_capacity_authorizations (
  id          SERIAL PRIMARY KEY,
  offering_id INTEGER NOT NULL REFERENCES clinic_offerings(id),
  capacity    INTEGER NOT NULL,
  note        TEXT NOT NULL CHECK (length(btrim(note)) >= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION clinic_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.capacity > NEW.standard_capacity AND NOT EXISTS (
       SELECT 1 FROM booking_capacity_authorizations a WHERE a.offering_id = NEW.id AND a.capacity >= NEW.capacity) THEN
    RAISE EXCEPTION 'clinic % : capacity % is above the standard % without a recorded authorization', NEW.id, NEW.capacity, NEW.standard_capacity
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_capacity_authorization';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clinic_capacity_guard ON clinic_offerings;
CREATE TRIGGER clinic_capacity_guard BEFORE INSERT OR UPDATE OF capacity ON clinic_offerings
  FOR EACH ROW EXECUTE FUNCTION clinic_capacity_guard();

CREATE TABLE IF NOT EXISTS clinic_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  INTEGER NOT NULL REFERENCES clinic_offerings(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  CHECK (ends_at > starts_at),
  UNIQUE (offering_id, starts_at)
);
ALTER TABLE schedule_occupancy DROP CONSTRAINT IF EXISTS occupancy_clinic_session_fk;
ALTER TABLE schedule_occupancy
  ADD CONSTRAINT occupancy_clinic_session_fk FOREIGN KEY (clinic_session_id) REFERENCES clinic_sessions(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS clinic_spots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  offering_id      INTEGER NOT NULL REFERENCES clinic_offerings(id),
  participant_name TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  checked_in_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_spots_offering ON clinic_spots (offering_id) WHERE status = 'active';

-- The spots counter, maintained by the database and never by application code.
CREATE OR REPLACE FUNCTION clinic_take_spot(p_offering INTEGER) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE clinic_offerings SET taken_count = taken_count + 1
   WHERE id = p_offering AND taken_count < capacity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clinic % is at capacity', p_offering
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_capacity', DETAIL = 'offering_id=' || p_offering;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION clinic_free_spot(p_offering INTEGER) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE clinic_offerings SET taken_count = taken_count - 1 WHERE id = p_offering AND taken_count > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clinic % has no taken spot to free (counter out of sync)', p_offering
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_counter', DETAIL = 'offering_id=' || p_offering;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION clinic_spot_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN PERFORM clinic_take_spot(NEW.offering_id); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN PERFORM clinic_free_spot(OLD.offering_id); END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'active' AND (NEW.status <> 'active' OR NEW.offering_id <> OLD.offering_id) THEN
    PERFORM clinic_free_spot(OLD.offering_id);
  END IF;
  IF NEW.status = 'active' AND (OLD.status <> 'active' OR NEW.offering_id <> OLD.offering_id) THEN
    PERFORM clinic_take_spot(NEW.offering_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clinic_spot_counter ON clinic_spots;
CREATE TRIGGER clinic_spot_counter AFTER INSERT OR DELETE OR UPDATE OF status, offering_id ON clinic_spots
  FOR EACH ROW EXECUTE FUNCTION clinic_spot_counter();

-- 7. Commit-time integrity: a booking's status, its occupied time and its spots always agree ---
-- Runs at COMMIT for every touched booking / offering, so even raw SQL cannot leave a cancelled
-- booking holding time or spots, or a live booking without them. This is the camp's technique.
CREATE OR REPLACE FUNCTION booking_assert(p_booking UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  b RECORD;
  live BOOLEAN;
  n_total INTEGER; n_sched INTEGER; n_occ_active INTEGER; n_occ_match INTEGER;
  s_total INTEGER; s_active INTEGER;
BEGIN
  SELECT kind, status INTO b FROM bookings WHERE id = p_booking;
  IF NOT FOUND THEN RETURN; END IF;
  live := b.status IN ('reserved', 'payment_reported', 'paid');
  IF b.kind = 'lesson' THEN
    SELECT count(*), count(*) FILTER (WHERE a.status = 'scheduled'),
           count(*) FILTER (WHERE o.active),
           count(*) FILTER (WHERE o.active AND a.status = 'scheduled' AND o.span = tstzrange(a.starts_at, a.occupied_until, '[)'))
      INTO n_total, n_sched, n_occ_active, n_occ_match
      FROM lesson_appointments a LEFT JOIN schedule_occupancy o ON o.lesson_appointment_id = a.id
     WHERE a.booking_id = p_booking;
    IF live AND (n_total = 0 OR n_occ_match <> n_sched OR n_occ_active <> n_sched) THEN
      RAISE EXCEPTION 'booking % is % but its lessons and its occupied time do not agree (% scheduled, % occupied, % matching)', p_booking, b.status, n_sched, n_occ_active, n_occ_match
        USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_status_matches_time';
    ELSIF NOT live AND n_occ_active > 0 THEN
      RAISE EXCEPTION 'booking % is % but still occupies % time ranges', p_booking, b.status, n_occ_active
        USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_status_matches_time';
    END IF;
  ELSE
    SELECT count(*), count(*) FILTER (WHERE status = 'active') INTO s_total, s_active FROM clinic_spots WHERE booking_id = p_booking;
    IF live AND (s_total = 0 OR s_active <> s_total) THEN
      RAISE EXCEPTION 'booking % is % but holds % of % spots', p_booking, b.status, s_active, s_total
        USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_status_matches_spots';
    ELSIF NOT live AND s_active > 0 THEN
      RAISE EXCEPTION 'booking % is % but still holds % active spots', p_booking, b.status, s_active
        USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_status_matches_spots';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION clinic_assert(p_offering INTEGER) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o RECORD; n INTEGER;
BEGIN
  SELECT taken_count, capacity INTO o FROM clinic_offerings WHERE id = p_offering;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO n FROM clinic_spots WHERE offering_id = p_offering AND status = 'active';
  IF n <> o.taken_count OR n > o.capacity THEN
    RAISE EXCEPTION 'clinic % counter says % taken, % spots are active, capacity %', p_offering, o.taken_count, n, o.capacity
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_counter';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION booking_check_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid UUID; oid INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    PERFORM booking_assert(NEW.id);
  ELSIF TG_TABLE_NAME = 'lesson_appointments' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM booking_assert(OLD.booking_id); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM booking_assert(NEW.booking_id); END IF;
  ELSIF TG_TABLE_NAME = 'schedule_occupancy' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.lesson_appointment_id IS NOT NULL THEN
      SELECT booking_id INTO bid FROM lesson_appointments WHERE id = OLD.lesson_appointment_id;
      IF bid IS NOT NULL THEN PERFORM booking_assert(bid); END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.lesson_appointment_id IS NOT NULL THEN
      SELECT booking_id INTO bid FROM lesson_appointments WHERE id = NEW.lesson_appointment_id;
      IF bid IS NOT NULL THEN PERFORM booking_assert(bid); END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'clinic_spots' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM booking_assert(OLD.booking_id); PERFORM clinic_assert(OLD.offering_id); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM booking_assert(NEW.booking_id); PERFORM clinic_assert(NEW.offering_id); END IF;
  ELSIF TG_TABLE_NAME = 'clinic_offerings' THEN
    PERFORM clinic_assert(NEW.id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS booking_integrity_bookings ON bookings;
CREATE CONSTRAINT TRIGGER booking_integrity_bookings AFTER INSERT OR UPDATE ON bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_appointments ON lesson_appointments;
CREATE CONSTRAINT TRIGGER booking_integrity_appointments AFTER INSERT OR UPDATE OR DELETE ON lesson_appointments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_occupancy ON schedule_occupancy;
CREATE CONSTRAINT TRIGGER booking_integrity_occupancy AFTER INSERT OR UPDATE OR DELETE ON schedule_occupancy
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_spots ON clinic_spots;
CREATE CONSTRAINT TRIGGER booking_integrity_spots AFTER INSERT OR UPDATE OR DELETE ON clinic_spots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_offerings ON clinic_offerings;
CREATE CONSTRAINT TRIGGER booking_integrity_offerings AFTER INSERT OR UPDATE ON clinic_offerings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();

-- 8. Lesson packages (flexible credits). BUILT BUT OFF until James approves the rules (decision C3).
-- A purchase is paid by Interac like any booking (kind 'package' in the real migration);
-- credits are spent against it. The counter works exactly like the clinic spots counter:
-- two people can never spend the last credit.
CREATE TABLE IF NOT EXISTS package_purchases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email    TEXT NOT NULL,
  credits_total     INTEGER NOT NULL CHECK (credits_total BETWEEN 1 AND 50),
  credits_remaining INTEGER NOT NULL CHECK (credits_remaining BETWEEN 0 AND 50),
  expires_at        TIMESTAMPTZ NOT NULL,
  rules_version     TEXT NOT NULL,                       -- the version of the rules James approved
  paid_at           TIMESTAMPTZ,                         -- credits can only be spent once paid
  CONSTRAINT credits_within_total CHECK (credits_remaining <= credits_total)
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          BIGSERIAL PRIMARY KEY,
  purchase_id UUID NOT NULL REFERENCES package_purchases(id),
  delta       INTEGER NOT NULL CHECK (delta <> 0),       -- -1 spend, +1 give back (cancelled in time)
  reason      TEXT NOT NULL,
  appointment_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION credit_ledger_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  -- The UPDATE takes the purchase's row lock, so concurrent spends queue and each re-checks the balance.
  UPDATE package_purchases
     SET credits_remaining = credits_remaining + NEW.delta
   WHERE id = NEW.purchase_id AND paid_at IS NOT NULL AND expires_at > now()
     AND credits_remaining + NEW.delta BETWEEN 0 AND credits_total
  RETURNING * INTO p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package % cannot apply % (unpaid, expired, or no credits left)', NEW.purchase_id, NEW.delta
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_balance';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS credit_ledger_apply ON credit_ledger;
CREATE TRIGGER credit_ledger_apply BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_apply();
-- The ledger is append-only (a correction is a new row, never an edit).
CREATE OR REPLACE FUNCTION credit_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'credit_ledger is append-only' USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_ledger_append_only'; END $$;
DROP TRIGGER IF EXISTS credit_ledger_no_change ON credit_ledger;
CREATE TRIGGER credit_ledger_no_change BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_immutable();
