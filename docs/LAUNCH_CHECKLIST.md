# Launch checklist

**Where things stand:** the registration and payment system is ready to be *rehearsed* with
real services and made-up families. It is **not ready to launch** until the rehearsal has been
done and the decisions in section 4 are made. Nothing has been merged, deployed or switched
on, no real family's information was used, and no paid service was activated.

How to read this: ✅ done and checked by a test you can re-run · 🟡 built, but only the real
services can prove it · ⬜ not built.

---

## 1. Completed and verified

*"Verified" means an automated test exercises it against a real PostgreSQL database, the real
production build of the site, and a recording mail server, with the site running on a single
database connection as it will in production. Run everything with `npm test` (about six
minutes). Counts below are checks in each suite.*

**Your eight priorities**

| # | You asked | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | Will parents with several children and weeks be wrongly blocked by the 8-reservation limit? | **No.** The limit counts *submissions*, not children or weeks: four children for all ten weeks is **one** reservation. I did find a real way to block a genuine family, **and fixed it**: form mistakes and retries used up the hourly allowance (five typos, or a few double-clicks, locked a family out). Now only an actual new reservation counts, and an attempt that creates nothing is handed back. | `families` (26), `registration-flow` (81) |
| 2 | Paid but forgot to click: the simplest safeguard? | **Three layers, none adds a step for parents.** (a) One **reminder email** about 3 hours before the hold ends ("already sent it? tap the button"), only to families who have not reported. (b) If it still lapses, the **release email says "reply with your reference if you paid"** and you can **Reinstate & confirm** with the deposit. (c) A **daily glance at the bank for the "Awaiting payment" references**: if the money is there, click Confirm; no parent action needed. | `outbox` (93), `scheduler` (49), `opening-day` (56); runbook §2, §5 |
| 3 | Is a reported payment ever released just because I did not check the bank? | **Never.** Proved three ways: (a) the database refuses it; (b) a source scan fails if *any* code outside the administrator's Release can release a reservation, and shows the automatic release can only touch unreported ones; (c) ten simulated days with 20 reported payments, every automatic entry point run repeatedly, plus 40 race tests at the moment a hold ends: nothing reported was released, you were alerted louder each day, and on return all 20 could be confirmed. | `no-auto-release` (32), `alerts` (106), `payment-policy` (175), `payment-integrity` (183) |
| 4 | A dependable scheduled process, without activating paid services | **Built and tested, not switched on.** One check releases unreported holds, queues reminders, sends your alerts and retries failed emails. It runs from a secret-protected URL, falls back to site visits, can't overlap itself, leaves a record, and the dashboard shows when it last ran (red if it stops). Options and costs are in `docs/SCHEDULING.md`. | `scheduler` (49), `no-auto-release` |
| 5 | Real-world end-to-end testing for Gmail, Neon, bank matching, confirmation emails | **The kit is built and tested; the rehearsal itself needs your accounts** (§2). Preflight check, fake-family tool, $1-week and fast-clock database scripts (each refuses to run on a database holding real registrations), a recording mail server, and a step-by-step guide. | `rehearsal-kit` (31), `smtp-stack` (30), `docs/LAUNCH_REHEARSAL.md` |
| 6 | French readiness | **Audited; nothing is translated** (§3, §4). About 340 pieces of text (~2,500 words) plus formats. French accents already work end to end. | `docs/FRENCH_READINESS.md`, `scripts/i18n-audit.mjs` |
| 7 | Sensitive child and parent information inaccessible to other families | **Verified over real HTTP.** Two families with distinctive data: neither can see the other's page, link, email or error; 14 forged or altered links open nothing; 210 requests to administrator addresses without a login (every method, three credential types) are all refused; no private page loads another website's script; the server log contains no name, phone or address. **Fixed along the way:** emails no longer carry health notes, birth dates or emergency contacts; logs can no longer print a database row; the parent's page shows their email masked. | `http-privacy` (43), `log-safety` (8) |
| 8 | Opening-day traffic: siblings, multiple weeks, duplicates, delayed e-Transfers, email failures | **Simulated end to end.** 130 to 300 families on the real production build and a single database connection: siblings, up to 10 weeks, double-clicks, repeat registrations, mistyped emails, a flaky then absent mail server, a server restart, and days of moved clocks (reminders, releases, late deposits reinstated, overdue alerts, false claims released). No week ever exceeded 30; nobody got another family's reference; no error reached a parent; nothing was left stuck. At 300 families, 100 at a time: 95% answered within 1.4 s. | `opening-day` (56), `pool-of-one` (13), `concurrency` (118) |

