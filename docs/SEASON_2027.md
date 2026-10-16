# The 2027 camp season — what is built, and what I need from you

**Status: the calendar below is a PROPOSAL. Nothing is confirmed until you say so.**
Until you do, the public site says "2027 camp dates coming soon", the sign-up form is not shown,
and the registration endpoint refuses, so a draft date can never reach a parent by accident.

## Why this had to change

The site was written for the 2026 camps. Its week labels ("June 22, 23, 25 & 26" …) were 2026's
calendar: Monday June 22, with the Wednesday holidays (Fête nationale, Canada Day) skipped. The
database seed used 2027 as a placeholder year, so the two disagreed. In 2027 the same dates fall
on different weekdays:

| Date | 2026 | 2027 |
|------|------|------|
| June 22 | Monday | **Tuesday** |
| Fête nationale (June 24) | Wednesday | **Thursday** |
| Canada Day (July 1) | Wednesday | **Thursday** |
| August 24 | Monday | **Tuesday** |

So "June 22, 23, 25 & 26" would have meant Tuesday, Wednesday, Friday and Saturday. Every label,
date and test is now derived from **one file**, `src/lib/season.ts`.

## The proposed calendar

It copies the 2026 pattern (ten weeks, Monday to Thursday, Friday held back as the rain makeup
day) onto the real 2027 weekdays. Both holidays fall on a **Thursday**, so in those two weeks the
holiday is skipped and **Friday becomes a regular camp day**, exactly as 2026 did with its Wednesday
holidays. Dates are not guesses about *your* plans, they are this arithmetic; whether you want
them is the question below.

<!-- season:begin -->
Season year: **2027** · Status: **PROPOSED — not yet confirmed** · Registration opens: **not set (opens as soon as the site is live)**

| # | Week id | Camp days | English label | French label | Note for parents |
|---|---------|-----------|---------------|--------------|------------------|
| 1 | `2027-06-21` | Mon, Tue, Wed & Fri (2027-06-21 → 2027-06-25) | June 21, 22, 23 & 25 | 21, 22, 23 et 25 juin | Thursday, June 24 is the Fête nationale du Québec (a holiday), so there is no camp that day. Camp runs Friday, June 25 instead, and there is no rain makeup day this week. |
| 2 | `2027-06-28` | Mon, Tue, Wed & Fri (2027-06-28 → 2027-07-02) | June 28, 29, 30 & July 2 | 28, 29, 30 juin et 2 juillet | Thursday, July 1 is Canada Day (a holiday), so there is no camp that day. Camp runs Friday, July 2 instead, and there is no rain makeup day this week. |
| 3 | `2027-07-05` | Mon, Tue, Wed & Thu (2027-07-05 → 2027-07-08) | July 5, 6, 7 & 8 | 5, 6, 7 et 8 juillet | — |
| 4 | `2027-07-12` | Mon, Tue, Wed & Thu (2027-07-12 → 2027-07-15) | July 12, 13, 14 & 15 | 12, 13, 14 et 15 juillet | — |
| 5 | `2027-07-19` | Mon, Tue, Wed & Thu (2027-07-19 → 2027-07-22) | July 19, 20, 21 & 22 | 19, 20, 21 et 22 juillet | — |
| 6 | `2027-07-26` | Mon, Tue, Wed & Thu (2027-07-26 → 2027-07-29) | July 26, 27, 28 & 29 | 26, 27, 28 et 29 juillet | — |
| 7 | `2027-08-02` | Mon, Tue, Wed & Thu (2027-08-02 → 2027-08-05) | August 2, 3, 4 & 5 | 2, 3, 4 et 5 août | — |
| 8 | `2027-08-09` | Mon, Tue, Wed & Thu (2027-08-09 → 2027-08-12) | August 9, 10, 11 & 12 | 9, 10, 11 et 12 août | — |
| 9 | `2027-08-16` | Mon, Tue, Wed & Thu (2027-08-16 → 2027-08-19) | August 16, 17, 18 & 19 | 16, 17, 18 et 19 août | — |
| 10 | `2027-08-23` | Mon, Tue, Wed & Thu (2027-08-23 → 2027-08-26) | August 23, 24, 25 & 26 | 23, 24, 25 et 26 août | — |
<!-- season:end -->

