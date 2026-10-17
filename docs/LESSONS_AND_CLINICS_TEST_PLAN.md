# Lessons and clinics: test plan (revision 2: lessons are paid at the lesson)

**Status: a plan, with one suite already running** (`lessons-clinics-sketch`, 188 checks and 22 deliberate breakages, on the
branch `claude/lessons-clinics-booking`). Everything else below is written before the code exists, so that each rule in
`docs/LESSONS_AND_CLINICS_DESIGN.md` has a named test that must fail when the rule is removed.

The method is the camp's, which is what made its launch checks trustworthy:

- **Real PostgreSQL, real parallel connections, nothing mocked** for anything the database is meant to guarantee. Each suite builds its own throwaway
  database from the migration files (so the migrations are tested too) and drops it.
- **Only local servers, never a real outside service.** The helper refuses any non-local database and strips the Gmail and Google settings from the
  environment: no test can email anyone or touch a calendar or Sheet. Google is a **fake** (section 5); mail goes to a recording sink.
- **Attack it from raw SQL**, not only through the application: a rule that only the application enforces is not a rule.
- **Deliberate breakage** ("mutation checks"): break one protection at a time and require the suites to notice.
- **Invariants after every test** (section 4), so a test cannot pass while the data is quietly wrong.
- **A test clock** for everything that depends on "now" (cancellation boundaries, reminders, close-out), so nothing waits in real time.
- Fake customers only, no real children's or customers' data.

---

## 1. The layers

| Layer | What it proves | Where it runs |
| --- | --- | --- |
| **A. Database rules** | Overlap, capacity, all-or-nothing, never-expires, payment shape and trail, cancellation terms, contact limits, reminders once, tax snapshot, calendar-check record, package credits, camp untouched | PostgreSQL only (the schema sketch today; the real migrations later) |
| **B. Service transactions** | The book / cancel / reschedule / close-out / pay / verify procedures under concurrency | Postgres plus the application's library code, a fake calendar, a fake mailer and a test clock |
| **C. HTTP** | The public state gates, error messages, rate limits, idempotency, private links, admin guards, privacy of responses | The real production build (`next start`) on one database connection, as in production |
| **D. Browser** | A real person on a phone and a laptop, in English and in French | Chromium via Playwright against the production build |
| **E. Rehearsal** | The same drills against the real services (hosting, a Neon branch, Gmail, your Google) | Staging, with your accounts, only after your approval |
| **F. Mutation** | The tests notice when a protection is removed | A scratch copy of the project |
| **G. Non-regression** | The website launch and the camp are untouched | Runs with everything else, on every step |

---

## 2. The suites

Status: **exists** now; otherwise the phase in which it is written (design section 15). All join `npm test` as they are built.

