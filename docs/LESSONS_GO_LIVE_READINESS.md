# What remains before private lessons can safely accept real online bookings

**Status: a checklist and plan, not a launch.** Today private lesson booking is **designed and its central database rules are proven**, but **nothing is built that a
customer could use**, nothing is deployed and no live booking is switched on. This document says exactly what stands between here and a public "Confirm my
lesson" button, in the order I would do it, and what has to be true before you flip the switch. **You decide when; nothing here happens without your approval.**

(Private lessons are booked now and paid at the lesson. Clinics and the camp keep advance payment and have their own checklists.)

---

## 1. Where things stand

| Piece | State |
| --- | --- |
| The lesson design (booking, cancellation rules, close-out and payment trail, Google sync, reminders, limits) | **Written** (`docs/LESSONS_AND_CLINICS_DESIGN.md`) |
| The database rules that make double-booking and expiry impossible | **Proven on a scratch database**: 188 checks, 22 deliberate breakages each caught |
| The test plan | **Written**; one suite running |
| The Google audit and reconciliation plan | **Written**; **not run** (needs you) |
| Application code, screens, emails, calendar connection, dashboard | **Not built** |
| Real services (hosting account, Neon branch, mail, calendars) | **Not set up** |
| Your approvals (below) | **Not given** |
| The informational website | Independent; can launch without any of this |

---

## 2. Your approvals (nothing public can open without these)

The first two are **gates in the code**: until they are confirmed on the dashboard, the booking page shows "coming soon, call or email".

| # | Approval | Where | Why it blocks |
| --- | --- | --- | --- |
| 1 | **Tax mode** (`added`, `included` or `none`) and whether each product is taxable (T1, T2) | dashboard, confirmed once | The database refuses a lesson with no tax mode |
| 2 | **The cancellation policy wording**, notice and fees (POL1-POL4) | dashboard, confirmed once | The database refuses a lesson with no policy version |
| 3 | **Prices** and their dates; **working hours**, locations, lesson length, buffer (P1, B1-B5) | dashboard | There is nothing to offer without them |
| 4 | **The design and phase 0** (R2) | reply | Nothing is built without it |
| 5 | **Which Google calendars** count as busy; two connections or one (E1, E5, E7) | reply | The calendar connection is a hard requirement for opening |
| 6 | **The Google audit** (A-audit): your answers, or permission for the read-only tool | reply | Anything that already exists in Google must be accounted for before the new system opens |
| 7 | **Opening the feature**: setting the switch after the rehearsal | you, when ready | Never automatic |

---

## 3. What still has to be built (lessons only)

You asked for clinics first (A2). **Lessons do not depend on clinics being built**; if you want lessons online first, the path is phases 0, 2, 3, 4 and 5.
Rough working effort, with uncertainty; each phase ends at your approval.

| Phase | What it delivers | Effort |
| --- | --- | --- |
| **0. Foundations** | The kill-switch on the old Google routes; the settings tables; the single "what does the public see" function (off / coming soon / open / paused); the "coming soon" states; migration 009; tests | 1-2 days |
| **2. Lessons core** | Hours, locations, blocks, products, prices; the availability engine (DST-safe); **booking with immediate confirmation**; frozen terms and tax; **cancel (customer within the rules, you any time)**; **move**; **manual add**; **close-out with Paid - Cash / Paid - Interac / Unpaid and the trail**; the contact limits; the reminder queue; the confirmation and notice emails in English and French; the customer's private page with add-to-calendar; the phone-first dashboard screens; all with a **simulated** calendar | 6-7 days |
| **3. Google Calendar** | The two connections; the live check at booking; the cache and freshness rules; the outage behaviour and the call-or-text card; outbound events; **change detection** (moved, deleted, added by hand, personal event over a lesson); health panel and alerts | 4 days |
| **4. Reminders, privacy and polish (the lesson parts)** | Reminders actually sent by the scheduler; copy and erase for lessons; the privacy notice extended; the lawyer's list; the daily "close out" email | 2-3 days |
| **5. Rehearsal** | Everything above against real services with made-up customers (section 6) | an afternoon of yours, plus my preparation |
| **Opening** | You approve; set the switch; pilot (section 8) | your decision |

That is roughly **16 to 20 working days of building** before the rehearsal, plus your approvals and the lawyer's review running in parallel. (Clinics, if built first, add about
4 to 5 days and share phases 0 and 5.)

---

## 4. What you will need to set up (accounts and settings)

None of this exists yet, and none is started without your approval. Costs are only what is needed for real bookings; the informational site needs none of it.

| Need | Notes |
| --- | --- |
| **Hosting** that runs the full app | Per `docs/HOSTING_OPTIONS.md` (written on the launch branch): Netlify Free ran the app and the booking drills unchanged; its monthly credit cap is the thing to watch |
| **A PostgreSQL database** (Neon) and a **separate rehearsal branch** | Needed for the overlap rule (`btree_gist`) and everything else; a free tier exists, check limits |
| **Mail** (a Gmail app password or another SMTP) | Confirmations, reminders, your alerts |
| **Google**: a service account, a **Bookings** calendar (write access) and your personal calendars shared **free/busy only** | See design 10.2; the old shared-everything access is not required |
| **A scheduler** | Reminders and the daily close-out email depend on it. Options already documented (GitHub Actions, Apps Script, a hosting scheduled function); **decision D1** |
| **Domain and DNS** | When the site goes live |
| Optional: a free bot check (Turnstile), an error monitor | Off until needed |

---

## 5. Legal, accounting and privacy (run in parallel; these can take the longest)

