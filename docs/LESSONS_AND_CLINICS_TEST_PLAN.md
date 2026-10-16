# Lessons and clinics: test plan

**Status: a plan, with one suite already running** (`lessons-clinics-sketch`, 96 checks, on the branch
`claude/lessons-clinics-booking`). Everything else below is written before the code exists, so that each rule in
`docs/LESSONS_AND_CLINICS_DESIGN.md` has a named test that must fail when the rule is removed.

The method is the camp's, which is what made its launch checks trustworthy:

- **Real PostgreSQL, real parallel connections, nothing mocked** for anything the database is meant to guarantee. Each
  suite builds its own throwaway database from the migration files (so the migrations are tested too) and drops it.
- **Only local servers, never a real outside service.** The helper refuses any non-local database, and strips the Gmail and
  Google settings from the environment: no test can email anyone or touch a calendar or Sheet. Google is a **fake** (section 5); mail
  goes to a recording sink that delivers nothing.
- **Attack it from raw SQL**, not only through the application: a rule that only the application enforces is not a rule.
- **Deliberate breakage** ("mutation checks"): break one protection at a time and require the suites to notice.
- **Invariants after every test** (section 4), so a test cannot pass while the data is quietly wrong.
- Fake customers only, no real children's or customers' data.

---

## 1. The layers

| Layer | What it proves | Where it runs |
| --- | --- | --- |
| **A. Database rules** | Overlap, capacity, all-or-nothing, legal payment moves, tax snapshot, calendar-check record, package credits, camp untouched | PostgreSQL only (the schema sketch today; the real migrations later) |
| **B. Service transactions** | The reserve / pay / expire / late-pay / cancel / reschedule / block procedures under concurrency | Postgres plus the application's library code and a fake calendar and fake mailer |
| **C. HTTP** | The public state gates, error messages, rate limits, idempotency, admin guards, privacy of responses | The real production build (`next start`) on one database connection, as in production |
| **D. Browser** | A real person on a phone and a laptop, in English and in French | Chromium via Playwright against the production build |
| **E. Rehearsal** | The same drills against the real services (Vercel, a Neon branch, Gmail, your Google, a few real $1 transfers) | Staging, with your accounts, only after your approval |
| **F. Mutation** | The tests notice when a protection is removed | A scratch copy of the project, nothing in the real tree is touched |
| **G. Non-regression** | The website launch and the camp are untouched | Runs with everything else, on every step |

---

## 2. The suites

Status: **exists** now; otherwise the phase in which it is written (design section 15). All join `npm test` as they are built.

