# Private lessons and group clinics: detailed design (revision 2: lessons are paid at the lesson)

**Status: design only, on the separate branch `claude/lessons-clinics-booking`.** Nothing here has been merged,
deployed or switched on. No payment, online booking or paid service is active, and no real customer's data was used.
The only code added so far is a **tested schema sketch** (`docs/design/lessons-clinics-schema-sketch.sql`, attacked by
`npm run test:lessons-clinics-sketch`, 188 checks and 22 deliberate breakages) that proves the central database rules
work before any real migration is written. The informational website launch is on a different branch and does not depend
on any of this (`docs/WEBSITE_LAUNCH_MODE.md`).

**What changed in revision 2 (2026-10-17).** You decided that **private lessons are booked without paying in advance**:
the customer picks a time, enters their details and is **confirmed immediately**; they pay you **cash or Interac
e-Transfer at the lesson**. That removes the hold, the "I've sent my payment" step, the expiry and the late-payment case
from private lessons altogether. **Group clinics and the summer camp keep their advance-payment rules unchanged.**

Companion documents: `docs/LESSONS_AND_CLINICS_TEST_PLAN.md` (how every rule below is proven),
`docs/LESSONS_GO_LIVE_READINESS.md` (**what remains before private lessons can safely accept real bookings**),
`docs/GOOGLE_AUDIT_AND_RECONCILIATION.md` (what Google holds today and how it is reconciled, without importing),
`docs/LESSONS_AND_CLINICS_DECISIONS.md` (your decisions and what I still need), and the earlier review
`docs/LESSONS_AND_CLINICS_ARCHITECTURE.md` (superseded where it disagrees with this document).

---

## 0. Your decisions, and where they landed

| You decided | What it means in this design | Section |
| --- | --- | --- |
| **A1** separate branch; do not interfere with the website launch or the camp | Branch `claude/lessons-clinics-booking`; additive migrations only; switches default off; a test proves the camp's schema is untouched | 2 |
| **A2** clinics first, then lessons | Build order unchanged | 15 |
| **B1** configurable 60-minute slot; duration and buffers adjustable | Per-product slot (60), lesson length (55), buffer (0), start grid (60) | 4, 9 |
| **B2** prices configurable; GST/QST calculated and shown; confirm tax before public bookings | Tax mode `unset / none / added / included`; nothing can be booked while `unset` (enforced by the database); each lesson freezes its own figures | 5 |
| **C1-C3** (clinics) 12-hour holds; delayed e-Transfers, reported payments, manual verification documented; never overlap, never exceed capacity; packages off | Unchanged **for clinics**; documented in 7A | 7A, 11 |
| **G1** no Google import; audit first | Unchanged | 10, companion doc |
| **Calendar adjustment:** if Google is unavailable or stale, do not accept conflicting lessons; offer contact | Unchanged, and now also covers the owner's own changes in Google | 10 |
| **NEW 1** book without paying; **immediate confirmation** | Section 3.2, 9 | 3, 9 |
| **NEW 2** PostgreSQL prevents overlapping bookings, including simultaneous requests | The same exclusion rule, now on `lesson_bookings`; 50-click race test | 1, 9 |
| **NEW 3** a confirmed lesson must not expire merely because it is unpaid | No hold or expiry exists in the lesson table; the system cannot cancel a lesson | 1 (L1), 7B |
| **NEW 4** Google Calendar stays synchronized; never offer or confirm a conflict; outages handled safely | Two-way sync with change detection; live check at booking; fail-safe card; owner attestation when Google is down | 10 |
| **NEW 5** automatic booking email and reminders | Immediate confirmation email; 24-hour and 2-hour reminders (configurable); sent once | 13 |
| **NEW 6** mark a completed lesson Paid - Cash / Paid - Interac / Unpaid, with an audit trail | Close-out screen; database-written append-only trail | 7B, 12 |
| **NEW 7** configurable cancellation rules, proposed 24-hour notice | Settings, frozen per booking, a gate you must approve | 7B, 4 |
| **NEW 8** easy reschedule, cancel, manual add, without conflicts | One atomic, rule-checked procedure for all three | 9, 12 |
| **NEW 9** prices, taxes, durations, availability configurable | Section 4 | 4 |
| **NEW 10** keep the separate advance-payment rules for camp and clinics | Separate tables and rules; table in 1.2 | 1.2, 8 |

---

## 1. The rules that never bend

Each rule is enforced **by PostgreSQL itself** wherever possible, so a future coding mistake cannot break it, and each has
a named test in the test plan.

### 1.1 Private lessons (pay at the lesson)

