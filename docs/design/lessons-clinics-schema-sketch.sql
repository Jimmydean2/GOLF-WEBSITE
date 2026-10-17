-- ============================================================================================
-- DESIGN SKETCH, NOT A MIGRATION.  Lessons and clinics: the database protections.  (Revision 2)
--
-- This file lives in docs/design/ on purpose. `npm run db:migrate` applies every file in
-- db/migrations/ and nothing here. It is the executable form of the rules described in
-- docs/LESSONS_AND_CLINICS_DESIGN.md, written so they can be tried on a scratch database
-- BEFORE any real migration exists. It is attacked on PostgreSQL 16 by
-- db/tests/lessons-clinics-sketch.test.mjs (npm run test:lessons-clinics-sketch: races on real
-- parallel connections, raw-SQL attacks, deliberate breakage); the real migrations (009 and up)
-- will be derived from it, additive only, and tested like the camp's.
--
-- REVISION 2 (2026-10-17): private lessons are BOOK NOW, PAY AT THE LESSON (cash or Interac e-Transfer).
--   * PRIVATE LESSONS (lesson_bookings): confirmed the moment they are booked. There is no hold, no
--     deadline and no "expired" state, so an unpaid lesson can never lapse; the system never cancels
--     a lesson by itself (cancelled_by is only 'customer' or 'owner'). Payment is recorded afterwards
--     by the owner as Unpaid / Paid - Cash / Paid - Interac, with a database-written audit trail.
--   * GROUP CLINICS (clinic_bookings) keep the ADVANCE-PAYMENT rules of the camp: a hold, a payment
--     the customer reports, the owner's verification of the exact amount, expiry of an unreported
--     hold, and late-payment handling. A reported payment is never expired by the system.
--   * The CAMP is untouched (its tables are not mentioned here).
--
-- Nothing here touches the camp's tables. The only shared object it will ever extend is
-- email_outbox (a nullable lesson_booking_id and clinic_booking_id column and more email kinds),
-- the same way migration 008 extended it for the waiting list.
--
-- Money is integer cents. Times are timestamptz (exact instants). A lesson's wall-clock time in
-- America/Toronto is stored beside the instant because weekly series are built from the wall-clock
-- time, not from "+7 x 24 hours" (which is wrong across a clock change).
-- ============================================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Settings: one row. Every number James may want to change lives here or in a product. ----
CREATE TABLE IF NOT EXISTS booking_settings (
  id                              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Money. 'unset' blocks every public booking until James confirms (decision B2).
  tax_mode                        TEXT NOT NULL DEFAULT 'unset' CHECK (tax_mode IN ('unset', 'none', 'added', 'included')),
  tax_confirmed_at                TIMESTAMPTZ,
  gst_rate                        NUMERIC(6,5) NOT NULL DEFAULT 0.05000 CHECK (gst_rate >= 0 AND gst_rate < 0.5),
  qst_rate                        NUMERIC(6,5) NOT NULL DEFAULT 0.09975 CHECK (qst_rate >= 0 AND qst_rate < 0.5),
  gst_number                      TEXT,
  qst_number                      TEXT,
  -- PRIVATE LESSONS: no hold, no expiry. Only how far ahead and how many a customer may have.
  min_notice_hours                INTEGER NOT NULL DEFAULT 24   CHECK (min_notice_hours BETWEEN 0 AND 336),
  max_advance_days                INTEGER NOT NULL DEFAULT 60   CHECK (max_advance_days BETWEEN 1 AND 366),
  max_upcoming_lessons_per_contact INTEGER NOT NULL DEFAULT 2   CHECK (max_upcoming_lessons_per_contact BETWEEN 1 AND 20),
  block_after_unpaid_lessons      INTEGER NOT NULL DEFAULT 2    CHECK (block_after_unpaid_lessons BETWEEN 0 AND 20),   -- 0 = never block
  unpaid_grace_days               INTEGER NOT NULL DEFAULT 7    CHECK (unpaid_grace_days BETWEEN 0 AND 90),
  -- PRIVATE LESSONS: cancellation rules (decision: proposed 24-hour notice; the wording is James's to confirm).
  cancel_notice_hours             INTEGER NOT NULL DEFAULT 24   CHECK (cancel_notice_hours BETWEEN 0 AND 720),
  reschedule_notice_hours         INTEGER NOT NULL DEFAULT 24   CHECK (reschedule_notice_hours BETWEEN 0 AND 720),
  customer_can_cancel             BOOLEAN NOT NULL DEFAULT TRUE,
  customer_can_reschedule         BOOLEAN NOT NULL DEFAULT FALSE,
  inside_notice_online_action     TEXT NOT NULL DEFAULT 'contact_only' CHECK (inside_notice_online_action IN ('contact_only', 'allow_and_flag')),
  late_cancel_fee_percent         SMALLINT NOT NULL DEFAULT 0   CHECK (late_cancel_fee_percent BETWEEN 0 AND 100),
  no_show_fee_percent             SMALLINT NOT NULL DEFAULT 0   CHECK (no_show_fee_percent BETWEEN 0 AND 100),
  cancellation_policy_version     TEXT NOT NULL DEFAULT 'unset',
  cancellation_policy_confirmed_at TIMESTAMPTZ,
  -- PRIVATE LESSONS: reminders (hours before the lesson; NULL switches one off).
  reminder_first_hours            INTEGER DEFAULT 24 CHECK (reminder_first_hours BETWEEN 1 AND 168),
  reminder_second_hours           INTEGER DEFAULT 2  CHECK (reminder_second_hours BETWEEN 1 AND 48),
  -- GROUP CLINICS: the advance-payment holds, as the camp's (decision C1).
  clinic_hold_minutes             INTEGER NOT NULL DEFAULT 720  CHECK (clinic_hold_minutes BETWEEN 15 AND 4320),
  clinic_hold_near_minutes        INTEGER NOT NULL DEFAULT 180  CHECK (clinic_hold_near_minutes BETWEEN 15 AND 4320),
  near_window_hours               INTEGER NOT NULL DEFAULT 48   CHECK (near_window_hours BETWEEN 1 AND 336),
  max_open_holds_per_contact      INTEGER NOT NULL DEFAULT 2    CHECK (max_open_holds_per_contact BETWEEN 1 AND 20),
  -- Google Calendar fail-safe (decision G1 adjustment): see section 10 of the design.
  calendar_refresh_minutes        INTEGER NOT NULL DEFAULT 5    CHECK (calendar_refresh_minutes BETWEEN 1 AND 60),
  calendar_stale_after_minutes    INTEGER NOT NULL DEFAULT 10   CHECK (calendar_stale_after_minutes BETWEEN 2 AND 240),
  -- Packages stay off until James approves their rules (decision C3).
  packages_approved_at            TIMESTAMPTZ,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tax_confirmed_when_set CHECK (tax_mode = 'unset' OR tax_confirmed_at IS NOT NULL),
  CONSTRAINT policy_confirmed_when_set CHECK (cancellation_policy_version = 'unset' OR cancellation_policy_confirmed_at IS NOT NULL),
  CONSTRAINT calendar_stale_after_refresh CHECK (calendar_stale_after_minutes > calendar_refresh_minutes),
  CONSTRAINT reminders_in_order CHECK (reminder_second_hours IS NULL OR reminder_first_hours IS NULL OR reminder_second_hours < reminder_first_hours)
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
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id        SMALLINT NOT NULL DEFAULT 1,                 -- the coach; room for more
  kind               TEXT NOT NULL CHECK (kind IN ('lesson', 'clinic_session', 'block')),
  span               TSTZRANGE NOT NULL,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  lesson_booking_id  UUID UNIQUE,
  clinic_session_id  UUID UNIQUE,
  time_block_id      UUID UNIQUE,
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT occupancy_span_is_closed_open
    CHECK (NOT isempty(span) AND lower_inc(span) AND NOT upper_inc(span) AND NOT lower_inf(span) AND NOT upper_inf(span)),
  CONSTRAINT occupancy_one_owner CHECK (
    (kind = 'lesson'         AND lesson_booking_id IS NOT NULL AND clinic_session_id IS NULL AND time_block_id IS NULL) OR
    (kind = 'clinic_session' AND clinic_session_id IS NOT NULL AND lesson_booking_id IS NULL AND time_block_id IS NULL) OR
    (kind = 'block'          AND time_block_id     IS NOT NULL AND lesson_booking_id IS NULL AND clinic_session_id IS NULL)),
  CONSTRAINT schedule_no_overlap
    EXCLUDE USING gist (resource_id WITH =, span WITH &&) WHERE (active)
);
CREATE INDEX IF NOT EXISTS idx_occupancy_active_span ON schedule_occupancy USING gist (span) WHERE active;

-- 4. PRIVATE LESSONS: confirmed on booking, paid at the lesson --------------------------------
-- One row is one lesson. A weekly series the owner adds by hand is several rows sharing a series_id,
-- created in one transaction (all or nothing) and then cancelled, moved and paid one lesson at a time.
CREATE TABLE IF NOT EXISTS lesson_bookings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by               TEXT NOT NULL DEFAULT 'customer' CHECK (created_by IN ('customer', 'owner')),
  series_id                UUID,
  series_index             SMALLINT NOT NULL DEFAULT 1 CHECK (series_index >= 1),
  idempotency_key          TEXT NOT NULL UNIQUE,
  reference_code           TEXT NOT NULL UNIQUE,                      -- GL-XXXXXX, also the e-Transfer memo
  customer_name            TEXT NOT NULL,
  email                    TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  language                 TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  privacy_consent_at       TIMESTAMPTZ NOT NULL,
  privacy_notice_version   TEXT NOT NULL,
  -- The cancellation rules shown at booking, frozen: later changes to the rules never apply backwards.
  policy_version           TEXT NOT NULL CHECK (policy_version <> 'unset'),
  cancel_notice_hours      INTEGER NOT NULL CHECK (cancel_notice_hours BETWEEN 0 AND 720),
  late_cancel_fee_percent  SMALLINT NOT NULL CHECK (late_cancel_fee_percent BETWEEN 0 AND 100),
  no_show_fee_percent      SMALLINT NOT NULL CHECK (no_show_fee_percent BETWEEN 0 AND 100),
  product_id               INTEGER NOT NULL REFERENCES lesson_products(id),
  location_id              SMALLINT NOT NULL REFERENCES booking_locations(id),
  participants             SMALLINT NOT NULL DEFAULT 1 CHECK (participants >= 1),
  starts_at                TIMESTAMPTZ NOT NULL,
  ends_at                  TIMESTAMPTZ NOT NULL,                      -- start + the product's slot_minutes
  occupied_until           TIMESTAMPTZ NOT NULL,                      -- ends_at + the product's buffer
  local_date               DATE NOT NULL,                             -- wall-clock date in America/Toronto
  local_start              TIME NOT NULL,                             -- wall-clock start in America/Toronto
  reschedule_count         SMALLINT NOT NULL DEFAULT 0,
  -- Lifecycle. There is NO 'expired': an unpaid lesson stays confirmed. Only a person ends a lesson.
  status                   TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
  closed_at                TIMESTAMPTZ,                               -- when it was marked completed or no-show
  cancelled_at             TIMESTAMPTZ,
  cancelled_by             TEXT CHECK (cancelled_by IN ('customer', 'owner')),
  cancel_reason            TEXT,
  late_cancelled           BOOLEAN NOT NULL DEFAULT FALSE,
  -- The money, frozen at the moment of booking. 'unset' can never be stored (decision B2).
  tax_mode                 TEXT NOT NULL CHECK (tax_mode IN ('none', 'added', 'included')),
  gst_rate                 NUMERIC(6,5) NOT NULL,
  qst_rate                 NUMERIC(6,5) NOT NULL,
  subtotal_cents           INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  gst_cents                INTEGER NOT NULL CHECK (gst_cents >= 0),
  qst_cents                INTEGER NOT NULL CHECK (qst_cents >= 0),
  total_cents              INTEGER NOT NULL CHECK (total_cents >= 0),
  -- What is actually owed now: the price while the lesson stands, 0 after a free cancellation, a fee after
  -- a late cancellation or a no-show.
  amount_owed_cents        INTEGER NOT NULL,
  -- Payment, recorded by the owner after the lesson.
  payment_status           TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid_cash', 'paid_interac')),
  paid_at                  TIMESTAMPTZ,
  paid_amount_cents        INTEGER,
  payment_reference        TEXT,
  payment_note             TEXT,
  -- Lesson fail-safe: every customer lesson records a live Google Calendar check made moments before.
  -- 'manual_override' is only for a lesson James himself adds (by phone, while the calendar cannot be reached).
  calendar_checked_at      TIMESTAMPTZ,
  calendar_check_result    TEXT CHECK (calendar_check_result IN ('clear', 'manual_override')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_total_is_sum CHECK (total_cents = subtotal_cents + gst_cents + qst_cents),
  CONSTRAINT lesson_no_tax_when_none CHECK (tax_mode <> 'none' OR (gst_cents = 0 AND qst_cents = 0)),
  CONSTRAINT lesson_wall_clock_matches CHECK (starts_at = ((local_date + local_start) AT TIME ZONE 'America/Toronto')),
  CONSTRAINT lesson_times_in_order CHECK (ends_at > starts_at AND occupied_until >= ends_at),
  CONSTRAINT lesson_owed_within_total CHECK (amount_owed_cents BETWEEN 0 AND total_cents),
  CONSTRAINT lesson_owed_matches_status CHECK (
    (status IN ('confirmed', 'completed') AND amount_owed_cents = total_cents)
    OR status = 'no_show'
    OR (status = 'cancelled' AND (late_cancelled OR amount_owed_cents = 0))),
  CONSTRAINT lesson_status_shape CHECK (
    (status = 'confirmed' AND cancelled_at IS NULL AND closed_at IS NULL)
    OR (status IN ('completed', 'no_show') AND closed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND closed_at IS NULL)),
  CONSTRAINT lesson_late_only_when_cancelled CHECK (NOT late_cancelled OR status = 'cancelled'),
  -- Paid exists only for a lesson that has happened (or a cancellation/no-show fee), for something that is owed.
  CONSTRAINT lesson_payment_shape CHECK (
    (payment_status = 'unpaid' AND paid_at IS NULL AND paid_amount_cents IS NULL)
    OR (payment_status IN ('paid_cash', 'paid_interac') AND status IN ('completed', 'no_show', 'cancelled')
        AND amount_owed_cents > 0 AND paid_at IS NOT NULL AND paid_amount_cents IS NOT NULL AND paid_amount_cents >= 0)),
  CONSTRAINT lesson_paid_difference_explained CHECK (
    payment_status = 'unpaid' OR paid_amount_cents = amount_owed_cents OR length(btrim(coalesce(payment_note, ''))) >= 3),
  -- The fail-safe, in the data: no customer lesson exists without a recent calendar check.
  CONSTRAINT lesson_calendar_checked CHECK (
    calendar_check_result IN ('clear', 'manual_override')
    AND calendar_checked_at IS NOT NULL
    AND calendar_checked_at <= created_at + interval '1 second'
    AND created_at - calendar_checked_at <= interval '30 seconds'),
  CONSTRAINT lesson_override_is_owner_only CHECK (calendar_check_result IS DISTINCT FROM 'manual_override' OR created_by = 'owner')
);
CREATE INDEX IF NOT EXISTS idx_lesson_email ON lesson_bookings (lower(email));
CREATE INDEX IF NOT EXISTS idx_lesson_status_start ON lesson_bookings (status, starts_at);
ALTER TABLE schedule_occupancy DROP CONSTRAINT IF EXISTS occupancy_lesson_fk;
ALTER TABLE schedule_occupancy
  ADD CONSTRAINT occupancy_lesson_fk FOREIGN KEY (lesson_booking_id) REFERENCES lesson_bookings(id) ON DELETE CASCADE;

-- 4a. The audit trail: written by the database, so even raw SQL leaves a record ----------------
-- The application says who is acting with  SET LOCAL app.actor = 'owner'  (and optionally app.note).
-- 'unknown' means something changed a lesson without saying who; the tests treat that as a defect.
-- No foreign key: the trail outlives anything, and holds no names, emails or phone numbers.
CREATE TABLE IF NOT EXISTS lesson_events (
  id         BIGSERIAL PRIMARY KEY,
  booking_id UUID NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL CHECK (actor IN ('owner', 'customer', 'system', 'unknown')),
  event      TEXT NOT NULL CHECK (event IN ('created', 'status', 'payment', 'reschedule', 'contact_edit')),
  old_values JSONB,
  new_values JSONB,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_lesson_events_booking ON lesson_events (booking_id, id);

CREATE OR REPLACE FUNCTION lesson_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lesson_events is append-only' USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_events_append_only';
END $$;
DROP TRIGGER IF EXISTS lesson_events_no_change ON lesson_events;
CREATE TRIGGER lesson_events_no_change BEFORE UPDATE OR DELETE ON lesson_events FOR EACH ROW EXECUTE FUNCTION lesson_events_immutable();
DROP TRIGGER IF EXISTS lesson_events_no_truncate ON lesson_events;
CREATE TRIGGER lesson_events_no_truncate BEFORE TRUNCATE ON lesson_events FOR EACH STATEMENT EXECUTE FUNCTION lesson_events_immutable();

CREATE OR REPLACE FUNCTION lesson_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  who  TEXT := coalesce(nullif(current_setting('app.actor', true), ''), 'unknown');
  why  TEXT := nullif(current_setting('app.note', true), '');
  fields TEXT[];
BEGIN
  IF who NOT IN ('owner', 'customer', 'system') THEN who := 'unknown'; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO lesson_events (booking_id, actor, event, new_values, note)
    VALUES (NEW.id, who, 'created',
            jsonb_build_object('status', NEW.status, 'starts_at', NEW.starts_at, 'total_cents', NEW.total_cents, 'created_by', NEW.created_by), why);
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.amount_owed_cents IS DISTINCT FROM OLD.amount_owed_cents OR NEW.late_cancelled IS DISTINCT FROM OLD.late_cancelled THEN
    INSERT INTO lesson_events (booking_id, actor, event, old_values, new_values, note)
    VALUES (NEW.id, who, 'status',
            jsonb_build_object('status', OLD.status, 'amount_owed_cents', OLD.amount_owed_cents, 'late_cancelled', OLD.late_cancelled),
            jsonb_build_object('status', NEW.status, 'amount_owed_cents', NEW.amount_owed_cents, 'late_cancelled', NEW.late_cancelled, 'cancelled_by', NEW.cancelled_by), why);
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.paid_amount_cents IS DISTINCT FROM OLD.paid_amount_cents THEN
    INSERT INTO lesson_events (booking_id, actor, event, old_values, new_values, note)
    VALUES (NEW.id, who, 'payment',
            jsonb_build_object('payment_status', OLD.payment_status, 'paid_amount_cents', OLD.paid_amount_cents, 'paid_at', OLD.paid_at),
            jsonb_build_object('payment_status', NEW.payment_status, 'paid_amount_cents', NEW.paid_amount_cents, 'paid_at', NEW.paid_at, 'payment_reference', NEW.payment_reference),
            coalesce(NEW.payment_note, why));
  END IF;
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    INSERT INTO lesson_events (booking_id, actor, event, old_values, new_values, note)
    VALUES (NEW.id, who, 'reschedule',
            jsonb_build_object('starts_at', OLD.starts_at, 'location_id', OLD.location_id),
            jsonb_build_object('starts_at', NEW.starts_at, 'location_id', NEW.location_id), why);
  END IF;
  fields := ARRAY[]::TEXT[];
  IF NEW.customer_name IS DISTINCT FROM OLD.customer_name THEN fields := array_append(fields, 'customer_name'::text); END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN fields := array_append(fields, 'email'::text); END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN fields := array_append(fields, 'phone'::text); END IF;
  IF array_length(fields, 1) > 0 THEN
    INSERT INTO lesson_events (booking_id, actor, event, new_values, note)
    VALUES (NEW.id, who, 'contact_edit', jsonb_build_object('fields', to_jsonb(fields)), why);   -- field names only, never the values
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lesson_audit ON lesson_bookings;
CREATE TRIGGER lesson_audit AFTER INSERT OR UPDATE ON lesson_bookings FOR EACH ROW EXECUTE FUNCTION lesson_audit();

-- 4b. Legal moves. Only a person ends a lesson; a lesson cannot be marked done before it starts. --------
CREATE OR REPLACE FUNCTION lesson_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_code <> OLD.reference_code OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at
     OR NEW.created_by <> OLD.created_by OR NEW.tax_mode <> OLD.tax_mode OR NEW.total_cents <> OLD.total_cents
     OR NEW.subtotal_cents <> OLD.subtotal_cents OR NEW.gst_cents <> OLD.gst_cents OR NEW.qst_cents <> OLD.qst_cents
     OR NEW.policy_version <> OLD.policy_version OR NEW.cancel_notice_hours <> OLD.cancel_notice_hours
     OR NEW.late_cancel_fee_percent <> OLD.late_cancel_fee_percent OR NEW.no_show_fee_percent <> OLD.no_show_fee_percent
     OR NEW.product_id <> OLD.product_id OR NEW.series_id IS DISTINCT FROM OLD.series_id THEN
    RAISE EXCEPTION 'lesson % : fixed fields cannot change (cancel and book again instead)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_fixed_fields';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (OLD.status = 'confirmed' AND NEW.status IN ('completed', 'no_show', 'cancelled')) THEN
      RAISE EXCEPTION 'lesson % : % -> % is not a legal move', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_legal_move';
    END IF;
    IF NEW.status IN ('completed', 'no_show') AND now() < OLD.starts_at THEN
      RAISE EXCEPTION 'lesson % has not started yet and cannot be marked %', OLD.id, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_not_started';
    END IF;
  END IF;
  IF OLD.status <> 'confirmed' AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.location_id <> OLD.location_id) THEN
    RAISE EXCEPTION 'lesson % is % and its time can no longer be changed', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_closed_time';
  END IF;
  IF OLD.payment_status <> 'unpaid' AND NEW.payment_status = 'unpaid' AND length(btrim(coalesce(NEW.payment_note, ''))) < 3 THEN
    RAISE EXCEPTION 'lesson % : taking a payment back needs a written reason', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_unpay_needs_note';
  END IF;
  IF NEW.starts_at <> OLD.starts_at THEN NEW.reschedule_count := OLD.reschedule_count + 1; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lesson_guard ON lesson_bookings;
CREATE TRIGGER lesson_guard BEFORE UPDATE ON lesson_bookings FOR EACH ROW EXECUTE FUNCTION lesson_guard();

-- 4c. Online booking without prepayment needs a limit on what one contact can hold, and no new online
-- bookings for someone who keeps leaving lessons unpaid. Checked INSIDE the booking transaction, under one
-- lock, so a burst of simultaneous requests from one person cannot slip past it. Lessons the owner adds by
-- hand are exempt.
CREATE OR REPLACE FUNCTION lesson_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s RECORD;
  ekey TEXT;
  pkey TEXT;
  n_upcoming INTEGER;
  n_unpaid INTEGER;
BEGIN
  IF NEW.created_by <> 'customer' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(7401);
  SELECT max_upcoming_lessons_per_contact AS cap, block_after_unpaid_lessons AS blk, unpaid_grace_days AS grace
    INTO s FROM booking_settings WHERE id = 1;
  ekey := lower(btrim(NEW.email));
  pkey := right(regexp_replace(NEW.phone, '\D', '', 'g'), 10);
  SELECT count(*) INTO n_upcoming FROM lesson_bookings x
   WHERE x.status = 'confirmed' AND x.starts_at > now()
     AND (lower(btrim(x.email)) = ekey OR right(regexp_replace(x.phone, '\D', '', 'g'), 10) = pkey);
  IF n_upcoming >= s.cap THEN
    RAISE EXCEPTION 'this contact already has % upcoming lessons', n_upcoming
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_contact_cap';
  END IF;
  IF s.blk > 0 THEN
    SELECT count(*) INTO n_unpaid FROM lesson_bookings x
     WHERE x.status IN ('completed', 'no_show') AND x.payment_status = 'unpaid' AND x.amount_owed_cents > 0
       AND x.closed_at < now() - make_interval(days => s.grace)
       AND (lower(btrim(x.email)) = ekey OR right(regexp_replace(x.phone, '\D', '', 'g'), 10) = pkey);
    IF n_unpaid >= s.blk THEN
      RAISE EXCEPTION 'this contact has % unpaid lessons', n_unpaid
        USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_unpaid_block';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lesson_contact_guard ON lesson_bookings;
CREATE TRIGGER lesson_contact_guard BEFORE INSERT ON lesson_bookings FOR EACH ROW EXECUTE FUNCTION lesson_contact_guard();

-- 4d. Reminders: each (lesson, time, hours-before) is queued once, however many workers run and however late.
CREATE TABLE IF NOT EXISTS lesson_reminders (
  id           BIGSERIAL PRIMARY KEY,
  booking_id   UUID NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  hours_before INTEGER NOT NULL,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, starts_at, hours_before)
);
-- A reminder is due once its moment has come and the lesson is still ahead, only for a lesson that
-- is still confirmed, and only if the booking was made before that moment (a lesson booked
-- 5 hours ahead gets the confirmation, not a 24-hour reminder). A rescheduled lesson has a new
-- starts_at, so it earns new reminders.
CREATE OR REPLACE FUNCTION lesson_queue_reminders(p_now TIMESTAMPTZ) RETURNS TABLE (r_booking UUID, r_hours INTEGER)
LANGUAGE sql AS $$
  WITH s AS (SELECT reminder_first_hours AS f, reminder_second_hours AS g FROM booking_settings WHERE id = 1),
  due AS (
    SELECT b.id AS bid, b.starts_at AS st, h.hrs AS hrs
      FROM lesson_bookings b CROSS JOIN s CROSS JOIN LATERAL (VALUES (s.f), (s.g)) AS h(hrs)
     WHERE h.hrs IS NOT NULL AND b.status = 'confirmed' AND b.starts_at > p_now
       AND b.starts_at - make_interval(hours => h.hrs) <= p_now
       AND b.created_at < b.starts_at - make_interval(hours => h.hrs)
  )
  INSERT INTO lesson_reminders (booking_id, starts_at, hours_before)
  SELECT bid, st, hrs FROM due
  ON CONFLICT DO NOTHING
  RETURNING booking_id, hours_before