| Suite | Covers | Phase |
| --- | --- | --- |
| `lessons-clinics-sketch` | **Exists, 188 checks.** The camp byte-identical before and after; applies twice; settings and gates (tax, cancellation policy); 50 clicks on one lesson slot give one winner; every partial overlap refused; buffers; blocks versus lessons; clinic sessions versus lessons; **a lesson never expires** (no hold column, no `expired`, the system cannot cancel, 90-day-old unpaid lesson still confirmed); **close-out and payment** (cannot be marked done or paid before it starts, Cash/Interac/Unpaid, a different amount needs a reason, reverting needs a reason, terminal states); **the trail** (written by the database, even for raw SQL, append-only, no personal data); **cancellation** (free, late with a fee, fee never above price, double cancel changes nothing, cancel racing rebooking); **reschedule** (atomic, refused into a taken time, 10 racing into one slot, versus a new booking); **manual add and weekly series** (all or nothing, owner cannot overlap, calendar override owner-only); **contact limits** (10 simultaneous bookings by one person give exactly the allowed number; email and phone written differently count as one person; unpaid block); **reminders** (due times, once, 8 workers, cancelled/moved/booked-inside-the-window); the calendar-check record; **clinic capacity, parties, reported payments, exact-amount verification, late payment**; package credits; daylight saving; cancellation-rule and fee arithmetic with the exact 24-hour boundary; the GST/QST arithmetic over $0.00 to $2,000.00 | **exists** |
| `launch-mode` | The site built with **no settings** loads every public page, says "coming soon", refuses bookings (503/401), touches no outside service. Must stay green on this branch with all switches off | **exists** (24 checks) |
| `booking-state` | The single "what does the public see" function: every combination of switch x tax mode x **cancellation policy** x published product x working hours x calendar state (off / not_ready / open / paused); **clinics stay open when only the calendar is down**; preview never bypasses the tax gate, the policy gate or the calendar fail-safe | 0 |
| `legacy-routes` | With the old Google settings present the old routes still answer 503 unless `LEGACY_GOOGLE_BOOKING=true`; the **new** setting names do not wake them | 0 |
| `camp-untouched` | (a) schema snapshot of every camp object equal after all migrations; (b) migrations 009+ contain no DROP/ALTER/UPDATE on camp tables except the allowed additive `email_outbox` changes; (c) camp-only source files byte-identical to the launch branch; (d) every camp suite passes | 0, every phase |
| `booking-money` | Tax modes and rounding as properties; camp parity in `added`; `included` exactness; exempt products; `unset` blocks; frozen figures survive a mode change; the "to pay at your lesson" text per mode in both languages; fees recorded as one amount | 1 |
| `lesson-booking` | The whole booking transaction through the library: validation, the live calendar check first, **confirmed on commit**, confirmation email queued in the same transaction, idempotency, error mapping ("just taken", paused card), the response only after commit | 2 |
| `lesson-availability` | The pure engine on golden days: hours by weekday and season, grid, slot/lesson/buffer, notice, horizon, blocks, occupancy, calendar busy, DST days, a day with no hours | 2 |
| `lesson-series-dst` | Owner-made weekly series across 2026-11-01 and 2027-03-14; a nonexistent local hour is never offered; an ambiguous hour is never offered | 2 |
| `lesson-never-expires` | **A code scan that no automatic job, sweep or email changes a lesson's status**; the database side (above); a simulated 90 days with the scheduler running | 2 |
| `lesson-cancellation` | Every rule with the **test clock**: exactly 24 hours (free), one second inside (contact only), "allow and flag", owner cancel with fee applied/waived/edited, frozen terms survive a rule change, the two clock-change days, the customer page and email text in both languages | 2 |
| `lesson-reschedule` | Owner move (checked against availability, overlap and calendar), customer move when the switch is on, notice rule, new reminders, calendar event updated, refused moves change nothing | 2 |
| `lesson-manual-add` | Owner adds by phone: conflicts impossible, optional email, weekly repeat all-or-nothing, the calendar attestation only when Google is down and never for customers | 2 |
| `lesson-closeout` | The close-out queue and screens' API: Completed + Cash / Interac / Unpaid, No-show with fee, change later, revert with a reason, different amount with a reason, bank reference, search by reference/name/email/phone/**amount**, the trail for every action | 2 |
| `lesson-contact-limits` | The per-contact cap, the unpaid block with its grace period, the owner exemption, normalisation of email and phone, a blocked-contacts list | 2 |
| `lesson-reminders` | With the test clock and a **late scheduler**: due times, once only, never for cancelled/closed lessons, skipped when booked inside the window, new ones after a move, personal details never in the queue, the scheduler absent for a day then back | 2, 4 |
| `lesson-emails` | Confirmation immediately and in the customer's language, content (date, place, amount with tax lines, how to pay, policy, add-to-calendar, cancel link), reminders, cancellation, reschedule, owner alerts; sent once; retried; the email failing never unconfirms a lesson | 2, 4 |
| `calendar-failsafe` | The fake calendar in every failure mode against **every lesson entry point** (booking, customer move, owner add, owner move); clinics unaffected; the 30-second record | 2, 3 |
| `calendar-sync` | **Outbound:** deterministic ids, retry storm, partial failures, event removed on cancel, event updated on move, no phone/email in payloads. **Inbound:** personal event over a lesson flagged and never auto-resolved; our event moved or deleted in Google flagged with Apply / Restore; a hand-made entry treated as busy; an orphan event ignored for availability; outage and recovery; lessons booked under attestation re-checked on recovery | 3 |
| `clinic-flow` | Offering and session generation across DST; reserve 1 to 6; full; capacity above 10 only with a written note; session cancel; the roster | 1 |
| `clinic-concurrency` | The clinic races under 10 to 100 connections with the invariants after each | 1 |
| `clinic-lifecycle` | K1 to K9 of the design: reserve, report, expire, extend, release, cancel, double-click, double-confirm, expiry versus confirm | 1 |
| `clinic-payment` | Late payment (re-take only if free, refused whole otherwise, both bookings byte-identical, the "paid but unavailable" flag), exact-amount verification, too little / too much / twice, search by reference (any spelling), name, email, phone, **amount** | 1 |
| `no-auto-release` | Nothing automatic can confirm, release or expire a clinic `payment_reported` booking (as the camp's), including a simulated week and ten days of owner absence | 1 |
| `booking-abuse` | Open clinic holds per contact, false-report strikes, rate limits, honeypot, flood limit, a joker cannot block a week of lessons | 1, 2 |
| `booking-i18n` | Same messages in English and French for every new string; typography; money and dates; the pause card; the cancellation policy and the tax lines | 1, 2 |
| `booking-privacy` | Copy of a customer's data; erasing leaves nothing personal in any new table, outbox, trail, log or calendar payload; an outstanding amount survives; retention clean-up; no health data | 1, 4 |
| `booking-roster` | Clinic roster downloads: full versus sign-in; recent-password gate; CONFIDENTIAL names; formulas stay text; audit without personal details; POST-only | 1 |
| `booking-http` | On the production build: every public-state gate; 503s while off; validation; idempotency; contact limits; private links (a lesson link opens only that lesson, a tampered link opens nothing); cancel needs the same-origin POST; admin routes 401/403/429; responses reveal nothing about other customers | 1, 2 |
| `booking-packages` | Credit races, unpaid/expired, approval and switch locks, give-back rules, append-only ledger; **inactive by default** | 6 |
| `reconciliation` | `legacy_key` uniqueness; dry run changes nothing; a legacy entry that conflicts is refused and shown; legacy entries create no outbound event | after G0 |

---

## 3. The race matrix

Every row runs on a real database with many simultaneous connections and a deliberate-breakage check (section 7). "Invariants" means section 4 after the run.

| # | The race | Closed by | Expected outcome |
| --- | --- | --- | --- |
| R1 | 50 customers, the same lesson slot, same instant | no-overlap rule | exactly 1 wins and is **confirmed**; 49 told "just taken"; nothing left behind |
| R2 | Overlapping but different starts (9:00 and 9:30) | same rule on ranges | exactly 1 wins |
| R3 | Back-to-back with a buffer | the buffer is part of the occupied range | touching only allowed with the buffer clear |
| R4 | An owner-made weekly series where only the 3rd week is taken | one transaction | nothing booked |
| R5 | Double click / retry (100 repeats) | idempotency key | 1 lesson, 1 reference |
| R6 | You block a time while a customer books it | same rule | exactly 1 wins; a block over a lesson is refused |
| R7 | *Clinic:* hold expires at the same moment the payment is confirmed | row lock and legal moves | both orders tested; no double state |
| R8 | *Clinic:* late payment after the spots were re-booked | re-take with the counter | refused whole; confirmed customers unchanged |
| R9 | **Reschedule** into a slot someone is booking right now | one update checked by the rule | exactly 1 wins |
| R10 | Two taps on **Paid** (or Paid-Cash versus Paid-Interac) at once | row lock; payment shape; the trail | both recorded in order, the final state consistent, nothing lost |
| R11 | *Clinic:* the last spot, two parties | counter trigger | never above capacity |
| R12 | *Clinic:* a party of 3 when 2 remain; a pair racing a single | all-or-nothing | no partial party |
| R13 | *Clinic:* a spot released while someone reserves it | counter and row locks | consistent either way |
| R14 | *Clinic:* 100 people for 10 spots | counter | exactly 10 |
| R15 | Google shows busy time between display and booking | live check at booking | refused "no longer free" |
| R16 | Daylight saving across an owner-made series | wall-clock arithmetic | correct local time every week |
| R17 | The displayed list is stale | never trusted | the booking is still refused if the time is taken |
| R18 | Counters drift from the truth | commit-time recount | any drift refused at commit |
| R19 | Google becomes unavailable between display and booking | live check fails closed | refused, call-or-text card, **nothing written** |
| R20 | Google answers slowly (beyond 3 seconds) at booking | timeout is "unavailable" | refused, nothing written, no lock held during the wait |
| R21 | Google answers with an error inside a successful reply | any error is "unavailable" | refused (reproduces finding F1) |
| R22 | Google answers for fewer calendars than asked | incomplete is "unavailable" | refused |
| R23 | The cache is stale or does not cover the dates | freshness rule | no times shown; booking refused |
| R24 | A very old check cannot be reused | database CHECK (30 seconds) | an old timestamp is refused by raw SQL |
| R25 | Calendar recovers while customers wait | refresh resets the state | times reappear; no earlier refusal left a trace |
| R26 | Two calendar refreshes at once | single flight | one Google call, one cache write |
| R27 | **One person books many lessons at once** (10 requests, 2 allowed) | the contact check inside the booking transaction under one lock | exactly 2 succeed |
| R28 | *Clinic:* a reported payment and the expiry sweep at the same instant | legal moves; reported never expired | stays reported |
| R29 | *Clinic:* two operators confirm the same late payment | row lock | one confirms |
| R30 | *Clinic:* cancel and confirm at once | row lock | one outcome, consistent |
| R31 | Spend the last package credit twice | counter trigger | exactly one succeeds |
| R32 | Change the tax mode (or the cancellation policy) while customers are booking | frozen snapshot | each lesson keeps the terms in force when it was booked |
| **R33** | **A customer cancels while someone books the same time** (12 pairs) | row lock, exclusion | every rebooking either succeeded after the cancel or was refused as taken |
| **R34** | **The customer and the owner both cancel the same lesson at once** | legal moves | one outcome; no double fee; the second sees "already cancelled" |
| **R35** | **Close-out and cancel at once** (two tabs) | legal moves from `confirmed` only | one wins |
| **R36** | **A customer cancels exactly at the notice boundary** (test clock, 23:59:59.9 and 00:00:00.1) | the decision uses the database's time under a row lock | free on one side, "contact James" on the other; never both |
| **R37** | **The owner adds a lesson while a customer books the same time** | exclusion | exactly one |
| **R38** | **Eight scheduler workers run the reminders at once, and again late** | unique (lesson, time, hours before) | each reminder queued exactly once |
| **R39** | **A lesson is moved while its reminder is being queued** | reminders keyed by the start time | the old time's reminder is skipped at send, the new time earns its own |
| **R40** | **Google event for a lesson is edited while the owner moves the lesson in the dashboard** | the database is the record; the edit is flagged afterwards | no automatic overwrite either way |

---

## 4. The invariant checker (runs after every test)

Each is one SQL query that must return zero rows:

1. Two active occupied ranges overlap.
2. A clinic's counter differs from its active spots, or exceeds its capacity.
3. A lesson that is confirmed, completed or no-show does not hold exactly one matching occupied range.
4. A cancelled lesson, or an expired / cancelled / refunded clinic booking, still holds time or spots.
5. A live clinic booking does not hold all its spots.
6. A paid clinic booking whose verified amount differs from its total.
7. An expired clinic booking that was ever reported.
8. A booking whose subtotal + GST + QST differs from its total, or one with the tax mode unset or the policy `unset`.
9. A customer lesson without a calendar check, or whose check is more than 30 seconds older than the booking.
10. A package with a negative or over-total balance, or a ledger row that was altered.
11. A lesson without its `created` event in the trail; a trail row altered or missing; an event with actor `unknown` made through an application path.
12. A lesson marked paid that has not happened, or owing nothing; a paid amount that differs from the amount owed without a written reason.
13. **A lesson whose status is anything but confirmed, completed, no-show or cancelled, or that was cancelled by anything but the customer or the owner.**
14. A booking email in the outbox with no booking, or the same email twice.
15. A clinic offering above its standard capacity with no written authorization.

---

## 5. The fake calendar

One test double stands in for Google everywhere. It is **scripted per call**. Behaviours:

| Behaviour | Used to prove |
| --- | --- |
| `ok` (with a given busy list) | normal availability and booking |
| `slow` (answers after N seconds, including after the limit) | R20; no database lock held while waiting |
| `down` (network error, 500, 503) | R19 |
| `rate_limited` (429) | unavailable; backs off; no retry storm |
| `auth_failed` (401/403, expired key) | unavailable, health line red, alert |
| `error_inside_success` (calendar-level error in a 200 reply) | R21 |
| `incomplete` (fewer calendars than asked) | R22 |
| `garbled` (unreadable body) | unavailable |
| `changes_between_calls` (free at display, busy at booking) | R15 |
| `recovers` (down, then ok) | R25 |
| `all_day_free` / `all_day_busy` | F10; vacations belong in Blocks |
| `window_too_large` (rejects a long range) | long ranges fall back to per-week requests |
| `write_fails` / `write_duplicate` (outbound) | retry, deterministic ids, "not on calendar yet" |
| **`event_moved` / `event_deleted` / `event_added_by_hand` / `orphan_event`** | the inbound change detection of design 10.5 |
| **`personal_event_over_a_lesson`** | the conflict is flagged and nothing is changed |

Tests also scan the code to prove that **only** the calendar adapter imports `googleapis`, that the free/busy client is created with the free/busy permission only, that nothing reads Google Sheets for lessons or clinics, and that no function creates a booking from a Google event.

---

## 6. Time: the dates that break scheduling systems (all with the test clock)

| Date or moment | Why |
| --- | --- |
| 2026-11-01 (Sunday) | clocks go back; 1:30 happens twice |
| 2027-03-14 (Sunday) | clocks go forward; 2:30 does not exist; **a lesson at 10:00 that day is 23 elapsed hours after "the same time yesterday"** (cancellation notice) |
| 2027-11-07 | the next fall-back, so no test works for one year only |
| 2028-02-29 | leap day inside an owner-made weekly series |
| A lesson exactly 24 hours away; 24 hours minus one second; 24 hours plus one second | the cancellation boundary (R36) |
| A lesson exactly 24 hours and 2 hours away | the reminder boundaries |
| A lesson booked 10 hours ahead | no 24-hour reminder; the 2-hour one only |
| A lesson that started 1 second ago | close-out becomes possible |
| A lesson 90 days after booking, never paid | L1: still confirmed |
| The scheduler silent for 26 hours, then running | reminders late but once, never after the lesson |

---

## 7. Deliberate breakage (mutation checks)

`npm run test:mutations` already breaks 98 camp protections. The lists below join it. **22 database mutations are written and run
against `lessons-clinics-sketch`; each must be caught.** Some are caught by a second, independent layer, like the camp's.

| # | Break this | Caught by |
| --- | --- | --- |
| M01 | Remove the no-overlap constraint | `lessons-clinics-sketch` |
| M02 | Remove the clinic capacity condition | `lessons-clinics-sketch` (second layer: the CHECK) |
| M03 | Let a clinic booking be Paid for any amount | `lessons-clinics-sketch` |
| M04 | Remove the live calendar-check requirement | `lessons-clinics-sketch` |
| M05 | Let a reported clinic payment expire | `lessons-clinics-sketch` (second layer) |
| M06 | Let a package go below zero | `lessons-clinics-sketch` |
| M07 | **Let a lesson become `expired`** | `lessons-clinics-sketch` |
| M08 | **Let the system cancel a lesson** | `lessons-clinics-sketch` |
| M09 | **Let a lesson be marked paid before it has happened** | `lessons-clinics-sketch` |
| M10 | **Remove the audit trail trigger** | `lessons-clinics-sketch` |
| M11 | **Let the trail be edited** | `lessons-clinics-sketch` |
| M12 | **Let a lesson be completed before it starts** | `lessons-clinics-sketch` |
| M13 | **Remove the lock in the contact check** | `lessons-clinics-sketch` (R27) |
| M14 | **Remove uniqueness of reminders** | `lessons-clinics-sketch` (R38) |
| M15 | **Let a payment be taken back without a reason** | `lessons-clinics-sketch` |
| M16 | **Let a different amount be recorded without a reason** | `lessons-clinics-sketch` |
| M17 | **Let a fee exceed the price** | `lessons-clinics-sketch` |
| M18 | **Remove the commit-time status-versus-time check** | `lessons-clinics-sketch` |
| M19 | **Let a closed lesson be moved** | `lessons-clinics-sketch` |
| M20 | **Let a booked lesson's price and terms be edited** | `lessons-clinics-sketch` |
| M21 | **Allow the placeholder policy `unset` on a booking** | `lessons-clinics-sketch` |
| M22 | **Ignore unpaid history in the contact check** | `lessons-clinics-sketch` |
| M23 | Build weekly series with `+7 x 24 hours` | `lesson-series-dst` |
| M24 | Ignore the error inside a successful Google reply | `calendar-failsafe` (R21) |
| M25 | Treat a timeout as "no busy time" | `calendar-failsafe` (R20) |
| M26 | Show times from a stale cache | `calendar-failsafe` (R23) |
| M27 | Allow a booking when the live check fails | `calendar-failsafe`, `booking-http` |
| M28 | Reuse the display check as the booking check | `calendar-failsafe` (R15) |
| M29 | Let preview mode bypass the tax gate | `booking-state` |
| M30 | **Let preview mode bypass the cancellation-policy gate** | `booking-state` |
| M31 | Read the old Google settings in the new code | `legacy-routes`, source scan |
| M32 | Wake the old routes when the new settings exist | `legacy-routes` |
| M33 | Compute QST on top of GST; round down instead of half-up; recompute an old booking's tax | `booking-money` |
| M34 | **A scheduled job that closes or cancels an old unpaid lesson** | `lesson-never-expires` (code scan) |
| M35 | **Apply today's cancellation rules to a lesson booked under older ones** | `lesson-cancellation` |
| M36 | **Treat exactly 24 hours as late** (or 24 hours and 1 second as free) | `lesson-cancellation` (R36) |
| M37 | **Allow a customer to cancel inside the notice when the setting says contact only** | `lesson-cancellation`, `booking-http` |
| M38 | **Charge a fee automatically instead of leaving it to the owner** | `lesson-cancellation` |
| M39 | **Send a reminder for a cancelled or completed lesson, or twice** | `lesson-reminders` |
| M40 | **Send a reminder for the old time after a move** | `lesson-reminders` (R39) |
| M41 | **Let the confirmation email failure roll back the booking** | `lesson-emails` |
| M42 | **Put the phone number or email in the calendar event or the trail** | `calendar-sync`, `booking-privacy` |
| M43 | **Auto-resolve a calendar conflict by moving a lesson** | `calendar-sync` (R40) |
| M44 | **Overwrite the booking from a changed Google event without the owner's click** | `calendar-sync` |
| M45 | **Treat an entry made by hand in the Bookings calendar as free** | `calendar-sync` |
| M46 | **Let the owner override apply to a customer, or when Google is reachable and shows busy** | `lesson-manual-add`, `booking-http` |
| M47 | **Let a lesson link open any other lesson, or accept a tampered link** | `booking-http` |
| M48 | Let a clinic hold expire a reported payment; skip the exact-amount check; late payment without the rule | `clinic-payment`, `no-auto-release` |
| M49 | Spend a package credit before payment; turn packages on with only the environment switch | `booking-packages` |
| M50 | Change a camp table in a migration; edit a camp-only source file | `camp-untouched` |
| M51 | Make a public page show a form while the state is `off` | `launch-mode`, `booking-http` |

---

## 8. Browser checks (Playwright, production build; phone first)

Phone-sized (390 px) and desktop; English and French; screenshots reviewed for layout and wording.

1. **Lesson:** swipe the days, tap a time, fill one form, **Confirm my lesson**; the confirmation page appears at once with date, place, amount, how to pay, add-to-calendar and cancel. A second device with the link sees the same page.
2. **Taken just now:** the other tab books the same time first; the message appears and the form is kept.
3. **Calendar paused:** the call-or-text card in both languages (tap-to-call, tap-to-text, the pre-filled email); clinics on the same site still work.
4. **Coming soon:** with a switch off, the tax mode unset or the policy unconfirmed, both pages show the "coming soon / call or email" card and no form.
5. **Cancel in time** (free) and **inside the notice** (contact-only message); the freed time returns to the list at once.
6. **Clinic:** the card shows spots left; reserve for 1 and for 3; the reservation page shows the amount, reference and deadline; "I've sent my payment"; Full shows no form.
7. **Admin on a phone:** the **Close out** list and its four buttons; Paid - Cash, Paid - Interac, Unpaid, No-show; a different amount asks for a note; reverting asks for a reason; the lesson's timeline shows who did what; **Move** (a conflicting time cannot be chosen); **Cancel** (apply or waive the fee); **Manual add**; blocks with affected lessons listed; clinic verification and rosters; settings with the tax and policy confirmations; the calendar health panel.
8. **Accessibility basics:** tab order, labels, contrast on status colours, tap-target size, the form usable with a keyboard and with large text.

---

## 9. Rehearsal on real services (extends `scripts/staging-verify.mjs` and `docs/LAUNCH_REHEARSAL.md`)

Only after your approval, on a **separate Neon branch**, a preview deployment, a throwaway Gmail app password and a **test calendar**, with made-up customers.

| Drill | Pass when |
| --- | --- |
| `CREATE EXTENSION btree_gist` on the Neon branch; run all migrations; run the schema checks | succeeds (else the row-lock fallback is built and tested) |
| 8 people for one lesson slot; 8 for the last clinic spot | one winner each; the others politely refused |
| One person tries to book 5 lessons at once | exactly the allowed number |
| Duplicates (double submit, back button) | one lesson |
| Email broken then repaired | the lesson stays confirmed; the email is sent later, once |
| **Google real behaviour**: unshare the calendar; revoke the key; slow network; a long window; all-day free and busy events; quota | each is read as unavailable or handled; times reappear on recovery |
| **Pause drill**: make the calendar unreachable while a customer presses the final button | refused, nothing saved, card shown, you are alerted |
| **Sync drill**: move and delete one of our events in Google; add an event by hand; add a personal event over a lesson | each flagged as designed; nothing changes by itself |
| **Reminder drill** with a test clock: the 24-hour and 2-hour reminders, a late scheduler, a moved lesson | sent once each at the right times |
| **Cancellation drill** with a test clock: just inside and just outside 24 hours | the right message each side |
| **Close-out drill** on a phone: Completed - Paid Cash, Interac, Unpaid, No-show, a correction | the trail shows every step |
| Clinic payment drill with three real $1-$5 e-Transfers (reference, without the button, wrong amount) | found, confirmed, mismatch flagged |
| Daylight saving drill | a series created across 2026-11-01 (test clock) lands at the right hours |
| The scheduler: one night with nothing running | clinic holds still free on time; reminders late but sent once |
| Restore drill | database restored to a new Neon branch; counters, lessons and the trail intact; invariant checker clean |

---

## 10. Guarding the website launch and the camp (runs on every step)

| Guard | How |
| --- | --- |
| The informational site can launch alone | `launch-mode` runs on this branch with every new switch unset |
| The camp is untouched | `camp-untouched` (schema snapshot, SQL scan, file hashes) and **all existing suites** green |
| Migrations are safe | idempotent (applied twice), each with a matching `db/rollback/…_down.sql`, preflight checks, no destructive statement |
| No accidental public booking | `booking-state` and `legacy-routes` |
| No paid service | a scan that no new dependency, setting or script requires a paid account |
| No real data | the helper refuses non-local servers; fixtures use `example.test` addresses and 555 numbers |

---

## 11. Entry and exit for each phase

- **Entry:** your approval for the phase; the open decisions it needs answered or defaulted safely.
- **Exit:** the phase's suites green; the invariant checker clean; the mutation list for that phase caught; `launch-mode` and `camp-untouched` green; the full `npm test` green; a browser run reviewed; a short report to you listing what was built, tested and could not be tested; **then I stop and ask before the next phase.** Nothing is merged, deployed or switched on.

---

## 12. Your requirements, and the test that covers each

| You asked for | Rule | Test |
| --- | --- | --- |
| **1.** Pick a date and time, enter details, **immediate confirmation without payment** | L3, 3.2 | `lesson-booking`, browser check 1, sketch section 3 |
| **2.** PostgreSQL atomically prevents overlapping bookings, including simultaneous requests | L2 | `lessons-clinics-sketch` (50-click race), R1 to R6, R9, R33, R37 |
| **3.** A confirmed lesson must not expire merely because it is unpaid | L1 | `lesson-never-expires`, sketch section 4, M07, M08, M34 |
| **4.** Google Calendar stays synchronized; never offer or confirm a conflict; outages handled safely | L4, 10 | `calendar-failsafe`, `calendar-sync`, R15 to R26, R40, M24 to M28, M42 to M46 |
| **5.** Email booking details and reminders automatically | 13 | `lesson-emails`, `lesson-reminders`, R38, R39, M39 to M41 |
| **6.** Mark a completed lesson Paid - Cash / Paid - Interac / Unpaid, with an audit trail | L5, 7B.4, 12 | `lesson-closeout`, sketch section 5, R10, M09 to M11, M15, M16 |
| **7.** Configurable cancellation rules, proposed 24-hour notice | L6, 7B.2 | `lesson-cancellation`, R34, R36, sketch sections 6 and 15, M17, M35 to M38 |
| **8.** Easy reschedule, cancel, manual add, without conflicts | 9.3, 12 | `lesson-reschedule`, `lesson-manual-add`, R9, R37, M19, M46, browser check 7 |
| **9.** Prices, taxes, durations and availability configurable | 4, 5 | `lesson-availability`, `booking-money`, `booking-state`, R32 |
| **10.** Keep the separate advance-payment rules for camp and clinics | 1.2, 7A | `clinic-lifecycle`, `clinic-payment`, `no-auto-release`, `camp-untouched`, sketch section 12 |
| Simple, secure, mobile-friendly | 3, 14 | browser checks 1, 7 and 8; `booking-http`; `booking-abuse` |
| Do not merge, deploy or activate live booking without approval | 2 | `launch-mode`, `booking-state`, M51 |
