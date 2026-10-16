# Private lessons and group clinics: detailed design

**Status: design only, on the separate branch `claude/lessons-clinics-booking`.** Nothing here has been merged,
deployed or switched on. No payment, online booking or paid service is active, and no real customer's data was used.
The only code added so far is a **tested schema sketch** (`docs/design/lessons-clinics-schema-sketch.sql`, attacked by
`npm run test:lessons-clinics-sketch`, 96 checks) that proves the central database rules work before any real
migration is written. The informational website launch is on a different branch and does not depend on any of this
(`docs/WEBSITE_LAUNCH_MODE.md`).

Companion documents: `docs/LESSONS_AND_CLINICS_TEST_PLAN.md` (how every rule below is proven),
`docs/GOOGLE_AUDIT_AND_RECONCILIATION.md` (what Google holds today and how it is reconciled, without importing),
`docs/LESSONS_AND_CLINICS_DECISIONS.md` (your decisions, and what I still need), and the earlier review
`docs/LESSONS_AND_CLINICS_ARCHITECTURE.md` (superseded where it disagrees with this document).

---

## 0. Your decisions, and where they landed

| You decided | What it means in this design | Section |
| --- | --- | --- |
| **A1** separate branch; do not interfere with the website launch or the camp | Branch `claude/lessons-clinics-booking`; additive migrations only; flags default off; a test proves the camp's schema is untouched and the launch-mode test still passes | 2 |
| **A2** clinics first, then lessons | Phase 1 clinics, phase 2 lessons core, phase 3 calendar, phase 4 dashboard and polish | 15 |
| **B1** configurable 60-minute slot as the default; duration and buffers adjustable | Per-product slot, lesson length, buffer and start step; defaults 60 / 55 / 0 / 60 | 4, 9 |
| **B2** all prices configurable; GST/QST calculated and shown; do not assume tax is included; confirm with you before public bookings | Tax mode `unset / none / added / included`; **nothing can be booked while it is `unset`** (enforced by the database); one confirmation screen; every booking freezes its own tax figures | 5 |
| **C1-C3** short lesson holds, 12-hour clinic holds; document delayed e-Transfers etc.; never overlap, never exceed capacity; flexible packages designed but **not active** until you approve the rules | Section 7 (every edge case); I1-I3; section 11 | 7, 11 |
| **G1** no automatic import of Google bookings; audit first, then a safe reconciliation plan | Nothing reads Google Sheets; no booking is ever created from Google; audit and plan in their own document | 10, companion doc |
| **Adjustment:** if Google Calendar availability is unavailable or stale, **do not accept** possibly conflicting lesson bookings; fail safe and offer a way to contact you | Lessons require a live calendar check at the moment of reserving, recorded in the booking and enforced by the database; the page switches to a "call or text" card; clinics are unaffected | 10 |
| Keep the customer's booking **extremely simple**; reuse PostgreSQL protection, Interac verification, bilingual messaging, the dashboard | Three screens for a customer; one queue for you; the camp's mechanisms copied, not reinvented | 3, 12 |
| Do not merge, deploy or activate without explicit approval; website launch stays separate | Every phase ends at an approval gate; the launch modes are tested | 2, 15 |

---

## 1. The rules that never bend

Each rule is enforced **by PostgreSQL itself** wherever possible, so a future coding mistake cannot break it, and each
has a named test in the test plan.

| # | The rule | Enforced by | Proven by |
| --- | --- | --- | --- |
| **I1** | No two active bookings, clinic sessions or your own blocks may occupy overlapping coach time (buffers included) | An **exclusion constraint** on a time range (`schedule_no_overlap`) | 50 simultaneous clicks on one slot give one winner; every partial overlap refused; touching ranges allowed |
| **I2** | A clinic can never hold more people than its capacity | A spots counter maintained by a trigger, a CHECK, and a commit-time recount | 100 people race for 10 spots: exactly 10 get one |
| **I3** | A party of participants and a weekly series are **all or nothing** | One transaction; the commit-time check refuses a booking that does not hold everything it should | A trio refused when 2 spots remain; a 4-week series with week 3 taken books nothing |
| **I4** | A payment the customer has **reported** is never expired or released by the system | A CHECK, a legal-moves guard, and a code scan (as in the camp) | Raw SQL cannot move `payment_reported` to `expired` |
| **I5** | **Paid** exists only after you verify the exact amount due | A CHECK on the booking | Wrong amount refused; no verification refused |
| **I6** | A late payment never displaces anyone: the time or spots are taken back **only if still free**, all-or-nothing; otherwise it is refused, nothing else changes, and it waits for your decision | The same rules (I1, I2) applied inside the confirm transaction | Time re-taken by a stranger: late confirm refused, both bookings unchanged; free again: confirm works |
| **I7** | **No private lesson is reserved without a live Google Calendar check made seconds before.** If Google cannot be checked, the booking is refused and the customer is offered a way to contact you | The booking row must carry a calendar check no older than 30 seconds (a CHECK); the application refuses first; a test with a fake calendar that is slow, down, or half-answering | Section 10 and the calendar rows of the race matrix |
| **I8** | Nothing is priced while the tax mode is `unset`; a booking's money is frozen at booking time; subtotal + GST + QST always equals the total | CHECKs; the tax mode cannot be stored as `unset` on a booking | 200,000-price property test; unset refused |
| **I9** | Nothing public opens unless **every** gate is satisfied (feature switch, tax confirmed, product published, hours set, calendar healthy for lessons) | One pure function decides the public state; every API and page asks it | A table test of every combination |
| **I10** | Google never creates, changes or deletes a booking, and nothing is imported from Google automatically | No code path from Google data to the bookings tables; a source scan | Scan test; audit document |
| **I11** | A package credit can never be spent twice or below zero, and packages stay inactive until you approve the rules | A counter trigger (like the clinic spots), append-only ledger, `packages_approved_at`, switch | 30 attempts on a 5-credit package: exactly 5 succeed |
| **I12** | The camp is untouched | New tables only; the one shared table (`email_outbox`) gets only an added nullable column and more allowed kinds, as the waiting list did | A before/after comparison of every camp table, constraint, trigger, index and function (passes today) |
| **I13** | Personal data is minimal, never in Google events or logs, and can be copied or erased | Design and tests (section 14) | Privacy suite for the new tables |

