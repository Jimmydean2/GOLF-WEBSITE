# Lessons and clinics: decisions log (revision 2)

What you have decided, what that changed, and what I still need. Keep this file as the record: when you answer something, I move it from
section 3 to section 1 in the commit that acts on it.

---

## 1. Decided by you

### 1.1 Recorded 2026-10-16

| ID | Your decision | Effect |
| --- | --- | --- |
| **A1** | A separate development branch for lessons and clinics; do not interfere with the website launch or the camp | Branch `claude/lessons-clinics-booking`; additive migrations only |
| **A2** | Build group clinics first, then private lessons | Phase 1 clinics, phase 2 lessons, then the calendar |
| **B1** | A configurable **60-minute appointment slot**; duration and buffers adjustable | Per-product slot (60), lesson length (55), buffer (0), start grid (60) |
| **B2** | Prices configurable; GST/QST calculated and displayed; do not assume tax is included; **confirm with you before public bookings** | Tax mode starts `unset`; nothing can be booked until you confirm it (enforced by the database). See T1 |
| **C1-C3** | Short holds and 12-hour clinic holds; document delayed e-Transfers, reported payments, cancellations, manual verification; never overlap, never exceed capacity; packages designed but **not active** | **Clinics only** now (design 7A); packages unchanged (design 11) |
| **G1** | No automatic import of Google bookings; audit first, reconcile by hand | `docs/GOOGLE_AUDIT_AND_RECONCILIATION.md` |
| **Adjustment** | If Google Calendar is unavailable or stale, do not accept conflicting lesson bookings; offer contact | Rule L4: live check, recorded, enforced by the database |
| **Process** | Simple booking; reuse PostgreSQL protection, Interac verification, bilingual messages and the dashboard; no merge, deploy or activation without approval | Every phase ends at an approval gate |

### 1.2 Recorded 2026-10-17: private lessons are paid at the lesson

| ID | Your decision | Effect |
| --- | --- | --- |
| **N1** | Customers book **without paying in advance**; they pay you **cash or Interac e-Transfer when they arrive** | Lessons are a separate model (`lesson_bookings`): no hold, no "I've sent my payment", no expiry, no late-payment case |
| **N2** | Select an available date and time, enter contact details, receive **immediate confirmation** | The lesson is confirmed in one transaction; the page and the email show it at once |
| **N3** | PostgreSQL atomically prevents overlapping bookings, including simultaneous requests | The exclusion rule on `schedule_occupancy`; 50 simultaneous clicks give one winner (tested) |
| **N4** | A confirmed lesson must not expire merely because it has not been paid | No hold or expiry column exists; no `expired` status; the system cannot cancel a lesson (tested, and the deliberate breakages M07 and M08 are caught) |
| **N5** | Google Calendar stays synchronized; never offer or confirm a conflicting time; handle outages safely | Two-way sync with change detection and attestation when Google is down (design 10.5) |
| **N6** | Automatic booking email and reminders | Immediate confirmation; 24-hour and 2-hour reminders (configurable), sent once |
| **N7** | Mark a completed lesson **Paid - Cash**, **Paid - Interac** or **Unpaid**, with an audit trail | Close-out screen; trail written by the database, append-only, no personal data |
| **N8** | Configurable cancellation rules, **proposed 24-hour notice** | Settings frozen into each booking; a gate you must approve before public bookings (see POL1) |
| **N9** | Easy reschedule, cancel and manual add, without conflicts | One atomic, rule-checked procedure for all three |
| **N10** | Prices, taxes, durations and availability configurable | Design section 4 |
| **N11** | Preserve the separate advance-payment rules for **camp and clinics** | Separate tables and rules; camp untouched; table in design 1.2 |

### 1.3 What changed from earlier proposals because of N1 to N11

| Earlier proposal | Now |
| --- | --- |
| Lesson hold of 3 hours (1 hour inside 48 hours), series hold of 6 hours | **Removed.** Lessons have no hold. Clinics keep 12 hours (3 if close) |
| "I've sent my payment" for lessons; review, escalation and never-auto-release for lessons | **Removed for lessons.** They remain for clinics and the camp |
| Late payment re-takes a lesson's time only if free | **Removed for lessons.** Remains for clinics |
| Customer may cancel an unpaid lesson hold (C4) | Replaced by the **cancellation rules** |
| Trusted-customer mode (C5) | Not needed: lessons are already pay-later; the contact limits replace it |
| Online recurring weekly lessons (series by the customer) | **Owner-made only**: a weekly standing lesson is several separate lessons booked together by you. Online series would let one person block weeks without paying |
| Confirmed lessons appear on your calendar only after payment | **At confirmation** |
| Only the owner's own Google edits flagged as conflicts | Also: changes made to our events in Google are detected and offered as Apply / Restore, never applied automatically |

---

## 2. Standing constraints (unchanged)

No merge to `main`; no public deployment; no paid service or payment activated; no real children's or customers' data; no bulk or real emails; fake data only;
applying migrations to a real (Neon) database is a deploy step that needs your approval; the website launch is independent of everything here.

---

## 3. Still open

"Default" is what I will do if you say nothing: always the safe, closed option. "Blocks" says what cannot happen until you answer.

