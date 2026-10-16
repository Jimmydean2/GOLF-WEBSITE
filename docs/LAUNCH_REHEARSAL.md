# Staging rehearsal plan: trying the real services with made-up families

The automated tests prove the *logic*: on a real PostgreSQL, against the real production build, with a
recording mail server. They cannot prove that **your** Gmail account, **your** Neon database, **your** hosting
plan and **your** bank behave the way the tests assume. This plan does that, in about **two afternoons and one
night**, using only made-up families and about **CA $5 of real money** that goes from one of your accounts
to another.

> **Nothing in this plan has been run.** No staging site, database, Gmail setup or scheduler exists yet, and
> nothing here is switched on until you say so. Steps that cost money or create an account are marked 💲 or 🆕.

**Rules**

1. **No real family's information, ever.** Names start with `TEST`, phone numbers are the reserved
   `514-555-01xx` range, parent emails are *your own inbox* (`you+rehearsal1@gmail.com` arrives in `you@gmail.com`).
   Children are made up. If a real parent gets hold of the staging address, tell them it is a test.
2. **A separate database.** A Neon *branch* named `rehearsal`. The live database never sees any of it, and the
   rehearsal database is never reused for the real launch.
3. **A preview deployment, not the live site.** Settings are scoped to *Preview* so the live site is untouched.
4. **No bulk email, no real families, no merge to `main`, no public launch** until you approve each.

You will need: your Neon account, the hosting account, the camp Gmail account (with its app password), a bank account
of yours to send from and the business account to receive in, a phone, a laptop with this project (`npm ci` done) and `psql`.

---

## 0. The plan at a glance

| When | What | Where in this page | Time |
| --- | --- | --- | --- |
| **Day 1, morning** | Make the Neon branch and the preview site, set the settings, run the preflight | §1 | ~1 h |
| | Gmail: do emails really reach inboxes? | §2 | ~30 min |
| | Parent tests: 14 realistic registrations in English and French, on phones | §3 | ~1.5 h |
| | The owner's day: confirm, release, search, download, erase | §4 | ~45 min |
| **Day 1, afternoon** | The bank: real $1.15 e-Transfers, Autodeposit | §5 | ~30 min + waiting |
| | The scripted safety drills (duplicates, last place, email failure) | §6 | ~30 min |
| | Leave one held reservation and a running site **overnight** | §7 | 5 min |
| **Day 2, morning** | The scheduled check: what ran overnight, what did not | §7 | 15 min |
| | Make time pass (reminders, releases, escalating alerts) | §8 | 30 min |
| | Neon sleep, pooled connection, certificate | §9 | 10 min |
| | Backups and a restore drill | §10 | ~45 min |
| | A burst of 10 families, then two phones at once | §11 | 15 min |
| **Day 2, end** | Clean up; fill in the results table; decide go / no-go | §12, §13 | 30 min |

### What the tests already proved (so staging only has to prove the platform)

| Already proved on a real database, locally | Only your real accounts can prove |
| --- | --- |
| Never over 30 (or 33 with your written authorization), however many families register at once, 100 at a time | Vercel really finishes the emails it sends after answering (`after()`), within your plan's time limit |
| A repeated submission (double-click, retry) makes one reservation; the same child and week twice is refused | The first request after Neon wakes from sleep is not too slow; the certificate check passes |
| The last place goes to exactly one family when 8 ask at the same instant; nobody is half-registered | Gmail delivers to Gmail, Outlook and Yahoo **inboxes**, with SPF and DKIM passing |
| A dead, slow or flaky mail server never loses an email: it is queued, retried, sent once | How many emails a day your Gmail account really lets you send |
| A reported payment is never released automatically; a lapsed unreported one can be confirmed from the bank | What your bank's deposit notice and transaction screen actually show (the reference? the sender?) |
| French and English end to end; every email in the family's language | How the pages and emails look on real iPhone Safari, Android and Outlook/Apple Mail |
| Roster downloads, privacy tools, waiting list | A scheduler that really wakes up on time (none is configured, by design) |

---

## 1. Set up the rehearsal copy (about 1 hour)

