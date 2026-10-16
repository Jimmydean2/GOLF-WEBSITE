-- Undoes db/migrations/005_email_outbox.sql. Not run by `npm run db:migrate`. Any email still
-- waiting in the outbox is forgotten: send those by hand (or let the parents' private links
-- carry them) before running this against a database that is serving the application.
BEGIN;
DROP TABLE IF EXISTS job_runs;
DROP TABLE IF EXISTS email_outbox;
COMMIT;