---

## 2. Keeping this separate from the website launch and the camp

**Three tracks, three branches of work, no shared deadlines.**

| Track | Branch | Opens when | Depends on this work? |
| --- | --- | --- | --- |
| Informational website | `claude/youthful-faraday-doicas` (launch) | You decide | No. It launches with camp, clinics and lessons "coming soon / call or email" (`docs/WEBSITE_LAUNCH_MODE.md`, 24 checks) |
| Summer camp | the same launch branch | Dates confirmed, rehearsal done | No |
| Clinics and lessons | `claude/lessons-clinics-booking` | Each phase, only on your approval | They are the thing being built |

How the separation is kept:

1. **The separate branch is the first wall.** Nothing from this branch reaches the public website unless you tell me to
   merge it. The launch branch has no lessons/clinics code beyond today's Google-based forms.
2. **Switches default to off:** `CLINICS_ENABLED`, `LESSONS_ENABLED`, `PACKAGES_ENABLED` (each must be exactly `true`).
   With none set, this branch behaves like the launch branch: pages say "coming soon, call or email" and every booking
   API answers `503`. The launch-mode test runs on this branch too, and the schema-untouched test runs with it.
3. **Migrations are additive and numbered 009 and up.** `npm run db:migrate` applies *every* file in `db/migrations/`
   to whatever database `DATABASE_URL` points at, so **these migrations must never be run against your real
   (production) Neon database until you approve**: rehearsals use a separate Neon branch. The design sketch is
   deliberately outside `db/migrations/`.
4. **The old Google-based endpoints are a hazard and get switched off first (phase 0).** Today `/api/lesson-booking`
   and `/api/clinic-signup` go live **by themselves** the moment the Google settings exist. The new calendar connection
   needs Google settings too, so on this branch those two old routes answer `503` unless a deliberate
   `LEGACY_GOOGLE_BOOKING=true` is set, and the new connection uses its own setting names (section 10) so setting it
   cannot wake the old routes. *I recommend porting that small guard to the launch branch as well; it needs your
   say-so because it touches the launch branch (decision R1).*
5. **The public state is one decision, in one place:**

   | State | When | What the visitor sees |
   | --- | --- | --- |
   | `off` | the product's switch is not `true` | "Online booking is coming soon. Call or email Coach James." (today's card) |
   | `not_ready` | switch on, but a gate is open: tax mode `unset`, no published product, no working hours or no published offering | the same "coming soon" card (nobody can book, nobody sees a half-built page) |
   | `open` | every gate satisfied (lessons: and the calendar is healthy) | the booking screens |
   | `paused` | lessons only: everything satisfied except the calendar cannot be verified right now | the "call or text" card (section 10); clinics stay `open` |

   Staging rehearsals add `BOOKING_PREVIEW=true` (never on the public site, like `SEASON_PREVIEW`), which only
   removes the "launch date" wait; it can never bypass the tax gate, the calendar fail-safe or any database rule.

---

## 3. What the customer sees (kept as simple as possible)

No accounts, no passwords, nothing to remember. Every booking has a private link. French and English throughout.

### 3.1 Reserving a clinic spot (3 screens)

1. **`/clinics`:** one card per open clinic series: title, dates and time, place, price (with the tax wording of
   section 5), and "**4 spots left**" or "**Full**". Tap **Reserve**.
2. **One form:** how many people (1 to 6, default 1); each person's name; your email and phone; language; one
   privacy box. The first name is pre-filled from your own if you are the participant.
3. **Your reservation page:** the exact amount, your reference (`GC-XXXXXX`), the e-Transfer address, the deadline
   ("pay within 12 hours"), and a big **"I've sent my payment"** button. The same text arrives by email.

If the clinic is full, the card says **Full** and offers the waiting list (if you enable it) or your phone and email;
it cannot be reserved or paid.

### 3.2 Booking a private lesson (3 screens)

1. **`/book`:** pick a day, then a time (only free times are shown; the lesson type and place are asked only if there
   is more than one choice). Optionally "repeat every week" for 2, 4, 6, 8 or 12 weeks.
2. **One form:** your name, email, phone, number of people, language, one privacy box.
3. **Your reservation page:** exactly as for a clinic (reference `GL-XXXXXX`, amount, deadline of 3 hours or 1 hour,
   "I've sent my payment").

If someone else takes the time first: "That time was just taken, please pick another" and the form is kept.
If the calendar cannot be verified: the **call or text** card (section 10). You never see an error page.

