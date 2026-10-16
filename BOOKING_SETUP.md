# Setting up online booking

One Google "service account" (think of it as a robot helper account) powers
everything below: it reads and blocks time on your **Google Calendar** for
1:1 lesson bookings (including recurring weekly bookings and browsing months
ahead), and it reads/writes your **Google Sheet** for Saturday clinic
sign-ups and your full client contact list. You set it up once, about 10
minutes total, and it all lives inside your own Google account.

---

## Step 1: Create the service account (one-time, ~5 minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   sign in with your Google account.
2. Create a new project (top left, name it anything, e.g. "James Dean Golf
   Website").
3. In the search bar, search for **"Google Sheets API"** and click **Enable**.
   Then search for **"Google Calendar API"** and click **Enable** too.
4. In the left sidebar go to **APIs & Services → Credentials**.
5. Click **Create Credentials → Service account**. Give it any name (e.g.
   "james-dean-golf-booking"), click through the remaining steps with
   defaults, then **Create**.
6. Click into the service account you just created → **Keys** tab → **Add
   Key → Create new key → JSON**. This downloads a `.json` file — keep it
   safe, don't share it publicly (it's like a password).
7. Open that JSON file in a text editor. You'll need two values from it:
   `client_email` and `private_key`. You'll use these same two values for
   both the Calendar and the Sheet below.

---

## Step 2: Connect your Google Calendar (lesson booking)

This lets clients book a 50-minute lesson (Monday–Friday, 9:00 AM–4:00 PM,
at least 24 hours ahead), including booking a recurring weekly spot in one
go, or browsing a couple months ahead — all blocked directly on your real
calendar under the client's name. Whatever time a lesson lands at, the
booking page automatically leaves the next 10 minutes off-limits too, so
there's always a breather before the next lesson can be booked.

