# Private lessons and group clinics: architecture review and proposal

> **Superseded in part (2026-10-16).** You have since decided A1, A2, B1, B2, C1 to C3 and G1, and asked for a
> Google Calendar fail-safe. Where this review disagrees, `docs/LESSONS_AND_CLINICS_DESIGN.md` wins. The changes:
> **E3** ("allow the reservation if Google is unreachable, and flag it") is replaced by **refuse and offer to contact
> you**; **C3** (packs sold as a booked series) is replaced by flexible credits that are designed but **off** until you
> approve the rules; **B1** (55 versus 50 + 10) is replaced by a configurable 60-minute slot; **G1** (a one-time import)
> is replaced by "no import, audit first, reconcile by hand"; the build is on the separate branch
> `claude/lessons-clinics-booking`. See `docs/LESSONS_AND_CLINICS_DECISIONS.md` for what is still open.

**Status: a proposal for your decision. Nothing in this document has been built.** No code was changed, nothing was
merged or deployed, no payment was activated and no paid service was added. This is separate from the camp and from the
informational-website launch (section 2).

**In one paragraph.** Build lessons and clinics as a **second product family on the same PostgreSQL foundation and the
same Interac payment workflow as the camp**, not as a second system and not by stretching the camp tables. Two new
database protections do the real work: for **clinics**, the same "spots counter that cannot exceed capacity" the camp
uses; for **lessons**, a PostgreSQL **"no two bookings may overlap" rule** (an exclusion constraint) that makes it
impossible for the database to accept two bookings for the same time, however fast two customers click. Google Calendar
becomes a **display and a courtesy check**, never the record. The customer's reservation, payment and confirmation
follow the flow you already know. Lessons get a **shorter hold** than the camp (3 hours instead of 12).

---

## 1. What exists today (and what I found)

I read the current lesson and clinic code. It is a different design from the camp: **Google is the database, and nothing is protected.**

| Today | How it works | The problem |
| --- | --- | --- |
| **Private lessons** (`/book`, `src/app/api/lesson-booking`, `lessonSlots.ts`) | Free/busy is read from Coach James's Google Calendar; a booking checks "is it free?" and **then** inserts a calendar event; a row is appended to a Google Sheet | **A race:** two customers who click within the same second both see "free" and both get booked, because nothing locks the time between the check and the insert. No payment, no hold, no confirmation email to the customer, no abuse limit (anyone can book every slot with a fake name). |
| **Group clinics** (`/clinics`, `src/app/api/clinic-signup`) | The Google Sheet is read, rows are counted against 10, then a row is appended | **The same race:** an 11th person can get in. One person per sign-up, no payment, the whole sheet is read on every sign-up, and Google's per-minute limits can fail a busy morning. |
| **Recurring lessons** (every 2 to 12 weeks) | The check adds `7 × 24 hours` to the first lesson for each later week | **A daylight-saving bug (I reproduced it):** a Thursday 9:00 a.m. lesson on Oct 29 is checked as **8:00 a.m.** on Nov 5 and Nov 12 (and a March series is checked an hour *late*). The check and the calendar event then disagree about the time. |
| **Personal data** | Name, phone and email are written into the Google Calendar event description and into a Google Sheet | No privacy notice or consent for lessons/clinics, English only, and a copy of customers' details sits at Google where erasing cannot reach it. |
| **Prices and duration** | The site says **55 minutes**, $110 single / $300 for 3 / $500 for 5 (summer), $25 per extra person; the calendar books **50 minutes + a 10-minute buffer** | Nothing charges the price: the booking flow has no amount at all. The 55 vs 50 minute mismatch needs your decision. |
| **Locations** | Golf Dorval (summer), Royal Westcourt (winter) appear in the page copy | The booking has no location, and hours are fixed in code (Mon to Fri, 9:00 to 4:00), with no way to block a date. |

None of this affects the camp, which is fully separate (PostgreSQL, payments, privacy, French).

---

## 2. Keeping this apart from the informational website launch

**The public website can launch without this work and without delay.**

