# Keeping the automatic check running

**Nothing in this repository switches a scheduler on.** This page explains what the
automatic check is, what happens without a scheduler, and the ways to run it, so you can
pick one. Every option that costs money or needs a new account waits for your approval.

---

## 1. What the automatic check does

One short job, run every few minutes, does four things:

| # | It… | Why it needs a clock |
| --- | --- | --- |
| 1 | **Releases** reservations whose 12-hour hold ended with *no payment report* | The release email to the family goes out on time |
| 2 | **Queues the reminder** ("your spot is released at 9:45 PM") for families who still have to act, about 3 hours before their hold ends | Needs to happen *before* the deadline, not when someone happens to visit |
| 3 | **Sends your alerts** for reported payments waiting for you (due soon, overdue, escalated, critical) | Alerts get louder with time |
| 4 | **Sends every email waiting** in the queue, retrying the ones that failed | A Gmail hiccup at 2 a.m. should not leave a family without instructions until morning |

It **never** releases, confirms or changes a payment that a parent has reported. That is
proved by automated tests that run it over ten simulated days (`npm run test:no-auto-release`).

**Capacity is always correct without it.** Every page that shows or uses availability first
releases any unreported hold past 12 hours, so a spot is never blocked by a forgotten
reservation, scheduler or not. The check only decides *when emails go out*.

---

## 2. What happens if it does not run

| Thing | With no scheduler |
| --- | --- |
| Spots held by unreported reservations | Freed on time (done on every page read) |
| Payment instructions email | Sent right after the family registers (not dependent on the check) |
| Confirmation email after you confirm | Sent right after you click Confirm |
| Reminder to families, release notice, your overdue alerts | **Late**: they go out the next time *anyone* visits the registration form or a parent's page, or you open the dashboard (a visit starts a check if none has run in 5 minutes) |
| Emails that failed the first time | Retried the same way |
| Overnight, with nobody visiting | Nothing runs until morning |

So the cost of having no scheduler is *lateness overnight*, never a lost spot or a wrong
payment. On a busy opening day there is constant traffic, which keeps things moving.

---

## 3. How you can tell

Open the dashboard (`/admin/camp-rosters`). The **Automatic checks and email** box at the top says:

- *"Automatic check ran 3 minutes ago."* — good.
- *"The automatic check last ran 3 hours ago. Reminders, alerts and emails may be late…"* — nothing has run for 20+ minutes. Opening the dashboard starts one by itself, and **Run the check now** does it on demand.
- *"…(Triggered by site visits: no scheduled job is set up yet.)"* — you are relying on visits.
- *"The last automatic check FAILED…"* with the reason.
- Emails waiting or undeliverable, with the family's phone number.

For an alarm that reaches you when you are *not* looking, point a free uptime monitor
(UptimeRobot, Better Stack, or a Google Apps Script) at
`https://your-site/api/health/scheduler`. It answers **200** while the check has run in the
last 20 minutes and **503** when it has not, and reveals nothing else.

---

## 4. The options

