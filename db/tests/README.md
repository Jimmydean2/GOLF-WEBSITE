# Camp payment and capacity tests

These tests run against a **real local Postgres** with real parallel connections — nothing is mocked.
Each suite builds its own throwaway database from `db/migrations/*.sql` (so the migrations are tested
too) and drops it afterwards. The audit log is append-only, which is why a fresh database per run
is the only clean way to test.

## Running them

```bash
# A local Postgres must be running; the URL only needs to reach the server (any database name).
export DATABASE_URL=postgres://user:pass@localhost:5432/anydb

npm test                       # every suite below, about six minutes (the first run builds the site)
npm run test:payment-policy    # or one suite at a time
npm run test:mutations         # slow (about 15 minutes), not part of `npm test`
```

Safety guards: the helper refuses any database host that is not `localhost` / `127.0.0.1`, and it
removes the Gmail and Google credentials from the environment, so a test can never send real email
or touch a real calendar or sheet. Tests that exercise the email code use a fake mailer, or the local
recording mail server in `scripts/lib/smtpSink.mjs`, which delivers nothing anywhere.

The last suites (`http-privacy`, `opening-day`, `rehearsal-kit`) build and start the real production
server (`next start`) against a throwaway database and talk to it over HTTP, with the site running on
ONE database connection exactly as in production. `SIM_FAMILIES`, `SIM_CONCURRENCY` and `SIM_APP_POOL`
scale the opening-day simulation, for example `SIM_FAMILIES=300 SIM_CONCURRENCY=100 npm run test:opening-day`.

## What each suite covers

| Suite | Covers |
| --- | --- |
| `payment-integrity` | Every database rule attacked with raw SQL: the original "released registration marked paid with no spots" bug, legal status moves, fixed fields, bounded holds and extensions, Paid needs a verification record, capacity 30 / up to 33 only with a recorded authorization, append-only audit log, a 60-transaction race on up to 40 connections |
| `payment-policy` | The 12-hour hold (exact boundaries), reports, the 48-hour review that **never** releases, extensions, false reports and strikes, late deposits, settings, multi-child / multi-week, concurrency, source scans (only Confirm can set Paid; every admin route is guarded) |
| `admin-security` | Random server-side sessions, idle / absolute expiry, revocation, lockout after 5 wrong passwords, the password re-check, the request gate (401 / 403 / 429), rate limits, same-origin check, safe login redirect, signed parent links, security headers |
| `alerts` | The exact alert schedule, one email per alert even with overlapping runs, failed-send retry, crashed-run recovery, a weekend away and ten days away (the reservation is never released), the parent's release notice |
| `concurrency` | Bursts of 10 to 100 registrations, multi-child and multi-week races, late payment racing new families, expiry under load |
| `xlsx-safety` | Roster export: spreadsheet formulas stay text, the Paid column, weeks above 30 print every child |
| `families` | A big family (4 children x 10 weeks) is ONE reservation; the 8-unpaid-reservation limit counts submissions, follows the phone number however it is written, and frees up on payment or release |
| `registration-flow` | The registration form's request path: form mistakes and retries cost nothing, a week being full never locks a family out, repeat registrations for the same child and week are refused, double-clicks and races, request hygiene, the flood limit |
| `outbox` | Every email a family is owed is recorded with the reservation or payment that causes it; retry with growing delays, a dead mail server stops a run, mistyped addresses are given up on, daily-allowance protection, one coach summary however many workers race, the reminder and release notices, 130 releases at once |
| `scheduler` | The scheduled check: releases only unreported holds, reminders, alerts, a run lease, failed runs recorded and recovered, the traffic fallback, health states, the cron URL's secret, load and time limits |
| `no-auto-release` | A reported payment is never released by anything automatic: a source scan, ten days across every entry point, 40 boundary races between a parent's report and the release |
| `pool-of-one` | Everything busy on exactly one database connection (the production setting): a repeated submission caught by the database does not hang, 80 simultaneous registrations, a dropped connection recovers |
| `smtp-stack` | The real mail code against a recording SMTP server: accents, an outage and recovery, a busy server, a slow server, a cut connection, a mistyped address, 100 messages |
| `log-safety` | Logs never contain a database row, a statement or an email address |
| `http-privacy` | Two families with sentinel data against the production server: pages, APIs, errors, headers, forged links, 210 admin requests without a login, emails, third-party scripts, server logs |
| `opening-day` | 130 to 300 families, a flaky then absent mail server, a restart, and days of moved clocks, end to end, with a full accounting at the end |
| `rehearsal-kit` | The launch-rehearsal tools themselves: the fake-registration script, the preflight check, and the guarded rehearsal SQL |
| `mutation-check` | Switches off one protection at a time on a scratch copy (a database rule, or one line of the application) and requires a test to fail. A protection that nothing checks would show up here |

Time-based behaviour is tested without waiting: deadlines are moved *earlier* in the database (the
database only ever allows that), and the alert dispatcher and the 12-hour release accept an explicit
"now".
