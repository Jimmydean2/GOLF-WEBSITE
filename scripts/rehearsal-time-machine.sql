-- REHEARSAL DATABASE ONLY. Moves every clock the site has stored back by N hours, which is
-- exactly the same to the site as the real clock moving forward by N hours. It lets you watch a
-- 12-hour hold run out, a 48-hour review go overdue and the alerts escalate in minutes.
--
--   psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v hours=13 -f scripts/rehearsal-time-machine.sql
--
-- then press "Run the check now" on the dashboard (or wait for the scheduler).
--
-- SAFETY: refuses unless every registration in the database is a TEST registration. It switches
-- the registration guard off for the single statement that edits the original deadlines, which
-- the guard otherwise (rightly) forbids. Never run it on the live database.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM registrations WHERE parent_name NOT LIKE 'TEST %') THEN
    RAISE EXCEPTION 'Refusing to run: this database holds registrations that are not TEST registrations. The time machine is for the rehearsal database only.';
  END IF;
END $$;

BEGIN;
ALTER TABLE registrations DISABLE TRIGGER USER;
UPDATE registrations SET
  created_at = created_at - make_interval(secs => :hours * 3600),
  hold_expires_at = hold_expires_at - make_interval(secs => :hours * 3600),
  hold_ends_at_initial = hold_ends_at_initial - make_interval(secs => :hours * 3600),
  payment_reported_at = payment_reported_at - make_interval(secs => :hours * 3600),
  review_due_at = review_due_at - make_interval(secs => :hours * 3600),
  paid_at = paid_at - make_interval(secs => :hours * 3600),
  cancelled_at = cancelled_at - make_interval(secs => :hours * 3600),
  verified_at = verified_at - make_interval(secs => :hours * 3600),
  deposit_at = deposit_at - make_interval(secs => :hours * 3600);
ALTER TABLE registrations ENABLE TRIGGER USER;
UPDATE email_outbox SET created_at = created_at - make_interval(secs => :hours * 3600),
  next_attempt_at = next_attempt_at - make_interval(secs => :hours * 3600),
  sent_at = sent_at - make_interval(secs => :hours * 3600);
UPDATE alert_ledger SET created_at = created_at - make_interval(secs => :hours * 3600), sent_at = sent_at - make_interval(secs => :hours * 3600);
UPDATE job_runs SET started_at = started_at - make_interval(secs => :hours * 3600), finished_at = finished_at - make_interval(secs => :hours * 3600);
UPDATE rate_limit_counters SET window_start = window_start - make_interval(secs => :hours * 3600);
UPDATE contact_strikes SET created_at = created_at - make_interval(secs => :hours * 3600);
UPDATE admin_sessions SET created_at = created_at - make_interval(secs => :hours * 3600),
  last_seen_at = last_seen_at - make_interval(secs => :hours * 3600),
  last_auth_at = last_auth_at - make_interval(secs => :hours * 3600),
  expires_at = expires_at - make_interval(secs => :hours * 3600);
UPDATE camp_settings SET value = (value::timestamptz - make_interval(secs => :hours * 3600))::text WHERE key IN ('scheduled_check_lease', 'coach_digest_slot');
COMMIT;

SELECT format('The clock has moved forward by %s hours. Log in again to the dashboard (the old login has aged), then press "Run the check now".', :'hours') AS result;
