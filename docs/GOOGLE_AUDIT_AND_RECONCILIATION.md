# Google today: what exists, what is wrong with it, and a safe way to reconcile (no import)

**Status: the audit of the *code* is done; the audit of your *real* Google data has not been run, because it needs you.**
Nothing was read from your calendar, your Sheet or your mailbox, nothing was imported or changed, and no Google account
was touched. (This work environment has Google connectors available. I deliberately did **not** use them: reading your
calendar or Sheet would expose your customers' names, phones and emails, and you asked for an audit plan first. If you
want me to run the read-only audit of section 3, say so; it would only ever report counts, not people.)

This follows your decision G1: **do not import Google Calendar or Google Sheets bookings automatically.** Nothing in the
new system creates, changes or deletes a booking because of something found in Google (design rule I10).

---

## 1. What the current code writes to Google (read from the code, nothing guessed)

The old online booking is `src/app/api/lesson-booking`, `src/app/api/clinic-signup`, `src/lib/googleCalendar.ts` and
`src/lib/googleSheets.ts`. It exists only if the Google settings are present; with them missing it shows "being
finalized, call or email" (and the informational launch leaves them unset).

### 1.1 Google Calendar (one calendar: `GOOGLE_CALENDAR_ID`)

| What | Exactly |
| --- | --- |
| When | A customer books a lesson on `/book` |
| Event title | `Golf Lesson — First Last` (with an em dash) |
| Event description | `Phone: …` / `Email: …` / `10-minute buffer after this lesson before the next booking.` / (if repeating) `Recurring weekly for N weeks.` |
| Time | Start as chosen, end = start + **50 minutes** (the 10-minute buffer is *not* in the event; the code applies it when checking) |
| Weekly bookings | **One recurring event** with `RRULE:FREQ=WEEKLY;COUNT=N` (not N separate events) |
| Event id / tags | None. Google assigns a random id; there is no marker saying "created by the website" except the title prefix and the description lines |
| Read | `freebusy` on the same calendar: **everything marked busy on it counts**, your personal events included |

### 1.2 Google Sheet (`GOOGLE_SHEETS_SHEET_ID`, three possible tabs)

| Tab | Columns (row 1) | Filled by | Notes |
| --- | --- | --- | --- |
| `ClinicSignups` | Timestamp, First Name, Last Name, Email, Phone, Cohort, Message | the clinic form | Cohort is `may`, `august` or `september`, **with no year** |
| `LessonBookings` | Timestamp, First Name, Last Name, Email, Phone, Lesson Date, Lesson Time, Recurring | the lesson form | Lesson Date is like `Thursday, October 29` (**no year**), Time like `9:00 AM`, Recurring `No` or `Weekly × 4` |
| `CampRegistrations` | 19 columns (child, health note, emergency contact, …) | camp registration, **only if `CAMP_SHEETS_COPY=true`** (off by default) | Not part of this work; it should stay off |

There is **no payment, status or notes column** for lessons or clinics: nothing in Google says who has paid.

### 1.3 Other places customers' details may sit

Your own mailbox (Gmail) holds any emails customers sent you, and the camp's sent confirmations when Gmail is the mail
service. Neither is read or written by the lesson/clinic code.

---

## 2. Findings (problems in what exists today)

