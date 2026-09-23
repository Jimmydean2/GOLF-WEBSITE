# Setting up online booking

Two separate things need to be connected before booking is fully live: your
**Google Calendar** (for 1:1 lesson booking) and a **Google Sheet** (for
tracking Saturday clinic sign-ups and spots remaining). Neither can be set up
by anyone but you, since they both live inside your personal Google account.

---

## Part 1: Individual lesson booking (Google Calendar)

This uses Google Calendar's built-in "Appointment Schedule" feature. Once
it's set up, Google handles everything automatically: it blocks the 50-minute
slot on your calendar under the client's name, won't offer times inside your
24-hour cutoff, and lets you see every booking (with the client's name, phone,
and email) right inside Google Calendar — no separate app to check.

**Steps:**

1. Go to [calendar.google.com](https://calendar.google.com) and sign in with
   the Google account you want lessons booked into.
2. Click **Create** (top left) → **Appointment schedule**.
3. Name it something like "James Dean Golf — Lesson Booking".
4. **Duration**: set to **50 minutes**.
5. **Availability**: set **Monday–Friday, 9:00 AM–4:00 PM**. Leave Saturday
   and Sunday off (the Saturday clinic is handled separately, below).
6. Under **Booking window / minimum lead time**: set a **24-hour** notice
   requirement. This automatically hides same-day slots — exactly what you
   asked for, so same-day requests have to come to you directly.
7. Under **Booking form**, make sure **Name**, **Phone number**, and **Email**
   are all set to required. (Google asks for name and email by default —
   just turn on "require phone number" too.)
8. Save, then click the schedule to get its **public booking page link**
   (looks like `https://calendar.app.google/...`).
9. Send me that link — I'll drop it into the site's "Book a Lesson" page,
   which is already built and waiting for it.

**Blocking off a day off:** just add a normal event (or mark yourself "busy")
on your Google Calendar for that day/time — the Appointment Schedule
automatically won't offer times that conflict with something already on your
calendar. No separate admin panel needed.

---

## Part 2: Saturday clinic sign-ups + live spot counter (Google Sheet)

The Saturday clinic (May / August / September series, max 10 people each) is
a group registration, not a 1:1 time slot, so it needs its own simple
database — this is what powers the "X of 10 spots left" display on the
Clinics page. It's a Google Sheet, so **you can open it any time to see every
sign-up's name, phone, and email** — this is your client "data bank" for the
clinics.

**Steps (about 10 minutes, one-time):**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   sign in with your Google account.
2. Create a new project (top left, name it anything, e.g. "James Dean Golf
   Website").
3. In the search bar, search for **"Google Sheets API"** and click **Enable**.
4. In the left sidebar go to **APIs & Services → Credentials**.
5. Click **Create Credentials → Service account**. Give it any name (e.g.
   "clinic-booking"), click through the remaining steps with defaults, then
   **Create**.
6. Click into the service account you just created → **Keys** tab → **Add
   Key → Create new key → JSON**. This downloads a `.json` file — keep it
   safe, don't share it publicly (it's like a password).
7. Open that JSON file in a text editor. You'll need two values from it:
   `client_email` and `private_key`.
8. Go to [sheets.google.com](https://sheets.google.com) and create a new
   blank spreadsheet, named e.g. "James Dean Golf — Clinic Signups".
9. Rename the first tab (bottom left) to exactly `ClinicSignups`.
10. In row 1, add these exact column headers, one per cell:
    `Timestamp | First Name | Last Name | Email | Phone | Cohort | Message`
11. Click **Share** (top right) and share the sheet with the `client_email`
    address from the JSON file (step 7), giving it **Editor** access.
12. Copy the spreadsheet's ID from its URL — it's the long string between
    `/d/` and `/edit`, e.g.
    `docs.google.com/spreadsheets/d/`**`1AbC-xyz123...`**`/edit`.

**Send me three things** and I'll wire it in:
- The `client_email` value from the JSON file
- The `private_key` value from the JSON file (the whole thing, including
  the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines)
- The spreadsheet ID from step 12

These get set as private environment variables on the hosting side (never
committed to the code), matching the names in `.env.local.example` in this
repo: `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`,
`GOOGLE_SHEETS_SHEET_ID`.

Once those are set, the Clinics page automatically shows live spots-remaining
per month, disables a cohort once it hits 10 sign-ups, and every submission
appends a row to your sheet — no further setup needed.

---

## A note on deployment

Both of these only go live once the site is actually deployed (which is
still waiting on the GitHub access issue to be resolved). Until then, the
site gracefully shows a "reserve by phone/email" fallback in both spots, so
nothing looks broken in the meantime.
