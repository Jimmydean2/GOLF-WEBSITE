-- Undoes the enforcement added by db/migrations/004_payment_policy.sql. Not run by
-- `npm run db:migrate`. The new columns and tables are kept (dropping them could lose
-- data); remove them by hand if you really want them gone. Do not run this against a
-- database serving the Stage 2 application.

BEGIN;
DROP TRIGGER IF EXISTS camp_registration_guard_insert ON registrations;
DROP TRIGGER IF EXISTS camp_registration_guard_update ON registrations;
DROP FUNCTION IF EXISTS camp_registration_guard();
DROP TRIGGER IF EXISTS camp_guard_capacity_insert ON camp_weeks;
DROP TRIGGER IF EXISTS camp_guard_capacity_update ON camp_weeks;
DROP FUNCTION IF EXISTS camp_guard_capacity();
DROP TRIGGER IF EXISTS camp_audit_no_change ON admin_audit_log;
DROP TRIGGER IF EXISTS camp_audit_no_truncate ON admin_audit_log;
DROP FUNCTION IF EXISTS camp_audit_immutable();
ALTER TABLE camp_weeks DROP CONSTRAINT IF EXISTS camp_weeks_capacity_ceiling;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_pending_has_hold;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_reported_has_review;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_extension_cap;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_reinstate_cap;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_verification_method_values;
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_paid_verified;
-- Any payment_reported rows must be returned to pending_payment before the old status
-- list can be restored:
--   UPDATE registrations SET status = 'pending_payment' WHERE status = 'payment_reported';
COMMIT;