1. **Neon: make a branch.** Project → *Branches* → *New branch* from the main branch, named `rehearsal`.
   Apply the migrations (`001` to `008`) with the branch's **direct** connection string:
   `DATABASE_URL="<rehearsal direct connection string>" npm run db:migrate`. 🆕 *Running this on Neon is the first thing that touches a real service: it waits for your OK.*
   Copy the branch's **pooled** connection string (the host contains `-pooler`) for the site.
2. **Make it a rehearsal database:**
   `psql "<rehearsal direct connection string>" -v ON_ERROR_STOP=1 -f scripts/rehearsal-setup.sql`.
   Every week costs **$1.00 + tax = $1.15**, holds last **2 hours**, the reminder goes **1 hour** before the end. It refuses to run if any
   real-looking registration is present.
3. **Hosting: a preview deployment** of the `claude/youthful-faraday-doicas` branch (not the live site), with these settings *scoped to Preview*:

   | Setting | Value |
   | --- | --- |
   | `DATABASE_URL` | the rehearsal branch's **pooled** connection string |
   | `SEASON_PREVIEW` | `true`. **Read when the site is built**: the camp pages are built ahead of time, so set it *before* the preview builds, and **redeploy** after changing it. Without it a staging site says "dates coming soon" and refuses registrations (the 2027 dates are not confirmed yet). **Never set it on the real site.** |
   | `WAITLIST_ENABLED` | `true`, so you can see the waiting list (it is off by default) |
   | `REGISTRATION_LINK_SECRET` | 32+ random characters (any; it is a rehearsal) |
   | `ADMIN_PASSWORD` | a long passphrase |
   | `CRON_SECRET` | 32+ random characters |
   | `SITE_URL` | the preview's address, e.g. `https://golf-website-git-….vercel.app` (no trailing slash) |
   | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | the camp Gmail account (BOOKING_SETUP.md, Step 4) |
   | `ADMIN_ALERT_EMAILS` | your address, and a second person's if you have one |
   | `ETRANSFER_EMAIL` | the address you will send test e-Transfers to |
   | `ETRANSFER_AUTODEPOSIT` | `true` only if that address really has Autodeposit (§5) |
   | `CAMP_SHEETS_COPY`, `GOOGLE_*` | **leave unset** (camp data is not copied to Google; clinics and lessons are not part of this rehearsal) |

   *Preview protection.* Vercel normally puts preview deployments behind a Vercel login. If a phone or a friend cannot open the preview, look at the
   project's *Deployment Protection* settings (a shareable link, or protection off for this one preview). Either way, only made-up data goes there.
4. **Run the preflight** from your laptop, with the same values in a file called `.env.rehearsal` (never commit it):

   ```
   node --env-file=.env.rehearsal scripts/preflight.mjs --url https://YOUR-PREVIEW --send-test-email you@gmail.com
   ```

   Every line should be `ok`, or a `WARN` you understand (for example "privacy notice is a DRAFT", expected until a lawyer has read it).
   Fix any `FAIL` before going on. It also reports the database seed vs the season calendar, the waiting list and the Google Sheets copy.

---

## 2. Gmail: does the email really get there? (about 30 minutes)

The preflight sent one test email. Now check, in the camp Gmail's inbox **and** where parents read mail:

| Check | What you should see | Result |
| --- | --- | --- |
| The preflight test email | In the **inbox** (not Spam), from "James Dean Golf" | |
| The same test sent to a **Hotmail/Outlook**, a **Yahoo** and a **second Gmail** you own | In the inbox on all three, not Spam. (Quebec parents use all of them.) | |
| Open it on an **iPhone** and an **Android** | Readable, the button works, the layout is not broken | |
| **Reply** to it from another address | Arrives in the camp Gmail's inbox | |
| In Gmail, *Show original* on a received test email | `SPF: PASS` and `DKIM: PASS` | |
| Register a TEST family in **French** (§3, P2) and look at the instructions email | French subject, `436,91 $`-style amounts, the reference, a working private link that opens the French page | |
| Register a child named `TEST Émilie Côté` | The name is intact in the page and in every email | |

