-- Junior Camp registration system — authoritative capacity + registration
-- data. This is the single source of truth for the "never more than 30
-- spots per week" rule; Google Sheets (see src/lib/googleSheets.ts) is a
-- secondary, synchronized reporting copy only and is never consulted for
-- capacity decisions.
--
-- Run with: psql "$DATABASE_URL" -f db/migrations/001_init.sql
-- (idempotent — safe to re-run; every statement checks IF NOT EXISTS)

-- One row per camp week. Capacity and price live here instead of in code,
-- so an admin can adjust either without a redeploy.
CREATE TABLE IF NOT EXISTS camp_weeks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 30 CHECK (max_capacity > 0),
  taken_count INTEGER NOT NULL DEFAULT 0 CHECK (taken_count >= 0),
  price_cents INTEGER NOT NULL DEFAULT 38000 CHECK (price_cents >= 0),
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT taken_within_capacity CHECK (taken_count <= max_capacity)
);

-- One row per form submission. idempotency_key is client-generated and
-- unique, so a double-click or retried request after a network hiccup
-- cannot create a second registration — the second insert attempt hits
-- the unique constraint and the route returns the original result instead.
CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  parent_name TEXT NOT NULL,
  email TEXT NOT NULL,
  primary_phone TEXT NOT NULL,
  secondary_phone TEXT NOT NULL DEFAULT '',
  emergency_name TEXT NOT NULL,
  emergency_relationship TEXT NOT NULL,
  emergency_phone TEXT NOT NULL,
  code_of_conduct_accepted BOOLEAN NOT NULL,
  consent_accepted BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'refunded')),
  confirm_token TEXT NOT NULL,
  total_price_cents INTEGER NOT NULL,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations (lower(email));
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations (status);

-- One row per child in a registration.
CREATE TABLE IF NOT EXISTS children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  age TEXT NOT NULL,
  health_info TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_children_name ON children (lower(full_name));
CREATE INDEX IF NOT EXISTS idx_children_registration ON children (registration_id);

-- The capacity-bearing table: one row per (child, week). This is what
-- camp_weeks.taken_count actually counts. A child can't be double-booked
-- into the same week twice (unique constraint), and cancelling a spot
-- here is always paired with an atomic decrement of taken_count.
CREATE TABLE IF NOT EXISTS registration_spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  week_id TEXT NOT NULL REFERENCES camp_weeks(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, week_id)
);
CREATE INDEX IF NOT EXISTS idx_spots_week ON registration_spots (week_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_spots_registration ON registration_spots (registration_id);

-- Every capacity-affecting or sensitive admin action, for the audit trail
-- requirement. Append-only — nothing ever updates or deletes a row here.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log (target_type, target_id);