- Today, if the Google credentials are **not set**, `/book` and the clinic sign-up already show *"Online booking is being finalized. In the meantime, reach out directly"* with your phone and email (I read the code of both screens). That is the safe, honest state for launch. The header's "Book a Lesson" button simply lands on that message; a small wording change to say "online booking opens soon" is optional.
- So: **for the informational launch, do not set the Google Calendar or Google Sheets settings** (`GOOGLE_*` in `BOOKING_SETUP.md` steps 1 to 3). The risky race-prone booking then cannot go live by accident, and no customer data goes to Google. Camp registration does not need Google at all.
- This work happens **behind switches that default to off** (`LESSONS_ENABLED`, `CLINICS_ENABLED`) and only **adds** new database tables (migrations 009 and up). It never edits the camp's tables, so it cannot disturb the camp launch.
- **Branching:** I am allowed to push only to `claude/youthful-faraday-doicas`. I recommend a separate branch for the build (for example `claude/lessons-clinics-booking`) so the launch branch stays clean. **I need your permission before I create or push to another branch** (decision A1).

---

## 3. The proposal

### 3.1 One system, three products

```
 CAMP (finished, untouched)            NEW: bookings family
 registrations ─ children ─ spots      bookings (one customer's reservation: payment status, hold, reference GL- / GC-)
        │                                  ├─ booking_slots   (a lesson's time on the coach's day, one row per lesson)  ← "no overlap" rule
 camp_weeks (capacity counter)             └─ clinic_spots    (one row per participant)                              ← capacity counter
                                       clinic_offerings (a series or a single date; capacity, price, location)
                                       clinic_sessions  (each date and time of an offering)
                                       lesson_products  (50/90-minute lessons: price, duration, participants, buffers)
                                       locations · availability_rules (working hours) · time_blocks (your blocks)
        │                              calendar_sync (outbound events + inbound free/busy cache; failures visible)
        └────────── shared: email queue, payment instructions, alerts, admin login, audit log, privacy tools, tests ──────────┘
```

Why **new tables** rather than extending the camp's: the camp's registration tables are hardened with database rules specific to children, weeks and health consent. Stretching them to carry lessons would mean editing the thing that is about to launch. New tables copy the same *rules* (they are proven) while leaving the camp untouched. Later, when the camp season is over, the two payment engines can be merged into one if you wish (an optional clean-up, not needed).

### 3.2 Clinics: the camp's capacity protection, nearly as is