| # | The rule | Enforced by | Proven by |
| --- | --- | --- | --- |
| **L1** | **A confirmed lesson never expires, lapses or is cancelled because it is unpaid.** Only a person (the customer, within the rules, or you) ends a lesson | The lesson table has **no hold, deadline or expiry column**; the status list has no `expired`; `cancelled_by` accepts only `customer` or `owner`; a code scan finds no automatic job that changes a lesson's status | A lesson booked 90 days ago and never paid is still confirmed after every sweep; `expired` and `system` are refused |
| **L2** | **No two active lessons, clinic sessions or blocks overlap** (buffers included), however many people click at once | An **exclusion constraint** on a time range (`schedule_no_overlap`) | 50 simultaneous clicks on one slot give one winner; every partial overlap refused; touching ranges allowed |
| **L3** | **Confirmation is immediate and real:** a lesson shown as confirmed holds its time until a person ends it | The booking and its occupied time are one transaction; a commit-time check refuses a lesson without its time, or a cancelled one still holding time | Raw-SQL attacks on status versus time |
| **L4** | **No lesson is accepted without a live Google Calendar check made seconds before** (or the owner's recorded attestation when Google is down) | The row must carry a check no older than 30 seconds; the application refuses first | Fake calendar slow, down, partial, erroring |
| **L5** | **Payment is recorded only by you, only for a lesson that has happened (or a fee), and every change is written to a trail by the database** | CHECKs on payment shape; "not started" guard; append-only `lesson_events` written by a trigger | Cannot pay a future lesson; raw SQL leaves a record; the trail cannot be edited |
| **L6** | **Cancellation rules are frozen into each booking**; a free cancellation owes nothing; a fee never exceeds the price | Snapshot columns; CHECKs on the amount owed | Rule changes never apply backwards; fee above price refused |
| **L7** | **Nothing is priced while the tax mode is unset, nothing opens without a confirmed cancellation policy**; money is frozen and adds up | CHECKs; the policy placeholder `unset` cannot be stored on a booking | 200,000-price property test; policy `unset` refused |
| **L8** | **Booking without prepayment is limited per contact**: a few upcoming lessons at most, and no new online bookings for someone who keeps leaving lessons unpaid. The check and the booking are one atomic step | A trigger taking one lock, inside the booking transaction | 10 simultaneous bookings by one person: exactly the allowed number succeed |

### 1.2 Which product uses which payment model (decision NEW 10)

| | Summer camp | Group clinics | Private lessons |
| --- | --- | --- | --- |
| **When the customer pays** | In advance (Interac), within the hold | In advance (Interac), within the hold | **At the lesson** (cash or Interac) |
| **Booking is confirmed** | After you verify the payment | After you verify the payment | **Immediately** |
| **Hold / deadline / expiry** | 12 hours, then released if unreported | 12 hours (3 if close), then released if unreported | **None** |
| **"I've sent my payment" button** | Yes | Yes | **No** |
| **Reported payment ever auto-released** | Never | Never | Not applicable |
| **Late payment after expiry** | Re-take only if still free, else refused | Same | Not applicable |
| **Capacity rule** | 30 per week (33 only with a written note) | 10 (more only with a written note) | One lesson per time (the exclusion rule) |
| **Tables** | `registrations` (untouched) | `clinic_bookings`, `clinic_spots` | `lesson_bookings` |
| **Who changes the money status** | You, after verifying the deposit | You, after verifying the deposit | You, after the lesson |

### 1.3 Clinics and everything shared

| # | The rule | Enforced by | Proven by |
| --- | --- | --- | --- |
| **C1** | A clinic can never hold more people than its capacity; a party is all or nothing | Spots counter trigger, a CHECK, and a commit-time recount | 100 people race for 10 spots: exactly 10 |
| **C2** | A payment a clinic customer has **reported** is never expired or released by the system | A CHECK, a legal-moves guard, and a code scan (as the camp) | Raw SQL cannot move `payment_reported` to `expired` |
| **C3** | **Paid** needs your verification of the exact amount due | A CHECK | Wrong amount refused |
| **C4** | A late clinic payment re-takes spots only if still free, all-or-nothing; otherwise refused and nothing else changes | The same rules applied inside the confirm transaction | Spot taken by a stranger: refused; free again: confirmed |
| **S1** | Nothing public opens unless every gate is satisfied | One pure function decides the public state | A table test of every combination |
| **S2** | Google never creates, changes or deletes a booking; nothing is imported automatically | No code path from Google to bookings; a source scan | Scan test; audit document |
| **S3** | A package credit can never be spent twice or below zero; packages stay inactive until you approve the rules | A counter trigger, append-only ledger, `packages_approved_at`, switch | 30 attempts on a 5-credit package: exactly 5 |
| **S4** | The camp is untouched | New tables only; `email_outbox` gets only added nullable columns and kinds, as the waiting list did | Before/after comparison of every camp object (passes) |
| **S5** | Personal data is minimal, never in Google events or logs, and can be copied or erased | Design and tests (section 14) | Privacy suite |

---

## 2. Keeping this separate from the website launch and the camp

**Three tracks, no shared deadlines.**

| Track | Branch | Opens when | Depends on this work? |
| --- | --- | --- | --- |
| Informational website | `claude/youthful-faraday-doicas` (launch) | You decide | No. It launches with camp, clinics and lessons "coming soon / call or email" |
| Summer camp | the same launch branch | Dates confirmed, rehearsal done | No |
| Clinics and lessons | `claude/lessons-clinics-booking` | Each phase, only on your approval | They are what is being built |

How the separation is kept:

1. **The separate branch is the first wall.** Nothing from this branch reaches the public website unless you tell me to merge it.
2. **Switches default to off:** `CLINICS_ENABLED`, `LESSONS_ENABLED`, `PACKAGES_ENABLED` (each must be exactly `true`). With none set, pages say "coming soon, call or email" and every booking API answers `503`. The launch-mode test runs on this branch too.
3. **Migrations are additive and numbered 009 and up.** `npm run db:migrate` applies *every* file in `db/migrations/` to whatever `DATABASE_URL` points at, so **these migrations must never be run against your real (production) database until you approve**; rehearsals use a separate Neon branch. The design sketch is deliberately outside `db/migrations/`.
4. **The old Google-based endpoints are a hazard and get switched off first (phase 0).** `/api/lesson-booking` and `/api/clinic-signup` go live by themselves the moment the old Google settings exist. On this branch they answer `503` unless `LEGACY_GOOGLE_BOOKING=true`, and the new calendar connection uses its own setting names.
5. **The public state is one decision, in one place:**

   | State | When | What the visitor sees |
   | --- | --- | --- |
   | `off` | the product's switch is not `true` | "Online booking is coming soon. Call or email Coach James." |
   | `not_ready` | switch on, but a gate is open: **tax mode unset, cancellation policy unconfirmed** (lessons), no published product, no hours, no published offering | the same "coming soon" card |
   | `open` | every gate satisfied (lessons: and the calendar is healthy) | the booking screens |
   | `paused` | lessons only: everything satisfied except the calendar cannot be verified right now | the "call or text" card (section 10); clinics stay `open` |

   Staging rehearsals add `BOOKING_PREVIEW=true` (never on the public site), which only removes the "launch date" wait; it can never bypass the tax gate, the policy gate, the calendar fail-safe or any database rule.

---

## 3. What the customer sees (kept as simple as possible)

No accounts, no passwords. Every booking has a private link. French and English throughout. **Phone first**: large tap targets,
one column, nothing that needs a mouse.

### 3.1 Reserving a clinic spot (3 screens, advance payment)

1. **`/clinics`:** one card per open clinic series: title, dates and time, place, price (with the tax wording of section 5), and "**4 spots left**" or "**Full**". Tap **Reserve**.
2. **One form:** how many people (1 to 6); each person's name; your email and phone; language; one privacy box.
3. **Your reservation page:** the exact amount, your reference (`GC-XXXXXX`), the e-Transfer address, the deadline ("pay within 12 hours") and a big **"I've sent my payment"** button. The same text arrives by email.

### 3.2 Booking a private lesson (3 screens, pay later)

1. **`/book`: pick a day and a time.** A strip of days to swipe, then big time buttons for that day; only genuinely free times appear. The price is shown as "**$126.47 including GST and QST, paid at your lesson**" (in the wording of the tax mode). If there is more than one lesson type or place, a single choice is asked first, otherwise nothing.
2. **One form:** your name, email, phone, number of people, language, one privacy box. Above the button, one plain sentence: "**Free to cancel up to 24 hours before. Pay at your lesson, cash or Interac e-Transfer.**" The button says **Confirm my lesson**.
3. **You are booked: the confirmation page, immediately.** Date, time, place with a map link, the amount and how to pay (cash, or Interac e-Transfer to the address shown with your reference `GL-XXXXXX`), **Add to my calendar**, and a **Cancel** button while cancelling is free. The same details arrive by email at once, and reminders follow.

If someone took the time a second before: "That time was just taken, please pick another", and the form is kept.
If the calendar cannot be verified: the **call or text** card (section 10). A customer never sees an error page.

**Inside the notice period** (default 24 hours) the Cancel button explains "It's less than 24 hours before your lesson, so please
call or text James" with tap-to-call and tap-to-text.

### 3.3 After booking

- **Email 1, immediately:** the confirmation (section 13).
- **Reminders:** 24 hours before and 2 hours before (you can change or switch off either).
- **At the lesson:** you pay by cash or Interac e-Transfer; **you** mark it paid afterwards (section 7B).

### 3.4 What is collected (and what is not)

Name, email, phone, language, number of people (lessons) or participants' names (clinics), and the privacy consent with the
notice version. **No health or injury information, no date of birth, no address.** If lesson customers include children, the
camp's parent-consent wording applies (decision F1).

---

## 4. What you control from the dashboard

Everything below is a setting or a record, never code. Defaults are my proposals; nothing is published until you confirm it.

| You set | Default | Notes |
| --- | --- | --- |
| **Tax mode** | **`unset` (no booking possible)** | Section 5 |
| GST and QST rates; your registration numbers | 5% and 9.975%; blank | Shown on confirmations if filled in |
| **Cancellation policy** (wording in English and French, and the version) | **`unset` (no lesson booking possible)** | You confirm it once; each change makes a new version |
| **Cancellation notice** | **24 hours** | Free cancellation (and change) up to this long before the lesson |
| Can customers cancel online? / reschedule online? | **yes / no** | Rescheduling online is a switch, off at first |
| Inside the notice period, online cancelling | **contact only** | The alternative is "allow and flag it as late" |
| Late-cancellation fee / no-show fee | **0% / 0% (proposal: 50% / 100%)** | Applied by you at close-out, never automatic; the lawyer should see the wording |
| **Lesson products** (names in English and French) | One "Private lesson" | Draft prices copied from today's website, unpublished until you confirm each |
| Appointment **slot** / lesson length shown / **buffer** / start grid | **60 / 55 / 0 / 60 minutes** | The slot is what the booking occupies |
| Participants per lesson | up to 3 | The extra-person fee is a price setting |
| **Prices by date range** (single, extra person) | Draft summer/winter from the site | Two prices for one day are impossible (database rule) |
| **Locations** and **working hours** by weekday, by date range | Golf Dorval summer, Royal Westcourt winter; Mon-Fri 9-16 | Seasonal ranges; weekends optional |
| **Blocks** (vacation, a morning, recurring) | none | A block over a booked lesson is refused until you move or cancel it |
| Notice to book / how far ahead | **24 hours / 60 days** | |
| Upcoming lessons one contact may hold | **2** | Anti-abuse (section 14) |
| Stop online booking after N unpaid lessons older than D days | **2 lessons, 7 days (0 switches it off)** | Anti-abuse; you can always add that person yourself |
| **Reminders** | **24 hours and 2 hours before** | Either can be switched off |
| **Calendar** freshness; which calendars count as busy | refresh 5 min, "stale" after 10 min | Section 10 |
| **Clinic series** | none | Generator: start date, weekday, time, weeks, capacity (10), price, place, bilingual description |
| Clinic holds | 12 hours (3 if the first session is within 48 hours) | As the camp |
| Packages | off | Section 11 |

---

## 5. Money: GST and QST (decision B2)

**Nothing is assumed.** There are four modes, and **`unset` is the starting point and blocks every public booking** (the
database will not store a booking without a mode).

| Mode | Meaning | The customer sees |
| --- | --- | --- |
| `unset` | You have not told me yet | Booking is "coming soon" |
| `none` | You do not charge GST/QST | "$110.00" and nothing about tax |
| `added` | Your advertised prices are **before** tax | "$110.00 + GST $5.50 + QST $10.97 = **$126.47**" |
| `included` | Your advertised prices **already include** tax | "$110.00 (includes GST $4.78 and QST $9.54)" |

How it behaves (proven by a 200,000-price property test):

- Tax is computed on the **pre-tax price** for both GST and QST, each **rounded half-up to the cent**. In `added` mode this gives **exactly the same cents as the camp's existing calculation** for every price from $0.00 to $2,000.00.
- In `included` mode the advertised price is the total; the system finds the pre-tax amount whose own taxes add back to it. For about **13% of prices** no exact breakdown exists; then the odd cent goes on the QST line, which stays within **1 cent** of 9.975%. The total is always exactly the advertised price. *Your accountant should confirm this convention.*
- **For a private lesson the tax lines are shown on the booking page and in the email as "to pay at your lesson"**, and frozen on the booking. A late-cancellation or no-show **fee** is recorded as one amount; how GST/QST applies to a fee is an accountant question (decision T5).
- Each product has a **tax treatment** (`taxable` or `exempt`). Exempt products never show tax.
- Examples (illustrative): $110 `added` becomes $126.47; $110 `included` splits as $95.68 + $4.78 + $9.54; $200 `added` becomes $229.95; $200 `included` splits as $173.95 + $8.70 + $17.35.

**The confirmation screens.** The dashboard shows "**Tax setting not confirmed: online bookings are off**" and "**Cancellation
policy not confirmed: online lesson bookings are off**". Each asks you to retype your choice and records who and when.

*The camp already adds tax on top of its $380 price (a rule you set in S4); this design does not change that and does not reuse its hard-coded rates: the new rates are settings.*

---

## 6. Data model

The runnable form is `docs/design/lessons-clinics-schema-sketch.sql`. In words:

```
booking_settings (one row)       booking_locations ── availability_rules (hours by weekday and date range)
lesson_products ── price_periods (prices by date range; no two for one day)

PRIVATE LESSONS (pay at the lesson)                 GROUP CLINICS (advance payment)
lesson_bookings  one row = one lesson               clinic_offerings ── clinic_sessions (each date)
   status: confirmed | completed | cancelled | no_show   clinic_bookings (reserved … paid … expired …)
   payment: unpaid | paid_cash | paid_interac           clinic_spots (one per participant; the counter)
   rules snapshot, money snapshot, calendar check
   ├── lesson_events     (append-only trail, written by a trigger)
   └── lesson_reminders  (queued once)
        │                                                    │
        └──────────── schedule_occupancy ────────────────────┘   ← the "no overlap" rule
              (a lesson, a clinic session or one of your blocks)
package_purchases ── credit_ledger  (built, off)
```

**Not yet in the sketch (to be written in phases, same style):** the calendar tables (`calendar_state`, `calendar_busy`,
`calendar_outbox`), `blocked_contacts`, `clinic_strikes`, `booking_notes`, the clinic waiting list, `contact_requests` (only if
you want a callback form), and the email link columns.

**Migrations (additive only):** `009` settings, locations, hours, products, prices; `010` occupancy and **lesson bookings** with
the guard, the trail and the contact limits; `011` clinics and the counter; `012` calendar and outbox tables; `013` the new email kinds
and the two nullable link columns on the existing `email_outbox` (as migration 008 did for the waiting list); `014` packages (created, unused).
Each is idempotent, refuses to run if its preflight finds a problem, and has a rollback file, like the camp's.

**Existing files this work will touch** (everything else is new): `src/lib/outbox.ts` and `outboxQueue.ts` (new email kinds),
`src/lib/alerts.ts` (booking alerts), `src/lib/privacyData.ts` (cover the new tables), `src/app/api/lesson-booking/route.ts` and
`clinic-signup/route.ts` (the phase 0 kill-switch), the clinics and lessons pages and their two components (replaced behind the state
of section 2), `scripts/preflight.mjs`, and the admin navigation. The camp's own modules are **not** edited, and a test keeps it so.

---

## 7A. Group clinics: a booking's life when money comes first

(The camp works the same way. This section applies to clinics only.)

| Word | Meaning | Holds the spots? |
| --- | --- | --- |
| **Reserved** | Held for the customer; awaiting payment; a clock is running | Yes |
| **Payment reported** | The customer says they sent it; **you must verify**; never released by the system | Yes |
| **Paid** | You verified the exact amount | Yes |
| **Expired** | The hold ran out unpaid and was released | No |
| **Cancelled** / **Refunded** | Cancelled by you or the customer / refund issued | No |

**Hold deadlines (decision C1):** 12 hours, or 3 hours when the first session is within 48 hours; never later than 1 hour before the
first session. After "I've sent it", a 48-hour review; **never auto-released**. You can extend an unreported hold (three times at most, with a reason).

| # | What happened | System behaviour | You see |
| --- | --- | --- | --- |
| **K1** | Pays and taps "I've sent it" | Moves to Payment reported; review clock starts | In Payments to verify, oldest first |
| **K2** | Pays but never taps and the hold runs out | Expires; spots released; release email | Nothing yet |
| **K3** | The money then arrives (found by reference, name, email, phone or **amount**) | **Confirm late payment**: re-take the same spots **only if still free**, all-or-nothing, then Paid | Success |
| **K4** | Same, but the spots were taken meanwhile | **Refused whole; nothing else changes.** Flagged "Paid but unavailable: move or refund" so it is never forgotten | Red item: move, refund, or add a spot (needs your written note) |
| **K5** | Says "sent" but nothing arrives | Stays reported; alerts escalate; **never released by the system** | Red after the review time; one click Release |
| **K6** | A delayed e-Transfer (bank hold, weekend, an unaccepted transfer) | If reported, waits safely; if not, you may extend (3 times, with a reason) | The extension button |
| **K7** | Wrong amount: too little / too much / twice / for a cancelled booking | Not confirmed (exact amount required); flagged `amount_mismatch`, `refund_due`, `duplicate` | Items to resolve |
| **K8** | Expiry and your confirmation at the same instant | One row lock decides; if expiry won, K3/K4 apply | Result of your click |
| **K9** | Customer cancels an unpaid hold / you cancel a paid booking | Spots freed at once; refund flagged for you to decide | Refund-due item |

---

## 7B. Private lessons: a booking's life when the money comes last

### 7B.1 The words

| Word | Meaning | Holds the time? |
| --- | --- | --- |
| **Confirmed** | Booked and certain. **There is no deadline.** Waits for the lesson | Yes |
| **Completed** | The lesson took place (you marked it) | Yes (it happened) |
| **No-show** | The customer did not come (you marked it) | Yes (the time was lost) |
| **Cancelled** | Cancelled by the customer (within the rules) or by you | No (freed at once) |

| Payment word | Meaning |
| --- | --- |
| **Unpaid** | Nothing recorded yet (the starting state) |
| **Paid - Cash** | You were paid in cash |
| **Paid - Interac** | You were paid by e-Transfer |

Status and payment are two separate fields: a lesson is "Completed - Unpaid" until you record the money.

### 7B.2 The cancellation rules (decision NEW 7; all configurable)

| Rule | Proposed default | What happens |
| --- | --- | --- |
| Notice | **24 hours**, counted in real elapsed hours (on the two clock-change days "the same time yesterday" differs by an hour; the page says "at least 24 hours before") | At or before the notice limit: free |
| Customer cancels in time | allowed online | Time freed at once, calendar event removed, no fee, confirmation email |
| Customer inside the notice | **contact only** (the button explains and offers call / text) | You decide whether to cancel for them, and whether to charge |
| Alternative | "allow and flag": the customer can cancel online and it is marked late | Only if you choose it |
| Late-cancellation fee | **0% until you approve** (proposal 50%) | You apply or waive it when you cancel; recorded as an amount owed |
| No-show fee | **0% until you approve** (proposal 100%) | You apply or waive it at close-out |
| You cancel | always allowed, never charged to the customer unless you choose | Customer emailed; you are offered a list of people to contact |
| Customer reschedules online | **off** (switch) | When on: same notice rule, same atomic move |
| Terms frozen at booking | always | A change of rules never applies to lessons already booked |
| Wording shown to the customer | the policy you confirmed, English and French, with its version | Displayed on the booking page, in the email and on the booking page |

The 50% / 100% figures are **proposals, not defaults**: they stay at 0% until you approve them, and the wording goes to the
Quebec lawyer with the other consumer-protection questions.

### 7B.3 Every awkward case

| # | What happened | System behaviour | The customer sees | You see |
| --- | --- | --- | --- | --- |
| **P1** | Books; Google reachable and free | **Confirmed in one transaction**; confirmation email queued in the same transaction | The confirmation page and email | A new lesson (and, if you wish, a notice) |
| **P2** | Two customers choose the same time at once | The database lets one in; the other is told it was just taken, nothing saved | "Just taken, pick another" | Nothing |
| **P3** | Google cannot be verified at booking | **Refused; nothing saved** | The call-or-text card | Alert if it lasts |
| **P4** | Google shows the time busy | Refused as "no longer free" | "Pick another time" | Nothing |
| **P5** | Double click / retry | One idempotency key: one lesson, one reference | The same page | One lesson |
| **P6** | The confirmation email fails | The lesson is still confirmed; the email waits in the outbox and is retried | They already saw the confirmation page | A badge if overdue |
| **P7** | The customer mistyped their email | They saw the confirmation page; reminders go astray | A spelling hint at entry for common mistakes | You can correct the email (the trail records that it changed, not the value); the phone number reaches them |
| **P8** | Never pays | **Nothing happens by itself.** The lesson stays confirmed; after it passes it waits for you to close it out | n/a | Appears in "Close out" |
| **P9** | Customer cancels at or before the notice limit | Free; freed time; event removed | Confirmation | Notice (optional) |
| **P10** | Customer tries to cancel inside the notice | Online cancel closed; "please call or text" | The message | Nothing |
| **P11** | You cancel for them inside the notice | You choose **apply the fee** (computed from the frozen terms, amount editable down to 0 with a note) or **waive** | Cancellation email | Amount owed recorded if you applied a fee |
| **P12** | You cancel (illness, rain, course closed) | Cancelled, no fee; the affected people are listed so you can contact or rebook them | Cancellation email | A list to work through |
| **P13** | You reschedule | One atomic move: the new time must pass the same availability, overlap and calendar checks; payment and terms unchanged | Reschedule email, new reminders | Done |
| **P14** | The lesson time passes with nothing recorded | **Not closed automatically.** It sits in "Close out" | n/a | Prompt, oldest first |
| **P15** | You mark it Completed and Paid - Cash at the course | One step; the amount owed is recorded as paid; the trail records who and when | n/a | Done |
| **P16** | Completed but unpaid; the e-Transfer arrives later | Record Paid - Interac later (search by reference, name or amount); optional bank reference | n/a | Done |
| **P17** | Customer pays a different amount | You record the amount and **must write why**; the owed amount stays the price | n/a | Done |
| **P18** | Marked paid by mistake | Set back to Unpaid **with a written reason**; the history keeps both | n/a | Trail shows both |
| **P19** | No-show | Marked No-show; fee per the frozen terms if you apply one; counts toward the unpaid limit if money is owed and unpaid | n/a | Amount owed |
| **P20** | Someone books, no-shows, and rebooks again | After the allowed number of unpaid lessons older than the grace period, online booking is closed for that contact; you can still add them yourself | The call-or-text card | A flagged contact |
| **P21** | A fake booking to block your day (no payment to deter it) | Limits per contact, rate limits, honeypot, optional free bot check; you cancel in one click and may block the contact | Nothing | A flagged, unrecognised first-time booking |
| **P22** | You book a customer by phone | Same rules; optional email; `owner` recorded; the calendar attestation applies only if Google is down | Confirmation email if you gave one | Done |
| **P23** | Daylight saving day | Times come from the wall clock, not "+24 hours" | Right time | Right time |
| **P24** | A customer asks to be erased | Contact details anonymised; the money rows and any outstanding amount are kept until resolved | n/a | A confirmation |
| **P25** | Refund after paying | Done outside the system (cash or e-Transfer back); you set Unpaid with the reason | n/a | The trail |

### 7B.4 The audit trail

`lesson_events` is written by the database whenever a lesson is created, its status or owed amount changes, its payment
changes, it is moved, or its contact details are edited. Each row has the **time, who acted (owner / customer / system),
what changed (old and new values) and your note**. It holds **no names, emails or phone numbers** (a contact edit records only
which fields changed), and it **cannot be edited, deleted or truncated**. The application states who is acting for every change; a
change that does not is recorded as "unknown", which the tests treat as a defect and your dashboard would show. A change made by raw
SQL is therefore still recorded.

---

## 8. Group clinics (built first)

- A **clinic offering** is a series (for example May: four Saturdays, 9:30 to 11:00) or a single date. Sessions are **generated** from "start date, weekday, time, number of weeks" and stored as explicit dated rows, so one date can be cancelled or moved without touching the rest. Each session occupies your coach time, so a lesson cannot be sold on top of it.
- A person reserves a **whole series** (one price) by default; joining after it has started, or buying a single session, is decision **G2**.
- **Reserving** is one transaction: the booking, then one spot per participant. The counter trigger refuses any spot beyond capacity; the whole party is accepted or refused together. Capacity defaults to **10**; raising it needs a written note.
- **Full** shows instantly and the booking button disappears. The displayed count is advice only; the database decides.
- **Rosters** download like the camp's: Excel or CSV, per series or date, **full** or **sign-in sheet**, recent password, CONFIDENTIAL names, logged without personal details.
- The **waiting list** built for the camp can be reused for clinics (it never holds or assigns anything).
- A **session cancelled** by you notifies everyone booked and flags a decision; nothing refunds automatically.

---

## 9. Private lessons: availability and booking

### 9.1 What is offered

For a chosen date, the offered start times satisfy **all** of:

1. inside that weekday's working hours at the location, in its season;
2. on the product's start grid (default every 60 minutes);
3. at least the notice period away and within the horizon;
4. **not overlapping** any lesson (with its buffer), clinic session or block of yours (database truth);
5. not overlapping a busy time on your calendars, and only while the calendar is verifiably healthy (section 10).

All times are computed in Montreal local time; an hour that does not exist (2:30 a.m. in March) is never offered. **The list is
advice. The booking is decided only by the database rule at the moment of booking.**

### 9.2 Booking (the order matters)

```
1  validate input; check the public state (section 2), rate limits and the honeypot
2  LIVE calendar check (3-second limit) over the requested time           ← outside any database lock
      cannot be verified → STOP: show the call-or-text card; nothing is written
      busy in the window → "that time is no longer free"
3  BEGIN
4    the contact check and the lesson row (one lock, one transaction):
         too many upcoming lessons, or too many unpaid → refused
5    INSERT lesson_bookings   (status confirmed; money and cancellation terms frozen; calendar check recorded)
6    INSERT schedule_occupancy                     ← the exclusion constraint decides here (23P01 = just taken)
7    queue the confirmation email, the reminders' first due time, the calendar write, in the same transaction
8  COMMIT         the customer sees "You are booked" only after this succeeds
```

A personal event you happen to add in Google between steps 2 and 8 (a fraction of a second) cannot be prevented, only noticed afterwards
(section 10.5); it never cancels or moves anyone.

### 9.3 The rest

- **Participants** 1 to the maximum; price = lesson price + the extra-person fee per additional person; the lesson takes the whole slot.
- **Reschedule** (you; the customer only if you switch it on): one atomic move, same checks, same trail, new reminders. Moving into a time that conflicts is refused and nothing changes.
- **Cancel:** section 7B.
- **Block time:** if a block would cover a booked lesson you are shown the lessons first; the database refuses the block until you move or cancel them.
- **Manual add** (a customer phones you): the same reservation transaction with `owner` recorded, optional email, optional weekly repeat (each lesson is its own lesson afterwards). You can never add on top of another lesson or a block, and you cannot add into a time Google shows busy; the one exception is a **recorded attestation** that you checked your calendar yourself **when Google cannot be reached**.
- **Weekly standing lessons** are created by you (not online), as separate lessons booked together, all or nothing.

---

## 10. Google Calendar: an integration, never the record

### 10.1 The policy

> **If the calendar cannot be verified right now, the system does not accept a private-lesson booking that could conflict with your
> own schedule.** It says so plainly and offers the customer your phone, text and email.

It applies **only to private lessons**. Clinics do not depend on Google. Anything already confirmed stays confirmed: the database is the record.

### 10.2 Two connections, least privilege (recommended)

| | Purpose | Google access you give | Setting names |
| --- | --- | --- | --- |
| **Busy calendars** | Your personal, work or family calendars: "am I busy then?" | **"See only free/busy"** (the system cannot read titles or details) | `BOOKING_BUSY_CALENDAR_IDS` |
| **Bookings calendar** | A calendar the system writes your lessons and clinic sessions into, which you subscribe to on your phone | "Make changes to events", on this one calendar only | `BOOKING_CALENDAR_ID` |

New setting names mean setting them cannot wake the old routes. If you prefer a single calendar it works, but conflict detection becomes a heuristic (decision E5).

### 10.3 Freshness and what counts as "unavailable"

Availability is read into a small cache (**refreshed at most every 5 minutes**, by whoever asks first), judged by the database's clock:

| State | Definition | Browsing lessons | Booking a lesson |
| --- | --- | --- | --- |
| `ok` | last good refresh within **10 minutes** and covers the dates shown | times shown | live check decides |
| `refreshing` | a refresh is running | cached times shown | live check decides |
| `stale` | no good refresh for more than 10 minutes, or the cache does not cover the dates | **no times shown**; the call-or-text card | **refused** |
| `down` | the last attempts failed (timeout, quota, credentials, calendar not shared) | the call-or-text card | **refused** |
| `not_configured` | no calendar settings | "coming soon" card | refused |

Treated as unavailable (never as "no events"): HTTP errors and timeouts, rate limiting, expired credentials, a response that carries an error for the
calendar (Google's documentation describes a per-calendar `errors` list inside an otherwise successful answer; **the current code ignores it and reads
it as "completely free"**: reproduced with a simulated answer, finding F1 in the audit; whether Google really answers that way is confirmed in the rehearsal),
a response for fewer calendars than asked, an unparseable body, or a refresh older than the threshold. Any one failing calendar makes the whole answer unavailable.

### 10.4 At the moment of booking

Always a **live** check of the requested time, not the cache. Only a successful, complete answer lets the booking proceed. The success is recorded on
the booking and **the database refuses a customer lesson whose check is missing or more than 30 seconds old**. There is no "allow and flag" path for the public.

### 10.5 Staying synchronized, both ways

**You to Google (outbound):** when a lesson is confirmed, an event is queued in the Bookings calendar with an id derived from the booking (a retry can never duplicate it). A
reschedule updates it; a cancellation removes it. Events carry the **reference, first name and last initial, lesson type and place, no phone or email**. A failed write is retried; after
repeated failure you see a "not on calendar yet" badge with a retry button, and the booking stays valid.

**Google to you (inbound), nothing automatic:**

| What happens in Google | The system does | You see |
| --- | --- | --- |
| You add a personal event on a **free** time | That time stops being offered at the next refresh (about 5 minutes) | nothing to do |
| You add a personal event **over a confirmed lesson** | **Nothing is cancelled or moved.** Conflict flagged | "Calendar conflict": move the lesson, or keep both |
| You **move or delete one of our events** in the Bookings calendar | The booking is unchanged (the database is the record) | "Calendar changed outside the dashboard": **Apply to the booking** (an ordinary checked reschedule or cancel, with the usual emails) or **Restore the event** |
| You **add an entry by hand** in the Bookings calendar | Treated as busy (never offered, never double-booked) | "Unrecognised calendar entry": enter it as a lesson if you want reminders and payment tracking |
| Our event for a cancelled lesson is still there | Ignored for availability (the database decides); deletion retried | "Orphan event" until removed |
| All-day events | Counted only if Google marks them busy. Vacations belong in **Blocks** | The audit lists "free" all-day events |

**Outages (decision NEW 4):**

| Outage | Customers | Existing lessons | You |
| --- | --- | --- | --- |
| Google unreachable or stale | **Booking paused**: call-or-text card; clinics unaffected | Stay confirmed; cancelling still works; emails and reminders continue | Red line, alert email; you may still add a lesson by phone, **ticking "I have checked my calendar"** (recorded) |
| Google back | Times reappear at the next refresh | Pending event writes are retried; lessons booked during the outage under your attestation are checked against the calendar and conflicts flagged | A short "back to normal" notice |
| Calendar not shared / key expired | as above | as above | Health line says why |
| Event write keeps failing | none | Valid; "not on calendar yet" | Retry button; alert after N failures |

### 10.6 What the customer sees when paused

> **Online lesson booking is paused for a moment.**
> To be sure we never double-book your time, please call or text Coach James at **514-816-3454** or email **jamesdeanladeroute@gmail.com**, and we'll find you a time.

> **La réservation en ligne des leçons est momentanément suspendue.**
> Pour éviter toute double réservation, appelez ou textez le coach James au **514-816-3454** ou écrivez à **jamesdeanladeroute@gmail.com**, et nous trouverons une heure qui vous convient.

Tap-to-call, tap-to-text and an email link that pre-fills the time chosen. An optional "ask James to call me" form is **off** unless you want it (decision E6).

### 10.7 Reading versus writing, and never importing

- The inbound connection requests only the free/busy permission (and the event listing of the Bookings calendar); the outbound one only the event permission.
- No code reads the Google Sheet to create or change a booking, and no code turns a Google event into a booking by itself. Old bookings that exist only in Google are handled by **reconciliation you review** (companion document).
- Google is mocked in every test by a fake that can be slow, down, partial, wrong, or changing between calls.

---

## 11. Lesson packages (built, but off)

Flexible credits, **inactive until you approve the rules.** This is the one place a lesson could be **paid in advance** (the package is bought by Interac like a clinic), so
it does not conflict with "no prepayment" for ordinary lessons, which stay pay-at-the-lesson.

**What "off" means technically (three independent locks):** `PACKAGES_ENABLED` is not `true`; `packages_approved_at` is empty (the database refuses to spend a credit without a rules
version); no package product is published.

**The mechanism** (tested in the sketch): you sell N lessons; the customer pays by Interac in advance; once you verify, they have N credits. A lesson booked with a credit is confirmed at
once, one credit is spent in the same transaction (the counter refuses the last credit being spent twice), and a cancellation that earns the credit back adds a ledger row. The ledger is append-only. Tax is charged when the package is bought.

**Proposed rules, for your approval (none active):** packs of 3 and 5 at today's prices; a credit buys one standard lesson for one person; the purchaser's email only, not transferable; validity and refunds **decided with the lawyer** (Quebec rules on prepaid services may limit expiry dates and say what is owed if lessons stop); a credit is returned if the customer cancels in time or if you cancel; a no-show uses the credit.

---

## 12. The dashboard: one place (phone first)

A new **Bookings** area next to the camp's, in English. The camp screens are unchanged. Everything works on a phone at the course.

| Part | What it does |
| --- | --- |
| **Close out** *(top of the page; your daily routine)* | Lessons whose time has passed and are still "confirmed", oldest first, each with four big buttons: **Completed - Paid Cash**, **Completed - Paid Interac**, **Completed - Unpaid**, **No-show**. A different amount asks for a note. Nothing is closed automatically |
| **Unpaid lessons** | Completed or no-show lessons with money owed: **Paid - Cash / Paid - Interac** in one tap; bank reference optional; search by reference, name, email, phone or **amount** |
| **Today / next 7 days** | Lessons and clinic sessions in order, with the customer's phone number one tap away |
| **Needs attention** | Clinic payments to verify and holds ending, **calendar conflicts**, **calendar changed outside the dashboard**, **not on calendar**, **calendar paused**, **tax or policy not confirmed**, **emails not sent**, flagged contacts |
| **A lesson** | Timeline from the trail (who, what, when, why) and the actions: **Move**, **Cancel** (apply or waive the fee; tell the customer or not), **Close out**, **Set payment**, **Correct contact details**, **Add note** |
| **Manual add** | Date and time from the valid times; customer by phone; email optional; weekly repeat optional; conflicts are impossible; the calendar attestation only if Google is down |
| **Blocks** | Date, hours or recurring; affected lessons listed before you can proceed |
| **Clinics** | Create a series (generator), publish, rosters, cancel a session; payment verification as in 7A |
| **Settings** | Everything in section 4, the tax and policy confirmations, the switches shown read-only |
| **Calendar health** | Last refresh, last error, pending writes, "refresh now" |
| **Money summary** | Paid by cash and by Interac, and unpaid, for a period (CSV later) |

Reused as they are: the login, the password re-check for sensitive actions, request guards and rate limits, same-origin checks, the audit log and the alert ladder.

---

## 13. Bilingual messages and reminders

Every customer message is written at send time in the language they chose, through the same outbox that makes the camp's emails resilient
(written in the same transaction as the reason for them; retried; sent once).

| Email | When | Notes |
| --- | --- | --- |
| **Lesson confirmation** | immediately on booking | Date, time, place and map, amount with the tax lines "to pay at your lesson", how to pay (cash, or Interac e-Transfer to the address with the reference), the cancellation policy and its notice, **Add to calendar**, the cancel link |
| **Reminder** | 24 hours and 2 hours before (settings) | Only for a lesson still confirmed; a lesson booked inside the window gets only the remaining reminder; a moved lesson earns new ones; each sent once |
| Cancelled by the customer | on cancelling | Confirms no charge, or the fee |
| Cancelled by you | on cancelling | Apology, offer to rebook |
| Rescheduled | on moving | Old and new time |
| Receipt *(optional, off)* | when you mark Paid | Tax lines and your registration numbers once you supply them |
| Your alerts | new lesson (optional), lessons to close out (daily), calendar paused / conflict / changed / not on calendar, emails failing | English; "reply in French" for French customers |
| Clinic emails | as the camp | Instructions, reminder before the hold ends, release, confirmation |

**Reminders are only as punctual as the scheduler.** The camp's scheduler decision now matters more: a 24-hour and a 2-hour reminder are time-sensitive. If a run is
late, the reminder goes out when it next runs (it is never skipped while the lesson is still ahead), and a reminder never goes out twice. New French wording joins
the list for the Quebec lawyer.

---

## 14. Privacy, security and abuse

| Data | Where | Kept | Erased / copied |
| --- | --- | --- | --- |
| Name, email, phone, language, consent and notice version | `lesson_bookings`, `clinic_bookings` | The retention you choose (proposal 90 days after the last lesson); **an unpaid amount keeps its record until paid or you resolve it** | Included in a customer's **copy** and **erasing** (anonymised in place; money and the trail stay) |
| The trail | `lesson_events` | With the money record | **Holds no personal data** |
| Calendar events | Google | reference, first name and last initial, lesson type, place; **no phone or email** | Deleted when a lesson is erased |
| Free/busy cache | `calendar_busy` | spans only | n/a |
| Emails | outbox | rows only; bodies built at send time | cascaded |
| Logs | server | no personal details | n/a |

**Security:** private links are long, random and signed; the page needs no login and shows only that booking; cancel is a POST with the same-origin check; every admin route is behind the login; money changes need the owner's session; rate limits and the booking limits stop cheap abuse; a CAPTCHA is not in v1.

**Abuse when nobody pays up front** (decision NEW, the main new risk of booking without prepayment):

| Control | Default |
| --- | --- |
| At most N upcoming lessons per person (email or phone, however written) | **2** (the owner is exempt) |
| No new online booking after N unpaid lessons older than D days | **2 and 7 days** (0 = off) |
| Notice to book / how far ahead | 24 hours / 60 days |
| Rate limits per connection; honeypot field | on |
| Optional free bot check (Cloudflare Turnstile) | **off**; a switch if bots appear |
| A blocked-contacts list you control | empty |
| One-click cancel of a suspicious lesson; first-time customers flagged in the dashboard | on |
| Optional "confirm your email within a few hours or the booking is cancelled" | **off**; I recommend against it (it reintroduces expiry), but it exists as a lever if fake bookings become a problem |

**Not collected:** health, injuries, date of birth.

---

## 15. Build plan with approval gates

Nothing past phase 0 is started without your go-ahead. Each phase ends with its tests green, the camp and launch-mode tests still green, a demo on a throwaway
database and a short report. **What remains before real online lesson bookings is in `docs/LESSONS_GO_LIVE_READINESS.md`.**

| Phase | What you get | Needs from you before | Rough effort |
| --- | --- | --- | --- |
| **0. Foundations** (no public effect) | Kill-switch on the old Google routes; settings and the public-state function; migration 009; "coming soon" states; tests | Approval of this design | 1-2 days |
| **G0. Google audit** (parallel, needs you) | Read-only inventory of what exists in Google | Your go-ahead and access | half a day |
| **1. Clinics** | Offerings, spots counter, reservation and payment pages, bilingual emails, rosters, dashboard, drills | Tax mode, prices, G2-G4 | 4-5 days |
| **2. Lessons core** | Hours, locations, blocks, products, the no-overlap rule, availability, **booking with immediate confirmation**, **cancellation rules**, close-out and payment trail, reschedule, manual add, contact limits, reminders queue; calendar still simulated | B3-B5, the policy wording, hours | 6-7 days |
| **3. Google Calendar** | The two connections, live check, outbound events, **change detection**, conflicts, health panel, alerts | G0 results, calendar ids, your sharing settings | 4 days |
| **4. One dashboard, reminders, privacy** | Combined queue and search, Today list, reminders sent, privacy notice extended, lawyer's list | Scheduler decision | 3 days |
| **5. Staging rehearsal** | Real Gmail, Neon, calendar, made-up customers; the drills for these products | Your accounts and approval | an afternoon of yours |
| **6. Packages** (optional, off) | Credits behind their three locks | Your approved rules and the lawyer | 2 days |

Opening a feature to the public is never a phase: it is a separate step you approve after the rehearsal, by setting the switch.

---

## 16. What I could not verify

- **`btree_gist` on your actual Neon project.** Neon lists it as supported and it works on the local PostgreSQL 16 used by the tests; the first step of the rehearsal is `CREATE EXTENSION btree_gist` on your Neon branch. Fallback: a per-day row lock, tested the same way.
- **Google's real behaviour** (the per-calendar `errors` answer, all-day "free" events, rate limits, the largest window one request accepts, whether event edits are detectable as designed). Each is handled as "unavailable" or flagged; the rehearsal checks them against your calendar.
- **The tax and consumer-protection rules themselves.** The arithmetic is tested; what is taxable, how a cancellation fee is taxed, what a receipt must show, whether and how a cancellation fee may be charged to consumers, and how prices must be advertised are for your accountant and the Quebec lawyer.
- **How customers behave when nobody pays up front** (fake bookings, no-shows). The limits are my reasoned starting point; real data will say whether they need tuning.
- **Scheduler punctuality in production**, which decides how on time the reminders are.
