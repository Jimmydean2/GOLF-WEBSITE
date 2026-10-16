# Camp payments: how to review, confirm and escalate

This is the procedure for the Interac e-Transfer registrations. It is written
for whoever is looking after the camp inbox and the review queue (today that
is James). Keep it open the first few weeks; after that it takes about two
minutes a day.

**The one rule behind everything:** a parent clicking *"I've Sent My
Payment"* is a *claim*, not proof. A registration becomes **Paid** only when an
administrator has seen the deposit in the real bank account and confirms it
on the dashboard. The website never marks anything paid by itself, and no
email link can change a payment.

---

## 1. What happens to a registration (and when)

| Step | What the parent sees | What the system does |
| --- | --- | --- |
| **Register** | Interac instructions, a unique reference (like `GD-7K4M2Q`), the exact amount (tax included) and a private link | Holds the spots for **12 hours** ("Awaiting Payment") |
| **Parent sends the e-Transfer** and taps **I've Sent My Payment** | "Thank you — we're checking your payment" (their spot is being held while you verify) | Status becomes **Payment Reported — Awaiting Verification**. The spots are protected while you verify, with a **48-hour** review window. You get an email straight away. |
| **No report, about 9 hours in** (3 hours before the hold ends) | A short reminder email: "already sent it? tap the button; haven't? here is how" | Sent once, only to families who have not reported or paid |
| **No report within 12 hours** | An email saying the reservation was released (and what to do if they did pay) | The spots are released automatically (reason: no payment reported in time) |
| **You see the deposit and click Confirm payment** | A confirmation email with dates, times and what to bring | Status becomes **Paid**, with a record of what you verified |

**After 48 hours the system never releases a reported payment by itself.**
Instead it flags it **overdue**, puts it at the top of the review queue, and
sends you louder and louder emails (section 4) until a person decides. Only an
administrator can release it, confirm it, or extend the review.

---

## 2. Your daily routine (2 minutes)

1. Open **/admin/camp-rosters** and log in. At the top, the **Automatic checks and email**
   box should be calm: *"Automatic check ran N minutes ago"* and *"No emails waiting"*. If it
   is red, see section 11. Below it, the **Payment review** box: if anything is red, that is the
   first thing to deal with.