- A **clinic offering** is either a **series** (today's May/August/September 4-Saturday cohorts: one price for all four) or a **single date**. It has a capacity (default **10**, editable), a price, a location, a title and a bilingual description. **Recurring** clinics are *generated* into explicit dated sessions when you create them ("Saturdays 9:30 to 11:00, 4 weeks from May 2"), so one date can later be cancelled or moved without touching the rest.
- A booking reserves the **exact number of spots** requested (1 to 6) as one row per participant. A database trigger keeps the counter and **refuses any spot that would exceed capacity**. The booking is all-or-nothing: asking for 3 when 2 are left is refused whole. This is the camp mechanism, already tested to 100 simultaneous attempts.
- When full: the page shows "Full" and cannot reserve or take a payment. The **waiting list I just built for the camp** can be reused for clinics (it never holds or assigns anything).
- Your coaching time is protected too: each clinic session also occupies the coach's calendar (3.3), so a private lesson can never be sold on top of a clinic.

### 3.3 Private lessons: let the database refuse overlaps

The heart of the lesson design is one rule that PostgreSQL itself enforces:

> *For the same coach, no two **active** time ranges may overlap.*

(technically an **exclusion constraint** on a time range, using the `btree_gist` extension; Neon lists it as supported, [Neon extensions reference](https://neon.tech/docs/reference/pg-extensions). It is verified on your actual Neon project in the rehearsal; if it were ever unavailable the fallback is a row lock per coach-day, which I would also test.)

- Every thing that uses the coach's time is a row in one table of occupied time: a **lesson** (including its buffer, so back-to-back lessons need the gap), a **clinic session**, and a **block** you create (vacation, a dentist, "no lessons on Tuesdays at noon").
- Because it is a rule of the database, **two customers clicking at the same instant cannot both succeed**: the second attempt is refused with "that time was just taken, pick another" and nothing else changes. A lesson that overlaps *any part* of another (9:30 against 9:00 to 9:50) is also refused. This protects against my own future mistakes too, because it holds even for code that forgets to check.
- A **recurring weekly series** inserts all its dates in one transaction: if any one date is taken, **none** are booked (and each date's local time is computed correctly across daylight saving, fixing the bug in section 1).
- **Availability shown to customers** is computed from: your working hours per location (and season), minus your blocks, minus every active booking and held reservation (with buffers), minus Google Calendar busy time (3.5), minus the notice window (24 hours today). It is **advice only**: the booking itself is decided by the database rule at the moment of reserving. *No displayed count or slot list is ever trusted to enforce a limit.*
- **You control it from the dashboard**: working hours per weekday and location (for example Golf Dorval in summer, Royal Westcourt in winter), date blocks, lesson products (name, duration, price, how many participants, buffer), notice window and how far ahead customers may book.
- **Locations:** to avoid travel-time puzzles, one location per working-hours rule (so a day is at one course). Two places on one day is possible by splitting the hours; a travel buffer between them is a setting.
- **Participants:** a lesson has 1 to N participants (default maximum 3). The price is the lesson price plus the extra-person fee (today $25) per additional person. A private lesson takes the whole time slot whatever the count.

### 3.4 Payments: the same Interac framework

| Piece | Reuse? |
| --- | --- |
| Reserve, then pay by Interac e-Transfer only; unique **reference** (`GD-` camp, `GL-` lessons, `GC-` clinics), **exact amount**, payment instructions page and email, private link per booking | Reuse the instruction module and link signing; new page `/booking/<link>` in both languages |
| "I've sent my payment" button; reported payments are **never** released automatically | Reuse the rule and the alert ladder |
| **You can confirm any genuine deposit even if the customer never tapped the button** (search by reference, name, email, phone or the **amount**) | Reuse the confirm flow and the search I built; extended to bookings |
| Expired reservations released; **late payment** after release: the time or spots are re-taken **only if still free**, all-or-nothing; otherwise refused with nothing else changed and your options listed (reschedule, refund) | Same rule, same tests, against the new tables |
| **Never displace a confirmed customer, never exceed capacity**: guaranteed by the database (spots counter for clinics, no-overlap rule for lessons), not by code | New rules modelled on the camp's |
| Status words | **Reserved** (held, awaiting payment) / **Payment reported** / **Paid** / **Expired** (hold ran out) / **Cancelled** (by you or the customer) / **Refunded**. The dashboard colours and labels them the same for camp, lessons and clinics. |

**Hold deadlines should differ from the camp** (decision C1). The camp holds 12 hours because a family may pay in the morning after registering at night, and a place in a 30-child week is one of many. A lesson time is **one slot of one coach**: a held-but-unpaid slot blocks every other customer *and* is the easiest target for abuse (one person with a fake name could block your week).

| Product | Recommended hold | If the booking is close to the date | After "I've sent it" |
| --- | --- | --- | --- |
| **Camp** (today) | 12 hours | n/a | 48-hour review, never auto-released |
| **Clinic spots** | 12 hours | 3 hours if the first session is within 48 hours | 48-hour review, never auto-released |
| **One lesson** | **3 hours** | **1 hour** if the lesson is within 48 hours (online booking needs 24 hours' notice, as today) | review until 48 hours or **4 hours before the lesson**, whichever is sooner, then it shows red on your dashboard; never auto-released |
| **A weekly series** (pay once) | 6 hours | 1 hour if the first lesson is within 48 hours | as a lesson |

Also: at most **2 unpaid lesson holds per email address, phone number and connection**, and the existing rate limits, so a joker cannot hold your week; a customer can **cancel their own unpaid hold** from their private page (frees the slot at once, no work for you). Packs (3 or 5 lessons at a discount, used on dates chosen later) need a prepaid-credit ledger; I recommend **v1 sells a pack as a booked weekly series** (every date reserved up front at the pack price), and a flexible credit pack only if you need it (decision C3).

### 3.5 Google Calendar: a calendar integration, not the booking database

The principle: **the database decides; the calendar informs and receives.**

- **Inbound (so your personal events block lesson times):** availability reads Google free/busy through a small **cache in PostgreSQL** (refreshed at most every 5 minutes while people browse, no scheduler needed). At the moment someone **reserves**, the system checks Google live for just that time (3-second limit).
- **Outbound (so confirmed lessons appear on your phone):** when a booking becomes **Paid**, an event is created on your calendar; reschedules update it and cancellations remove it. Each event has an ID derived from the booking, so a retry can never create a duplicate. Unpaid holds are **not** put on the calendar by default (decision E2): they live on the dashboard and expire within hours.
- **Failures never break booking.** Pushing an event is queued and retried (the same safe queue the emails use); a failure shows as a small "not on calendar yet" badge with a retry button.

| What happens | What the system does | What you see |
| --- | --- | --- |
| Google is slow or down when someone browses | Shows availability from the database (last good copy, at most about an hour old) | A banner on the dashboard: "calendar not reachable since 2:10 p.m." |
| Google is down when someone **reserves** | **Allows** the reservation (the customer is not punished for Google), stamps it "calendar not checked" | It appears in "Needs attention" so you glance at your calendar *before* confirming payment |
| You add a personal event that **overlaps an existing booking** | Nothing is cancelled. The booking is flagged | "Calendar conflict: your 2:00 event overlaps Jordan's paid lesson. Reschedule or keep" |
| You add a personal event on a **free** time | That time stops being offered at the next refresh (within about 5 minutes) | Nothing to do |
| You **delete or move our event** in Google | The booking in the database is unchanged (the database is the record) | "Calendar event changed: re-add to calendar" button |
| The connection to Google breaks (permission, key) | The system keeps working from its own data; availability ignores Google until fixed | A red health line and an alert email |
| The same retry arrives twice | Same event ID, so no duplicate | Nothing |
| All-day events | Treated as busy for the whole day (a setting: which calendars and whether all-day counts) | n/a |

What this means in plain terms: **a customer can never be double-booked with another customer or with a clinic, by any timing.** The only thing that can ever overlap is *your own personal Google event* created after a booking, and you are told about it rather than the system silently cancelling anyone.

### 3.6 Administration: one dashboard

- **One queue** ("Needs attention") for camp, lessons and clinics, with a chip for the type and the same five words (Reserved, Payment reported, Paid, Expired, Cancelled). Payments to verify are at the top, most overdue first, **exactly the daily two-minute routine you have now.**
- **Today / next 7 days** list (lessons and clinic sessions, with payment status). An optional morning email with the same list.
- **Manual booking**: pick lesson or clinic, enter the customer, choose a time or offering, optionally "mark as paid" (with how and why). It goes through **the same database rules**, so even you cannot double-book yourself; only a written authorization can raise a clinic above its capacity, as for the camp.
- **Reschedule** a lesson: one atomic move that checks the new time against the same rule (all-or-nothing), emails the customer, updates the calendar event. A clinic participant can move between offerings (all-or-nothing, price difference noted).
- **Cancel** a booking (with or without telling the customer, as for the camp). **Block time**: date, hours or recurring; if it covers a booked lesson the system **lists the affected bookings and refuses to block silently**; you choose to reschedule or cancel them first.
- **Clinic participant lists** download exactly like the camp rosters: Excel or CSV, per offering or per session date, **full** (with phone and email) or **sign-in sheet** (names and payment status only), recent password, CONFIDENTIAL file names, logged without personal details.
- **Search** by reference, name, email, phone or amount, across all three.

### 3.7 Bilingual, reminders, privacy

- Customers choose English or French; every email is written in that language at send time (the camp mechanism). Lesson and clinic wording joins the list for the Quebec lawyer (cancellation terms are the main item).
- **Emails:** payment instructions, a reminder before the hold ends, release notice, **confirmation**, **24-hour lesson/clinic reminder**, reschedule notice, cancellation notice, plus your own alerts. Reminders are only as punctual as the scheduler (decision D1).
- **Privacy:** private link per booking (no accounts, nothing to remember), consent recorded with the version of the notice, a copy of a customer's data, erasing, retention after the last session (proposed 90 days; accounting record kept), no health or injury information collected (decision F2), and the privacy notice extended to lessons and clinics. Calendar events carry only **first name and last initial, the lesson type and the location**: no phone number or email (today's events contain both).

---

## 4. Reuse and build

| Reuse as is | Reuse with changes | Build new |
| --- | --- | --- |
| Admin login, password re-check, audit log; rate limits; **email queue** (retries, once-only) and bilingual templates; payment instructions text; signed private links; scheduled check and health box; i18n and French typography; privacy erase/copy/retention machinery; waiting list; CSV/Excel download code and its safeguards; the test harness, race-test helpers and mutation checker | Dashboard queue and search (add the booking types); email queue (new email kinds, a booking link); alert ladder (lesson-specific times); privacy tools (cover the new tables); the clinic and lesson pages (replace the Google forms) | **New tables and database rules** (bookings, no-overlap rule, clinic spots counter, working hours, blocks); lesson availability engine and settings screens; booking and reservation pages in both languages; reschedule and manual-booking flows; calendar adapter with a fake for tests; clinic setup (recurring generation) |

Not reused: the Google Sheets code for lessons/clinics (retired; the lesson and clinic data move to PostgreSQL; **you no longer need the Sheet at all**, which removes a copy of customers' details at Google). If any **real** lesson or clinic bookings exist today in the Sheet or Calendar, I would import them once (decision G1).

---

## 5. Race conditions and how each is closed and tested

Each row becomes an automated test run against a real database with **many simultaneous connections** (as the camp's `concurrency` suite does), and a deliberate-breakage check proving the test fails if the protection is removed.

| # | The race | Closed by | Test |
| --- | --- | --- | --- |
| 1 | Two customers, **the same lesson slot**, same instant | no-overlap rule: exactly one succeeds | 50 simultaneous attempts, one winner |
| 2 | **Overlapping** but different starts (9:00 and 9:30) | the same rule on time ranges | every overlap pair |
| 3 | Back-to-back lessons and the **buffer** | the buffer is part of the occupied range | boundary minutes: touching is allowed only with the buffer |
| 4 | A **weekly series** where only the 3rd week is taken | one transaction, all or nothing | no partial series, ever |
| 5 | The **double-click / retry** of one reservation | idempotency key: one booking, one reference | 100 repeats |
| 6 | **You block a time** while a customer books it | the same rule: one of the two wins; a block over a booking is refused | simultaneous block vs booking |
| 7 | **Hold expires** at the same moment the customer's payment is confirmed | row locks and the camp's expiry rules | boundary race, both orders |
| 8 | **Late payment**: slot or spots already re-booked | re-reserve with the rule; refused whole, nothing else changes | confirmed customers byte-identical before/after |
| 9 | **Reschedule** into a slot someone is booking right now | a single update checked by the rule | simultaneous move vs booking |
| 10 | Two administrators (or two tabs) confirm / cancel the same booking | row lock, status guard | double confirm, confirm vs cancel |
| 11 | **Clinic: the last spot** with two parties | counter trigger refuses over capacity | 100 simultaneous, never above capacity |
| 12 | **Clinic: a party of 3 when 2 remain**, and a party of 2 racing a party of 1 | all-or-nothing spots | no partial party; counters equal spots |
| 13 | Clinic spot **released while someone reserves it** | counter and row locks | release vs reserve |
| 14 | Google busy time appears **between display and reserve** | live re-check at reserve, flag if unreachable | fake calendar: busy, slow, down |
| 15 | A calendar event is created **twice** (timeout then retry) | deterministic event ID | retry storm |
| 16 | **Daylight saving** and a series across it | local-time arithmetic per occurrence | dates across both clock changes, and Nov/Mar series |
| 17 | The displayed count or slot list is **stale** | never trusted: the rule decides | display forced stale, booking still refused |
| 18 | Counters drift from the truth | commit-time integrity check (as the camp's) | invariant checker after every test |

Plus the same attack tests the camp has (raw SQL against every database rule), a source scan that nothing automatic can confirm or release a *reported* payment, privacy tests (copy, erase, nothing personal left anywhere, none in logs or calendar events), French/English parity, and a rehearsal script like `staging-verify.mjs` for lessons and clinics.

---

## 6. Risks (and what I would do about each)

1. **Scope.** Three products plus a calendar is real work. *Mitigation:* build in phases (section 7); clinics first because they are nearly the camp; everything behind switches that are off.
2. **Daylight saving and time zones** are where scheduling systems quietly go wrong. *Mitigation:* all times stored as exact instants but calculated in Montreal local time per date; tests across both clock changes.
3. **Abuse of free holds** (fake bookings blocking your week). *Mitigation:* short holds, 2-unpaid-holds cap, rate limits, customer self-cancel; CAPTCHA only if abuse appears (decision, as D9 for the camp).
4. **Your daily workload.** Many $110 e-Transfers to verify. *Mitigation:* exact amount and reference make matching quick; one queue; a morning list. If volume grows, an optional **"trusted regular customer"** setting (they may book with payment due before the lesson, no hold expiry) would cut the work; I recommend leaving it out of version 1 (decision C5).
5. **Reminders need a reliable scheduler.** A lesson reminder 24 hours before, and releasing a lapsed 3-hour hold on time, are more time-sensitive than the camp's. The free Vercel plan runs a scheduled job once a day; the camp's traffic-triggered fallback means holds would still free on time (every page that shows availability releases lapsed holds first; I would build lessons the same way), but **emails could be late overnight**. *Decision D1:* the camp's open decision D2 (Vercel Pro or a free pinger) becomes more important.
6. **`btree_gist` on Neon:** listed as supported; I verify on your project early in the rehearsal and keep a tested fallback.
7. **Regressions in shared code** (email queue, alerts, privacy tools). *Mitigation:* additive changes, the full suite (27 suites) plus mutation checks run on every step.
8. **Legal:** cancellation and refund terms for lessons and clinics, GST/QST on lesson prices and receipts, and the privacy notice. *Mitigation:* listed for the Quebec lawyer and your accountant; no wording is final until you approve it.
9. **Customers expect instant confirmation.** With e-Transfer-only they reserve, pay, then are confirmed. *Mitigation:* clear wording on the page and in the email (as for the camp); this is the price of "Interac only".
10. **Two sources of truth drifting** (calendar vs database). *Mitigation:* the policy table in 3.5; the database always wins, and drift is shown, not hidden.

---

## 7. Phases (my working effort, roughly, with uncertainty)

| Phase | What you get | Effort |
| --- | --- | --- |
| **0. Launch the informational site** | `/book` and clinic sign-up show "call or email"; nothing else needed (no code) | none |
| **1. Clinics** | Offerings (series/single), spots counter, reservation page, payment flow, waiting list, bilingual emails, rosters, admin; tests | about 4 to 5 days |
| **2. Lessons core** | Working hours, locations, blocks, products, no-overlap rule, slot engine, reservation/payment, manual booking, reschedule, series; tests | about 6 to 7 days |
| **3. Google Calendar** | Inbound cache and live check, outbound events, conflict flags, failure handling, fake adapter tests | about 3 days |
| **4. One dashboard, reminders, privacy and polish** | Unified queue and search, Today list, 24-hour reminders, privacy notice extended, French reviewed list | about 3 days |
| **5. Staging rehearsal** (yours: an afternoon) | Real Gmail, Neon, bank, calendar with made-up customers | needs your accounts and approval |

That is roughly **three to four weeks of focused work**, in order you choose. Each phase ends with a **demo on a staging copy** and its tests, and nothing is merged, deployed or switched on without your approval.

---

## 8. Decisions I need from you

Recommendations in **bold**. "Your call" items have a safe default so I am never blocked.

**A. Launch and process**
- **A1.** Launch the informational website with online lesson booking and clinic sign-up **off** (call or email), and do the build on a **separate branch**. *(Needs your OK to create the branch.)*
- **A2.** Build order: **clinics first** (nearest to the camp, the May cohort is the next deadline), then lessons, then the calendar. *(Say if lessons should come first.)*

**B. Lessons**
- **B1.** Duration and buffer: the page says **55 minutes** and the calendar books **50 + a 10-minute gap**. Which is true? Which durations do you sell (for example 30, 55 and 90 minutes)?
- **B2.** Prices (today $110 single summer, $115 winter, $25 per extra person): **are they before or after GST/QST?** Do prices change by season or location?
- **B3.** Working hours by location and season (today Mon to Fri, 9 to 4, no weekends); weekend lessons? Which dates are always closed?
- **B4.** Notice and horizon: **24 hours' notice** (as today) and **up to 60 days ahead**?
- **B5.** Maximum participants per lesson (**3**), and whether extra participants must be named.

**C. Payments and holds**
- **C1.** The hold deadlines in section 3.4: **lessons 3 hours (1 hour when the lesson is within 48 hours), series 6 hours, clinics 12 hours.**
- **C2.** Cancellation and rescheduling terms (for example "free change with 24 hours' notice; refunds at your discretion"). I will not invent them; a lawyer should see them.
- **C3.** Packs of 3 and 5: **sell as a weekly series booked up front** in v1, or build a flexible credit balance now?
- **C4.** May a customer **cancel their own unpaid hold** from their private link? **Yes.** May they reschedule themselves? **Not in v1** (you reschedule; fewer ways to go wrong).
- **C5.** A "trusted regular customer" mode (booking without a hold expiry): **not in v1.**

**D. Operations**
- **D1.** The scheduler decision from the camp (Vercel Pro or a free pinger) now also drives lesson reminders: **decide it with the camp's D2.**
- **D2.** A **morning email** with today and the next 7 days: **yes, optional per setting.**

**E. Google Calendar**
- **E1.** Which calendar(s) count as busy (just your lessons calendar, or also your personal one)? Do all-day events block the day? **Personal calendar yes; all-day events yes.**
- **E2.** Put **unpaid holds** on your calendar? **No** (confirmed lessons only).
- **E3.** If Google is unreachable at the moment of reserving: **allow, and flag it** (alternative: refuse and show "call to book").
- **E4.** Calendar event wording: **first name and last initial, lesson type, location, no phone or email.**

**F. Customers and privacy**
- **F1.** Are lesson customers adults, children, or both? (Children need a parent's consent wording; the camp's rules apply.)
- **F2.** Do you need any health or injury information for lessons and clinics? **No** (collecting it triggers the stricter health-consent rules).
- **F3.** Retention after the last session: **90 days**, accounting record kept (as the camp's proposal, P2).

**G. Clinics**
- **G1.** Are there **real bookings today** in the Google Sheet or calendar that I should import before anything changes?
- **G2.** Clinics: keep the **four-Saturday series for $200** only, or also single-session drop-ins (price)? Can someone join a series after it starts?
- **G3.** Capacity: **10** (raise only by your written authorization, to a maximum you choose, for example 12).
- **G4.** Clinic participants: **name each participant** (needed for the roster) or just a head count?

---

## 9. What I did and did not do

- I **read** the existing lesson and clinic code, the camp's payment/capacity design, and the Google integration, ran a small script to demonstrate the daylight-saving problem, and looked up Neon's extension support.
- I **wrote only this document.** I changed no code and no database, created no branch, merged nothing, deployed nothing, activated no payment and added no paid service.
- Your next step is the **A-decisions** (they unlock everything else). Reply with "A1 yes, A2 clinics first, defaults for the rest" and I will start with the clinic design in detail.