1. Go to [calendar.google.com](https://calendar.google.com) and open
   **Settings** (gear icon) for the calendar you want lessons booked into
   (usually your main calendar).
2. Under **Settings for my calendars**, select that calendar → **Share with
   specific people or groups** → **Add people and groups**.
3. Paste in the `client_email` from your service account's JSON file, and
   set its permission to **"Make changes to events."** Save.
4. Copy the **Calendar ID**, found further down that same settings page
   under "Integrate calendar" — if it's your main calendar, this is usually
   just your Gmail address.

**Blocking off a day off:** just add a normal event (or mark yourself
"busy") on your Google Calendar for that day/time — the booking page
automatically won't offer times that conflict with anything already on your
calendar, no separate admin panel needed.

**How recurring bookings work:** if a client books "weekly for 8 weeks,"
that creates all 8 lessons on your calendar in one shot, reserved under
their name. If you ever need to change just one date in that series (e.g.
you need that one week off), open that single event on your calendar and
edit or delete just that occurrence — the rest of the series is unaffected.

---

## Step 3: Connect your Google Sheet (sign-ups + full client list)

This is your client "data bank" — every clinic sign-up, lesson booking, and
camp registration gets logged here as its own row, so **you can open it any
time** to see everyone's name, phone, and email. It also powers the live
"X of 10 spots left" counter on the Clinics page and the "X of 30 spots
left" counter on the Junior Camps page.

1. Go to [sheets.google.com](https://sheets.google.com) and create a new
   blank spreadsheet, named e.g. "James Dean Golf — Bookings".
2. Rename the first tab (bottom left) to exactly `ClinicSignups`. In row 1,
   add these exact column headers, one per cell:
   `Timestamp | First Name | Last Name | Email | Phone | Cohort | Message`
3. Add a second tab (the `+` at the bottom) named exactly `LessonBookings`.
   In row 1, add these exact column headers:
   `Timestamp | First Name | Last Name | Email | Phone | Lesson Date | Lesson Time | Recurring`
4. Add a third tab named exactly `CampRegistrations`. In row 1, add these
   exact column headers:
   `Timestamp | Parent Name | Email | Primary Phone | Secondary Phone | Child Name | Date of Birth | Child Age | Health/Medical Info | Emergency Contact Name | Emergency Contact Relationship | Emergency Contact Phone | Weeks | Code of Conduct Accepted | Consent Accepted | Registration ID | Paid | Paid At | Confirm Token`
   (A parent can register one child for several weeks at once — the "Weeks"
   column lists all of them together, e.g. `jul06,jul13`, rather than one
   row per week. The last four columns are filled in automatically by the
   site — you don't need to touch them. The real payment status lives in
   the camp database and your admin dashboard (Step 4 below), which is
   where you confirm a payment; the sheet is only a reporting copy.)
5. Click **Share** (top right) and share the sheet with the same
   `client_email` address from Step 1, giving it **Editor** access.
6. Copy the spreadsheet's ID from its URL — it's the long string between
   `/d/` and `/edit`, e.g.
   `docs.google.com/spreadsheets/d/`**`1AbC-xyz123...`**`/edit`.

---

## Step 4: Connect email for camp registrations and payment alerts (~3 minutes)

This is what makes camp registration run smoothly. The moment a parent
registers, they get an email with the Interac e-Transfer instructions, their
own payment reference (like `GD-7K4M2Q`) and a private link to their
reservation page; you get an email with their details. Their spots are held
for 12 hours. When they've sent the e-Transfer they tap **I've Sent My
Payment** (no account, no screenshots), you get an alert, and their spots are
protected for 48 hours while you check your bank account.

Once you can see the deposit in your bank account, open the dashboard, find
the registration, and click **Confirm payment** — that records what you
verified, confirms every week in the registration, and emails the parent a
full confirmation with their dates, drop-off/pick-up times, what to bring, and
safety info. The website never marks anything paid by itself, no email link can
change a payment, and only you, logged in, can confirm. If a reported payment
sits unchecked past 48 hours, nothing is released behind your back: it's
flagged for urgent review and you get louder and louder reminder emails (see
`docs/PAYMENT_REVIEW_RUNBOOK.md` for exactly what to do at each stage).
Nothing changes about how you actually get paid — parents still e-transfer you
directly, no processing fees, no new payment account.

This uses your own Gmail account to send the emails, via something called
an "App Password" (a special password just for this website — it doesn't
expose your real Gmail password, and you can revoke it anytime).

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
   and make sure **2-Step Verification** is turned on for your Gmail
   account (required for App Passwords — if it's already on, skip to step 2).
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Under "App name," type something like `James Dean Golf Website` and
   click **Create**.
4. Google shows you a 16-character password (four groups of four letters).
   Copy it — you won't be able to see it again after closing this screen.

---

## Step 5: Set an admin password for printable camp rosters (~1 minute)

This gives you a private page, **yoursite.com/admin/camp-rosters**, where
you can download a print-ready roster workbook any time — one sheet per
camp week, every registered camper's name, age, parent, phone numbers,
emergency contact, allergy notes, and paid status already filled in from
real sign-ups, plus blank rows (at least 30 per week) so you can hand it
straight to whoever's working that week. It's always current — download
it again any time and it reflects every registration up to that second.

This same page is where you review and confirm camp payments, so please pick
a **long, unique password** (a few random words is fine) that you use nowhere
else, and send it to me along with the other items below — no account to
create, nothing to click through. Keep it private; anyone with it can see
campers' contact and health info and confirm payments. The login locks for 15
minutes after five wrong tries, payment actions ask for the password again,
and there is a **Log out everywhere** button if a device is ever lost.

---

## Step 6: Create the camp registration database (~10 minutes)

Camp registration now runs on its own small database instead of counting
rows in a spreadsheet — this is what makes the "never more than 30 kids
in a week" rule hold up even if dozens of parents hit submit at the exact
same second (tested up to 100 at once; see the readiness report). The
database also enforces the payment rules: a registration can't be marked paid
without a verified deposit on record, and the audit log can't be edited. A
week can only go above 30 (to a maximum of 33) when you authorize it with a
written reason. Without
this step, the registration form and the live spots-remaining counts on
the Junior Camps page won't work — everything else on the site (lessons,
clinics, the rest of the pages) works fine either way.

1. Go to [neon.com](https://neon.com) and sign up. The free tier is big
   enough for this site's size, but it puts the database to sleep after
   about 5 idle minutes (the first visit after a quiet spell takes a second
   or two longer), and how far back you can restore depends on your plan:
   check that before real registrations arrive.
2. Click **Create a project**. Give it any name (e.g. `golf-website`).
   For region, pick the one geographically closest to your visitors
   (e.g. a US East region if nothing in Canada is offered) — flag this
   choice in the privacy review doc I shared, since it affects where
   campers' information is physically stored.
3. Once it's created, go to the project's **Connection Details** and
   make sure the toggle says **Pooled connection** (not "Direct
   connection") — this matters for reliability once the site is live;
   the two look almost identical but only one is correct here.
4. Copy the connection string — it looks like
   `postgresql://user:password@ep-something-pooler.region.aws.neon.tech/dbname?sslmode=require`.

Send me that connection string along with the other items below, and
I'll both add it to the hosting environment and run the one-time setup
(`npm run db:migrate`) that creates the camp registration tables, the 10
weeks' worth of seed data, the database-level capacity and payment
safety rules (`003_capacity_integrity.sql` and `004_payment_policy.sql`), and
the reliable-email queue and scheduled-check log (`005_email_outbox.sql`) —
nothing further for you to do. (Use a **new, empty** database for the real
launch: never the one used for the rehearsal in `docs/LAUNCH_REHEARSAL.md`.)

---

## Step 7: Your Interac e-Transfer details (~2 minutes)

Three quick answers so the parent's instructions and your alerts are right:

1. **Which email address do parents send the e-Transfer to?** (If you don't
   say, I'll use your business email.)
2. **Is Autodeposit turned on for that address at your bank?** If yes, parents
   don't need a security question. If you're not sure, say so — I'll leave it
   off, and the instructions just tell parents to send the e-Transfer and tap
   **I've Sent My Payment**.
3. **Who should receive the payment alerts?** Your own email, plus ideally a
   backup person's email so an alert is never seen by only one inbox.

(I'll also generate two private random keys for the hosting settings
myself — one that signs each parent's private reservation link, one that
protects the scheduled payment check. You don't need to do anything for them.)

---

## Send me these things and I'll wire it all in

- The `client_email` value from the JSON file (Step 1)
- The `private_key` value from the JSON file (the whole thing, including
  the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines)
- The Calendar ID (Step 2)
- The spreadsheet ID (Step 3)
- Your Gmail address (Step 4)
- The 16-character App Password (Step 4)
- Your chosen admin password (Step 5)
- The database connection string (Step 6)
- Your three e-Transfer answers (Step 7)

These get set as private environment variables on the hosting side (never
committed to the code), matching the names in `.env.local.example` in this
repo: `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
`GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SHEET_ID`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
`ADMIN_PASSWORD`, `DATABASE_URL`, `ETRANSFER_EMAIL`, `ETRANSFER_AUTODEPOSIT`,
`ADMIN_ALERT_EMAILS`, `SITE_URL` (your site's real web address, used for the links in
emails), plus two keys I generate: `REGISTRATION_LINK_SECRET` and `CRON_SECRET`.
Optional: `COACH_NOTICE_MODE` (digest, each or off), `EMAIL_DAILY_BUDGET`.

**Before launch:** run `node scripts/preflight.mjs` (it checks every setting, the
database and the live site), do the rehearsal in `docs/LAUNCH_REHEARSAL.md` with made-up
families, and work through `docs/LAUNCH_CHECKLIST.md`.

Once those are set:
- The **Book a Lesson** page shows a real month calendar of your actual open
  times, lets clients book one-time or recurring weekly lessons, and blocks
  the time on your calendar automatically.
- The **Clinics** page automatically shows live spots-remaining per month
  and disables a cohort once it hits 10 sign-ups.
- The **Junior Camps** page automatically shows live spots-remaining per
  week and disables a week once it is full (30 children, or the higher number
  you've authorized for that week, up to 33). Each week tile
  on the page is clickable and jumps straight to the registration form
  with that week pre-selected. Parents can select multiple weeks in that
  same form — filling out their info once — and the running total price
  updates live as they add or remove weeks.
- Every booking, sign-up, or registration appends a row to your sheet — no
  further setup needed.
- Every camp registration sends the parent their Interac instructions and
  private reservation page, and tells you about it. Once the e-transfer is
  showing in your bank account, **Confirm payment** in the **Payment review**
  box at the top of the admin page records what you verified and emails the
  parent their full confirmation (dates, drop-off/pick-up times, what to
  bring, safety info). Confirming a second time is harmless — it won't send a
  duplicate email. A parent who reports payment is protected for 48 hours;
  after that the registration is flagged overdue and you get escalating
  reminders, but it is never released or marked paid automatically. You can
  **Extend review** (with a note) for a delayed transfer, or **Release** it if
  the money never arrives. If a registration was released and the family turns
  out to have paid, **Reinstate & confirm payment** restores their spots — but
  only if the week still has room; if it doesn't, nothing changes and the
  dashboard tells you why.
- **yoursite.com/admin/camp-rosters** (behind your admin password) lets
  you download a printable roster workbook any time, one sheet per camp
  week, auto-filled with every current registration — always up to date,
  no manual copying. The same page also lets you search for a family's
  registration (by name or payment reference) and cancel it, resend either
  email, check a camper in, adjust a week's price, open status and capacity
  (up to 30 freely; 31 to 33 only with a written reason), and see a log of
  every admin action taken.

---

## Publishing the site (~5 minutes, no coding)

The code lives on GitHub, but that alone doesn't put it on the internet —
that takes one more step: connecting this repo to a hosting service. I'd
recommend **Vercel**, the company that makes Next.js (the framework this
site is built with); deploying from GitHub is a few clicks with nothing to
configure. **One cost to know about:** Vercel's free "Hobby" plan is for
non-commercial, personal use only, and its rules count taking payments or
advertising a business as commercial use. A business site that takes camp
registrations belongs on the paid **Pro** plan (about US$20 a month at the time of
writing; please confirm on vercel.com/pricing). It also lets the automatic
payment check run every few minutes (docs/SCHEDULING.md). I won't sign you up
for anything: that is your decision (see docs/LAUNCH_CHECKLIST.md).

1. Go to [vercel.com](https://vercel.com) and sign up using the **same
   GitHub account** this repository lives under (look for "Continue with
   GitHub"). This lets Vercel see your repos without you creating a
   separate password.
2. Click **Add New... → Project**, then find and select the
   `GOLF-WEBSITE` repository and click **Import**.
3. Vercel auto-detects it's a Next.js site, so the build settings are
   already correct — just click **Deploy**. It takes a minute or two.
4. You'll get a free address like `golf-website-xyz.vercel.app`
   immediately. If you own a domain (or want to buy one, e.g. from
   Namecheap or Google Domains), go to the project's **Settings →
   Domains** in Vercel and follow the prompts to connect it — Vercel
   walks you through the few DNS records to add at your domain
   registrar.
5. Any time new code is pushed to this repo's main branch going forward,
   Vercel automatically redeploys the live site within a minute or two —
   nothing further to click.

Once live, go back to **Steps 1–7** above whenever you're ready: send me
the items listed above and I'll add them as private settings in the Vercel
project (**Settings → Environment Variables**) myself, or walk you
through adding them there directly if you'd rather handle it yourself.

Until both the deployment and the credentials are in place, the
site gracefully shows a "reserve by phone/email" fallback in the booking
spots, so nothing looks broken or half-finished in the meantime — you can
publish now and wire up live booking whenever the credentials are ready.
