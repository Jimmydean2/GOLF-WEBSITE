# Rosters, confirming a payment a parent never reported, and the waiting list

Three things you do from the dashboard (`/admin/camp-rosters`), what the site guarantees for
each, and what is still your decision. Everything below was exercised by automated tests and in a
real browser against made-up families; nothing was used with a real family.

**The record is PostgreSQL.** Availability, registrations, payments and rosters all come from the
camp database. Google Sheets is not read for any of them, and camp registrations are **not copied to
Google at all** unless you switch that on (§1.4).

---

## 1. Downloading the roster

### 1.1 What you can download

The **Download rosters** box has three choices:

| Choice | Options |
| --- | --- |
| **Which week** | All weeks, or any one week |
| **File type** | **Excel workbook** (print-ready: one sheet per week, at least 30 numbered rows, a "Read Me First" cover) or **CSV** (a plain list, opens in Excel, Numbers and Google Sheets) |
| **What it includes** | **Full roster**: child, age, parent, both phone numbers, parent email (CSV only), emergency contact, **allergies and medical notes**, payment status, reference. **Sign-in sheet**: child, age, parent, parent phone, payment status, and only "Medical note on file: Y/N". No health notes, no emergency contact, no second phone, no email. |

Use the **sign-in sheet** for anything that will lie on a table or be handed to a helper, and the
**full roster** for the coach who needs to know about an EpiPen.

Payment status is spelled out, so a printout cannot be misread: **Paid**, **Payment reported, not yet
verified**, **Awaiting payment**. Released, cancelled and erased registrations are never listed. "All
weeks" CSV has one row per place held, and the row count equals what the database counts (a test
checks that).

### 1.2 Privacy controls on every download

- **Your login and a recent password check.** A download asks for your password again if you last
  typed it more than 15 minutes ago. (The old plain link, which skipped that, is gone.)
- **Only from this site.** A request from another website is refused.
- **Never cached.** The file is sent with "do not store" headers and is named
  `CONFIDENTIAL-Junior-Camp-Roster-2027-07-05-signin-2026-10-16.csv` (week, contents, date).
- **Labelled.** The Excel workbook says CONFIDENTIAL on its cover and on every week's sheet, and
  advises shredding printouts. The dashboard says it before you download.
- **Recorded.** Each download writes one line to the activity log: what, which week, how many rows. The log
  never holds a name, email or phone number.

### 1.3 What a CSV protects you from (and the one thing you will notice)

A parent can type anything in a form field, including text that a spreadsheet would run as a formula
(`=HYPERLINK(...)`). In the CSV (and the Excel file) such text is kept as plain, visible text. In the CSV a
cell that starts with `=`, `+`, `-` or `@` gets a leading apostrophe: so a second phone typed as
`+1 514 555 0102` appears as `'+1 514 555 0102`. That is deliberate. Accents (é, ô) are correct in Excel
because the file starts with a byte-order mark.

### 1.4 Google Sheets

- Camp **availability, booking and rosters never read Google.** A test scans the code to keep it that way.
- Camp registrations are **no longer copied to a Google Sheet by default.** That copy put every child's date of birth and health
  note in a place that erasing a family and the end-of-season clean-up cannot reach, and the privacy notice
  did not mention it. To turn it back on (not recommended) set `CAMP_SHEETS_COPY=true` **and** complete
  BOOKING_SETUP.md Step 3, item 4. The preflight check warns when it is on.
- **Not part of this change, but you should know:** the **Saturday clinic sign-ups** and the **private lesson
  bookings** still use Google Sheets and Google Calendar as their storage. They are separate from the camp
  and were left alone. If you want them on PostgreSQL too, that is a separate piece of work: say so.

### 1.5 A download is a convenience copy, not a backup

For a real backup, see the rehearsal plan (§ "Backups and a restore drill" in `docs/LAUNCH_REHEARSAL.md`): the database's own
restore window, and a `pg_dump` you take yourself. A CSV is also personal information: save it only on a
device you control and delete it when the week is over.

---

## 2. "A parent paid but never tapped I've Sent My Payment"

This is the case where the money is in your bank account and the parent did nothing on the site.
**You do not need the parent's help.** The registration exists either way.

### 2.1 Find it from what the bank shows

In **Find a Registration** type any one of:

| The bank (or the parent) gave you | Type | Finds |
| --- | --- | --- |
| a reference | `GD-7K4M2Q`, `gd 7k4m2q`, `7K4M2Q` | that registration |
| the amount | `436.91`, `$436.91`, `436,91 $` | registrations **still needing a payment** (held, reported, or released) for exactly that amount. Once a registration is paid it no longer turns up for its amount. |
| a phone number | `514-555-0142`, `(514) 555 0142`, `+1 514 555 0142` | the parent's first or second number |
| a name or email | part of either | parent, child, email |