**Daily limit.** A personal Gmail account can send about **500 emails a day** (Google Workspace: about 2,000; Google counts a rolling 24 hours and
blocks sending for up to a day once you pass it). The site keeps its own count and holds back reminders and coach summaries near 400
(`EMAIL_DAILY_BUDGET`); family emails always try. Simulated opening days sent about 2.7 emails per registered family in the first few days, so **150
families is roughly 400 emails**, mostly in the first two days. The dashboard shows "N sent in the last 24 hours" so you can watch it (D3).

**If emails ever stop:** the dashboard box says *"N emails waiting"*. Usual causes: the app password was revoked (changing the Google
password can do this), the daily limit, or Gmail briefly refusing. Waiting emails are retried automatically.

---

## 3. Realistic parent registrations (about 1.5 hours)

Use two real phones (your own, plus a friend's if possible), one on Wi-Fi and one on mobile data. For each test, note ✔ / ✘ / what you saw.
**Reference numbers and private links** come on screen and in the email.

| # | A parent who… | Do this | Expected |
| --- | --- | --- | --- |
| P1 | registers one child for one week, in **English**, on a phone | Fill the form, three tick boxes, Register Now | Lands on their private page: reference, the exact amount with GST/QST, e-Transfer instructions, "held until" in **Montreal time**; instructions email within seconds; the page shows **no** birth date, health note or emergency contact |
| P2 | registers in **French**, on a phone | Start on the English page, tap "Français" in the header | The page, the form, errors, the private page, the privacy notice and **every email** are French; `436,91 $`; the holiday weeks explain themselves; "English" on the private page opens the *same* reservation |
| P3 | registers **two children for three weeks** in different months | Add a child, pick June, July and August weeks | One reservation; weeks listed in calendar order everywhere; one total |
| P4 | **makes mistakes** | A mistyped email, a phone without area code, a missing tick box, a child's birth date in the future | Each is refused in plain words in the page's language; nothing is reserved; no wait before trying again |
| P5 | **taps twice**, refreshes, or uses Back after submitting | Double-tap Register Now; refresh the confirmation; Back and submit again | **One** reservation, one reference; the week's count went up once |
| P6 | **registers the same child again** | Same child, same week, new browser | "Already registered"; the payment instructions are re-sent to the same email |
| P7 | **pays but never taps** the button | Send the $1.15 for a reservation; do nothing else | Reminder about an hour in; then released **with a release email that says "reply if you paid"**; you find them by the **amount or reference** and confirm from the bank (§4) |
| P8 | **does nothing** | Register and leave | Reminder, then released, with the release email; nothing else |
| P9 | **taps "I've sent my payment" without paying** | Tap it with no transfer | Held and flagged for your review; you see no deposit and release it (with the family's notice); that family cannot do it forever (strikes) |
| P10 | arrives when a week has **one place left** | Two phones, same week, register at the same moment (§6 does 8 at once) | Exactly one gets it; the other is told the week is full and can join the **waiting list** (if on) |
| P11 | is on a **slow or dropped connection** | Phone in airplane mode just after tapping Register; reopen | No second reservation is created by retrying; if the first went through the page link is in the email |
| P12 | uses a **keyboard or screen reader**, or zooms to 200% | Tab through the form; VoiceOver/TalkBack on the first screen | Every field has a label; no sideways scrolling; buttons reachable |
| P13 | **asks for a copy of their data, then to be erased** | Dashboard → find them → "Download this family's data"; then "Erase personal details" | A file with their registration, children, consent record; after erasing: no name, phone or health note anywhere in the dashboard, and their page says the reservation is no longer active |
| P14 | arrives **before registration opens** | Set `REGISTRATION_OPENS_AT` 15 minutes ahead (with its offset, e.g. `2027-01-16T09:00:00-05:00`), redeploy | The page counts down on the **server's** clock; at the moment it opens it unlocks by itself; before it, the form and the API both refuse |

---

## 4. The owner's day (about 45 minutes)

At `/admin/camp-rosters` (the guide for each is in `docs/ROSTERS_CONFIRMING_AND_WAITLIST.md` and `docs/PAYMENT_REVIEW_RUNBOOK.md`):

1. **Confirm a reported payment**: tap the button as a parent (P1), send $1.15 with the reference, find the deposit, **Confirm payment**. Expect the confirmation email (French for a French family).
2. **Confirm one nobody reported** (P7): search the **amount** or phone number; the family appears; **Confirm payment**. Then try it for a **released** family: **Reinstate & confirm payment**.
3. **A refusal you want to see**: register a TEST family for a week, let its hold lapse so it is released, then set that week's **Max Capacity** in the dashboard's week editor to the number of children now registered (so the week is full) and register another TEST family for it (or use the last-place drill in §6). Now try to confirm the released family: *"…now full… Nothing was changed. Your options…"*. Nobody else changes. Put the week back to 30.
4. **Wrong amounts**: confirm with $1.14: refused. Use the same bank confirmation number twice: refused.
5. **Release with and without the family's notice** (the tick box), in French and English.
6. **Downloads**: Excel and CSV, one week and all weeks, **Full** and **Sign-in sheet**. Open each on your laptop **and** phone; open the CSV in Excel and in Google Sheets (accents correct?). Check the file name says CONFIDENTIAL. After 15 minutes the password is asked again.
7. **Waiting list** (if on): join from a phone for a full week; look at the box; release a place; **Email: a place may be open**; check the email says nothing is held.
8. **Privacy tools**: download a family's data; erase a TEST family; look at "Privacy: season clean-up" (nothing is due until 90 days after a family's last camp week).
9. **Look at the activity log**: every action above is there, and no name, email or phone.

---

## 5. The bank: how does a deposit really look? (about 30 minutes, once)

This is the one thing no test can tell you: every bank shows e-Transfers a little differently. For each real $1.15 / $2.30 test transfer, write down:

| Question | Answer |
| --- | --- |
| How long after sending did the deposit appear in your business account? | |
| Does the **notification email** from your bank show the sender's **name**? The **message** (your reference)? | |
| Does the **online banking transaction detail** show the message? Where do you click? | |
| With **Autodeposit**: is the message still shown? (Some banks show the sender and message in Autodeposit notices; others, like [Desjardins' business page](https://coop.desjardins.com/ca/business/accounts-cash-management/interac-e-transfer-business/) describes, leave them out.) | |
| What does the screen show *before* the money has landed ("pending")? | |
| Is there a **per-transfer or daily receiving limit** on that account that a $436.91 payment, or a family paying for ten weeks (about $4,369), could hit? Ask your bank. | |

**Autodeposit test.** `ETRANSFER_AUTODEPOSIT=true` makes the instructions say "no password or security question". Turn it on **only** after you have
(a) registered the address for Autodeposit at your bank and (b) sent a test **from a different bank than the receiving one** and watched it land
without a question. A wrong promise makes a parent's transfer fail. While it is off the instructions tell parents to call you if their bank asks a
security question.

What the answers decide:

- **The reference is visible** → use "The reference is in the bank message" when confirming. Easiest and safest.
- **It is *not* visible** → match by **sender name, exact amount and time** and write how in the note. Consider telling parents you may phone them.
- **Autodeposit hides the message** but the transaction detail shows it → fine; check the detail, not the email.

Also, once each: send **$1.14** (one cent short), send **twice**, send with **no message**, send from **a different person's** account.
The site must refuse a wrong amount, and one bank confirmation number cannot be used twice.

---

## 6. The scripted safety drills (about 30 minutes)

`scripts/staging-verify.mjs` talks to the preview the way parents and your dashboard do (the same API, nothing special). It needs your
admin password in an environment variable, and `--confirm-rehearsal`; it **refuses a site whose camp week costs more than $5** (so it will not run on the real
site), uses only `TEST` names, and prints what it created so `scripts/rehearsal-reset.sql` can clear it.

```
ADMIN_PASSWORD='…' node scripts/staging-verify.mjs --base-url https://YOUR-PREVIEW --email-base you@gmail.com --confirm-rehearsal
```

| Drill | What it does | Pass means |
| --- | --- | --- |
| **Duplicates** | Sends one registration, then the identical request again, then six identical requests at the same instant, then the same child under a different key | **One** reservation and **one** held place; the repeats return the same reference; the different key is refused "already registered" |
| **The last place** | Limits one week to one free place (through your own admin screen), then eight different families register at the same instant, then a two-child family; then puts the week's limit back | Exactly **one** succeeds; seven are told the week is full (a normal answer, not an error); the week is exactly at its limit, never over; the two-child family is refused **whole** with nothing half-held |
| **Email health** | Runs the check, waits for the queue to empty, reads the dashboard's email status | Mail is connected; nothing waiting or failed |

**Email failure on the real platform** (the local tests already proved the logic; this proves it on Vercel + Gmail):

1. In the preview's settings put a **wrong** `GMAIL_APP_PASSWORD` and redeploy.
2. `… node scripts/staging-verify.mjs … --email-drill broken`: a family registers and gets their reference on screen with **no error**; the dashboard says an email is **waiting**, not lost.
3. Put the correct password back and redeploy.
4. `… --email-drill fixed`: the waiting email goes out; the instructions arrive in your inbox.

If a drill fails, **stop and tell me**; do not work around it.

The 8-at-once and 6-at-once requests come from one address, and the site allows **30 new reservations an hour per connection** (to stop a runaway script): running the drills
twice in an hour, or together with `rehearsal-register.mjs`, can hit that on purpose. Wait an hour, or use two networks.

---

## 7. The scheduled check, and a night with nothing running

One short job releases unreported holds, queues reminders, sends your alerts and retries failed emails (`docs/SCHEDULING.md`). **Nothing in the repository switches a scheduler on.**

1. **By hand, with the secret** (this is what a scheduler would call):
   `curl -s -H "Authorization: Bearer $CRON_SECRET" https://YOUR-PREVIEW/api/cron/payment-review`: a short JSON answer. Without the header: **401**.
2. **The health address**: `curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-PREVIEW/api/health/scheduler` is **200** if the check ran in the last 20 minutes, **503** if not, and reveals nothing else.
3. **The dashboard box** ("Automatic check ran 3 minutes ago") and the **Run the check now** button.
4. **The night test.** Before bed, register a TEST family and leave it unpaid (2-hour hold on staging). Do not visit the site. In the morning:
   - With **no scheduler**, nothing ran overnight: the reminder and the release notice go out the next time *anyone* visits (opening the dashboard starts a check). **That lateness is expected and safe: places free on time because every page that reads availability releases lapsed holds first.** Write down how late.
   - 🆕💲 If you later choose a scheduler (SCHEDULING.md §4), repeat the night: the reminder should have gone out about an hour in and the release email at the right time. Facts to plan with: Vercel's free (Hobby) plan allows scheduled jobs **at most once a day**, timed anywhere in an hour; the Pro plan allows a job every minute. [Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing). A free external pinger, or a Google Apps Script trigger, are the no-cost options.

---

## 8. Making time pass (optional but worth it)

Real holds are 12 hours and reviews 48 hours. On the **rehearsal** database only:

```
psql "<rehearsal direct connection string>" -v ON_ERROR_STOP=1 -v hours=2 -f scripts/rehearsal-time-machine.sql
```

then reload the dashboard (it starts a check) or press **Run the check now**. It refuses to run if the database holds anything that is not a `TEST` registration.

| Move forward | You should see |
| --- | --- |
| 1 hour (reminder time: hold 2 h, reminder 1 h before the end) | The reminder to families who have not tapped the button, **not** to one who has |
| 3 hours | Unreported holds released; the release email sent once each |
| 13 hours | A family that **tapped** the button is still held; nothing reported was released |
| 49 hours after a report | "Review due / overdue" emails to you |
| 4 days | "[CRITICAL]" emails; the payment still held |

---

## 9. Neon: what to watch (about 10 minutes)

- **First visit after being idle.** The free tier puts the database to sleep after about 5 minutes of no use; the next request wakes it (a second or two). Leave
  the preview alone for 10 minutes, then open the registration page on your phone and time the first load. Slow *first*, quick after.
- **Pooled connection.** The preflight reports whether you are on the `-pooler` host. Keep it.
- **TLS.** The preflight connects with full certificate checking. If it fails with a certificate message, tell me; do not switch checking off.
- **Connections.** During the burst (§11) Neon's dashboard should show a small number of connections.

---

## 10. Backups and a restore drill (about 45 minutes)

Know *before launch* how you would get back from a mistake (a deleted registration, a bad migration, a lost database).

**What Neon keeps.** Neon can restore a branch to an earlier moment within its *history window*. At the time of writing, from [Neon's documentation](https://neon.com/docs/postgres/backup-restore/history-window):
the **Free** plan keeps **6 hours**; the **Launch** plan **1 day by default (up to 7)**; the **Scale** plan **1 day by default (up to 30)**. Longer is billed. **Check your plan's current figure** in the Neon console: 6 hours is not enough to
notice a mistake on Monday that you made on Friday.

**The drill** (on the rehearsal branch, with TEST data):

1. Note the counts: `psql … -Atc "select count(*) from registrations"` and the week counts on the dashboard.
2. Make a deliberate mistake: delete one TEST registration with SQL, and note the time.
3. **Restore** with Neon: create a *new branch from a time just before the mistake* (or use the console's restore), and point `psql` at it. Confirm the registration is back and the counts match step 1.
4. **A copy you hold yourself.** `pg_dump --format=custom --no-owner "<direct connection string>" -f rehearsal.dump`. Create an empty throwaway database, `pg_restore` into it, run `node scripts/preflight.mjs` against it, compare the counts. Delete the dump and the throwaway database.
5. **Decide the routine** for the real launch and write it down: a `pg_dump` before opening day, then once a day during the first week and weekly after; kept on an encrypted drive only you control; **a dump is personal information about children**: delete old ones. A roster download (CSV) is a convenience copy, not a backup.

**Done when:** you have restored from a point in time once, restored a dump once, and written the routine down.

---

## 11. A small burst, then two phones (about 15 minutes)

```
node scripts/rehearsal-register.mjs --base-url https://YOUR-PREVIEW --email-base you@gmail.com --count 10 --confirm-rehearsal
```

All ten should succeed within seconds and ten emails reach your inbox. Then two phones on mobile data register two more TEST families at the same moment. Check the hosting provider's *Logs* for errors and the dashboard box for stuck emails. (The 300-family version runs automatically: `npm run test:opening-day`.)

---

## 12. Clean up

1. In Neon, **delete the `rehearsal` branch** (or run `scripts/rehearsal-reset.sql` to reuse it).
2. In the hosting settings remove the Preview-scoped values you added (especially `GMAIL_APP_PASSWORD`, `ADMIN_PASSWORD`, `DATABASE_URL`).
3. Confirm the **live** database is empty and has the real prices: `node --env-file=.env.production scripts/preflight.mjs --production` says *Registrations: none yet*, $380.00 a week, `SEASON_PREVIEW` not set.
4. Revoke any app password you made only for the rehearsal. Delete `.env.rehearsal`, any `pg_dump` file and any downloaded roster.

---

## 13. Record the results, and decide

| Area | Result (✔ / ✘ / notes) |
| --- | --- |
| Preflight passes with no FAIL | |
| Test email reaches Gmail, Outlook, Yahoo inboxes (not Spam); SPF and DKIM pass | |
| Instructions, reminder, release, confirmation emails arrive and read well on iPhone and Android, in English **and** French | |
| Accented names arrive intact | |
| P1 to P14 parent tests | |
| The owner's day (§4) | |
| A real e-Transfer is found and matched at the bank (and how); Autodeposit behaves as promised | |
| Wrong amount refused; same bank number refused twice | |
| Drills: duplicates, last place, email failure and recovery (§6) | |
| Night test: what ran, what was late | |
| First load after 10 idle minutes (seconds): | |
| Restore from a point in time works; a dump restores | |
| 10-family burst: all succeeded; emails all arrived | |
| Daily email count looks safe for the expected number of families | |

**Go / no-go.** Launch is reasonable when: no row above is ✘; the decisions in `docs/LAUNCH_CHECKLIST.md` are made (hosting plan, scheduler, season dates, language and privacy review);
the real database is a *fresh* one with migrations `001` to `008`; and you have read `docs/PAYMENT_REVIEW_RUNBOOK.md`. Any ✘ is a reason to stop and tell me, not to work around it.