| Suite | Covers | Phase |
| --- | --- | --- |
| `lessons-clinics-sketch` | The central database rules on the sketch: camp byte-identical before and after; sketch applies twice; 50 clicks on one slot give one winner; every partial overlap refused; touching allowed; buffers; block versus booking races; clinic session versus lesson; all-or-nothing series; 100 repeats of one request; DST; raw-SQL attacks on status/time/spots; legal payment moves; late payment both ways; money CHECKs; calendar-check record; 100-for-10 clinic race; party of 3 when 2 remain; counter attacks; capacity authorization; credits; the money arithmetic over $0.00 to $2,000.00 | **exists** (96 checks) |
| `launch-mode` | The site built with **no settings** loads every public page, says "coming soon", refuses bookings (503/401), touches no outside service. Must stay green on this branch with all switches off | **exists** (24 checks) |
| `booking-state` | The single "what does the public see" function: every combination of switch x tax mode x published product x working hours x calendar state (off / not_ready / open / paused), including that **clinics stay open when only the calendar is down**, and that the preview flag never bypasses the tax gate or the calendar fail-safe | 0 |
| `legacy-routes` | With the Google settings present, the old `/api/lesson-booking` and `/api/clinic-signup` still answer 503 unless `LEGACY_GOOGLE_BOOKING=true`; the **new** setting names do not wake them | 0 |
| `camp-untouched` | (a) schema snapshot of every camp object equal before and after all new migrations; (b) migrations 009 and up contain no DROP/ALTER/UPDATE on camp tables except the allowed additive `email_outbox` changes (a scan of the SQL); (c) a list of camp-only source files is byte-identical to the launch branch; (d) every camp suite still passes | 0 and every phase |
| `booking-money` | Tax modes and rounding as properties over 0 to $2,000.00 in every mode; camp parity in `added`; `included` exactness rule; exempt products; `unset` blocks; a booking keeps its frozen figures when the mode or rates change; the confirm amount equals the frozen total; the payment instruction text per mode in both languages | 1 |
| `clinic-flow` | Offering and session generation (weekday, time, weeks, across DST); reserve 1 to 6 participants; full; capacity above 10 only with a written note; session cancel; the roster contents | 1 |
| `clinic-concurrency` | Races R11 to R14, R22 (section 3) under 10 to 100 connections, with the invariant checker after each | 1 |
| `booking-lifecycle` | Every edge case E1 to E22 of the design: reserve, report, expire, extend, release, cancel, double-click, double-confirm, expiry versus confirm | 1 |
| `booking-late-payment` | E3, E4, E11: late payment re-takes only if free; refused whole otherwise; both bookings byte-identical; flag `late_unavailable` surfaces; resolution paths (move, refund, written-note extra spot) | 1 |
| `booking-payment-verify` | E7 to E10, E16: exact amount required; too little / too much / twice / for a cancelled booking; search by reference (any spelling), name, email, phone, **amount**; verification fields | 1 |
| `booking-no-auto-release` | A scan that nothing automatic can confirm, release or expire a `payment_reported` booking (as the camp's), plus a simulated week and a simulated ten days with the owner away and the scheduler running | 1 |
| `booking-abuse` | At most 2 open holds per email, per phone (however written) and per connection; false-report strikes; rate limits; flood protection; a joker cannot hold a week | 1 |
| `booking-emails` | Every email kind, in the customer's language at send time; written in the same transaction as its cause; sent once; retried; the 24-hour reminder timing; the daily budget; no private note in a customer's cancellation notice | 1 and 4 |
| `booking-i18n` | Same messages in English and French for every new string; typography; money and dates; the pause card; the tax lines per mode | 1 |
| `booking-privacy` | Copy of a customer's data; erasing leaves nothing personal in any new table, outbox, log or calendar event payload; retention clean-up (right customers, right day, never an unresolved payment); no health data; no personal details in logs | 1 and 4 |
| `booking-roster` | Clinic roster downloads: full versus sign-in; recent-password gate; CONFIDENTIAL file name; formulas stay text; audit without personal details; POST-only | 1 |
| `booking-http` | On the production build: every gate of the state function; 503s while off; request validation; idempotency; open-hold cap; admin routes 401/403/429; responses reveal nothing about other customers | 1 and 2 |
| `lesson-availability` | The pure engine on golden days: hours by weekday and season, grid, slot/lesson/buffer, notice, horizon, blocks, occupancy, calendar busy, DST days, a day with no hours, midnight edges; the same answer for any order of input | 2 |
| `lesson-series-dst` | Weekly series across 2026-11-01 and 2027-03-14 and Nov/Mar series; a local hour that does not exist is never offered; an ambiguous hour is never offered | 2 |
| `lesson-flow` | Reserve single and series, participants and price, taken-just-now, reschedule (single and series), block with affected bookings, manual booking, manual override rules | 2 |
| `lesson-concurrency` | Races R1 to R10 and R16, R17 (section 3) under 10 to 100 connections on the production build | 2 |
| `calendar-failsafe` | The fake calendar in every failure mode against every lesson entry point (section 5); clinics unaffected | 2 and 3 |
| `calendar-outbound` | Deterministic event ids, retry storm, partial failures, deleted/moved events, conflicts flagged and never auto-resolved, event payload without phone/email | 3 |
| `booking-packages` | Credit races, unpaid/expired, approval and switch locks, give-back rules, append-only ledger; **inactive by default** (no screen, no route, no spend) | 6 |
| `reconciliation` | `legacy_key` uniqueness; dry run changes nothing; a legacy entry that conflicts is refused and shown; legacy entries create no outbound event | after G0 |

---

## 3. The race matrix

Every row runs on a real database with many simultaneous connections and a **deliberate-breakage check** (section 7). "Invariants"
means section 4 after the run. Rows 1 to 18 are the earlier review's, kept; 19 to 32 are new.

| # | The race | Closed by | Expected outcome |
| --- | --- | --- | --- |
| R1 | 50 customers, the same lesson slot, same instant | no-overlap rule | exactly 1 wins; 49 told "just taken"; nothing left behind |
| R2 | Overlapping but different starts (9:00 and 9:30) | same rule on ranges | exactly 1 wins |
| R3 | Back-to-back with a buffer | buffer is part of the occupied range | touching only allowed with the buffer clear |
| R4 | A weekly series where only the 3rd week is taken | one transaction | nothing booked, ever |
| R5 | Double click / retry of one reservation (100 repeats) | idempotency key | 1 booking, 1 reference |
| R6 | You block a time while a customer books it | same rule | exactly 1 wins; a block over a booking is refused |
| R7 | Hold expires at the same moment the payment is confirmed | row lock and legal moves | both orders tested; no double state |
| R8 | Late payment: the time or spots were re-booked | re-reserve with the rule | refused whole; confirmed customers unchanged byte for byte |
| R9 | Reschedule into a slot someone is booking right now | single update checked by the rule | exactly 1 wins |
| R10 | Two tabs confirm or cancel the same booking | row lock, status guard | one acts, one is told "already done" |
| R11 | Clinic: the last spot, two parties | counter trigger | never above capacity |
| R12 | Clinic: a party of 3 when 2 remain; a pair racing a single | all-or-nothing | no partial party; counter equals spots |
| R13 | A clinic spot released while someone reserves it | counter and row locks | consistent either way |
| R14 | 100 people for 10 spots | counter | exactly 10 |
| R15 | Google shows busy time between display and reserve | live check at reserve | refused "no longer free" |
| R16 | Daylight saving across a series | wall-clock arithmetic | correct local time every week |
| R17 | The displayed list is stale | never trusted | booking still refused if taken |
| R18 | Counters drift from the truth | commit-time recount | any drift refused at commit |
| **R19** | **Google becomes unavailable between display and reserve** | live check fails closed | reservation refused, "call or text" card, **nothing written** |
| **R20** | **Google answers slowly** (beyond the 3-second limit) at the reserve | timeout is "unavailable" | refused, nothing written, no lock held during the wait |
| **R21** | **Google answers with an error inside a successful reply** (calendar not found) | any error is "unavailable" | refused (this reproduces finding F1) |
| **R22** | **Google answers for fewer calendars than asked** | incomplete is "unavailable" | refused |
| **R23** | **The cache is stale or does not cover the dates** | freshness rule | no times shown; reserve refused |
| **R24** | **A very old check cannot be reused** | database CHECK (30 seconds) | an old timestamp is refused by raw SQL |
| **R25** | **Calendar recovers while customers wait** | refresh resets the state | times reappear; no earlier refusal left a trace |
| **R26** | **Two refreshes at once** | single flight | one Google call, one cache write |
| **R27** | **Hold-cap race**: 3 simultaneous reservations from one email | cap counted in the transaction | at most 2 open |
| **R28** | **Reported payment and expiry sweep at the same instant** | legal moves, reported never expired | stays reported |
| **R29** | **Two operators confirm the same late payment** | row lock | one confirms |
| **R30** | **Cancel and confirm at once** | row lock | one outcome, consistent |
| **R31** | **Spend the last package credit twice** | counter trigger | exactly one succeeds |
| **R32** | **Change the tax mode while customers are booking** | frozen snapshot | each booking uses the mode in force when it was created, never a mix |

---

## 4. The invariant checker (runs after every test)

Each is one SQL query that must return zero rows:

1. Two active occupied ranges overlap.
2. A clinic's counter differs from its active spots, or exceeds its capacity.
3. A live booking (`reserved`, `payment_reported`, `paid`) does not hold all its time or spots.
4. A non-live booking (`expired`, `cancelled`, `refunded`) holds any time or any spot.
5. A `paid` booking whose verified amount differs from its total, or has no verification.
6. An `expired` booking that was ever reported.
7. A booking whose subtotal + GST + QST differs from its total, or a booking with the tax mode unset.
8. A lesson booking without a calendar check, or whose check is more than 30 seconds older than the booking.
9. A package with a negative or over-total balance, or a ledger row that was altered.
10. A booking email in the outbox with no booking, or the same email twice.
11. A clinic offering above its standard capacity with no written authorization.
12. The audit log has a gap, edit or deletion.

---

## 5. The fake calendar

One test double stands in for Google everywhere. It is **scripted per call**, so a test can say "the first call
succeeds, the second times out, the third returns busy". Behaviours:

| Behaviour | Used to prove |
| --- | --- |
| `ok` (with a given busy list) | normal availability and reserve |
| `slow` (answers after N seconds, including after the limit) | R20; no database lock is held while waiting |
| `down` (network error, 500, 503) | R19 |
| `rate_limited` (429) | treated as unavailable; backs off; no retry storm |
| `auth_failed` (401/403, expired key) | unavailable, health line red, alert |
| `error_inside_success` (calendar-level error in a 200 reply) | R21 |
| `incomplete` (fewer calendars than asked) | R22 |
| `garbled` (body that cannot be read) | unavailable |
| `changes_between_calls` (free at display, busy at reserve) | R15 |
| `recovers` (down, then ok) | R25 |
| `all_day_free` / `all_day_busy` | F10, and that vacations belong in Blocks |
| `window_too_large` (rejects a long range) | long series fall back to per-week requests |
| `write_fails` / `write_duplicate` (outbound) | retry, deterministic ids, "not on calendar yet" |

Tests also scan the code to prove that **only** the calendar adapter imports `googleapis`, that the free/busy client is
created with the free/busy permission only, that nothing reads Google Sheets for lessons or clinics, and that no function
creates a booking from a Google event (rule I10).

---

## 6. Time: the dates that break scheduling systems

Fixed dates used across the availability, series, reminder and hold tests:

| Date (Montreal) | Why |
| --- | --- |
| 2026-11-01 (Sunday) | clocks go back; 1:30 happens twice |
| 2027-03-14 (Sunday) | clocks go forward; 2:30 does not exist |
| 2027-11-07 | the next fall-back, to avoid a test that only works for one year |
| 2028-02-29 | leap day inside a 12-week series |
| Series starting Thursday 2026-10-29 and Monday 2027-03-01 | cross the changes |
| A hold that starts at 11:30 pm | the hold clock does not pause overnight (lever off), and ends at 2:30 am |
| A lesson 24 hours and 1 minute away, and 23 hours 59 minutes away | notice boundary |
| A hold ending exactly at the instant of confirmation | R7 |
| The first lesson within 48 hours, and at 48 hours and 1 minute | near-window boundary of the hold |

---

## 7. Deliberate breakage (mutation checks)

`npm run test:mutations` already breaks 98 camp protections one at a time. The lessons/clinics list below joins it. Each
must be caught by the named suite (some by a **second, independent layer**, like the camp's two such cases).

| # | Break this | Caught by |
| --- | --- | --- |
| M1 | Remove the no-overlap constraint | `lessons-clinics-sketch` *(done: caught)* |
| M2 | Remove the clinic capacity condition | `lessons-clinics-sketch` *(done: caught by the second layer, the CHECK)* |
| M3 | Let `paid` accept any amount | `lessons-clinics-sketch` *(done: caught)* |
| M4 | Remove the calendar-check requirement | `lessons-clinics-sketch` *(done: caught)* |
| M5 | Let a reported payment expire | `lessons-clinics-sketch` *(done: caught by the second layer)* |
| M6 | Let a package go below zero | `lessons-clinics-sketch` *(done: caught)* |
| M7 | Build weekly series with `+7 x 24 hours` | `lesson-series-dst` |
| M8 | Ignore the error inside a successful Google reply | `calendar-failsafe` (R21) |
| M9 | Treat a timeout as "no busy time" | `calendar-failsafe` (R20) |
| M10 | Show times from a stale cache | `calendar-failsafe` (R23) |
| M11 | Allow a reservation when the live check fails | `calendar-failsafe`, `booking-http` |
| M12 | Reuse the display check as the reserve check | `calendar-failsafe` (R15) |
| M13 | Let preview mode bypass the tax gate | `booking-state` |
| M14 | Let preview mode bypass the calendar fail-safe | `booking-state` |
| M15 | Read the old Google settings in the new code | `legacy-routes`, source scan |
| M16 | Wake the old routes when the new settings exist | `legacy-routes` |
| M17 | Compute QST on top of GST | `booking-money` |
| M18 | Round down instead of half-up | `booking-money` |
| M19 | Recompute an old booking's tax from the current mode | `booking-money` (R32) |
| M20 | Skip the exact-amount check on confirm | `booking-payment-verify` |
| M21 | Late payment re-takes the time without the rule | `booking-late-payment` |
| M22 | Late payment overwrites the stranger's booking | `booking-late-payment` |
| M23 | Release a reported payment in the expiry sweep | `booking-no-auto-release` |
| M24 | Let the customer's "I've sent it" revive an expired hold | `booking-lifecycle` (E17) |
| M25 | Count the hold cap per request instead of per transaction | `booking-abuse` (R27) |
| M26 | Skip the idempotency key | `booking-lifecycle` (R5) |
| M27 | Put the phone number in the calendar event | `calendar-outbound`, `booking-privacy` |
| M28 | Use a random event id on retry | `calendar-outbound` |
| M29 | Auto-resolve a calendar conflict by moving a booking | `calendar-outbound` |
| M30 | Let a block silently cover a booking | `lesson-flow` |
| M31 | Skip the written note for capacity above 10 | `clinic-flow` |
| M32 | Leave a customer's details in the outbox on erase | `booking-privacy` |
| M33 | Let the owner override apply to a customer | `booking-http`, `lessons-clinics-sketch` |
| M34 | Include the private note in the cancellation notice | `booking-emails` |
| M35 | Make a CSV cell start with `=` unescaped | `booking-roster` |
| M36 | Spend a package credit before the purchase is paid | `booking-packages` |
| M37 | Turn packages on with only the environment switch | `booking-packages` |
| M38 | Change a camp table in a migration | `camp-untouched` |
| M39 | Edit a camp-only source file | `camp-untouched` |
| M40 | Make a public page show a form while the state is `off` | `launch-mode`, `booking-http` |

---

## 8. Browser checks (Playwright, production build)

Phone-sized and desktop; English and French; screenshots reviewed by me for layout and wording.

1. **Clinic:** the card shows spots left; reserve for 1 and for 3; the reservation page shows amount (per tax mode),
   reference, deadline; "I've sent my payment"; refresh keeps state; a second device with the link sees the same page.
2. **Clinic full:** card shows Full, no form; waiting list if enabled.
3. **Lesson:** pick a day and time; repeat weekly; details; reservation page; the taken-just-now message keeps the form.
4. **Calendar paused:** the call-or-text card, in both languages, tap-to-call and tap-to-text links, the pre-filled email;
   clinics on the same site still work.
5. **Coming soon:** with a switch off or the tax mode unset, both pages show the "coming soon / call or email" card and no
   form (the launch-mode picture).
6. **Customer cancels an unpaid hold:** time returns to the list at once.
7. **Admin:** Needs attention queue; confirm payment by reference and by amount; late payment succeeds and is refused; extend
   a hold; release; cancel with and without telling the customer; move a lesson; block with affected bookings listed;
   manual booking incl. owner override; clinic series generator; roster downloads (password dialog, file names); settings
   incl. the tax confirmation banner; calendar health panel.
8. **Accessibility basics:** tab order, labels, contrast on the status colours, the form usable with a keyboard.

---

## 9. Rehearsal on real services (extends `scripts/staging-verify.mjs` and `docs/LAUNCH_REHEARSAL.md`)

Only after your approval, on a **separate Neon branch**, a preview deployment, a throwaway Gmail app password and a
**test calendar** (not your real one), with made-up customers and about $5 of real e-Transfers.

| Drill | Pass when |
| --- | --- |
| `CREATE EXTENSION btree_gist` on the Neon branch; run all migrations; run the schema checks | succeeds (else the row-lock fallback is built and tested) |
| 8 people for the last clinic spot; 8 for one lesson slot | one winner each; others politely refused |
| Duplicates (double submit, back button) | one booking |
| Email broken then repaired | customer still sees their page; email sent later, once |
| **Google real behaviour**: unshare the calendar; revoke the key; slow network; ask for a 12-week window; an all-day "free" and "busy" event; quota | each is read as unavailable or handled; times reappear on recovery; confirms F1, F8 and F10 |
| **Pause drill**: make the calendar unreachable while a customer is on the booking screen and presses the final button | refused, nothing saved, card shown, James alerted |
| Three real $1-$5 e-Transfers: with reference, without the button, and wrong amount | found by reference/amount; confirmed; mismatch flagged |
| The scheduler: one night with nothing running | holds still free on time when someone loads availability; reminders late but sent once |
| Daylight saving drill | a series created across 2026-11-01 (using a test clock) lands at the right hours |
| Restore drill | database restored to a new Neon branch; counters and bookings intact; invariant checker clean |

---

## 10. Guarding the website launch and the camp (runs on every step)

| Guard | How |
| --- | --- |
| The informational site can launch alone | `launch-mode` runs on this branch with every new switch unset |
| The camp is untouched | `camp-untouched` (schema snapshot, SQL scan, file hashes) and **all 28 existing suites** green |
| Migrations are safe | idempotent (applied twice), each with a matching `db/rollback/…_down.sql`, preflight checks, no destructive statement |
| No accidental public booking | `booking-state` and `legacy-routes` |
| No paid service | a scan that no new dependency, setting or script requires a paid account, and no Google/Neon/Vercel call happens outside `rehearsal` scripts |
| No real data | the test database helper refuses non-local servers; fixtures use `example.test` addresses and 555 numbers |

---

## 11. Entry and exit for each phase

- **Entry:** your approval for the phase; the open decisions it needs (design section 15) answered or defaulted safely.
- **Exit:** the phase's suites green; the invariant checker clean; the mutation list for that phase caught; `launch-mode`
  and `camp-untouched` green; the full `npm test` green; a browser run reviewed; a short report to you listing what
  was built, what was tested and what I could not test; **then I stop and ask before the next phase.** Nothing is merged,
  deployed or switched on.

---

## 12. Your requirements, and the test that covers each

| You asked for | Rule | Test |
| --- | --- | --- |
| No double-booking, even with simultaneous clicks | I1 | `lessons-clinics-sketch`, `lesson-concurrency` (R1 to R6, R9) |
| Account for Google Calendar events, other website bookings, availability, buffers | 9.1, 10 | `lesson-availability`, `calendar-failsafe` |
| **If Google is unavailable or stale, do not accept possibly conflicting lessons; offer to contact you** | I7 | R19 to R25, M8 to M12, browser check 4 |
| Admin can block dates, set working hours, manage locations | 4 | `lesson-flow`, browser check 7 |
| Configurable durations (60-minute default), buffers, prices, participants | 4 | `lesson-availability`, `booking-money` |
| Prices configurable; GST/QST calculated and shown; tax mode confirmed before public bookings | I8, 5 | `booking-money`, `booking-state`, R32 |
| Clinic capacity 10, exact spots, full means no reserve or pay | I2, I3 | `clinic-concurrency`, R11 to R14 |
| Recurring clinics and individual dates | 8 | `clinic-flow` |
| Interac only; unique reference; exact amount; reported/unpaid/manual verification; confirm genuine deposit without the button | 7 | `booking-lifecycle`, `booking-payment-verify` |
| Expired reservations and late payments handled safely; confirmed clients never displaced | I6 | `booking-late-payment`, R8, M21, M22 |
| Delayed e-Transfers, reported payments, cancellations, manual verification documented | 7.3 | E1 to E22 each map to a suite |
| Never overlap confirmed bookings, never exceed capacity | I1, I2 | the invariant checker after every test |
| Flexible packages designed but not active | I11, 11 | `booking-packages`, M36, M37 |
| No automatic import of Google bookings; audit and reconciliation first | I10, companion doc | the scan, `reconciliation` |
| One dashboard; reschedule; cancel; manual booking; blocks with safeguards; bilingual messages; downloadable clinic lists | 12, 13 | `booking-http`, `booking-emails`, `booking-roster`, browser check 7 |
| Quebec privacy | 14 | `booking-privacy` |
| Customer booking extremely simple | 3 | browser checks 1 to 3 (3 screens) |
| Website launch kept separate; booking features disabled or "coming soon" | I9, 2 | `launch-mode`, `booking-state`, M40 |