### 2.2 Confirm it

On the result, **Confirm payment** (if it is still held or reported) or **Reinstate & confirm payment**
(if the 12-hour hold ran out and the places were released). Enter the amount received, when it arrived and how you
matched it:

- the reference is in the bank message, or
- your bank does not show it: you matched by **name, amount and time**, and write a note saying how (required).

The site then makes the registration **Paid** and sends the family their confirmation email. It refuses, in plain
language, a wrong amount, a different reference, a deposit dated before the reservation or in the future, and a bank confirmation number
already used on another registration. A second click is harmless.

### 2.3 What the site never does here

- It **never takes a place from another family.** If the places were released and have since been taken,
  confirming is **refused** and nothing at all changes: the other families' status, holds, payments and places are
  exactly as they were, and the registration stays released. A test compares every other row before and after.
- It **never goes over a week's limit**, not even with two confirmations at the same instant for the last place (exactly one wins).
- All or nothing: a family registered for several weeks gets all of them back or none.

### 2.4 When the week has filled up (your decision, each time)

The dashboard says: *"This registration was released and the week is now full, so its spots can't be restored. Nothing was changed. Your options: refund
them by e-Transfer, offer another week, or authorize an extra spot for that week."* The extra spot is **your** recorded decision: a week can go from 30 to 33
only with a written reason (the database refuses a 34th). If the family paid before their hold ended, resolve theirs first.

---

## 3. The waiting list for full weeks

### 3.1 What it is, and is not

A family that finds a week full can leave their name, email, phone (optional), the number of children and the
weeks. **That is all.** It is **not a registration, holds no place, and promises nothing.** It cannot: the list has
no link to registrations, places or a week's count, and no code that touches it can change them (a database check
and a source scan prove it). Nothing happens automatically when a place opens.

It is **off until you switch it on**: set `WAITLIST_ENABLED=true`. While it is off families are not offered it
and the endpoint refuses. (This is decision W1 at the end of this page.)

### 3.2 What a family sees

On the camp page, a full week says "Full. You can join the waiting list below", and a section under the form (English or French) explains that
joining does not register or hold anything, asks for the details and a separate tick box, and sends a confirmation email that says the same.
The list is offered only for a week that is really full (not one you merely closed), only while registration is open.

### 3.3 What you do

The **Waiting list** box shows each full week, who joined in what order, how many places are free right now, and
whether each family has been emailed. You have two buttons per family:

- **Email: a place may be open.** Available only while that week really has room and is open, and only for a family
  that does not already hold a place there. It emails that one family: *a place may have opened; nothing is held; no promise; register on the website, first come, first served.* The same family cannot be emailed
  again within 12 hours, nor more than three times. Telling two families about one free place is allowed: whoever
  registers first gets it and the other is told the week is full, the ordinary way.
- **Remove.** Takes the family off and erases their request (and any email waiting for them).

You choose whom to email and when. The site does not rank, hold or pick.

### 3.4 Privacy

Kept until its camp week has passed, then deleted by the season clean-up (and the privacy notice says so). Erasing a family also erases a request made with the
same email address, and "Download this family's data" includes it. The activity log records that you emailed or removed someone, never who.
The wording is on the list for a Quebec lawyer (items L16, L17 in `docs/QUEBEC_LEGAL_REVIEW.md`): in particular whether a
withdrawal by phone or reply is enough, or each email needs a one-click "remove me" link (not built).

---

## 4. Decisions for you

| # | Question | My recommendation |
| --- | --- | --- |
| W1 | **Offer the waiting list at launch?** (`WAITLIST_ENABLED=true`) | Yes for staging, so you can see it. For the real launch: yes if you expect weeks to fill; it costs parents nothing and you control every email. It is off by default. |
| W2 | **Who gets the email first?** The list shows join order; you choose. | First joined first, as the list shows. |
| W3 | **One-click "remove me" link in the emails?** Not built. | Build it only if the lawyer (L16) says reply-or-phone is not enough. |
| W4 | **Sign-in sheet or full roster for camp days?** | Print the sign-in sheet for the check-in table; keep the full roster with the head coach. |
| W5 | **Keep the Google Sheets copy of camp registrations off?** | Yes (off). |
| W6 | **Move clinic sign-ups and lesson bookings off Google Sheets too?** | Your call; separate work, not needed for the camp. |
