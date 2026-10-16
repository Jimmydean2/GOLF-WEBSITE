# James Dean Golf: website and camp registration

The marketing site, lesson booking, group clinics, and the **junior camp registration with
Interac e-Transfer payment review**. Next.js (App Router), PostgreSQL (Neon), Gmail for email.

## Start here

| If you want to… | Read |
| --- | --- |
| Know whether the site is ready to launch, and what is still open | [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) |
| Run your day-to-day payment routine (2 minutes a day) | [docs/PAYMENT_REVIEW_RUNBOOK.md](docs/PAYMENT_REVIEW_RUNBOOK.md) |
| Try the real services (Gmail, Neon, your bank) with made-up families | [docs/LAUNCH_REHEARSAL.md](docs/LAUNCH_REHEARSAL.md) |
| Choose how the automatic check runs | [docs/SCHEDULING.md](docs/SCHEDULING.md) |
| Confirm the 2027 dates, and see what I still need from you | [docs/SEASON_2027.md](docs/SEASON_2027.md) |
| See how French and English work, and what a Quebec reader and lawyer must check | [docs/FRENCH_READINESS.md](docs/FRENCH_READINESS.md), [docs/QUEBEC_LEGAL_REVIEW.md](docs/QUEBEC_LEGAL_REVIEW.md) |
| Privacy notice, consent, retention and the Law 25 checklist | [docs/PRIVACY_AND_LAW25.md](docs/PRIVACY_AND_LAW25.md) |
| Download rosters, confirm a payment a parent never reported, run the waiting list | [docs/ROSTERS_CONFIRMING_AND_WAITLIST.md](docs/ROSTERS_CONFIRMING_AND_WAITLIST.md) |
| Connect Google, Gmail and the database, and publish | [BOOKING_SETUP.md](BOOKING_SETUP.md) |

## How a camp registration works

1. A parent registers (any number of children and weeks), in **French or English**, after agreeing to the privacy notice and consents. Their spots are held for **12 hours**.
2. They get the e-Transfer instructions, a unique reference and a private link, by email and on screen.
3. After sending the e-Transfer they tap **I've Sent My Payment**. Their spots are then protected
   while **you** check your bank. Nothing is marked paid by the website, and a reported payment is
   **never** released automatically; only you can confirm or release it.
4. If they never tap the button, they get a reminder before the hold ends and a release notice after.
5. You confirm the deposit on the dashboard (`/admin/camp-rosters`); the family gets its confirmation email. A family that paid but never tapped the button is found by the deposit's amount, reference, name or phone and confirmed the same way, and **nobody else's place is ever taken** to make room.
6. If a week is full, families may (if you switch it on) ask to wait. The waiting list holds nothing and assigns nothing; you may email one family that a place *may* be open.
7. Rosters download as Excel or CSV (full, or a sign-in sheet without health details) behind a recent password check; PostgreSQL is the record, not Google Sheets.

## Developing

```bash
npm ci
cp .env.local.example .env.local      # fill in DATABASE_URL (a local throwaway Postgres) and the secrets
npm run db:migrate                    # applies db/migrations/001 to 008
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm test` | Every automated suite (about fifteen minutes; builds the site once). Needs a local Postgres and `DATABASE_URL`; see [db/tests/README.md](db/tests/README.md) |
| `npm run test:opening-day` | The opening-day simulation alone (`SIM_FAMILIES=300 SIM_CONCURRENCY=100` to scale it) |
| `npm run test:mutations` | Breaks protections one at a time and checks a test notices (slow) |
| `node scripts/preflight.mjs` | Checks every setting, the database and (with `--url`) the live site (`--production` is stricter) |
| `node scripts/staging-verify.mjs` | Safety drills on a REHEARSAL site: duplicates, the last place in a week, email failure ([docs/LAUNCH_REHEARSAL.md](docs/LAUNCH_REHEARSAL.md)) |
| `npm run season:write` / `npm run legal:write` | Regenerate the files derived from the season calendar and from the list of wording for a lawyer |
| `npm run retention` | Preview (and, when told, run) the end-of-season erasure of families' personal details |
| `node scripts/smtp-sink.mjs` | A mail server that records email instead of delivering it, for looking at real emails safely |

Tests never use real data and never send real email: they refuse any database that is not on
this computer and remove the Gmail and Google credentials from their environment.