| # | Finding | Evidence | Why it matters | In the new design |
| --- | --- | --- | --- | --- |
| **F1** | **A problem report from Google is read as "completely free".** Google's free/busy answer can carry a per-calendar error (for example "not found" when a calendar stops being shared) inside an otherwise normal reply. `getBusyIntervals` reads only the busy list, so an error looks like an empty calendar and every time is offered. | `npx tsx docs/design/evidence/legacy-freebusy-errors.mjs` calls the real function with *simulated* answers: a normal answer keeps its busy time; "not found", "internal error" and "calendar missing" all return **0 busy periods**. (That Google really replies this way is from its documentation and is confirmed in the rehearsal.) | This is exactly the situation you asked me to make safe: the system would accept bookings blind | Any error, missing calendar, timeout or stale cache = **unavailable**, lessons are refused and the "call or text" card appears (design section 10, rule I7) |
| **F2** | **Check, then write: nothing locks the time in between.** Two customers within the same second both see "free" and both are booked. | `lesson-booking/route.ts`: reads busy time, then inserts the event | Double-booked lessons | The database refuses overlaps (rule I1; 50 simultaneous clicks, one winner) |
| **F3** | **Clinic capacity is counted per cohort name, forever.** The cap of 10 counts every row with `may` in the Sheet, whatever the year. Once ten people signed up for "May" in one year, "May" shows full in every later year unless the rows are deleted; and the whole Sheet is read on every sign-up, with the same check-then-append race as F2. | `clinic-signup/route.ts` filters `cohort === cohort`; no year anywhere | A full or overfull clinic series with no way to see it | Clinic offerings are dated rows with their own counter |
| **F4** | **The two writes are not one action.** The event is created, then the Sheet row; if the second fails the customer gets "something went wrong" while the event exists, and the retry is then told the time is taken. | `lesson-booking/route.ts` | Phantom bookings, confused customers | One database transaction; Google is written afterwards from a queue |
| **F5** | **Weekly bookings are checked on the wrong clock.** The check adds 7 x 24 hours; Google's recurring event keeps wall-clock time. After a clock change the two disagree by an hour. | `start + i*7*24*60*60_000`; reproduced in the sketch test | A weekly slot is checked at 8:00 while the event sits at 9:00 | Wall-clock arithmetic per week (tested across both clock changes) |
| **F6** | **Customers' phone numbers and emails sit in event descriptions** and Sheet rows, outside any privacy notice, consent record, retention rule or erase. | Section 1 | Law 25: you cannot honour an erase request for data at Google | New events carry no phone or email; the Sheet is retired |
| **F7** | **The old routes switch themselves on** as soon as Google settings exist, with no separate switch. | `isGoogleCalendarConfigured()` / `isGoogleSheetsConfigured()` are the only gates | Setting up the *new* calendar connection could accidentally publish the *old* race-prone booking | The old routes are disabled unless `LEGACY_GOOGLE_BOOKING=true` (phase 0), and the new connection uses different setting names |
| **F8** | **The website's Google access is wider than it needs.** One service account holds `spreadsheets` and `calendar.events` and is shared with "make changes to events", so it can edit or delete any event on that calendar. | `googleAuth.ts` | A bug or a leaked key could alter your personal calendar | Read-only free/busy on your personal calendars; write access only to a separate Bookings calendar |
| **F9** | **Dates without a year, and no payment record,** make the Sheet impossible to reconcile against the calendar by machine. | Section 1.2 | The reason reconciliation is by human review, not by script | `legacy_key` and human review (section 4) |
| **F10** | **All-day or "free" events may not block time.** Google's free/busy reports only events marked busy; an all-day "vacation" is often saved as free. | Google behaviour; to be confirmed against your calendar | Time you think is blocked could be offered | Vacations are entered as **Blocks** in the dashboard; the audit counts "free" all-day events |

None of these affects the camp, and none is a reason to delay the informational website: with the Google settings unset
(the launch configuration) the old booking is closed (`docs/WEBSITE_LAUNCH_MODE.md`).

---

## 3. The audit of your real data (read-only; not run yet)

The first question decides how much there is to do:

> **Has online lesson booking or clinic sign-up ever been live on the real website with the Google settings
> configured?**
> If **no**, there is nothing to reconcile: Section 4 reduces to "retire the unused Sheet tabs". If **yes**, real
> customers may have lessons booked for the future that exist only in Google.

You can answer everything below yourself in about fifteen minutes, with no access given to anyone. Tick what applies:

| # | Check (in Google or in your hosting settings) | Why |
| --- | --- | --- |
| A1 | Hosting dashboard (Vercel): are `GOOGLE_SERVICE_ACCOUNT_*`, `GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SHEET_ID` set on the **production** site? Since when? | Tells whether online booking was ever possible |
| A2 | Calendar: search `Golf Lesson` — how many events **in the future**? Any **recurring** ones (which ones end when)? | Future commitments = the only things that matter |
| A3 | Calendar: how many `Golf Lesson` events in the past year? | Volume, retention |
| A4 | Sheet: how many rows in `LessonBookings` and in `ClinicSignups`? Any with dates still ahead? | Same, for clinics |
| A5 | Is the calendar in `GOOGLE_CALENDAR_ID` your **personal** calendar or a separate one? | Decides the two-calendar setup |
| A6 | Who has access to that calendar and that Sheet (Share settings)? | Privacy and cleanup |
| A7 | Open an all-day event in your calendar: does it say **Busy** or **Free**? | F10 |
| A8 | Where do you record that a lesson or clinic spot was **paid**? (bank only, a note, a Sheet?) | A paid-status source for the manual entry |
| A9 | Do any customers have a weekly standing lesson right now? | Highest-risk legacy items |
| A10 | For the 2027 clinic cohorts (May / August / September): has anyone signed up or paid already? | Capacity to carry over |

### 3.1 Optionally, a read-only audit tool (built and tested on fake data first, only after you approve)

If you would rather not count by hand, phase **G0** would build `scripts/google-audit.mjs`:

- **Read-only** (it requests only read/free-busy permissions and cannot write), run **on your computer or under a
  session you watch**, with the credentials you provide for that run only.
- **Counts only, never people.** The report contains no names, emails or phone numbers. Example fields: events with the
  `Golf Lesson — ` prefix by month; recurring series and their end dates; **future** lessons; pairs of legacy events that
  overlap each other (possible old double-bookings); all-day events marked free; Sheet rows per tab, per cohort and
  year; rows where a Sheet lesson has no matching calendar event (by date and time only) and the reverse; duplicates
  detected by a one-way hash of the email, never printed.
