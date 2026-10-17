# Launching the informational website on its own

**The short version:** the public website can go live **now**, with summer-camp registration, group
clinics and online lesson booking all switched off and honestly labelled "coming soon". Nothing in the
camp, clinic or lesson work has to be finished, approved or deployed first. This document says what
the visitor sees in that mode, which two independent locks keep the booking features closed, and the
test that proves it.

Nothing here was deployed. This is a description of what the code on the launch branch does when it is
built with **no booking settings at all**.

---

## 1. What a visitor sees

| Page | In launch mode |
| --- | --- |
| Home, About, Contact, Privacy, Junior programs, Lessons (information) | Normal pages. Prices, descriptions and the coach's phone/email are the ones in `src/lib/content.ts`. |
| `/junior-camps` and `/fr/camps-juniors` | "Dates coming soon" (French: "bientôt"). No registration form, no week tiles, no price promise. The coach's phone (514-816-3454) and email are shown for questions. |
| `/clinics` | The clinic description and price, then a card saying the online sign-up is **being finalized**, with the phone and email. No form. |
| `/book` (private lessons) | The lesson description and price, then the same "being finalized — call or email" card. No calendar, no times offered. |
| `/admin/*` | Redirects to the login. The login says it is not set up. |

The introductory paragraphs on `/book` and `/clinics` were reworded so they never promise something
the card below them says is not available yet ("pick a day and time", "sign up below").

## 2. The two locks

Booking features stay closed unless **both** of these are deliberately opened, so a mistake in one does
not open registration to the public.

1. **Nothing is configured.** With no `DATABASE_URL`, no admin password and no Google credentials, every
   booking API answers `503` with a plain "call or email" message, the availability APIs answer
   `configured: false`, and the owner APIs answer `401`. A fresh deployment of the site with only the
   public content set up is therefore a purely informational site.
2. **The season is not announced.** `src/lib/season.ts` has `confirmed: false`. While it is false, camp
   registration and the camp waiting list refuse, the pages say "dates coming soon", and the capacity
   API reports `registration.state: "not_announced"` with no weeks. The only way around it is the
   rehearsal switch `SEASON_PREVIEW=true`, which must never be set on the public site. Flipping
   `confirmed` to `true` is a code change in a commit that records your approval of the dates.

For clinics and lessons the lock is the same idea: they are not open until their own feature switches
(`CLINICS_ENABLED`, `LESSONS_ENABLED`, described in the lessons-and-clinics design on the
`claude/lessons-clinics-booking` branch) are turned on. Those switches default to **off**.

## 3. Settings to leave unset for an informational launch

Leave **all** of these unset (they are only needed once you choose to open a booking feature):

`DATABASE_URL`, `ADMIN_PASSWORD`, `REGISTRATION_LINK_SECRET`, `CRON_SECRET`, `ETRANSFER_EMAIL`,
`ETRANSFER_AUTODEPOSIT`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SMTP_*`, `EMAIL_FROM`,
`ADMIN_ALERT_EMAILS`, `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
`GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SHEET_ID`, `CAMP_SHEETS_COPY`, `WAITLIST_ENABLED`,
`SEASON_PREVIEW`.

`SITE_URL` can be set (it only builds absolute links). No paid service has to be created for an
informational launch: no database, no mail account, no Google service account.

## 4. How it is verified

`npm run test:launch-mode` (part of `npm test`, about two minutes) does the following:

1. Copies the site into a temporary folder and **builds it with an almost empty environment** (only
   `PATH`, `HOME`, and Next.js's telemetry opt-out), so no setting from this machine can leak in.
2. Starts the production server on a free port and checks, over HTTP:
   - eleven public pages (English and French) load;
   - the camp page says "coming soon" in both languages, has no form, and shows the phone number;
   - camp capacity reports `not_announced`; camp registration and the camp waiting list return `503`;
   - clinic and lesson availability report `configured: false`; a clinic sign-up and a lesson booking
     return `503` with "call or email";
   - the `/book` and `/clinics` text no longer promises an online sign-up;
   - the dashboard redirects to the login, the four owner APIs return `401`, the login says it is not
     set up, and the health address reveals nothing;
   - the server log contains no connection attempt to a database, Google or a mail server.
3. Deletes the temporary folder and stops the server.

Result on the launch branch: **24 checks, 0 failures.** A browser run of the same build (phone and
desktop, English and French) found no broken link or empty form on the pages above.

### Checking a real hosting preview

`LAUNCH_MODE_URL=https://the-preview-address npm run test:launch-mode` runs the same checks 1 to 4 against any running
site (a Netlify or Cloudflare preview, say) instead of building one here. Which host to use, with the tests behind the
recommendation, is in `docs/HOSTING_OPTIONS.md`.

## 5. Going from here to a real launch, one feature at a time

The informational launch changes nothing about the later steps. Each booking feature opens separately,
and only after you approve it:

| Feature | What opens it | Where the steps are |
| --- | --- | --- |
| Summer camp | Your approval of the 2027 dates (`confirmed: true`), the database and mail settings, and the staging rehearsal | `docs/LAUNCH_CHECKLIST.md`, `docs/LAUNCH_REHEARSAL.md` |
| Group clinics | Not built yet. Developed on `claude/lessons-clinics-booking`; opens with `CLINICS_ENABLED` only after your approval and a confirmed tax setting | `docs/LESSONS_AND_CLINICS_DESIGN.md` on that branch |
| Online private lessons | Same branch; opens with `LESSONS_ENABLED` only after your approval, a confirmed tax setting and a working calendar connection | same |

If the informational site goes live first, the clinic and lesson pages keep telling visitors to call
or email, and the camp page keeps saying "dates coming soon", until the matching step above is done.