$$;

-- 5. GROUP CLINICS: offerings, sessions, spots, and the ADVANCE-PAYMENT booking ------------------------
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

CREATE TABLE IF NOT EXISTS clinic_bookings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by               TEXT NOT NULL DEFAULT 'customer' CHECK (created_by IN ('customer', 'owner')),
  idempotency_key          TEXT NOT NULL UNIQUE,
  reference_code           TEXT NOT NULL UNIQUE,                      -- GC-XXXXXX
  customer_name            TEXT NOT NULL,
  email                    TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  language                 TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  privacy_consent_at       TIMESTAMPTZ NOT NULL,
  privacy_notice_version   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'reserved'
                           CHECK (status IN ('reserved', 'payment_reported', 'paid', 'expired', 'cancelled', 'refunded')),
  tax_mode                 TEXT NOT NULL CHECK (tax_mode IN ('none', 'added', 'included')),
  gst_rate                 NUMERIC(6,5) NOT NULL,
  qst_rate                 NUMERIC(6,5) NOT NULL,
  subtotal_cents           INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  gst_cents                INTEGER NOT NULL CHECK (gst_cents >= 0),
  qst_cents                INTEGER NOT NULL CHECK (qst_cents >= 0),
  total_cents              INTEGER NOT NULL CHECK (total_cents >= 0),
  hold_expires_at          TIMESTAMPTZ,
  hold_ends_at_initial     TIMESTAMPTZ,
  payment_reported_at      TIMESTAMPTZ,
  review_due_at            TIMESTAMPTZ,
  extension_count          SMALLINT NOT NULL DEFAULT 0 CHECK (extension_count BETWEEN 0 AND 3),
  verified_at              TIMESTAMPTZ,
  verification_method      TEXT CHECK (verification_method IN ('reference_matched', 'name_amount_time', 'cash_or_other')),
  deposit_at               TIMESTAMPTZ,
  amount_received_cents    INTEGER,
  bank_confirmation_number TEXT,
  verification_note        TEXT,
  payment_issue            TEXT NOT NULL DEFAULT 'none'
                           CHECK (payment_issue IN ('none', 'late_unavailable', 'amount_mismatch', 'duplicate', 'refund_due')),
  cancelled_at             TIMESTAMPTZ,
  cancelled_by             TEXT CHECK (cancelled_by IN ('customer', 'owner', 'system')),
  cancel_reason            TEXT,
  refund_status            TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'due', 'issued', 'declined')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clinic_total_is_sum CHECK (total_cents = subtotal_cents + gst_cents + qst_cents),
  CONSTRAINT clinic_no_tax_when_none CHECK (tax_mode <> 'none' OR (gst_cents = 0 AND qst_cents = 0)),
  CONSTRAINT clinic_reserved_has_hold
    CHECK (status <> 'reserved' OR (hold_expires_at IS NOT NULL AND payment_reported_at IS NULL)),
  CONSTRAINT clinic_reported_has_review
    CHECK (status <> 'payment_reported' OR (payment_reported_at IS NOT NULL AND review_due_at IS NOT NULL)),
  -- A reported payment is never expired by the system.
  CONSTRAINT clinic_expiry_never_reported
    CHECK (status <> 'expired' OR payment_reported_at IS NULL),
  CONSTRAINT clinic_paid_verified
    CHECK (status <> 'paid' OR (verified_at IS NOT NULL AND verification_method IS NOT NULL AND deposit_at IS NOT NULL
           AND amount_received_cents IS NOT NULL AND amount_received_cents = total_cents)),
  CONSTRAINT clinic_cancelled_has_time
    CHECK (status NOT IN ('cancelled') OR cancelled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_clinic_bookings_email ON clinic_bookings (lower(email));
CREATE INDEX IF NOT EXISTS idx_clinic_bookings_hold ON clinic_bookings (hold_expires_at) WHERE status = 'reserved';

CREATE OR REPLACE FUNCTION clinic_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_code <> OLD.reference_code OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.created_at <> OLD.created_at OR NEW.tax_mode <> OLD.tax_mode OR NEW.total_cents <> OLD.total_cents
     OR NEW.subtotal_cents <> OLD.subtotal_cents OR NEW.gst_cents <> OLD.gst_cents OR NEW.qst_cents <> OLD.qst_cents THEN
    RAISE EXCEPTION 'clinic booking % : fixed fields cannot change (cancel and book again instead)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_booking_fixed_fields';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'reserved'         AND NEW.status IN ('payment_reported', 'paid', 'expired', 'cancelled')) OR
       (OLD.status = 'payment_reported' AND NEW.status IN ('paid', 'cancelled')) OR           -- never 'expired'
       (OLD.status = 'paid'             AND NEW.status IN ('cancelled', 'refunded')) OR
       (OLD.status = 'expired'          AND NEW.status IN ('paid', 'cancelled')) OR           -- a late payment, re-reserved if still free
       (OLD.status = 'cancelled'        AND NEW.status = 'refunded' AND OLD.verified_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'clinic booking % : % -> % is not a legal move', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_booking_legal_move';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clinic_booking_guard ON clinic_bookings;
CREATE TRIGGER clinic_booking_guard BEFORE UPDATE ON clinic_bookings FOR EACH ROW EXECUTE FUNCTION clinic_booking_guard();

CREATE TABLE IF NOT EXISTS clinic_spots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NOT NULL REFERENCES clinic_bookings(id) ON DELETE CASCADE,
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

-- 6. Commit-time integrity: status, occupied time and spots always agree --------------------
-- Runs at COMMIT for every touched row, so even raw SQL cannot leave a cancelled lesson holding time,
-- a live lesson without its time, a cancelled clinic booking holding spots, or a counter that disagrees.
CREATE OR REPLACE FUNCTION lesson_assert(p_booking UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT; v_starts TIMESTAMPTZ; v_until TIMESTAMPTZ;
  n_active INTEGER; n_match INTEGER;
BEGIN
  SELECT status, starts_at, occupied_until INTO v_status, v_starts, v_until FROM lesson_bookings WHERE id = p_booking;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) FILTER (WHERE o.active),
         count(*) FILTER (WHERE o.active AND o.span = tstzrange(v_starts, v_until, '[)'))
    INTO n_active, n_match
    FROM schedule_occupancy o WHERE o.lesson_booking_id = p_booking;
  IF v_status IN ('confirmed', 'completed', 'no_show') AND (n_active <> 1 OR n_match <> 1) THEN
    RAISE EXCEPTION 'lesson % is % but occupies % time ranges (% matching its time)', p_booking, v_status, n_active, n_match
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_status_matches_time';
  ELSIF v_status = 'cancelled' AND n_active > 0 THEN
    RAISE EXCEPTION 'lesson % is cancelled but still occupies % time ranges', p_booking, n_active
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lesson_status_matches_time';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION clinic_booking_assert(p_booking UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  st TEXT; s_total INTEGER; s_active INTEGER;
BEGIN
  SELECT status INTO st FROM clinic_bookings WHERE id = p_booking;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'active') INTO s_total, s_active FROM clinic_spots WHERE booking_id = p_booking;
  IF st IN ('reserved', 'payment_reported', 'paid') AND (s_total = 0 OR s_active <> s_total) THEN
    RAISE EXCEPTION 'clinic booking % is % but holds % of % spots', p_booking, st, s_active, s_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_booking_status_matches_spots';
  ELSIF st NOT IN ('reserved', 'payment_reported', 'paid') AND s_active > 0 THEN
    RAISE EXCEPTION 'clinic booking % is % but still holds % active spots', p_booking, st, s_active
      USING ERRCODE = 'check_violation', CONSTRAINT = 'clinic_booking_status_matches_spots';
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
DECLARE bid UUID;
BEGIN
  IF TG_TABLE_NAME = 'lesson_bookings' THEN
    PERFORM lesson_assert(NEW.id);
  ELSIF TG_TABLE_NAME = 'schedule_occupancy' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.lesson_booking_id IS NOT NULL THEN PERFORM lesson_assert(OLD.lesson_booking_id); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.lesson_booking_id IS NOT NULL THEN PERFORM lesson_assert(NEW.lesson_booking_id); END IF;
  ELSIF TG_TABLE_NAME = 'clinic_bookings' THEN
    PERFORM clinic_booking_assert(NEW.id);
  ELSIF TG_TABLE_NAME = 'clinic_spots' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM clinic_booking_assert(OLD.booking_id); PERFORM clinic_assert(OLD.offering_id); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM clinic_booking_assert(NEW.booking_id); PERFORM clinic_assert(NEW.offering_id); END IF;
  ELSIF TG_TABLE_NAME = 'clinic_offerings' THEN
    PERFORM clinic_assert(NEW.id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS booking_integrity_lessons ON lesson_bookings;
CREATE CONSTRAINT TRIGGER booking_integrity_lessons AFTER INSERT OR UPDATE ON lesson_bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_occupancy ON schedule_occupancy;
CREATE CONSTRAINT TRIGGER booking_integrity_occupancy AFTER INSERT OR UPDATE OR DELETE ON schedule_occupancy
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_clinic_bookings ON clinic_bookings;
CREATE CONSTRAINT TRIGGER booking_integrity_clinic_bookings AFTER INSERT OR UPDATE ON clinic_bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_spots ON clinic_spots;
CREATE CONSTRAINT TRIGGER booking_integrity_spots AFTER INSERT OR UPDATE OR DELETE ON clinic_spots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();
DROP TRIGGER IF EXISTS booking_integrity_offerings ON clinic_offerings;
CREATE CONSTRAINT TRIGGER booking_integrity_offerings AFTER INSERT OR UPDATE ON clinic_offerings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION booking_check_row();

-- 7. Lesson packages (flexible credits). BUILT BUT OFF until James approves the rules (decision C3).
-- A package is the one place a lesson could be prepaid (the purchase is paid by Interac in advance, like a
-- clinic). Credits are spent against it; the counter works exactly like the clinic spots counter:
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
  lesson_booking_id UUID,
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