- Tested against a fake Google (with deliberately messy data) before it ever touches yours, and it ships with a
  "dry run only" report that you read before anything else happens.

You approve the tool, the account it runs under and the output before it runs; I do not run it unasked.

---

## 4. The reconciliation plan (human decisions; nothing automatic)

*(Revision 2, 2026-10-17: private lessons are now booked without prepayment and paid at the lesson, so a hand-entered legacy lesson is simply a confirmed lesson that you close out afterwards with Paid - Cash, Paid - Interac or Unpaid. Clinic sign-ups keep advance payment.)*

Principle: **Google remains the record of what Google already holds. The new system only blocks around it, and takes new
bookings from the day it opens. Anything you want moved across, you enter yourself through the dashboard, where every
rule applies.**

### 4.1 What happens to each kind of legacy item

| Legacy item | Recommended handling | The new system's behaviour meanwhile |
| --- | --- | --- |
| **Past lessons and clinics** | Nothing is imported. Decide retention (I propose the same 90 days after the last session; keep what your accountant needs) and delete the rest from the calendar and Sheet | Not involved |
| **Future single lesson** | Leave it in Google (it already blocks the time), or enter it by hand as a **manual booking** tagged *legacy* (a confirmed lesson, paid at the lesson like any other, so it gets a reminder, a place on your Today list and a place in your close-out routine; it starts as Unpaid unless you already know it was paid) | The time is unavailable because the busy calendar shows it |
| **Future weekly (recurring) lessons** | Highest risk. Leave the Google series in place until it ends, or enter each by hand. The new system **never edits or deletes** them | Every week of the series blocks time through the busy calendar |
| **Clinic sign-ups (Sheet)** for a series that has not started | Enter each participant by hand as a clinic **manual booking** (tagged legacy, paid or not according to your knowledge). Their spots then count against the 10 in the database | Clinic capacity counts them from the moment you enter them; **until entered, they are not in the database**, so the offering must not be published until they are (a pre-publish checklist item) |
| **A clinic or lesson that conflicts with another** | The manual entry is refused by the same overlap or capacity rule, and you are shown what it conflicts with, so legacy double-bookings surface instead of hiding | Nothing is changed |

### 4.2 How a hand-entered legacy booking is protected

- It is created by the **manual booking** screen: `created_by = owner`, tagged `source = legacy`, with a
  **`legacy_key`** (a one-way hash of the source row or event id) that is **unique**, so the same Google item cannot be
  entered twice even by mistake.
- Entering it needs the **calendar check** like any lesson, except that, because the event already exists in Google, the
  override "I have checked my calendar" applies and is recorded.
- It does **not** create a second Google event (that would duplicate the one already there): legacy-entered bookings
  skip the outbound event, and are marked "already on calendar (legacy)".
- A **dry run** first: the audit tool (or you, from the lists) produces "here is what would be entered" with masked
  details; you approve a batch; nothing is entered without that.

### 4.3 The order of events

1. **Answer the audit** (section 3). If nothing was ever live, skip to step 5.
2. **Freeze the old booking** so no new items arrive while reconciling (it is already closed in the launch
   configuration; the phase 0 kill-switch makes that permanent).
3. **Decide** per item (table 4.1), with the dry-run report.
4. **Enter** what you chose, by hand, in batches you approve.
5. **Open the new system** (still only on your explicit approval), connected to your calendars as busy sources.
6. **Retire the old Sheet tabs:** export them to a file for your records, remove the service account's access, delete or
   archive the tabs, and remove the old settings (so the old routes cannot wake). Remove customers' phone numbers and
   emails from old event descriptions only if you choose to (a retention decision, not a requirement of the system).

### 4.4 Undoing it

Nothing here is destructive. The legacy Google data is never modified by the new system, so switching the new features
off (the flags) leaves Google exactly as it was. The only irreversible step is **your** deletion of old Sheet tabs or
events, which is step 6 and only after an export.

### 4.5 Privacy while reconciling

The Sheet rows have no consent record and no retention rule. Reconciliation is the natural moment to apply them: enter
only what you still need, tell those customers about the privacy notice with their first email from the new system, and
delete what is not needed. This list goes to the Quebec lawyer with the others (`docs/QUEBEC_LEGAL_REVIEW.md`).

---

## 5. What I did and did not do

- I **read** `lesson-booking`, `clinic-signup`, `lesson-availability`, `clinic-capacity`, `googleCalendar.ts`,
  `googleSheets.ts`, `googleAuth.ts` and `BOOKING_SETUP.md`, and wrote one small script that calls the existing
  `getBusyIntervals` with **simulated** Google answers (nothing leaves this machine).
- I did **not** read your calendar, your Sheet, your mailbox or your hosting settings, did not import anything, did not
  change any Google setting, and did not run any Google connector.
- I did not change the old routes. (Their phase 0 kill-switch is part of the plan and needs your approval because it
  edits two existing files.)
