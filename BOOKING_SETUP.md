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

This lets clients book a 40-minute lesson (Monday–Friday, 9:00 AM–4:00 PM,
at least 24 hours ahead), including booking a recurring weekly spot in one
go, or browsing a couple months ahead — all blocked directly on your real
calendar under the client's name. Bookable start times are still 50 minutes
apart, so the last 10 minutes of each slot is automatically left open as a
buffer before your next lesson.

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

## Step 3: Connect your Google Sheet (clinic sign-ups + full client list)

This is your client "data bank" — every clinic sign-up and every lesson
booking gets logged here as its own row, so **you can open it any time** to
see everyone's name, phone, and email. It also powers the live "X of 10
spots left" counter on the Clinics page.

1. Go to [sheets.google.com](https://sheets.google.com) and create a new
   blank spreadsheet, named e.g. "James Dean Golf — Bookings".
2. Rename the first tab (bottom left) to exactly `ClinicSignups`. In row 1,
   add these exact column headers, one per cell:
   `Timestamp | First Name | Last Name | Email | Phone | Cohort | Message`
3. Add a second tab (the `+` at the bottom) named exactly `LessonBookings`.
   In row 1, add these exact column headers:
   `Timestamp | First Name | Last Name | Email | Phone | Lesson Date | Lesson Time | Recurring`
4. Click **Share** (top right) and share the sheet with the same
   `client_email` address from Step 1, giving it **Editor** access.
5. Copy the spreadsheet's ID from its URL — it's the long string between
   `/d/` and `/edit`, e.g.
   `docs.google.com/spreadsheets/d/`**`1AbC-xyz123...`**`/edit`.

---

## Send me four things and I'll wire it all in

- The `client_email` value from the JSON file (Step 1)
- The `private_key` value from the JSON file (the whole thing, including
  the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines)
- The Calendar ID (Step 2)
- The spreadsheet ID (Step 3)

These get set as private environment variables on the hosting side (never
committed to the code), matching the names in `.env.local.example` in this
repo: `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
`GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SHEET_ID`.

Once those are set:
- The **Book a Lesson** page shows a real month calendar of your actual open
  times, lets clients book one-time or recurring weekly lessons, and blocks
  the time on your calendar automatically.
- The **Clinics** page automatically shows live spots-remaining per month
  and disables a cohort once it hits 10 sign-ups.
- Every booking or sign-up appends a row to your sheet — no further setup
  needed.

---

## A note on deployment

All of this only goes live once the site is actually deployed to a public
URL (connecting this repo to Vercel or another host — a separate one-time
step from pushing code to GitHub). Until both the deployment and the
credentials above are in place, the site gracefully shows a "reserve by
phone/email" fallback in both spots, so nothing looks broken in the
meantime.
