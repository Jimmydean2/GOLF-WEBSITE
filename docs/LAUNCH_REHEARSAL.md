# Launch rehearsal: trying the real services with made-up families

The automated tests prove the *logic*. They cannot prove that **your** Gmail account, **your**
Neon database, **your** bank and **your** hosting behave the way the tests assume. This is a
one-afternoon rehearsal that does exactly that, using only made-up families and about
**US/CA $4 of real money** that goes from one of your accounts to another.

**Rules**

1. **No real family's information, ever.** Every name starts with `TEST`, phone numbers are the
   reserved `514-555-01xx` range, and parent emails are *your own inbox* (`you+rehearsal1@gmail.com`
   arrives in `you@gmail.com`).
2. **A separate database.** Use a Neon *branch* (a copy) for the rehearsal. The live database
   never sees any of it. Do not reuse the rehearsal database for the real launch.
3. **Nothing here is switched on for you.** Each step names who has to click what. Steps that
   cost money or create an account are marked 💲 or 🆕 and wait for your OK.

You will need: your Neon account, the hosting account, the camp Gmail account (with its app
password), a second bank account of yours to send from (a personal account is fine), and a
laptop with this project (`npm ci` done) and `psql`.

---

## 1. Set up the rehearsal copy (30 minutes)

1. **Neon: make a branch.** In the Neon dashboard open your project → *Branches* → *New branch*
   from the main branch (named `rehearsal`). Apply the migrations if the parent branch is empty:
   `DATABASE_URL="<rehearsal direct connection string>" npm run db:migrate`. Copy the branch's
   **pooled** connection string (the host contains `-pooler`).
2. **Make it a rehearsal database:**
   `psql "<rehearsal connection string>" -v ON_ERROR_STOP=1 -f scripts/rehearsal-setup.sql`.
   This sets every week to **$1.00 + tax = $1.15**, holds to **2 hours**, and the reminder to 1
   hour before the hold ends. It refuses to run if any real-looking registration is present.
3. **Hosting: a preview deployment** of the `claude/youthful-faraday-doicas` branch (not the
   live site), with these settings *scoped to Preview* so the live site is untouched:

   | Setting | Value |
   | --- | --- |
   | `DATABASE_URL` | the rehearsal branch's pooled connection string |
   | `REGISTRATION_LINK_SECRET` | 32+ random characters (any; it is a rehearsal) |
   | `ADMIN_PASSWORD` | a long passphrase |
   | `CRON_SECRET` | 32+ random characters |
   | `SITE_URL` | the preview's address, e.g. `https://golf-website-git-….vercel.app` |
   | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | the camp Gmail account (BOOKING_SETUP.md, Step 4) |
   | `ADMIN_ALERT_EMAILS` | your address, and a second person's if you have one |
   | `ETRANSFER_EMAIL` | the address you will send test e-Transfers to |
   | `ETRANSFER_AUTODEPOSIT` | `true` only if that address really has auto-deposit |

4. **Run the preflight** from your laptop, with the same values in a file called `.env.rehearsal`
   (never commit it):

   ```
   node --env-file=.env.rehearsal scripts/preflight.mjs --url https://YOUR-PREVIEW --send-test-email you@gmail.com
   ```

   Every line should be `ok`, or a `WARN` you understand. Fix any `FAIL` before going on.

---

## 2. Gmail: does the email really get there? (20 minutes)

The preflight already sent one test email. Now check, in the camp Gmail's inbox **and** in the
other places parents use:

| Check | What you should see | Result |
| --- | --- | --- |
| The preflight test email | In the **inbox** (not Spam), from "James Dean Golf" | |
| Send the same test to a **Hotmail/Outlook**, a **Yahoo** and a **second Gmail** address you own | In the inbox on all three, not Spam. (Quebec parents use all of them.) | |
| Open the email on a **phone** | Readable, the button works, the layout is not broken | |
| **Reply** to it from the other address | Arrives in the camp Gmail's inbox | |
| In Gmail, *Show original* on a received test email | `SPF: PASS` and `DKIM: PASS` | |
| Register a TEST family (section 3), look at the **payment instructions email** | Reference `GD-XXXXXX`, the exact amount ($1.15), a "Open my reservation page" button that opens the private page | |
| The **accents**: register a TEST child named `TEST Émilie Côté` | The name is intact in the page and in every email | |