**Other problems found and fixed while testing** (each now has a test)

- A repeated submission caught by the database could **hang forever** on the production's one-connection setting.
- Dozens of requests at the same moment could each send you a coach summary (now one per hour, atomically).
- A "reservation released" notice was only sent to the 100 most recent releases (a mass lapse could skip families) and retried a mistyped address forever; it now goes through the same retrying queue as every other email.
- Database connections had no timeouts and no handler for a connection Neon drops; the database's certificate was not being checked (now verified).
- Registration answers were slower and fragile because emails were sent *inside* the request; they now go out after the answer, from a queue that cannot lose an email.
- The child fields on the form were not linked to their labels for screen readers, and the camp page still said "one form per child".
- Weeks were listed by their internal code, so a family with weeks in different months saw August before June in emails, the reservation page and your alerts; they are now in calendar order.
- The setup guide said the free Vercel plan was fine; it is for non-commercial use only (§4).

---

## 2. Built, but not tested in production-like conditions

These can only be proved on your real accounts. `docs/LAUNCH_REHEARSAL.md` is the plan (about one afternoon, ~$4 of real e-Transfers between your own accounts, made-up families).

- 🟡 **Gmail**: that mail from your account reaches Gmail, Outlook and Yahoo **inboxes** (not Spam) with SPF/DKIM passing; that the app password works; how the daily limit behaves in real life.
- 🟡 **Neon**: certificate verification against Neon's real certificates; the pooled connection; the first request after the database has slept (a second or two); backups on your plan.
- 🟡 **Vercel**: that emails sent *after* the answer (`after()`) complete on the platform; function time limits on your plan (the registration route asks for 30 s, the check for 60 s); environment settings; function logs.
- 🟡 **Your bank**: whether the deposit shows the **reference** (the reference is how payments are matched); what an auto-deposit notice contains; how long a deposit takes. Some banks leave the sender and message out of auto-deposit notices (for example, [Desjardins' business e-Transfer page](https://coop.desjardins.com/ca/business/accounts-cash-management/interac-e-transfer-business/) describes auto-deposit notices without a sender or message); the other matching method (name, amount, time) exists for that case.
- 🟡 **A real scheduler** (none is configured, by design).
- 🟡 **Real phones and email apps**: browser tests used a desktop and a phone-sized Chromium. Real iPhone Safari, Android, and Outlook/Apple Mail were not available here.
- 🟡 **Google Sheets / Calendar** copies (no credentials here). The Sheets copy adds one row per child per registration; Google limits writes per minute, so on a busy opening minute some rows may be missed. It is a convenience copy, not the record.
- 🟡 **Real-network load**: tests ran on one machine. Real latency, Neon's connection limits on a small compute (about 100) and Vercel's concurrency are not exercised.
- 🟡 **Screen readers / full accessibility review.**

---

## 3. Not yet implemented

- ⬜ **French** (and the legal text in French): the whole parent journey is English only (§4, D6).
- ⬜ **Privacy notice and Quebec privacy-law steps** for collecting children's health information: a published policy, a named person in charge, parental consent wording, a retention rule, an incident register, and assessing where the data is stored (D7). The site has none of these today.
- ⬜ **Parents correcting or cancelling their own unpaid reservation** (today you release it from the dashboard and they register again).
- ⬜ **Bot protection** (CAPTCHA) on the form: rate limits only, so a determined script with many addresses could hold weeks for 12 hours at a time (D9).
- ⬜ **Waiting list** for full weeks.
- ⬜ **A "we got your report" email** to the parent and a **late-claim button** after release (small, optional; the reply-to-the-release-email route works today).
- ⬜ **A second administrator login** (alerts can go to a backup, but only the single password can act).
- ⬜ **Uptime and error monitoring** and a **tested backup/restore** routine.
- ⬜ **Automatic deposit detection** from the bank's notification emails (not recommended: such emails can be forged; a hint-only version is possible later).
- ⬜ **A settings screen** for the clocks (hold, reminder and review times): today they are changed in the database, by me.
- ⬜ **The static preview** (the standalone mock) has not been updated since before Stage 2.

---

## 4. Decisions that need your approval

Each has my recommendation. Nothing happens until you say so.

| # | Decision | Recommendation | Cost / risk |
| --- | --- | --- | --- |
| D1 | **Hosting plan.** Vercel's free plan is for non-commercial, personal use; its rules count taking payments and advertising a business as commercial. | Move to **Vercel Pro** before taking real registrations. It also allows a check every 5 minutes. | About US$20 per user per month (confirm on vercel.com/pricing). Staying on the free plan risks the account being restricted during camp season. |
| D2 | **Scheduler** (docs/SCHEDULING.md). | With Pro: **Vercel Cron every 5 minutes** + a free uptime monitor on `/api/health/scheduler`. Without Pro: a Google Apps Script trigger. | Free to about $0 extra with Pro. Without any scheduler, reminders and alerts are late overnight (spots are not affected). |
| D3 | **Email sender.** A personal Gmail account sends about 500 emails a day (Google Workspace: about 2,000). Simulated days used about 2.7 emails per registered family, so ~150 families is ~400. | Rehearse first and watch the dashboard count. If you expect more than ~120 families in the first two days, use a **Google Workspace** account for the camp address or a transactional email service. | Workspace is a paid subscription. Over the limit, Gmail refuses all mail for up to a day. |
| D4 | **Coach emails.** Today: one summary an hour, no health details anywhere in email. | Keep as is. (`COACH_NOTICE_MODE=each` gives one per registration.) | None. |
| D5 | **Reminder** 3 hours before the hold ends (adjustable 0-11). | Keep at 3. | One more email per family who has not reported (~0.15 per registration in simulation). |
| D6 | **French.** (a) bilingual at launch, (b) English first with a French phone line and French soon after, (c) English only. | **(a)** if the camp is advertised publicly in Quebec; ask a Quebec lawyer or the OQLF what applies to the acceptance text and the site. | Translation fee + about 5 days of development (docs/FRENCH_READINESS.md). |
| D7 | **Privacy notice / Quebec privacy law** for children's health information; where the data is stored (Neon region, Vercel, Google). | Have a Quebec privacy lawyer draft the notice and consent wording; decide the retention period; choose the closest regions. | Professional fee. Not a code blocker. |
| D8 | **Season dates.** The page says "2026 Junior Camps" and week labels fit 2026's calendar; the database seed uses 2027 as a placeholder year. | Tell me the season and I will make the labels, seed and page agree before launch. | A wrong date on a registration is a customer-service problem. |
| D9 | **Bot protection** (CAPTCHA, a third-party service). | Defer unless you see abuse; the 12-hour hold and per-connection limits contain it. | Adds a vendor and a step for parents. |
| D10 | **Same-child rule**: one child cannot hold the same week twice under one email or phone (done). **Parent self-cancel** (not built). | Keep the rule; build self-cancel only if you see support emails about mistakes. | Needs a small database change. |
| D11 | **Google Sheets copy**: keep or drop. | Drop it (the dashboard and the roster workbook are the record, and health details leave your database for another service). If kept, expect missed rows at peak. | None either way. |
| D12 | **Rehearsal**: approve running it (a Neon branch, a preview deployment, a Gmail app password, ~$4 in e-Transfers). | Do it, then re-run `scripts/preflight.mjs` on the real settings. | A few hours of yours. |
| D13 | **Merging and deploying.** Everything is on the `claude/youthful-faraday-doicas` branch; `main` is untouched. The database changes (migrations 001 to 005) must be applied, in order, to the new live database before the first deploy. | After D1-D3 and the rehearsal. | Do not merge before you have rehearsed. |
| D14 | **`ETRANSFER_AUTODEPOSIT`**: only say "no security question needed" once your bank confirms auto-deposit on that address and you have sent a test. | Set after the rehearsal. | A wrong promise makes a parent's transfer fail. |
| D15 | **Receipts.** Many parents claim day-camp fees as a child-care expense, and a business that charges GST and QST has number-on-receipt rules. The confirmation email shows the tax breakdown but not your registration numbers or address. | Ask your accountant what a receipt must show; I will add it to the confirmation email. | A parent asking for a proper receipt in March. |

---

## Before the very first real registration

1. D1, D2, D3, D8 decided; hosting and database accounts ready.
2. Rehearsal done; results recorded; every "FAIL" in `scripts/preflight.mjs` fixed.
3. Fresh live database with migrations 001-005 (not the rehearsal one); `SITE_URL` set to the real address; `ADMIN_ALERT_EMAILS` has a backup address.
4. A week's price is $380.00 again; capacity 30; `Registrations: none yet` in the preflight.
5. You have read `docs/PAYMENT_REVIEW_RUNBOOK.md` (two minutes a day) and know where the dashboard box is.
