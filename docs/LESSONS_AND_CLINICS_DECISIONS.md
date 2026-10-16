# Lessons and clinics: decisions log

What you have decided, what that changed, and what I still need. Keep this file as the record: when you answer
something, I move it from section 3 to section 1 in the commit that acts on it.

---

## 1. Decided by you (recorded 2026-10-16)

| ID | Your decision | Effect |
| --- | --- | --- |
| **A1** | Create a separate development branch for lessons and clinics; do not interfere with the informational website launch or the summer camp | Branch `claude/lessons-clinics-booking`. The launch branch got only a test and two copy fixes; this branch adds tables, never edits camp ones |
| **A2** | Build group clinics first, then private lessons | Phase 1 clinics, phase 2 lessons, then the calendar (design section 15) |
| **B1** | A configurable **60-minute appointment slot** as the default; lesson duration and buffers adjustable in the admin dashboard | Per-product slot (60), lesson length (55), buffer (0), start grid (60), all settings |
| **B2** | All prices configurable; applicable GST/QST calculated and clearly displayed; do **not** hard-code or assume whether advertised prices include tax; **ask you to confirm before public bookings are enabled** | Tax mode starts `unset` and nothing can be booked until you confirm it (enforced by the database). See T1 below: this is the question I am asking you now |
| **C1** | Start with the proposed short lesson holds and 12-hour clinic holds | Lesson 3 h (1 h if within 48 h), series 6 h, clinic 12 h (3 h if within 48 h); all adjustable |
| **C2** | Document how delayed e-Transfers, reported payments, cancellations and manual verification are handled; never allow overlapping confirmed bookings or exceed clinic capacity | Design section 7 (22 cases, each with a test) and rules I1 to I6 |
| **C3** | Propose flexible lesson-package credits as the default; **do not activate packages** until you approve their rules | Designed and tested at the database level, off behind three locks; proposed rules in design section 11 |
| **G1** | Do **not** import Google Calendar or Sheets bookings automatically; first provide an audit of what exists and a safe reconciliation plan | `docs/GOOGLE_AUDIT_AND_RECONCILIATION.md`; nothing reads Google to create a booking (rule I10) |
| **Adjustment** | If Google Calendar availability is unavailable or stale, do not accept potentially conflicting private-lesson bookings; fail safely and offer the client a way to contact you | Rule I7: a live check at every reservation, recorded and enforced by the database; the page becomes a call-or-text card; clinics are unaffected (design section 10) |
| **Process** | Keep the customer's booking extremely simple; reuse PostgreSQL protection, Interac verification, bilingual messages and the dashboard; do not merge, deploy or activate anything without explicit approval; keep the website launch on a separate track | Three screens for a customer; every phase ends at an approval gate; the launch-mode test |

### What changed from my earlier review because of your decisions

| Earlier proposal | Now |
| --- | --- |
| E3: if Google is unreachable at the moment of reserving, **allow and flag it** | **Superseded:** refuse and offer contact |
| C3: sell packs as a weekly series booked up front; credits only if needed | **Superseded:** credit packages are designed (off); series stays for people who want fixed weekly times |
| B1: 55-minute lesson vs 50 + 10 | A 60-minute slot, adjustable; the lesson length shown to customers is separate wording |
| G1: import real bookings once | **Superseded:** no import; human-reviewed manual entry only |
| Unpaid holds shown on the calendar: no | Unchanged |
| Google calendar access | New recommendation: free/busy-only on your own calendars and a separate Bookings calendar (design 10.2); needs your answer E5 |

---

## 2. Standing constraints (unchanged)

No merge to `main`; no public deployment; no paid service or payment activated; no real children's or customers'
data; no bulk or real emails; fake data only; applying migrations to a real (Neon) database is a deploy step that needs
your approval; the website launch is independent of everything here.

---

## 3. Still open

"Default" is what I will do if you say nothing, always the safe, closed option. "Blocks" says what cannot happen until
you answer.

### Needed before anything is built

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **R2** | Approve **phase 0** (the foundations, no public effect) and this design? | I wait | everything |
| **R1** | The old Google booking routes switch themselves on whenever the Google settings exist. May I add a small off-by-default guard to **the launch branch** as well, so setting up Google later can never wake them by accident? (It edits two existing files there.) | Not touched; the launch branch relies on leaving the Google settings unset | nothing |

