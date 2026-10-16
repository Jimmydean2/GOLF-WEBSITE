# Launch checklist

**Where things stand:** the 2027 camp registration system is built, bilingual (French and English),
privacy-aware, and tested on a real database and in a real browser with made-up families. It is
ready to be **rehearsed** on staging with your real accounts (`docs/LAUNCH_REHEARSAL.md`). It is **not
ready to launch** until the rehearsal is done and the decisions in section 5 are made.

Nothing has been merged to `main`, deployed, or switched on. No paid service was activated, no real
child's data was used, and no email was sent to anyone (the tests use a recording mail server that
delivers nothing). Everything is on the `claude/youthful-faraday-doicas` branch.

How to read this: ✅ built and checked by a test or browser run you can repeat · 🟡 built, but only
your real accounts can prove it · ⬜ not built · 🧑 needs your decision.

---

## 1. Your eight priorities: what exists, what I tested, what needs you

| # | You asked | Already implemented | What I tested | Still needs work | Needs your decision |
| --- | --- | --- | --- | --- | --- |
| 1 | **The whole system consistent with the real 2027 season** | One calendar file (`src/lib/season.ts`) drives every label, date, the database seed, the registration gate and the checks. Week ids are the date of the Monday. Registration is **closed until you approve the dates** ("dates coming soon"), and can open at an exact moment by itself. The two holiday weeks (June 24, July 1) are handled and explained to parents. | `season` (160 checks): calendar arithmetic, no weekends/holidays, labels match days in both languages, generated files current, no stale year anywhere, the gate on page and endpoint, the preflight reports it. | The 2027 dates are a **proposal** (`confirmed: false`). | 🧑 **S1 to S10** in `docs/SEASON_2027.md`: first/last day, the two holiday weeks, rain day, price and cancellation fee, hours, **when registration opens**, auto-close before a week, refund dates, location, how long to keep data. Reply "S1–S5, S9 as the draft; S6 opens Jan 16 at 9:00" and I finish it. |
| 2 | **Bilingual pages, payment instructions, confirmation emails, cancellation notices, admin communications; flag wording for Quebec legal review** | The whole parent journey in French and English: camp page, form, consents, private reservation page, privacy notice, payment instructions, instructions / reminder / release / confirmation / **cancellation** emails, the waiting-list emails. The family chooses a language; every email is written in it at send time. A cancellation notice (new) is sent once, never shows your private note. Your own emails and dashboard stay English and say "reply in French". **15 + 2 passages are listed for a lawyer** with the question to ask. | `i18n` (85): same messages in both languages, French is French and typographically right, money/dates/names, each email in the family's language, the cancellation notice; `launch-http` (49); a real-browser run of a francophone parent on a phone and an anglophone family on a laptop (36 checks). | A native Quebec reader for the French (it is a careful draft, not a certified translation); a lawyer on `docs/QUEBEC_LEGAL_REVIEW.md` (L1–L17). Pages outside the camp (lessons, clinics) are English only (L9). | 🧑 Whether to translate the rest of the site; **who reviews the French**; the lawyer's answers. |
| 3 | **Privacy notice, consent flow, retention, Law 25 checklist; separate what is implemented from what needs a lawyer** | A privacy notice (both languages, marked DRAFT), **two separate tick boxes** (privacy; health information) recorded with the notice version and time, **enforced by the database**; a "how we use your information" box; a family's **copy of their data**; **erasing** a family; the **clean-up after the season**; no health data in any email or log; the log holds no personal details. | `privacy` (70): consent required/split/recorded (even by raw SQL), the copy, erasure leaves nothing personal in any table, the clean-up (right families, right day, never an unresolved payment); `log-safety`, `http-privacy`. | Not done and not code: a risk assessment for data stored outside Quebec, written agreements with Vercel, Neon and Google, the incident register (template provided), a lawyer's read of the notice. The preflight **refuses the real site** until you record that the notice was reviewed. | 🧑 **P1 to P12** in `docs/PRIVACY_AND_LAW25.md` (the person in charge, 90 days' retention, date of birth vs age only, ...). |
| 4 | **PostgreSQL stays the source of truth; reliable Excel/CSV rosters with privacy controls; no dependence on Google Sheets** | Availability, bookings and rosters read only the database (a test scans for it). Rosters as **Excel or CSV**, one week or all, **full** or **sign-in sheet** (no health/emergency details); every download needs a **recent password**, is named CONFIDENTIAL, never cached, **recorded** without personal details; text a parent typed can never run as a spreadsheet formula. The Google Sheets copy of camp registrations is **off** unless `CAMP_SHEETS_COPY=true`. | `roster-export` (39), `roster-http` (15), `xlsx-safety` (19), browser run (downloads, password dialog, log). | Clinic sign-ups and lesson bookings still use Google Sheets/Calendar as their storage (separate system, untouched). A CSV is a convenience copy, not a backup (§ restore drill in the rehearsal plan). | 🧑 **W4–W6** in `docs/ROSTERS_CONFIRMING_AND_WAITLIST.md`. |
| 5 | **Confirm a genuine Interac payment even if the parent never tapped the button; never overbook or silently displace** | Any held, reported or released registration can be found by **reference (any spelling), name, email, phone number or the deposit's amount**, and confirmed from the bank; the family gets the confirmation. If the places were taken meanwhile it is **refused and nothing else changes**; two confirmations racing for the last place: exactly one wins; the extra spot (to 33) is only ever your written decision. | `manual-confirm` (57), `manual-confirm-http` (8), `payment-policy`, `concurrency`, `no-auto-release`; browser run: found by amount, confirmed with no report, then the plain-language refusal. | Nothing in code. | 🧑 What to do when a paid family's week has filled: refund, another week or an extra spot (your call each time). |
| 6 | **An optional waiting list for full weeks, without promising or automatically assigning spots** | A family can ask to wait for a **full** week (name, email, optional phone, number of children; **no child details**). It holds nothing: **no link to registrations, spots or capacity**, and nothing happens when a place opens. You can email one family "a place **may** be open" (nothing held, first come first served), only while the week has room, never to a family already registered, at most three times. Deleted when its week has passed; included in a family's copy and in erasing. **Off until you switch it on** (`WAITLIST_ENABLED=true`). | `waitlist` (82), `waitlist-http` (28): structure, a source scan, a place opening changes nothing, two families told about one place, emails queued/retried/once, privacy; browser run in English and French. | A one-click "remove me" link in the emails is not built (reply or phone today). | 🧑 **W1 (offer it?), W3** in `docs/ROSTERS_CONFIRMING_AND_WAITLIST.md`; lawyer L16, L17. |
| 7 | **A concrete staging rehearsal plan** (Vercel, Neon, Gmail, Autodeposit, scheduled jobs, backups, realistic parent tests) | `docs/LAUNCH_REHEARSAL.md`: a two-afternoon-and-a-night plan with exact settings, 14 parent scenarios, the owner's day, the bank and Autodeposit test, a scripted drill, the scheduler and a night with nothing running, a restore drill, go / no-go table. | The scripts it uses are tested (`rehearsal-kit`, and the drill script was run against a production build here). | The rehearsal itself needs your accounts. | 🧑 **D12**: approve running it (a Neon branch, a preview deployment, a Gmail app password, ~$5 in e-Transfers). |
| 8 | **Email failures, duplicate requests and simultaneous last-place bookings are safe in staging** | `scripts/staging-verify.mjs` runs these drills against any rehearsal site (it refuses a site charging more than $5 a week): duplicates, 8 families for the last place, email broken then repaired. | **Locally, against a real production build and a real PostgreSQL, with a local recording mail server that I switched off and on:** duplicates (one reservation, one place), 8 at once for the last place (exactly one wins, a 2-child family refused whole), email broken (family still gets their answer, email waits) then repaired (it goes out). Plus the suites `opening-day` (130–300 families), `concurrency`, `registration-flow`, `outbox`, `smtp-stack`, `pool-of-one`. | **I could not run it on Vercel + Neon + Gmail** (they do not exist yet). That is the first thing the rehearsal does (§6 of the plan). | 🧑 D12. |

---

## 2. What was verified, in numbers

*"Verified" means an automated test exercises it against a real PostgreSQL database and, where it
matters, the real production build of the site and a recording mail server, with the site running on a
single database connection as in production. `npm test` runs everything (about fifteen minutes).*

- **1,793 automated checks** in **27 suites**, all passing in one clean `npm test` run.
- **99 browser checks** in a real Chromium (phone-sized and desktop): the bilingual parent journey and dashboard (36), the
  roster downloads, manual confirmation and waiting list in both languages (44), plus 19 earlier journey checks.
- **98 deliberate breakages** (one protection switched off or one line sabotaged at a time; `npm run test:mutations`): **94 were noticed by the tests and 2 are safely covered by a second layer** (the released-family roster filter and one older one). The last 2 (#97, #98: the waiting-list switch and the closed-week rule) were still running when this was written, so they are not counted yet.

### Problems I found and fixed while doing this

- A review queue that did not refresh after an action taken in the search panel (and now does).
- The old roster download link skipped the recent-password check and was not recorded: it is gone (POST only, password, logged).
- The Google Sheets copy of camp registrations was on automatically whenever Google was configured, copying every child's date of birth and health note where erasing could not reach: now off unless you set `CAMP_SHEETS_COPY=true`.
- A week you have merely *closed* is shown to parents as "full". The waiting list is therefore offered only for a week that is really full (every place taken), never for a closed one.
- Dashboard search could not find a family from what the bank shows (amount, phone, a reference typed without its dash): it can now.
- Free-text notes about a family were written to a log that cannot be edited, so erasing could not reach them: they now live in an erasable table.
- Dates of birth came back from the database as JavaScript dates, which can shift by a day depending on the server's time zone; they now stay plain dates.
- (Earlier phases) form retries used up a family's hourly allowance; emails sent inside the request could hang or get lost; a "released" notice could be skipped for families in a mass lapse; registration questions with no phone area code; weeks listed by internal code; and the others listed in the git history.

---

## 3. 🟡 Built, but only your real accounts can prove it

`docs/LAUNCH_REHEARSAL.md` is the plan.

- 🟡 **Gmail**: that mail reaches Gmail, Outlook and Yahoo **inboxes** (not Spam) with SPF/DKIM passing, in both languages; the real daily limit.
- 🟡 **Neon**: certificate checking, the pooled connection, the first request after a sleep, **your plan's restore window** (6 hours on the free plan, 1 day by default on Launch: check), a restore drill.
- 🟡 **Vercel**: that emails sent *after* the answer (`after()`) complete on the platform and within your plan's time limit; preview protection; logs.
- 🟡 **Your bank**: whether the deposit shows the **reference**; what an Autodeposit notice contains; limits on receiving.
- 🟡 **A real scheduler** (none is configured, by design): the free Vercel plan allows a scheduled job once a day.
- 🟡 **Real phones and mail apps**: iPhone Safari, Android, Outlook/Apple Mail were not available here.
- 🟡 **Screen readers / a full accessibility review.**
- ℹ️ **Known and accepted:** `npm audit` lists 2 moderate advisories in `uuid` inside the roster-spreadsheet library (a feature it does not use here); the only automatic "fix" is a downgrade, so I left it.

## 4. ⬜ Not built

- ⬜ **Parent self-service** (correct or cancel their own reservation): you release it from the dashboard and they register again.
- ⬜ **Bot protection** (CAPTCHA): rate limits only (D9).
- ⬜ **A one-click "remove me" link** in waiting-list emails, and an **"edit this family's details"** button (P8).
- ⬜ **A second administrator login**; **uptime and error monitoring**.
- ⬜ **Automatic deposit detection** from the bank's notification emails (not recommended: they can be forged).
- ⬜ **A settings screen** for the clocks (hold, reminder and review times); today I change them in the database.
- ⬜ **The static Artifact preview** (the standalone mock) is out of date: nothing is deployed, so I did not update it.
- ⬜ **Clinics and lessons on PostgreSQL** (they still use Google Sheets and Calendar; W6).

---

## 5. 🧑 Decisions that need you

Each has a recommendation; nothing happens until you say so. Details live in the page named.

| # | Decision | Recommendation |
| --- | --- | --- |
| **S1–S10** | The 2027 dates, holiday weeks, price, fee, hours, **opening time**, refund dates, data retention (`docs/SEASON_2027.md`) | Answer "as the draft" or correct me. **Nothing can open until `confirmed` is set.** |
| **L1–L17** | A **Quebec lawyer** on the flagged wording (`docs/QUEBEC_LEGAL_REVIEW.md`), and a **native Quebec reader** for the French | Before launch. The preflight refuses the real site until the privacy notice is recorded as reviewed. |
| **P1–P12** | Privacy choices: the person in charge, **90 days** retention, date of birth or age only, health field required, regions, Gmail retention, edit button, photos, rosters, waiting list, the remove link (`docs/PRIVACY_AND_LAW25.md`) | The defaults in that table. |
| **W1–W6** | Offer the waiting list? Which roster for camp days? Google Sheets copy off? (`docs/ROSTERS_CONFIRMING_AND_WAITLIST.md`) | Staging on, real launch your call; sign-in sheet for the table; Sheets copy off. |
| D1 | **Hosting plan.** Vercel's free plan is for non-commercial use; taking payments and advertising a business counts as commercial. | **Vercel Pro** before real registrations (about US$20 per user per month: confirm on vercel.com/pricing). |
| D2 | **Scheduler** (`docs/SCHEDULING.md`) | With Pro: Vercel Cron every 5 minutes + a free uptime monitor on `/api/health/scheduler`. The free plan allows a job once a day. Without any scheduler reminders and alerts are late overnight (spots are not affected). |
| D3 | **Email sender.** A personal Gmail account sends about 500 a day (Workspace about 2,000); simulated days used ~2.7 emails per family. | Rehearse and watch the dashboard count; if you expect over ~120 families in two days, Workspace or a transactional service. |
| D4 | Coach emails: one summary an hour, no health details anywhere in email | Keep. |
| D5 | Reminder 3 hours before the hold ends | Keep. |
| D9 | **Bot protection** (CAPTCHA) | Defer unless you see abuse. |
| D10 | Same-child rule (done); parent self-cancel (not built) | Keep; build self-cancel only if you get support emails. |
| D12 | **Run the rehearsal**: a Neon branch, a preview deployment, a Gmail app password, ~$5 in e-Transfers between your own accounts | Do it, then re-run the preflight on the real settings. |
| D13 | **Merging and deploying.** `main` is untouched. Migrations `001` to `008` must be applied, in order, to the **new, empty** live database before the first deploy. | After D1–D3 and the rehearsal. **I will not merge, deploy or touch a real database without your explicit OK.** |
| D14 | `ETRANSFER_AUTODEPOSIT`: only after your bank confirms Autodeposit and you have sent a test from another bank | After the rehearsal. |
| D15 | **Receipts.** Many parents claim day-camp fees; the confirmation email shows the tax breakdown but not your registration numbers or address. | Ask your accountant what a receipt must show; I add it. |

(Earlier decisions D6 French, D7 privacy and D8 season dates are now the work above: **S**, **L**, **P**. D11, the Google Sheets copy, is settled: off.)

---

## Before the very first real registration

1. S1–S10, D1, D2, D3 decided; hosting and database accounts ready; the privacy notice reviewed and recorded; the French read by a native speaker.
2. The rehearsal done and its results recorded; every `FAIL` in `scripts/preflight.mjs --production` fixed.
3. A **fresh, empty** live database with migrations `001`–`008` (never the rehearsal one); `SITE_URL` set to the real address; `ADMIN_ALERT_EMAILS` has a backup address; **`SEASON_PREVIEW` not set**; `confirmed: true` and the opening time set in `src/lib/season.ts`.
4. A week costs $380.00; capacity 30; "Registrations: none yet" in the preflight; `WAITLIST_ENABLED` decided.
5. A first `pg_dump` taken, and you have restored one once (rehearsal plan §10).
6. You have read `docs/PAYMENT_REVIEW_RUNBOOK.md` (two minutes a day) and `docs/ROSTERS_CONFIRMING_AND_WAITLIST.md`, and know where the dashboard box is.