**Daily limit.** A personal Gmail account can send about **500 emails a day** (Google Workspace:
about **2,000**; Google counts a rolling 24 hours and blocks sending for up to a day once you
pass it). The site keeps its own count and holds back reminders and coach summaries as it
nears 400 (`EMAIL_DAILY_BUDGET`), but the family emails always try. Simulated opening days sent
about 2.7 emails per registered family over the first few days, so **150 families is roughly
400 emails**, most of them in the first two days: close to the limit for a personal account. If you expect that, plan for Workspace (or
a transactional email service) *before* launch. The dashboard box shows "N sent in the last 24
hours" so you can watch it.

**If emails ever stop:** the dashboard box says *"N emails waiting"*. Usual causes: the app
password was revoked (changing the Google password can do this: make a new one), the daily
limit, or Gmail briefly refusing. Waiting emails are retried automatically.

---

## 3. The whole journey with three TEST families (45 minutes)

From your laptop:

```
node scripts/rehearsal-register.mjs --base-url https://YOUR-PREVIEW --email-base you@gmail.com --count 3 --confirm-rehearsal
```

This creates `TEST Parent 1..3` (the second has two children). Write down each reference.
Then walk each family through a *different* ending:

| Family | What you do | What you should see |
| --- | --- | --- |
| **1. Pays properly** | Send a real e-Transfer of **$1.15** to `ETRANSFER_EMAIL`, with the reference in the message. Open the private page from the email, tap **I've Sent My Payment**. | Page says "Thank you — we're checking your payment". You get a "Payment reported" email (to `ADMIN_ALERT_EMAILS`). Dashboard shows it under *Payments to verify*. |
| **2. Pays, never taps** | Send **$2.30** (two children) with the reference. Do **not** tap the button. | After the 2-hour hold (use section 5 to skip ahead): a reminder about an hour in, then a "your reservation was released" email *with* "reply to this email if you paid". |
| **3. Does nothing** | Do nothing. | Reminder, then released, with the release email. |

Then, **as the administrator** (`/admin/camp-rosters`):

1. Open the bank, find the deposit for family 1 (section 4 explains what to check), click
   **Confirm payment**, enter the amount received, the time, and the reference. Expect the
   **"You're confirmed" email** with dates, times and what to bring.
2. Family 2: click **Reinstate & confirm payment** on the released reservation. Expect it back to
   **Paid** and a confirmation email.
3. Family 3: leave it released. Try **Confirm** with the wrong amount (`$1.14`): the site must refuse.
4. Look at the dashboard box: no emails stuck, scheduler line sensible.

---

## 4. The bank: how does a deposit really look? (15 minutes, once)

This is the one thing no test can tell you, because every bank shows e-Transfers a little
differently. For each real $1.15 / $2.30 test transfer, write down:

| Question | Answer |
| --- | --- |
| How long after sending did the deposit appear in your business account? | |
| Does the **notification email** from your bank show the sender's **name**? The **message** (your reference)? | |
| Does the **online banking transaction list/detail** show the message? Where do you click to see it? | |
| With **auto-deposit**: is the message still shown? (Some banks leave the sender and message out of auto-deposit notices.) | |
| With a **security question** instead: what extra step does a parent face? | |
| What does the screen show *before* the money has landed ("pending")? | |
| Does the sender see a confirmation number you could also ask a parent for? | |

What the answers decide:

- **The reference is visible** → use **"The reference is in the bank message"** when confirming. Easiest and safest.
- **It is *not* visible** (the bank drops the message) → you will match by **sender name, exact amount and time** ("My bank doesn't show it: matched by name, amount and time") and write down how. Then consider telling parents in the instructions that you may phone them; that line is in the instructions text in `src/lib/payment.ts`.
- **Auto-deposit hides the message** but the transaction detail shows it → fine; check the detail, not the email.