### 3.3 After payment

You verify the deposit (usually the daily two-minute routine you already know). The customer gets a **confirmation
email** in their language; lessons and clinics also get a **reminder 24 hours before**. A paid lesson appears on your
phone calendar.

### 3.4 What is collected (and what is not)

Name, email, phone, language, participants' names (clinics) or the count (lessons), and the privacy consent with the
version of the notice. **No health or injury information, no date of birth, no address** (decision F2 is still
yours, but this keeps the stricter health-consent rules out of scope). If lesson customers include children, the
camp's parent-consent wording applies (decision F1).

---

## 4. What you control from the dashboard

Everything below is a setting or a record, never code. Defaults are my proposals; nothing is published until you
open and confirm it.

| You set | Default | Notes |
| --- | --- | --- |
| **Tax mode** | **`unset` (no booking is possible)** | Section 5. The one gate you must open before the public can book |
| GST and QST rates; your registration numbers | 5% and 9.975%; blank | Shown on confirmations if filled in |
| **Lesson products** (name in English and French) | One "Private lesson" | Draft prices copied from today's website, unpublished until you confirm each |
| Appointment **slot** | **60 minutes** | What the booking occupies on your schedule |
| Lesson length shown to customers | 55 minutes | Wording only; must fit inside the slot |
| **Buffer** after a lesson | 0 minutes | Extra clear time (travel, changeover); part of the occupied time |
| Start-time grid | 60 minutes | 30 would offer half-hour starts but can fragment a day |
| Participants per lesson | up to 3 | Extra-person fee is a price setting |
| **Prices by date range** (single, extra person) | Draft summer/winter from the site | Two prices for one day are impossible (database rule) |
| **Locations** and **working hours** per weekday, by date range | Golf Dorval summer, Royal Westcourt winter; Mon-Fri 9-16 (today's hours) | Seasonal ranges; weekends optional |
| **Blocks** (vacation, a morning, recurring) | none | If a block would cover a booking you are shown the bookings first and must deal with them |
| Notice and horizon | 24 hours, 60 days | |
| **Holds** | lesson 3 h (1 h if within 48 h); series 6 h; clinic 12 h (3 h if within 48 h) | Section 7 |
| Open holds allowed per person | 2 | Anti-abuse |
| **Clinic series** | none | Generator: start date, weekday, time, number of weeks, capacity (10), price, place, English/French description |
| Clinic capacity above 10 | needs a written note | As the camp's 30 to 33 rule |
| Calendar freshness | refresh 5 min, "stale" after 10 min | Section 10 |
| Packages | off | Section 11 |

---

## 5. Money: GST and QST (decision B2)

**Nothing is assumed.** The system has four modes, and **`unset` is the starting point and blocks every public booking**
(the database will not store a booking without a mode).

| Mode | Meaning | The customer sees |
| --- | --- | --- |
| `unset` | You have not told me yet | Booking is "coming soon" |
| `none` | You do not charge GST/QST (for example a small supplier) | "$110.00" and nothing about tax |
| `added` | Your advertised prices are **before** tax | "$110.00 + GST $5.50 + QST $10.97 = **$126.47**" |
| `included` | Your advertised prices **already include** tax | "$110.00 (includes GST $4.78 and QST $9.54)" |

How it behaves (proven by a 200,000-price property test, `lessons-clinics-sketch` section 10):

- Tax is computed on the **pre-tax price** for both GST and QST (QST is not charged on GST), each **rounded half-up
  to the cent**. In `added` mode this gives **exactly the same cents as the camp's existing calculation** for every
  price from $0.00 to $2,000.00.
- In `included` mode the advertised price is the total; the system finds the pre-tax amount whose own taxes add back to
  it. For about **13% of prices** no exact breakdown exists; then the odd cent goes on the QST line, which stays within
  **1 cent** of 9.975%. The total is always exactly the advertised price. *Your accountant should confirm this
  convention.*
- A booking **freezes** its own mode, rates, subtotal, GST, QST and total. Changing the mode or a rate later only
  affects new bookings. The amount the customer must send is the frozen total, and only that exact amount can be
  verified (I5).
- Each product has a **tax treatment** (`taxable` or `exempt`), because your accountant may treat a children's
  program and an adult lesson differently. Exempt products never show tax.
- Examples (illustrative, your real prices are yours to set): $110 `added` becomes $126.47; $110 `included` splits as
  $95.68 + $4.78 + $9.54; $200 `added` becomes $229.95; $200 `included` splits as $173.95 + $8.70 + $17.35.

**The confirmation screen.** The dashboard shows a banner "**Tax setting not confirmed: online bookings are off**".
Choosing a mode asks you to retype it and records who and when in the audit log. The public site stays closed until you
have confirmed it, *for every product*, because the question is asked beside each price.

**Questions I cannot answer for you** (they are in the decisions log): is each product taxable or exempt; are you
registered for GST/QST and what must a receipt show (the camp has the same open item, D15); and whether prices
advertised on the website must say "before tax" or "tax included" (today's website says "+ tax" for junior programs
and says nothing for lessons and clinics, so the same wording rule applies there; that needs your accountant or the
Quebec lawyer, not a guess).

*The camp already adds tax on top of its $380 price (a rule you set in S4); this design does not change that and does not
reuse its hard-coded rates: the new rates are settings.*

---

## 6. Data model

The runnable form is `docs/design/lessons-clinics-schema-sketch.sql`. In words:

```
booking_settings (one row)      booking_locations ── availability_rules (hours by weekday and date range)
lesson_products ── price_periods (prices by date range; no two for one day)

bookings  (one customer's reservation: money snapshot, status, clocks, verification, calendar check)
   ├── lesson_appointments  (one per lesson; a series has several)   ─┐
   └── clinic_spots         (one per participant)                     │
clinic_offerings ── clinic_sessions (each date)                       ├── schedule_occupancy  ← the "no overlap" rule
time blocks (yours) ──────────────────────────────────────────────────┘
package_purchases ── credit_ledger  (built, off)
```

**Not yet in the sketch (to be written in phases, same style):** the calendar tables (`calendar_state`, `calendar_busy`,
`calendar_outbox`), `booking_strikes` and `booking_notes` (the camp's equivalents point at camp registrations), the
waiting-list table for clinics (optional), `booking_waitlist`, `contact_requests` (only if you want the callback form),
and the email link column.

**Migrations (additive only):** `009` settings, locations, hours, products, prices; `010` occupancy and bookings with
the legal-moves guard; `011` lessons; `012` clinics and the counter; `013` calendar and outbox tables plus the new
email kinds on the existing `email_outbox` (one nullable `booking_id` column, as migration 008 did for the waiting
list); `014` packages (created, unused). Each is idempotent and refuses to run if its preflight finds a problem, like
the camp's.

**Existing files this work will touch** (everything else is new): `src/lib/outbox.ts` and `outboxQueue.ts` (new email
kinds), `src/lib/alerts.ts` (booking alerts), `src/lib/privacyData.ts` (cover the new tables in copy/erase/retention),
`src/app/api/lesson-booking/route.ts` and `clinic-signup/route.ts` (the phase 0 kill-switch), the clinics and lessons
pages and their two components (replaced by the new screens behind the state of section 2), `scripts/preflight.mjs`,
and the admin navigation. The camp's own modules (`campDb.ts`, the registration routes, the camp tables) are **not**
edited, and the test plan includes a check that they stay unchanged.

---

## 7. A booking's life, and what happens when money is late

### 7.1 The words

| Customer and dashboard word | Meaning | Holds the time or spots? |
| --- | --- | --- |
| **Reserved** | Held for the customer; awaiting payment; a clock is running | Yes |
| **Payment reported** | The customer says they sent it; **you must verify**; never released by the system | Yes |
| **Paid** | You verified the exact amount | Yes |
| **Expired** | The hold ran out unpaid and was released | No |
| **Cancelled** | Cancelled by you, the customer, or (for an unpaid hold) by the customer from their link | No |
| **Refunded** | A paid booking whose refund you issued | No |

### 7.2 Hold deadlines (decision C1; all adjustable)

| Product | Hold | Shorter hold | After "I've sent it" |
| --- | --- | --- | --- |
| One lesson | **3 hours** | **1 hour** when the lesson is within 48 hours | review until 48 hours or 4 hours before the lesson, whichever is sooner; then red on your dashboard; **never auto-released** |
| Weekly series (pay once) | **6 hours** | 1 hour if the first lesson is within 48 hours | as a lesson |
| Clinic spots | **12 hours** | 3 hours if the first session is within 48 hours | 48-hour review; never auto-released |

A hold can never end later than 1 hour before the first lesson or session starts. You can extend an unreported hold
(at most three times, with a reason). **Levers if real life shows a problem** (not enabled): pause the hold clock
overnight, or lengthen the lesson hold. I recommend starting with the short holds as you asked and adjusting from
real data.

### 7.3 Every awkward case, and what the system does

| # | What happened | System behaviour | The customer sees | You see | Test |
| --- | --- | --- | --- | --- | --- |
| **E1** | Pays within minutes, taps "I've sent it" | Moves to **Payment reported**; the hold clock stops; review clock starts | "Thanks, we'll confirm when it arrives" | In **Payments to verify**, oldest first | `lifecycle` |
| **E2** | **Pays but never taps the button** and the hold runs out | Expires normally; the time or spots are released | Release email ("your time was released; if you've already paid, reply") | Nothing yet | `lifecycle` |
| **E3** | Money from E2 then arrives (found by reference, name, email, phone **or amount**) | **Confirm late payment**: re-take the same time/spots **only if still free**, all-or-nothing, then Paid | Confirmation email | Success banner | `late-payment` |
| **E4** | Same, but the time/spots were taken meanwhile | **Refused whole; nothing else changes.** The booking stays Expired and is flagged **"Paid but unavailable: reschedule or refund"** (`payment_issue = late_unavailable`) so it is never forgotten | An apology email only when *you* choose to send one | A red item with three buttons: **Move to another time**, **Refund**, **Add a clinic spot (needs your written note)** | `late-payment` |
| **E5** | Customer says "sent" but **nothing arrives** | Stays Payment reported; alerts escalate on the camp's ladder; **never released by the system** | Nothing | Red after the review time; one click **Release** (with a note) when you decide | `no-auto-release` |
| **E6** | **A delayed e-Transfer** (bank hold on a new payee or large amount, the customer's bank limit, a weekend or holiday, an unaccepted transfer when Autodeposit is off) | If reported: waits safely. If not reported: you may **extend the hold** (3 times max) the moment the customer tells you; if it already expired, E3/E4 apply | "Your reservation is still being held" (if extended) | The extension button with a required reason | `lifecycle` |
| **E7** | **Wrong amount**: too little | **Not confirmed** (the database requires the exact amount). Flag `amount_mismatch`; ask for the difference; extend the hold | A request for the balance (your email) | Verify form shows the difference | `payment-verify` |
| **E8** | Wrong amount: too much | Confirm at the **amount due**; the excess recorded in the note and flagged `refund_due` | Confirmation | A refund-due item | `payment-verify` |
| **E9** | The customer **pays twice** | The second deposit is `duplicate`: flagged `refund_due`; the booking is unaffected | Nothing | A refund-due item | `payment-verify` |
| **E10** | Money arrives for a booking that was **cancelled** | Flag `refund_due`; the cancelled booking stays cancelled | Nothing | A refund-due item | `payment-verify` |
| **E11** | The hold expires **at the same instant** you confirm the payment | One row lock decides; whichever second finds the other's result acts accordingly (E3/E4 if expiry won) | Confirmation or release email | Result of your click | `lifecycle` race |
| **E12** | **Customer cancels an unpaid hold** from their link | Frees the time at once, no work for you | "Cancelled" | Nothing | `lifecycle` |
| **E13** | **Customer wants to cancel a paid booking** | Customers contact you (v1). You cancel with the camp's flow: choose to tell the customer or not, set refund `due / declined`; the time/spots are freed at once | Cancellation notice (if sent) | Refund-due until you mark it issued | `cancellation` |
| **E14** | **You cancel** (illness, rain, course closed) | Cancel and notify; every affected paid booking is flagged `refund_due` or offered a move | Cancellation notice | A batch of items to resolve | `cancellation` |
| **E15** | **You move** a lesson | One atomic move checked by the no-overlap rule; the payment stays; the calendar event is updated | Reschedule email | Done | `reschedule` |
| **E16** | **Manual verification** with no customer action at all | You search by reference, name, email, phone or amount and confirm; same transaction as E3 if the hold had expired | Confirmation | Done | `manual-confirm` |
| **E17** | Customer reports payment **on an expired booking** | The report is ignored for release purposes (it cannot revive a hold) but is shown to you: "customer says they paid" | "We'll check and be in touch" | The item moves to the top | `lifecycle` |
| **E18** | **A flood of fake holds** to block your week | At most 2 open holds per email, phone and connection; short lesson holds; rate limits; you can release any hold in one click | Polite refusal | Nothing | `abuse` |
| **E19** | The **email fails** (SMTP down) | The email waits in the outbox and is retried; the booking is already safe in the database | They still see their page | A badge if overdue | `outbox` |
| **E20** | Customer double-clicks / retries | One idempotency key: one booking, one reference | The same page | One booking | `lifecycle` race |
| **E21** | **Two people confirm the same booking** (two tabs) | Row lock and status guard: one confirms, the other sees "already confirmed" | n/a | n/a | `lifecycle` race |
| **E22** | The lesson time **passes with an unresolved reported payment** | Nothing is released automatically; it stays in your queue as **"lesson has passed, resolve"** | n/a | A resolve item | `no-auto-release` |

### 7.4 How a late payment can never hurt anyone

`Confirm late payment` runs one transaction: re-activate the booking's time (or spots), then mark it Paid. The
no-overlap rule (or the spots counter) refuses if anyone else holds that time (or the last spot); the transaction rolls
back and **both bookings are exactly as they were**. This is the camp's late-deposit rule, and the sketch's tests show it
on the new tables (section 6 of the sketch test).

---

## 8. Group clinics (built first)

- A **clinic offering** is a series (for example May: four Saturdays, 9:30 to 11:00) or a single date. Sessions are
  **generated** from "start date, weekday, time, number of weeks" and stored as explicit dated rows, so one date can be
  cancelled or moved without touching the rest. Each session occupies your coach time (so a lesson cannot be sold on top
  of it), unless you mark a session as not needing you.
- Today's website says four themed sessions per series. A person reserves a **whole series** (one price) by default;
  whether someone can join after it has started, or buy a single session, is decision **G2** (the data model supports
  both).
- **Reserving** is one transaction: create the booking, then one spot per participant. The counter trigger refuses any
  spot beyond capacity; the whole party is refused or accepted together (I2, I3). Capacity defaults to **10**; raising it
  needs a written note, as the camp's 30 to 33.
- **Full** shows on the page instantly, and the booking button disappears. The displayed count is advice only; the
  database decides at the moment of reserving (race 17).
- **Rosters** download exactly like the camp's: Excel or CSV, per series or per date, **full** (with phone and email)
  or **sign-in sheet**, recent password, CONFIDENTIAL file name, logged without personal details.
- The **waiting list** built for the camp can be reused for clinics (it never holds or assigns anything), as an
  option once you want it.
- A **session cancelled** by you (rain) notifies everyone booked and flags a decision; nothing refunds automatically.

---

## 9. Private lessons

### 9.1 What is offered

For a chosen date, the offered start times are those that satisfy **all** of:

1. inside that weekday's working hours at the location, in its season (the valid date range);
2. on the product's start grid (default every 60 minutes);
3. at least the notice period away and within the horizon;
4. **not overlapping** any active lesson (with its buffer), clinic session or block of yours (database truth);
5. not overlapping a busy time on your Google calendar, if the calendar is healthy (section 10).

All times are computed in Montreal local time. A weekly series is built from the wall-clock time, week by week, so a
Thursday 9:00 stays 9:00 after both clock changes (today's code adds 7 x 24 hours and drifts to 8:00 or 10:00; the
sketch test shows both). An hour that does not exist (2:30 a.m. in March) is never offered.

The list is **advice**. The booking is decided only by the database rule at the moment of reserving.

### 9.2 Reserving (the order matters)

```
1  validate input; check the public state (section 2) and the rate limits and open-hold cap
2  LIVE calendar check (3-second limit) over the requested time(s)       ← outside any database lock
      calendar cannot be verified  → STOP: show the "call or text" card; nothing is written
      calendar busy in the window  → "that time is no longer free"
3  BEGIN
4    INSERT booking          (money frozen; calendar_checked_at = step 2; hold clock set)
5    INSERT one appointment per week (wall-clock arithmetic)
6    INSERT one occupancy row per appointment    ← the exclusion constraint decides here (23P01 = taken)
7    queue the instruction email (same transaction)
8  COMMIT                     any failure rolls back the whole series
```

If another customer's step 6 won, the customer gets "just taken, pick another" and nothing is left behind. A personal
event you happen to add in Google between step 2 and step 8 (a window of a fraction of a second) cannot be prevented,
only noticed afterwards (section 10.5); it never cancels or moves anyone.

### 9.3 The rest

- **Participants** 1 to the product's maximum; price = lesson price + extra-person fee per additional person; the
  lesson takes the whole slot whatever the count.
- **Reschedule** (you): move one appointment, or a whole series; checked atomically by the same rule.
- **Block time:** if it would cover a booking you are shown the affected bookings first; the database refuses the block
  until they are moved or cancelled. A block over free time simply removes it from the offered times.
- **Manual booking** (a customer phones you): the same reservation transaction, with `created_by = owner`. It can be
  marked paid immediately (with how and why). If Google cannot be reached you may still book them yourself by ticking
  "I have checked my own calendar": recorded as a **manual override**, allowed only for you, never for the public (I7).

---

## 10. Google Calendar: an integration, never the record (the fail-safe)

### 10.1 The policy

> **If the calendar cannot be verified right now, the system does not accept a private-lesson reservation that could
> conflict with your own schedule.** It says so plainly and offers the customer your phone, text and email.

It applies **only to private lessons**. Clinics do not depend on Google (their sessions are already in the database), and
you can always book someone yourself by phone.

### 10.2 Two connections, least privilege (recommended)

| | Purpose | Google access you give | Setting names |
| --- | --- | --- | --- |
| **Busy calendars** | Your personal, work or family calendars: "am I busy then?" | **"See only free/busy"** (the system cannot read titles or details at all) | `BOOKING_BUSY_CALENDAR_IDS` (comma-separated) |
| **Bookings calendar** | A new calendar the system writes your paid lessons and clinics into, which you subscribe to on your phone | "Make changes to events", on this one calendar only | `BOOKING_CALENDAR_ID` |

Why two: the system can never modify or delete an event of yours, and the free/busy of your personal calendars is all
it ever sees. It uses **new setting names** so it cannot wake the old routes. If you prefer a single calendar, it works
but conflict detection becomes a heuristic (decision E5). Today's one shared calendar (with the old service-account
access to *change* events) is not required.

### 10.3 Freshness and what counts as "unavailable"

Availability is read from Google into a small cache in the database (**refreshed at most every 5 minutes**, by whoever
asks first; others wait on the same refresh). The cache has a clock, **judged by the database's time**:

| State | Definition | Browsing lessons | Reserving a lesson |
| --- | --- | --- | --- |
| `ok` | last good refresh within **10 minutes** and covers the dates shown | times shown | live check (10.4) decides |
| `refreshing` | a refresh is running | cached times shown | live check decides |
| `stale` | no good refresh for more than 10 minutes, or the cache does not cover the dates | **no times shown**; the call-or-text card | **refused** |
| `down` | the last attempts failed (timeout, quota, credentials, calendar not shared) | the call-or-text card | **refused** |
| `not_configured` | no calendar settings | "coming soon" card | refused |

Treated as unavailable (never as "no events"): HTTP errors and timeouts, rate limiting, expired credentials, a response
that carries an error for the calendar (Google's documentation describes a per-calendar `errors` list inside an otherwise
successful answer, for example when a calendar is not shared with the service account; **the current code ignores that
list and reads it as "completely free"**: reproduced with a simulated answer, finding F1 in the audit; whether Google
really answers that way is confirmed in the rehearsal), a response for fewer calendars than asked, an unparseable body, or
a refresh older than the threshold. Any one failing calendar makes the whole answer unavailable.

### 10.4 What happens at the moment of reserving

Always a **live** check of the requested window (all weeks of a series), not the cache. Only a successful, complete
answer lets the reservation proceed. The success is recorded on the booking (`calendar_checked_at`, result `clear`) and
**the database refuses a lesson booking whose check is missing or more than 30 seconds old** (the sketch test shows
this). A busy answer gives "no longer free". There is no "allow and flag" path for the public.

### 10.5 After the booking

| What happens | The system does | You see |
| --- | --- | --- |
| Paid lesson | Queues an event (id derived from the booking, so a retry can never duplicate it) in the Bookings calendar: "Lesson, Jordan K., Golf Dorval" with the reference only; **no phone, no email** | Event on your phone |
| Google down when writing | The booking stays valid; the write is retried; after repeated failure an alert | "Not on calendar yet" badge, retry button |
| You add a personal event over a **paid** booking | **Nothing is cancelled or moved.** Conflict flagged at the next refresh | "Calendar conflict" item: reschedule or keep |
| You add a personal event on a free time | That time stops being offered at the next refresh (about 5 minutes) | nothing to do |
| You delete or move our event | The booking is unchanged (the database is the record) | "Event changed: re-add" button |
| The connection breaks | Lessons are `paused`; clinics continue | Red line and an alert email |
| All-day events | Counted only if Google marks them "busy". Vacations should be entered as **Blocks** in the dashboard | Audit lists "free" all-day events |

### 10.6 What the customer sees when paused (English, then French)

> **Online lesson booking is paused for a moment.**
> To be sure we never double-book your time, please call or text Coach James at **514-816-3454** or email
> **jamesdeanladeroute@gmail.com**, and we'll find you a time.

> **La réservation en ligne des leçons est momentanément suspendue.**
> Pour éviter toute double réservation, appelez ou textez le coach James au **514-816-3454** ou écrivez à
> **jamesdeanladeroute@gmail.com**, et nous trouverons une heure qui vous convient.

The buttons are tap-to-call, tap-to-text and an email link that pre-fills the date and time the person had chosen. An
optional "ask James to call me" form (storing a name and a phone number) is possible but is **off** unless you want it
(decision E6).

### 10.7 Reading versus writing, and never importing

- The inbound connection requests only the free/busy permission; the outbound one only the event permission. A bug in
  one cannot do the other's job.
- No code reads the Google Sheet to create or change a booking, and no code turns a Google event into a booking. Old
  bookings that exist only in Google are handled by **reconciliation you review** (companion document), not import.
- Google is mocked in every test by a fake that can be slow, down, partial, wrong, or changing between calls.

---

## 11. Lesson packages (built, but off)

Flexible credits, as you asked to have proposed, **inactive until you approve the rules**.

**What "off" means technically (three independent locks):** `PACKAGES_ENABLED` is not `true`; `packages_approved_at` in the
settings is empty (the database refuses to spend a credit without a rules version); and no package product is
published. Any one is enough to keep them off.

**The mechanism** (tested in the sketch): you sell N lessons; the customer pays by Interac exactly like any booking;
once you verify, they have N credits. Booking a lesson with a credit skips the payment step: the booking is confirmed at
once, one credit is spent in the same transaction (the counter refuses the last credit being spent twice), and a
cancellation that earns the credit back adds a ledger row. The ledger is append-only. Tax is charged when the package is
bought, not when a credit is used.

**Proposed rules, for your approval (none active):**

| Rule | Proposal |
| --- | --- |
| Packs | 3 and 5 lessons at today's prices (summer $300 / $500; winter $330 / $520) |
| What a credit buys | one standard lesson for **one person** (extra people pay the extra-person fee as a normal small booking) |
| Who may use it | the purchaser's email; not transferable |
| Validity | **to be decided with the lawyer** (see below) |
| Cancelling | credit returned if the customer cancels with at least 24 hours' notice, or if you cancel at any time; a no-show uses the credit |
| Unused credits | refund policy yours to set; **needs the lawyer** |
| Price changes | credits keep the value paid |
| Mixing | one booking per credit; series by credit possible later |

**Why the lawyer must see it first:** Quebec consumer-protection rules on prepaid services and on contracts that run
over time may limit expiry dates and may set what a customer is owed if lessons stop. I will not guess; this is the main
reason packages are not active by default.

---

## 12. The dashboard: one place

A new **Bookings** area next to the camp's, in English like the rest of the dashboard. The camp screens are unchanged.

| Part | What it does |
| --- | --- |
| **Needs attention** | One queue, a chip for Camp / Lesson / Clinic, most overdue first: **payments to verify** (reported), **holds ending soon**, **paid but unavailable** (E4), **refund due**, **calendar conflict**, **not on calendar**, **calendar paused**, **tax not confirmed**, **a session passed with an unresolved payment** |
| **Today / next 7 days** | Lessons and clinic sessions with payment status; optional morning email |
| **Search** | By reference, name, email, phone or **amount**, across all three products |
| **A booking** | Timeline (every action is in the audit log), and the actions: **Confirm payment** (amount, deposit time, how matched, bank confirmation number), **Extend hold**, **Release**, **Cancel** (tell the customer or not; refund `due / declined / issued`), **Move**, **Add note**, **Mark refund issued** |
| **Manual booking** | Lesson or clinic spot for someone who phoned; goes through the same rules; optional "mark paid" with details; the calendar override (owner only) |
| **Blocks** | Date, hours or recurring; affected bookings listed before you can proceed |
| **Clinics** | Create a series (generator), publish, see the roster, download it (privacy controls as the camp's), cancel a session |
| **Settings** | Everything in section 4; the tax confirmation; read-only display of which switches are on |
| **Calendar health** | Last refresh, last error, pending writes, a "refresh now" button |
| **Packages** | Hidden unless the switch is on and the rules approved |

Existing protections reused as they are: the login, the password re-check for downloads and sensitive actions, request
guards and rate limits, same-origin checks, the audit log (append-only; booking actions use `target_type = 'booking'`),
and the alert ladder.

---

## 13. Bilingual messages and reminders

Every customer message is written at send time in the language they chose, through the same outbox that makes the
camp's emails resilient (written in the same transaction as the reason for them; retried; sent once).

| Email | When | Notes |
| --- | --- | --- |
| Payment instructions | on reserving | Amount with the tax breakdown for the mode in force, reference, address, deadline |
| Reminder before the hold ends | halfway through | Only while Reserved (not Reported) |
| Release notice | hold expired | Says what to do if already paid |
| Confirmation | after you verify | Date/time or series dates, place, receipt lines |
| **Reminder 24 hours before** | the day before a lesson or session | Lessons and clinics; needs the scheduler |
| Reschedule notice | you moved it | Old and new time |
| Cancellation notice | you cancelled | Never includes your private note |
| Your alerts | payments to verify, overdue, calendar paused, conflicts, not-on-calendar | English; "reply in French" for French customers, as for the camp |

New French wording joins the list for the Quebec lawyer (`docs/QUEBEC_LEGAL_REVIEW.md`): cancellation and refund terms,
the tax lines, the hold wording, and the pause message. **Reminders are only as punctual as the scheduler**; the
camp's decision on a dependable scheduler (Vercel's once-a-day limit versus Pro or a free pinger) now matters more
because a 3-hour lesson hold and a 24-hour reminder are time-sensitive. Holds still free on time without it
(whoever loads availability releases lapsed holds first), but reminders and release emails could be late overnight.

---

## 14. Privacy, security and abuse

| Data | Where | Kept | Erased / copied |
| --- | --- | --- | --- |
| Name, email, phone, language, consent and notice version | `bookings` | the season/year it belongs to plus the retention you choose (proposal 90 days after the last session; the accounting record is kept) | Included in a customer's **copy** and in **erasing** (anonymised in place; the money record stays) |
| Participants' names (clinics) | `clinic_spots` | same | same |
| Calendar events | Google | reference, first name and last initial, lesson type, place; **no phone or email** | Deleted when a booking is erased |
| Free/busy cache | `calendar_busy` | spans only, replaced at each refresh | n/a |
| Emails | outbox | rows only; bodies are built at send time, not stored | cascaded |
| Logs | server | no personal details (same safe logger) | n/a |

Also: private links are long, random and per booking; every admin route is behind the login and the same-origin guard;
downloads need a recent password; rate limits and the open-hold cap block cheap abuse; a CAPTCHA is not in v1 (as for the
camp, add it only if abuse appears). **Not collected:** health, injuries, date of birth (decision F2).

---

## 15. Build plan with approval gates

Nothing past phase 0 is started without your go-ahead for that phase. Each phase ends with its tests green, the camp
and launch-mode tests still green, a demo on a throwaway database, and a short report to you.

| Phase | What you get | Needs from you before | Rough effort |
| --- | --- | --- | --- |
| **0. Foundations** (this branch, no public effect) | Kill-switch on the old Google routes; settings and the `bookingState` decision; migration 009; the public "coming soon / call or email" states; tests; launch-mode and camp-untouched checks | Approval of this design | 1-2 days |
| **G0. Google audit** (parallel, needs you) | Read-only inventory of what exists in Google (companion document), run by you or with your explicit approval | Your go-ahead and access | half a day |
| **1. Clinics** | Offerings and sessions, spots counter, reservation and payment pages, bilingual emails, rosters, dashboard, waitlist hookup, rehearsal drills | Tax mode, prices, G2-G4 | 4-5 days |
| **2. Lessons core** | Hours, locations, blocks, products, no-overlap rule, availability, reserve/pay, series, reschedule, manual booking, the **fake-calendar fail-safe** (calendar still simulated) | B3-B5, hours | 6-7 days |
| **3. Google Calendar** | The two connections, cache and live check, outbound events, conflicts, health panel, alerts | G0 results, calendar ids, your sharing settings | 3 days |
| **4. One dashboard, reminders, privacy** | Combined queue and search, Today list, 24-hour reminders, privacy notice extended, lawyer's list | Scheduler decision | 3 days |
| **5. Staging rehearsal** | Real Gmail, Neon branch, calendar, a few made-up customers; the staging drills for these products | Your accounts and approval | an afternoon of yours |
| **6. Packages** (optional, off) | Credits live behind their three locks | Your approved rules and the lawyer | 2 days |

Opening a feature to the public is never a phase: it is a separate step you approve, after the rehearsal, by setting the
switch.

---

## 16. What I could not verify

- **`btree_gist` on your actual Neon project.** Neon lists it as supported and it works on the local PostgreSQL 16 used
  by the tests; the first step of the rehearsal is `CREATE EXTENSION btree_gist` on your Neon branch. If it were ever
  unavailable the fallback is a per-day row lock, which I would test the same way.
- **Google's real behaviour** (the per-calendar `errors` answer, how all-day "free" events are reported, the rate
  limits, the largest window a single free/busy request accepts). The design handles each as "unavailable", and the
  rehearsal checks them against your calendar.
- **The tax rules themselves.** The arithmetic is tested; what is taxable, what a receipt must show and how prices must be
  advertised are for your accountant and the lawyer.
- **Real-world timing of e-Transfers.** The hold lengths are your approved starting point; real data decides whether the
  levers in 7.2 are needed.