2. For each **Payment reported** card (most overdue first), open your **bank
   account** (the bank's own app or website, never a link in an email) and
   look for the deposit. Then use the table below.
3. Open **Awaiting payment** and look in the bank for those references too. *This is the safety
   net for a family that paid but never tapped "I've Sent My Payment".* If the money is there,
   click **Confirm payment** right away: the family does not need to tap anything first. The
   rest release themselves after 12 hours, and each family gets a reminder before that.

### What to check in the bank before you click Confirm

All four must be true:

- the money is **in your account** (not "pending", not a request, not an email
  saying you "have money waiting");
- the amount is **exactly** the amount due on the card (tax included);
- the **reference** (`GD-XXXXXX`) is in the transfer message, **or** the sender's
  name, the amount and the time clearly match this family;
- it has not already been used for another registration.

A screenshot or a parent's word is never enough. Fake "you've received money"
emails exist: always go to the bank directly.

### What you see → what to click

| In the bank | Click |
| --- | --- |
| Deposit with the reference and the exact amount | **Confirm payment** → "The reference is in the bank message" → enter the amount, the deposit time and the reference → tick *I can see this deposit in my bank account* |
| Deposit with the exact amount and a matching name, but no reference | **Confirm payment** → "My bank doesn't show it: matched by name, amount and time" → write how you matched it in the note |
| Deposit but **too little** | Do **not** confirm. Email or call the parent for the rest. Click **Extend review** (note: "short by $X, parent contacted") while you wait. If the rest arrives as a second transfer, confirm with the **total** and write both transfers in the note. |
| Deposit but **too much** | Send the extra back by e-Transfer first, then confirm using the amount due and say what happened in the note. |
| Nothing there, but the bank shows the transfer as **pending/delayed** | **Extend review** (24 hours is the default; note: "bank shows pending") |
| Nothing there at all | Contact the parent (phone and email are on the card). Ask for the bank's **Interac confirmation number** and which address they sent it to. If they say it was sent a moment ago, **Extend review** once. |
| Still nothing after the **[ESCALATED]** email | **Release (not received)**. Tick *I checked my bank and the payment was not received* and add a note. |
| A deposit turns up **after** you released it | See section 5 |

Extensions are limited on purpose: 1 to 72 hours each, **two per
registration**, each with a note, each recorded in the log. The goal is that
no spot is ever held indefinitely.

---

## 3. Who is allowed to do what

- **Parents** (private link): view their reservation and tap *I've Sent My
  Payment*. That is all. They cannot confirm, release or extend anything.
- **Emails** (to you or to parents): never contain a link that changes a
  payment. The only link in an alert is the login-protected review queue.
- **Administrator** (logged in): confirm, release, extend, reinstate, change
  capacity. These actions ask for your **password again** if you have not typed
  it in the last 15 minutes, so a laptop left open cannot move money state.
- **The database itself** refuses to record a Paid registration without the
  verification record (amount, deposit time, how it was matched) and refuses
  to let any week go over its limit. Even a mistake in the website cannot
  override that.

Every action is written to the **audit log** (who, what, when, your note). The
log cannot be edited or deleted, even by the website.

---

## 4. Alerts and escalation

Times are counted from the moment the parent reported. Defaults:

| When | Email subject starts with | Meaning | What to do |
| --- | --- | --- | --- |
| Right away | `Payment reported` | A parent says they sent it | Check the bank when you next can |
| 42 hours (6 h before the end) | `Review due soon` | The review window ends in about 6 hours | Check the bank today |
| 48 hours | `[URGENT] Payment review overdue` | The window ended. **The spots are still held.** | Confirm, extend or release today |
| 54 hours, then every 6 hours | `[REMINDER] Payment review still overdue` | Still waiting for you | Same |
| 72 hours (a day overdue) | `[ESCALATED] Payment review overdue` | A day overdue; the spots may be turning away other families | Decide now. If the deposit is not there, release it |
| 5 days (three days overdue), then every 6 hours | `[CRITICAL] Spots blocked by an unverified payment` | Reminders stop; this repeats until it is resolved | Release it or confirm it. A spot held for nobody is a lost sale |

If you extend the review, the schedule starts again from the new review time.
Once a registration is confirmed or released, its alerts stop.

**Who receives these:** the addresses in `ADMIN_ALERT_EMAILS` (or the business
address if that is not set). Put a **backup person's address** there as well,
so an alert is never seen by only one inbox.

**If email is not connected**, no alerts can be sent. The red banner in the
review queue is then the only signal, so open the queue every day.

**How often the check runs:** see docs/SCHEDULING.md. In short: until you choose a
scheduler, the check starts when someone visits the registration form or a parent's page, or
when you open the dashboard (at most once every 5 minutes), so a quiet night can delay a
reminder or an alert. The box at the top of the dashboard always says when it last ran, and
**Run the check now** runs it on demand. Spots are never affected: they are freed on time
regardless.

---

## 5. A deposit arrives after the reservation was released

Money received is never lost, and never silently ignored:

1. Find the family: open *Recently released* in the queue (it covers the last 14
   days), or search by their reference or name.
2. Click **Reinstate & confirm payment**, enter what you see in the bank.
3. If the week still has room, the spots come back and the registration is
   **Paid**. The confirmation shows whether they paid within their original 12
   hours.
4. If the week filled up in the meantime, **nothing changes** and the
   dashboard says so. Your options, your call:
   - refund by e-Transfer and offer another week or the waiting list;
   - if it is operationally appropriate (enough coaches, ratios, venue), raise
     that week by one (section 7). It must be a conscious decision, with a
     written reason;
   - never overbook silently: the system will not allow it.

The release email a family receives tells them to reply with their reference if
they did pay, so these cases normally reach you by email.

---

## 6. When a report turns out to be false

If you release a **reported** payment as *not received*, it counts as a strike
against that parent's email address and phone number. After **two strikes in 30
days**, the *I've Sent My Payment* button no longer appears on that contact's
new reservations (they still get the normal 12-hour hold and can still pay and
tell you directly; you can still confirm any deposit you actually see).
Confirming a real payment from that contact clears their strikes.

A parent can hold at most **8 open reservations** at once. That counts *submissions*, not
children or weeks: one submission can include several children and up to all ten weeks.
(The form is also limited per connection and per email address, but form mistakes and
retries do not count against it.)

A child can only be reserved once for a given week under the same email address or phone
number. A parent who registers again because "the email never came" is told they already
have a reservation, no second one is created, and the payment instructions are sent again
to the address on file (at most once an hour). If a parent made a mistake and needs it
changed, release their reservation from the dashboard and let them register again.

---

## 7. Capacity: 30 normally, up to 33 only on purpose

Every week holds **30 children**. In the *Weeks* table you may raise a week to
31, 32 or 33. The dashboard asks for a written reason (at least 10 characters)
and asks for your password. Only do it when it is operationally appropriate:
enough coaches for the ratio, the venue and insurance allow it. Do **not** raise
capacity to get around an overdue claim: release the claim instead. The
database refuses any number above 33, and refuses any number above 30 that does
not have a recorded reason.

---

## 8. If you are away

Plan ahead for trips longer than a weekend:

1. **Before you go:** add a second address to `ADMIN_ALERT_EMAILS`. Check that
   the alerts land in the inbox (not spam).
2. **What happens while you are away:** nothing is released and nothing is
   marked paid. Emails that fail keep being retried. A claim flagged overdue keeps holding its spots and you (and
   your backup) get the emails above. Reservations that nobody reported still
   release themselves after 12 hours.
3. **Coming back:** open the review queue first. Work from the top (most
   overdue). Release anything you cannot find in the bank; a family with a real
   payment can be reinstated (section 5).

*Open decision for James:* today there is one admin login. A backup can receive
alerts but cannot act unless you share the password with them. The safer
options (a second login, or an authenticator-app code) are listed as decisions
in the Stage 2 report.

---

## 9. Keeping the admin login safe

- Use a **long, unique password** (a few random words is fine) that you use
  nowhere else. Never send it by email or text.
- Five wrong passwords from one place lock the login for 15 minutes (even the
  right password is refused during that time). This also applies to the
  "confirm your password" box.
- A login lasts at most 24 hours, and ends after 4 idle hours. Use **Log out**
  on shared computers.
- Lost a device, or think someone else knows the password? Use **Log out
  everywhere**, then change `ADMIN_PASSWORD` in the hosting settings. Look
  through the audit log for anything you do not recognise.

---

## 10. Monthly check (5 minutes)

- Skim the audit log for actions you do not remember.
- Confirm the alert emails still reach you (and your backup), and are not in
  spam.
- Look at *Released* in the queue: any "released, but they emailed that they
  paid"? Handle them (section 5).
- Make sure no registration has been in *Payment reported* for more than a
  few days. If one has, decide it today.
- Look at the emails-in-24-hours count in the dashboard box. If it is regularly above 300
  on a Gmail account, plan for a Workspace account (see section 11).

---

## 11. Email and the automatic check: what the dashboard box means

| What the box says | What it means | What to do |
| --- | --- | --- |
| *Automatic check ran N minutes ago* | All good | Nothing |
| *Triggered by site visits: no scheduled job is set up yet* | It runs only when someone visits | Choose a scheduler (docs/SCHEDULING.md) before launch, or check the box daily |
| *The automatic check last ran 3 hours ago…* | Nothing has run for a while; reminders, alerts and emails may be late | Press **Run the check now** |
| *The last automatic check FAILED: …* | Usually the database was briefly unreachable | Press **Run the check now**; if it fails again, tell me |
| *N emails waiting to be sent* | Gmail refused or was unreachable; each is retried with growing delays | Wait a few minutes, then **Run the check now**. If it persists, see below |
| *N emails could not be delivered. Call the family* | The mail server said the address does not exist (a typo, usually) | **Phone the family** (their number is shown) and tell them their reference and how to pay; they can also open the reservation page they were shown after registering |
| *Email is not connected* | Gmail settings missing or wrong | Fix the settings (BOOKING_SETUP.md, Step 4) and press Run the check now; waiting emails are sent then |

**If emails keep stopping:** (1) the Gmail app password may have been revoked (changing the
Google password can do this): make a new one and update `GMAIL_APP_PASSWORD`; (2) the daily
limit: a personal Gmail account sends about 500 emails a day (Workspace: about 2,000) and
refuses more for up to a day. The site holds back reminders and coach summaries as the count
nears 400, but payment instructions and confirmations always try.

**Bounces you will not see here:** Gmail often *accepts* mail for a mistyped address and then
sends you a "Delivery Status Notification (Failure)" in the Gmail inbox. Watch for those in the
first days and phone the family.

**Coach summaries:** you get one summary email an hour (not one per registration), and no health
details, birth dates or emergency contacts are ever put in an email: they are on the dashboard.
`COACH_NOTICE_MODE=each` sends one per registration; `off` stops them.