## What I need you to decide or supply

I have not guessed any of these. The "assumed" column is only what the draft uses so that
everything is consistent and testable.

| # | Question | What the draft assumes | Why it matters |
|---|----------|------------------------|----------------|
| S1 | **First and last camp day of 2027, and how many weeks.** Does camp really start Monday June 21 and finish Thursday August 26? | 10 weeks, June 21 – August 26 (the same slot as 2026's June 22 – August 27) | Every label, email and spreadsheet tab; the database weeks. |
| S2 | **The two holiday weeks** (Thursday June 24 and Thursday July 1). Run Friday instead (draft), run a 3-day week (then at what price?), or no camp that week? Is Golf Dorval open on those days? | Friday replaces the Thursday; same price; no rain makeup day that week | Parents are told the exact days. A 3-day week changes the price you charge. |
| S3 | **Friday rain makeup day**: still "held in reserve" in every normal week? | Yes, unchanged from 2026 | It is printed on the page and in the policy text. |
| S4 | **2027 price per week** and **cancellation fee** | $380 + tax per child per week; $50 cancellation fee | Printed on the page, charged by the system, shown in every email. |
| S5 | **Daily hours and drop-off / pick-up windows** | 9:30 AM – 4:00 PM; drop-off 9:15 – 9:30; pick-up 4:00 – 4:15 | Same. |
| S6 | **When does registration open?** A specific date and time (recommended), or "the moment the site is live"? | Not set: it would open the moment the site goes live | With a set time the form unlocks **by itself** at that second, so you do not have to be at a computer, and parents who arrive early see a clear "opens on …" message. |
| S7 | **Should a week stop taking registrations automatically** some days before it starts (for example 7 days)? | No. A week stays open until it is full or you close it | A late registration may leave you no time to confirm payment. |
| S8 | **Cancellation and refund dates.** Is there a deadline (for example "full refund less $50 until June 1")? | The form only says "Cancellations are subject to a $50 administrative fee"; no dates | A date is a consumer-protection term, so it needs your decision and legal review. |
| S9 | **Location and name** | Golf Dorval, 2000 Chemin Reverchon, Dorval QC; "James Dean Golf" | Printed everywhere. |
| S10 | **How long do you keep 2027 camper data after the season?** | Not decided (a proposal is in `docs/PRIVACY_AND_LAW25.md`) | Privacy law: see that document. |

Not every one needs a long answer. "S1–S5, S9 as in the draft; S6 opens Saturday January 16 at
9:00 a.m." is a complete reply.

## How a change is made (for whoever maintains this)

1. Edit `src/lib/season.ts` (the `days` of a week, a `note`, `registrationOpensAt`).
2. Run `npm run season:write`. It rewrites the database seed (`db/migrations/002_seed_weeks.sql`)
   and the table above from that file.
3. Run `npm test`. The season suite fails if a day falls on a weekend or a statutory holiday, if
   a week spans two calendar weeks, if a label does not match its days, or if the seed or this
   document is out of date.
4. Only in the commit that records your approval, set `confirmed: true`.

A week's **id is the date of its Monday** (`2027-06-21`), so it can never contradict its dates and
two seasons can sit in the same database. The migration was rewritten before any deployment; once
it has run against a real database it must not change again (a later season gets its own migration).

## Switches that matter on the day

| Setting | Where | What it does |
|---------|-------|--------------|
| `confirmed` | `src/lib/season.ts` | `false` = "dates coming soon", registration closed. `true` = the dates are public. |
| `registrationOpensAt` | `src/lib/season.ts` | An exact moment with its offset, for example `2027-01-16T09:00:00-05:00`. Before it: the page says when registration opens and the form cannot be sent. |
| `SEASON_PREVIEW=true` | environment, **rehearsal sites only** | Lets a staging site show and use the draft calendar. `npm run preflight -- --production` fails if it is set on the real site. |
| `REGISTRATION_OPENS_AT` | environment, rehearsals | Overrides the opening moment so you can rehearse the "unlock" without editing code. |

A mistyped opening time keeps registration **closed** (never open early); the preflight reports it.