| Item | Who | What is needed |
| --- | --- | --- |
| Cancellation policy, **late-cancellation and no-show fees**, and the wording shown at booking | Quebec lawyer | Whether and how fees may be charged to consumers for a service paid afterwards; the exact English and French text; how acceptance is shown |
| Consumer-protection rules for service contracts; prepaid packages (if ever on) | Quebec lawyer | Expiry, refunds, what is owed if lessons stop |
| The **privacy notice** extended to lessons; consent wording; retention; erasing; the person in charge | Lawyer, you | The camp's notice is the template (`docs/PRIVACY_AND_LAW25.md`); the unpaid-amount exception (kept until resolved) needs a line |
| **GST/QST**: mode, taxable or exempt, how a fee is taxed, what a receipt must show, your registration numbers | Accountant | T1 to T5 |
| French wording of everything new | A native reader | Listed in `docs/QUEBEC_LEGAL_REVIEW.md` as it grows |

---

## 6. Risks I still have to retire (and how)

| Risk | How it is retired |
| --- | --- |
| `btree_gist` unavailable or different on your Neon project | First rehearsal step; fallback (a per-day lock) designed and tested the same way |
| **Google behaves differently from the documentation** (the per-calendar `errors` answer, all-day "free" events, event edit detection, quotas) | The rehearsal drills against your real calendar; every unknown is treated as "unavailable" until proven |
| **Fake or abusive bookings** when nobody pays up front | The limits, rate limits and flags; a **pilot** with a short horizon and a low cap (section 8); levers ready if needed |
| **Reminders late or missing** | A dependable scheduler (D1); the reminders table is idempotent and catches up; the owner sees "reminders not sent" |
| **Emails not arriving** (typos, spam folders) | A spelling hint at entry; the phone number is always collected; the confirmation page already showed everything; your correction tool is audited |
| **Hosting limits** (function time, the credit cap) | `docs/HOSTING_OPTIONS.md` (launch branch); usage warnings; the rehearsal measures real usage |
| **People expect a refund route** after paying you in cash | Handled outside the system; the trail records the correction |
| **Daylight saving and time zones** | All times from the wall clock; tests on both clock changes and the two boundary days |
| **The first weeks' no-shows and unpaid lessons** | Close-out routine, the unpaid list, the contact block; your fee decision stays manual |

---

## 7. The rehearsal (what "ready" means technically)

On a separate database branch and a test calendar, with made-up customers (`docs/LESSONS_AND_CLINICS_TEST_PLAN.md` section 9):

- 8 people for one slot; one person trying to book many; duplicates; email broken then repaired;
- the calendar **unplugged mid-booking**; revoked; slow; all-day events; one of our events moved, deleted, and one added by hand;
- reminders with a test clock, including a late scheduler and a moved lesson; the cancellation boundary just inside and just outside 24 hours;
- the close-out routine on your phone, with every payment word and a correction;
- a restore from backup with every lesson and the trail intact.

---

## 8. The go / no-go checklist (every line must be a yes, with evidence)

| # | Must be true | Evidence |
| --- | --- | --- |
| 1 | Tax mode confirmed; policy confirmed and approved by the lawyer | Dashboard screenshots; the lawyer's reply |
| 2 | Prices, hours, locations, buffers and the booking horizon set and reviewed by you | You |
| 3 | Every phase 2-4 suite and the whole `npm test` green; the invariants clean; **all mutation checks caught** | The test report |
| 4 | **The camp and the informational site tests unchanged and green** (`camp-untouched`, `launch-mode`) | The test report |
| 5 | The rehearsal passed, including the calendar-outage and sync drills | The rehearsal report |
| 6 | A real **confirmation email and reminders** received on Gmail and another provider; not in spam | You |
| 7 | The scheduler proven running for several days (the health line) | The dashboard |
| 8 | The phone close-out routine done by you at least once for each payment word | You |
| 9 | The Google audit done and the reconciliation plan executed, or "nothing was ever live" confirmed | The audit |
| 10 | The old Google booking routes disabled (kill-switch) and the old settings removed | A test and a settings check |
| 11 | A backup you have restored once; the database not shared with rehearsals | The restore drill |
| 12 | The privacy notice extended and live; the erase and copy tools tried | You |
| 13 | A rollback you have tried: switch the feature off and confirm the page shows call-or-text while existing lessons stay confirmed | The drill |
| 14 | An alert address that reaches you for calendar paused, emails failing and the scheduler stopping | A test alert |
| 15 | You say go | **You** |

**Rollback is simple and safe:** set the lesson switch off. The page shows "call or text", no new lesson can be booked, and every existing lesson stays confirmed and
keeps its reminders. Nothing is deleted.

---

## 9. Opening carefully (a pilot, not a flood)

1. Open with a **short horizon** (for example 7 days) and **1 upcoming lesson per person**, and tell only a few existing customers.
2. For two weeks, check every day: lessons booked, emails delivered, calendar events present, the close-out list, the unpaid list, the calendar health.
3. Widen the horizon to 60 days and the limit to 2 only when two clean weeks have passed.
4. Review the first month's numbers with me: how many lessons, how many no-shows, how many unpaid, how many cancellations and how late, how often the calendar paused.

---

## 10. Deliberately not included (so there are no surprises)

- **Text messages** (a paid provider; reminders are email).
- **Online prepayment for lessons** (the only exception is the optional, off-by-default packages).
- **Customers rescheduling themselves** (a switch exists, off).
- **Online weekly series** for customers (you create standing lessons).
- **Automatic fees, automatic cancellation or automatic "completed"** of any lesson: a person decides each.
- **Importing anything from Google.**

*Nothing in this document has been merged, deployed or switched on.*