### Needed to open clinics (phase 1)

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **T1** | **Are your advertised lesson and clinic prices before GST/QST, or do they already include it, or do you not charge it?** (Pick: `added`, `included`, `none`.) | `unset`: no booking possible | any public booking |
| **T2** | Is each product taxable or exempt (children's programs and adult lessons may differ)? Your accountant decides. | taxable | public booking of that product |
| **G2** | Clinics: only the whole four-Saturday series for $200, or also single sessions (price)? Can someone join after it started? | whole series only; no joining late | the clinic design details |
| **G3** | Highest capacity you would ever authorize above 10 (for example 12)? | 10, raised only with a written note up to a ceiling you name | capacity ceiling |
| **G4** | Must each participant be named (needed for a roster) or only a head count? | name each | the clinic form |
| **P1** | Prices to publish (today's draft: summer $110 / $300 / $500; winter $115 / $330 / $520; extra person $25; clinic $200) and their dates | drafts, unpublished | publishing |

### Needed to open lessons (phase 2 and 3)

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **B1b** | The page says "55 minutes"; the slot is 60. Keep "55-minute lesson in a 60-minute slot", or say "60 minutes"? | keep 55 shown | wording only |
| **B1c** | Offer start times every 60 minutes (clean days) or every 30 (more choice, more gaps)? | 60 | the engine's default |
| **B3** | Working hours per location and season (today Mon-Fri 9-16, no weekends); weekend lessons? always-closed dates? | today's hours | lessons |
| **B4** | 24 hours' notice and 60 days ahead? | yes | lessons |
| **B5** | Up to 3 people per lesson? Must the others be named? | 3, not named | lessons |
| **E1** | Which Google calendars count as busy (personal? work? family?), and do all-day events block? | all you list; "free" all-day events do not block (vacations are Blocks) | calendar connection |
| **E5** | Two connections (free/busy-only on your calendars plus a separate Bookings calendar; recommended) or keep a single calendar? | two | calendar connection |
| **E2** | Put unpaid holds on your calendar? | no | n/a |
| **E4** | Calendar event wording: first name + last initial, type, place, no phone/email? | yes | outbound events |
| **E6** | On the "call or text" card, also offer an "ask James to call me" form? (It stores a name and a phone number.) | no: tap to call / text / email only | the pause card |
| **A-audit** | Answers to checks A1 to A10 in the Google audit document, or permission for the read-only audit tool (phase G0) | I do nothing with Google | reconciliation; never blocks the website |

### Policy and legal

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **C2b** | Cancellation, rescheduling and refund terms for lessons and clinics (for example "free change with 24 hours' notice") | I invent nothing; terms stay blank and the lawyer sees the question | public wording |
| **C4** | May a customer cancel their **own unpaid** hold from their link? Reschedule themselves? | cancel yes; reschedule no (you do it) | n/a |
| **C5** | A "trusted regular customer" mode (pay later, no expiry)? | no | n/a |
| **PK** | Package rules (design section 11), including expiry and refunds; the Quebec lawyer's view on prepaid services | off | packages |
| **F1** | Are lesson customers adults, children or both? | assume both; a parent's consent wording for children | the privacy wording |
| **F2** | Any health or injury information needed? | none collected | n/a |
| **F3** | Retention: 90 days after the last session, accounting record kept? | yes | the clean-up job |
| **T3** | GST/QST registration numbers and what a receipt must show (the camp's D15 is the same question) | not shown | receipts |
| **T4** | Must the website's prices say "before tax" or "taxes included"? (Junior programs already say "+ tax"; lessons and clinics say nothing.) **This one concerns the launch branch's copy; I have not changed it.** | unchanged | nothing technical |

### Operations

| ID | Question | Default | Blocks |
| --- | --- | --- | --- |
| **D1** | The dependable scheduler (decide together with the camp's D2: Vercel Pro or a free pinger) | holds still free on time through traffic; reminders may be late overnight | on-time reminders |
| **D2** | A morning email with today and the next 7 days? | yes, optional | n/a |
| **D3** | If real data shows holds lapse overnight, pause the hold clock 10 p.m. to 7 a.m.? | off | n/a |

---

## 4. What I need from you next (smallest useful answer)

1. **R2:** "Phase 0 approved" (or what to change in the design).
2. **T1:** `added`, `included` or `none`. (This is the only thing that stands between the design and a public clinic
   booking, apart from the rehearsal.)
3. **G2 to G4:** one line each for clinics.
4. **A-audit:** your answers to the ten checks, or "run the read-only audit".

Everything else has a safe default and can wait. I will not start phase 1 (clinics) until you answer 2 and 3, because the
price shown on a reservation page depends on them.

*Nothing in this document has been merged, deployed or switched on.*