Also try, once each: send **$1.14** (one cent short), send twice, and send with **no** message.
The site must refuse a wrong amount, and it will not let one bank confirmation number be used twice.

---

## 5. Making time pass (optional but worth it)

Real holds are 12 hours and reviews 48 hours. On the **rehearsal** database only, you can move the
clock forward:

```
psql "<rehearsal connection string>" -v ON_ERROR_STOP=1 -v hours=2 -f scripts/rehearsal-time-machine.sql
```

then log in to the dashboard again and press **Run the check now** (or wait for the scheduler).
It refuses to run if the database has anything that is not a `TEST` registration.

| Move forward | You should see |
| --- | --- |
| 1 hour (reminder time: hold 2 h, reminder 1 h before the end) | The reminder email to families 2 and 3 only, not to family 1 (who tapped the button) |
| 3 hours | Families 2 and 3 released; the release email sent once each |
| 13 hours, to see a *reported* payment survive | Family 1's reservation is still held; nothing was released |
| 49 hours after a report | "Review due / overdue" emails to you for any reported payment you have not confirmed |
| 4 days | "[CRITICAL]" emails; the dashboard shows the payment still held |

(The 2-hour hold applies to reservations made *after* `rehearsal-setup.sql`; earlier ones keep their 12 hours.)

---

## 6. Neon: what to watch (10 minutes)

- **First visit after being idle.** Neon's free tier puts the database to sleep after about 5
  minutes of no use; the next request has to wake it (typically under a second, sometimes a couple
  of seconds). Leave the rehearsal alone for 10 minutes, then open the registration page on your
  phone and time the first load. A slow *first* load is normal; every later one should be quick.
- **Pooled connection.** The preflight reports whether you are on the `-pooler` host. Keep it.
- **TLS.** The preflight connects with full certificate checking. If it fails with a
  certificate message, tell me: do not simply switch checking off.
- **Connections.** Neon shows connections in use. During the 10-family burst (section 7) it
  should stay small.
- **Backups.** In Neon, look at *Restore/branch history* and note how far back you can restore on
  your plan. Decide whether that is enough once real registrations exist.

---

## 7. A small burst (10 minutes)

```
node scripts/rehearsal-register.mjs --base-url https://YOUR-PREVIEW --email-base you@gmail.com --count 10 --confirm-rehearsal
```

All ten should succeed within a few seconds, ten emails should reach your inbox, and the
dashboard should show them. Then, from two phones on mobile data, register two more TEST families
at the same moment. Check the hosting provider's *Logs* for errors, and the dashboard box for stuck
emails. (The 300-family version of this runs automatically: `npm run test:opening-day`.)

---

## 8. Clean up

1. In Neon, **delete the `rehearsal` branch** (or run `scripts/rehearsal-reset.sql` to reuse it).
2. In the hosting settings, remove the Preview-scoped values you added.
3. Confirm the **live** database is empty and has the real prices:
   `node --env-file=.env.production scripts/preflight.mjs` should say *Registrations: none yet* and show $380.00 a week.
4. Revoke any test app password you made only for the rehearsal.

---

## 9. Record the results

| Area | Result (✔ / ✘ / notes) |
| --- | --- |
| Preflight passes with no FAIL | |
| Test email reaches Gmail, Outlook, Yahoo inboxes (not Spam) | |
| SPF and DKIM pass | |
| Instructions, reminder, release and confirmation emails all arrive and read well on a phone | |
| Accented names arrive intact | |
| A real e-Transfer is found and matched at the bank (and how) | |
| Wrong amount refused | |
| Scheduler line healthy after the check is running | |
| First load after 10 idle minutes (seconds): | |
| 10-family burst: all succeeded; emails all arrived | |
| Daily email count looks safe for the expected number of families | |