| | A. Vercel Cron | B. GitHub Actions | C. Google Apps Script | D. Site visits only |
| --- | --- | --- | --- | --- |
| **Cost** | Needs the **Pro** plan (about US$20 per user per month; check vercel.com/pricing). On the free Hobby plan a cron can run only **once a day**, at an unpredictable minute within the hour | Free for a public repository; a private repository has a monthly free allowance (check GitHub's current figure) | Free, inside your Google account | Free |
| **How often** | Every minute is possible; **every 5 minutes** recommended | Every 5 minutes at best; GitHub warns runs can start **5–30 minutes late** at busy times, and may be skipped | Every 1, 5, 10, 15 or 30 minutes | Only when someone visits |
| **Reliability** | Highest: same platform as the site | Good, not guaranteed. Scheduled workflows are switched off after 60 days with no activity in the repository | Good. Google can occasionally delay a trigger by a few minutes | Weak overnight |
| **New account / vendor** | No (already hosting there) | No (the code is already on GitHub) | No (you already use Google) | None |
| **Where the secret lives** | Vercel (sent automatically) | GitHub repository secret | The script's private properties | n/a |
| **Needs your approval** | Yes: it is a paid plan | Yes: adds a workflow file and a secret | Yes: you create the script yourself | Already on |

### The Vercel plan question comes first

Vercel's free **Hobby** plan is limited to **non-commercial, personal use**; its fair-use
guidelines say that all commercial usage, including taking payments from visitors or
advertising a product or service, needs the **Pro** plan. A business website with paid camp
registration is commercial use. That makes Pro the plan to budget for regardless of the
scheduler, and Pro also gives you the every-5-minutes cron. Please confirm the current
terms and price on vercel.com before deciding.

### Recommendation

1. **If you move to Vercel Pro (recommended for a paid, commercial site): use A.** One vendor,
   nothing extra to look after. Add the free uptime monitor on `/api/health/scheduler`.
2. **If you stay on a free setup for now: use C** (Apps Script), with D as the safety net, and
   check the dashboard box every day.
3. **B is a fine alternative to C** if you prefer everything in GitHub.

Whatever you choose, keep **D** (site visits) switched on. It costs nothing and covers a gap in the scheduler.

---

## 5. How to turn each one on (when you approve)

All options call the same address with the same secret:

```
GET https://YOUR-SITE/api/cron/payment-review
Authorization: Bearer <the CRON_SECRET you chose>
```

First, in the hosting settings, set `CRON_SECRET` (any 32+ random characters) and `SITE_URL`
(your real web address, for example `https://www.jamesdeangolf.com`). Then:

### A. Vercel Cron (Pro plan)

Add a file named `vercel.json` at the top of the project:

```json
{ "crons": [{ "path": "/api/cron/payment-review", "schedule": "*/5 * * * *" }] }
```

Vercel sends `Authorization: Bearer <CRON_SECRET>` by itself. Deploy, then watch the dashboard box.

### B. GitHub Actions (template; nothing here is active)

Create `.github/workflows/scheduled-check.yml` (only after you approve):

```yaml
name: Scheduled check
on:
  schedule:
    - cron: "7,22,37,52 * * * *"   # every 15 minutes, off the busy :00 mark
  workflow_dispatch: {}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Call the site
        run: |
          curl --fail --silent --show-error --max-time 60 \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.SITE_URL }}/api/cron/payment-review"
```

Add `CRON_SECRET` and `SITE_URL` under *Settings → Secrets and variables → Actions*. A failed
run (the site said 502) makes the job fail, and GitHub emails the repository owner.

### C. Google Apps Script (template)

In script.google.com create a project, paste this, and set Script properties `SITE_URL` and
`CRON_SECRET` (Project Settings → Script properties). Then add a **time-driven trigger**
for `runCheck` every 5 minutes. Under *Triggers → Failure notification settings* choose
"Notify me immediately".

```javascript
function runCheck() {
  const props = PropertiesService.getScriptProperties();
  const response = UrlFetchApp.fetch(props.getProperty("SITE_URL") + "/api/cron/payment-review", {
    headers: { Authorization: "Bearer " + props.getProperty("CRON_SECRET") },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("The scheduled check answered " + response.getResponseCode());  // triggers the failure email
  }
}
```

Google's published limits for an ordinary account are 90 minutes of trigger runtime and 20,000
web requests a day; a check every 5 minutes uses a few minutes and 288 requests.

---

## 6. Proving it works (after you switch one on)

1. Open the dashboard: **"Automatic check ran N minutes ago"** with no "triggered by site visits" note.
2. `node scripts/preflight.mjs --url https://YOUR-SITE` runs the check once and reports what it did.
3. In the rehearsal (docs/LAUNCH_REHEARSAL.md), register a test family, do not report, and watch the reminder and release emails arrive on time.

## 7. What the automated tests already prove

| Test | What it covers |
| --- | --- |
| `npm run test:scheduler` | releases only unreported holds; reminders; alerts; run lease (5 runs at once → 1 works); failed run is recorded and recovered from; traffic fallback throttled to one per 5 minutes; health states; the cron URL's secret; 120 holds released in one run; time-bounded runs |
| `npm run test:no-auto-release` | ten simulated days across every automatic entry point; the source scan that fails if any new code can release a reported payment |
| `npm run test:outbox`, `test:smtp-stack` | retries, backoff, dead mail server, busy server, slow server, mistyped addresses, daily-allowance protection |
| `npm run test:opening-day` | 130–300 families, a mail outage, a server restart and days of clock movement, end to end |