### 3.1 Needed before private lessons can open to the public (see `docs/LESSONS_GO_LIVE_READINESS.md`)

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **POL1** | **Approve the cancellation policy wording** (English and French) and its version. My proposal: *"Cancel or change free of charge up to 24 hours before your lesson. Inside 24 hours, please call or text James. A late cancellation or a missed lesson may be charged. Pay at your lesson by cash or Interac e-Transfer."* The lawyer should see it | `unset`: **no online lesson booking** | public lesson booking |
| **POL2** | Cancellation notice: **24 hours**? | 24 | n/a |
| **POL3** | Fees: late cancellation **0%** (proposal 50%) and no-show **0%** (proposal 100%)? A fee is only ever applied by you, never automatically | 0% and 0% | charging fees |
| **POL4** | Inside the notice, the customer's Cancel button: **contact only** (recommended) or "allow and flag as late"? | contact only | n/a |
| **POL5** | May customers **reschedule** themselves online (same notice rule)? | no; you do it | n/a |
| **POL6** | Do you want a fourth payment word for "**waived / written off**", or is Unpaid with a note enough? | Unpaid with a note | n/a |
| **POL7** | The e-Transfer address customers use at the lesson (the same as for clinics?) and whether the reference `GL-XXXXXX` is shown as the memo | the clinics' address; reference shown | the confirmation wording |
| **POL8** | Abuse limits: **2 upcoming lessons per person**; no new online booking after **2 unpaid lessons older than 7 days**; optional free bot check **off**; optional email-confirmation lever **off**. Right numbers? | as stated | n/a |
| **POL9** | Reminders by **email** at **24 h and 2 h** before? (A text message would need a paid provider and is not planned.) | email, 24 h and 2 h | n/a |
| **POL10** | An email to you on **each new booking** and a **daily list** of lessons to close out? | both on | n/a |
| **POL11** | Send the customer a **receipt** when you mark Paid? (Needs your registration numbers.) | off | n/a |

### 3.2 Money and legal

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **T1** | **Are your advertised lesson and clinic prices before GST/QST, already including it, or not taxed?** (`added`, `included`, `none`) | `unset`: no booking possible | any public booking |
| **T2** | Is each product taxable or exempt? (your accountant) | taxable | public booking of that product |
| **T3** | GST/QST registration numbers and what a receipt must show (the camp's D15 is the same question) | not shown | receipts |
| **T4** | Must the website's prices say "before tax" or "taxes included"? (Junior programs say "+ tax"; lessons and clinics say nothing.) **Concerns the launch branch's copy; not changed.** | unchanged | nothing technical |
| **T5** | How are GST/QST applied to a **late-cancellation or no-show fee**? (your accountant) | recorded as one amount | fees |
| **L-NEW** | Quebec lawyer: may cancellation and no-show fees be charged to consumers for a service paid afterwards, and with what wording; consumer-protection rules for service contracts; the privacy notice extended to lessons | not final until reviewed | public lesson booking |

### 3.3 Needed before anything is built

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **R2** | Approve **phase 0** (foundations, no public effect) and this design? | I wait | everything |
| **R1** | The old Google booking routes switch themselves on whenever the Google settings exist. May I add a small off-by-default guard to **the launch branch** as well? (It edits two existing files there.) | not touched | nothing |

### 3.4 Clinics (phase 1)

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **G2** | Whole four-Saturday series only, or also single sessions? Joining after it started? | whole series only | the clinic design details |
| **G3** | Highest capacity you would ever authorize above 10 (for example 12)? | 10 | capacity ceiling |
| **G4** | Name each participant, or only a head count? | name each | the clinic form |
| **P1** | Prices to publish (today's draft: lessons summer $110 / winter $115, extra person $25; clinic $200) and their dates | drafts, unpublished | publishing |

### 3.5 Lessons: hours and calendar

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **B1b** | The page says "55 minutes"; the slot is 60. Keep "55-minute lesson in a 60-minute slot"? | keep 55 shown | wording only |
| **B1c** | Start times every 60 minutes or every 30? | 60 | the engine's default |
| **B3** | Working hours per location and season (today Mon-Fri 9-16); weekends? always-closed dates? | today's hours | lessons |
| **B4** | 24 hours' notice to book and 60 days ahead? | yes | n/a |
| **B5** | Up to 3 people per lesson? Must the others be named? | 3, not named | lessons |
| **E1** | Which Google calendars count as busy, and do all-day events block? | all you list; "free" all-day events do not block (vacations are Blocks) | calendar connection |
| **E5** | Two connections (free/busy-only on your calendars plus a separate Bookings calendar; recommended) or a single calendar? | two | calendar connection |
| **E6** | On the call-or-text card, also an "ask James to call me" form? | no | the pause card |
| **E7** | When you move or delete one of our events in Google, should the dashboard offer **Apply to the booking** (recommended) or just flag it? | offer both buttons | sync design |
| **A-audit** | Answers to checks A1 to A10 in the Google audit, or permission for the read-only audit tool (phase G0) | I do nothing with Google | reconciliation |

### 3.6 Privacy, operations

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **F1** | Are lesson customers adults, children or both? | assume both; a parent's consent wording | the privacy wording |
| **F2** | Any health or injury information needed? | none collected | n/a |
| **F3** | Retention: 90 days after the last lesson, **except an unpaid amount is kept until resolved**? | yes | the clean-up job |
| **D1** | The dependable scheduler (decide with the camp's D2). **Reminders depend on it more than anything else does.** | holds still free on time through traffic; reminders may be late | on-time reminders |
| **D2** | Packages (the one prepaid lesson product): approve the rules, and the lawyer's view on prepaid services | off | packages |

---

## 4. What I need from you next (smallest useful answer)

1. **R2:** "Phase 0 approved" (or what to change in the design).
2. **POL1** and **T1**: the cancellation wording you want, and `added`, `included` or `none` for tax. These are the two gates the public site will check before a lesson can be booked.
3. **POL3, POL4:** fees and the inside-notice behaviour (or "defaults").
4. **A-audit:** the ten Google checks, or "run the read-only audit".

Everything else has a safe default and can wait. I will not start phase 2 (lessons) until you have answered 2.

*Nothing in this document has been merged, deployed or switched on.*
