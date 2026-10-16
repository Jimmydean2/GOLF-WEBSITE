# Camp payment and capacity tests

These tests run against a **real local Postgres** with real parallel connections — nothing is mocked.
Each suite builds its own throwaway database from `db/migrations/*.sql` (so the migrations are tested
too) and drops it afterwards. The audit log is append-only, which is why a fresh database per run
is the only clean way to test.

## Running them

```bash
# A local Postgres must be running; the URL only needs to reach the server (any database name).
export DATABASE_URL=postgres://user:pass@localhost:5432/anydb

npm test                       # every suite below, about two minutes
npm run test:payment-policy    # or one suite at a time
npm run test:mutations         # slow (about 15 minutes), not part of `npm test`
```

Safety guards: the helper refuses any database host that is not `localhost` / `127.0.0.1`, and it
removes the Gmail and Google credentials from the environment, so a test can never send real email
or touch a real calendar or sheet. Tests that exercise the email code use a fake mailer.

## What each suite covers

| Suite | Covers |
| --- | --- |
| `payment-integrity` | Every database rule attacked with raw SQL: the original "released registration marked paid with no spots" bug, legal status moves, fixed fields, bounded holds and extensions, Paid needs a verification record, capacity 30 / up to 33 only with a recorded authorization, append-only audit log, a 60-transaction race on up to 40 connections |
| `payment-policy` | The 12-hour hold (exact boundaries), reports, the 48-hour review that **never** releases, extensions, false reports and strikes, late deposits, settings, multi-child / multi-week, concurrency, source scans (only Confirm can set Paid; every admin route is guarded) |
| `admin-security` | Random server-side sessions, idle / absolute expiry, revocation, lockout after 5 wrong passwords, the password re-check, the request gate (401 / 403 / 429), rate limits, same-origin check, safe login redirect, signed parent links, security headers |
| `alerts` | The exact alert schedule, one email per alert even with overlapping runs, failed-send retry, crashed-run recovery, a weekend away and ten days away (the reservation is never released), the parent's release notice |
| `concurrency` | Bursts of 10 to 100 registrations, multi-child and multi-week races, late payment racing new families, expiry under load |
| `xlsx-safety` | Roster export: spreadsheet formulas stay text, the Paid column, weeks above 30 print every child |
| `mutation-check` | Switches off one protection at a time on a scratch copy (a database rule, or one line of the application) and requires a test to fail. A protection that nothing checks would show up here |

Time-based behaviour is tested without waiting: deadlines are moved *earlier* in the database (the
database only ever allows that), and the alert dispatcher and the 12-hour release accept an explicit
"now".
