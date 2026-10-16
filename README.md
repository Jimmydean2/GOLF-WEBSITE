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
| See where French stands | [docs/FRENCH_READINESS.md](docs/FRENCH_READINESS.md) |
| Connect Google, Gmail and the database, and publish | [BOOKING_SETUP.md](BOOKING_SETUP.md) |

## How a camp registration works

1. A parent registers (any number of children and weeks). Their spots are held for **12 hours**.
2. They get the e-Transfer instructions, a unique reference and a private link, by email and on screen.
3. After sending the e-Transfer they tap **I've Sent My Payment**. Their spots are then protected
   while **you** check your bank. Nothing is marked paid by the website, and a reported payment is
   **never** released automatically; only you can confirm or release it.
4. If they never tap the button, they get a reminder before the hold ends and a release notice after.
5. You confirm the deposit on the dashboard (`/admin/camp-rosters`); the family gets its confirmation email.

## Developing

```bash
npm ci
cp .env.local.example .env.local      # fill in DATABASE_URL (a local throwaway Postgres) and the secrets
npm run db:migrate                    # applies db/migrations/001 to 005
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm test` | Every automated suite (about six minutes; builds the site once). Needs a local Postgres and `DATABASE_URL`; see [db/tests/README.md](db/tests/README.md) |
| `npm run test:opening-day` | The opening-day simulation alone (`SIM_FAMILIES=300 SIM_CONCURRENCY=100` to scale it) |
| `npm run test:mutations` | Breaks protections one at a time and checks a test notices (slow) |
| `node scripts/preflight.mjs` | Checks every setting, the database and (with `--url`) the live site |
| `node scripts/smtp-sink.mjs` | A mail server that records email instead of delivering it, for looking at real emails safely |
| `node scripts/i18n-audit.mjs` | Measures the English-only text for the French plan |

Tests never use real data and never send real email: they refuse any database that is not on
this computer and remove the Gmail and Google credentials from their environment.
