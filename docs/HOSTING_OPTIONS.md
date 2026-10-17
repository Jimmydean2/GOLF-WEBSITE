# Where to host the informational website for free, and what it takes to switch bookings on later

**Status: investigated and tested locally. Nothing was deployed, no account was created, no branch was merged, no paid
service was started.** Every test ran on this machine, on a scratch copy of the launch branch
(`claude/youthful-faraday-doicas` at `f557962`), so the real project, its `node_modules` and the booking code are unchanged.

## 1. The short answer

**Launch on Netlify Free, with the app exactly as it is.** It is the only free option that ran the *whole* application
(public pages, every booking route, the PostgreSQL drills) without changing any source file. The one thing to add is a
three-line `netlify.toml` (a tested copy is in `docs/hosting/netlify.toml`, inactive until you approve).

| | Netlify Free (full app) | Cloudflare Workers Free (full app) | Static copy on Cloudflare (public pages only) |
| --- | --- | --- | --- |
| Public pages, "coming soon" camp, bookings off (23 launch checks) | **Pass** | **Pass** | Pass (pages); the API checks do not apply |
| Source files changed | **None** | One tweak in `next.config.ts` needed even to build | None in the repo; a build recipe that leaves the server routes out |
| All booking code kept in the repo | Yes | Yes | Yes (it just is not in the static copy) |
| Booking system works when switched on | **Yes** (camp drills pass: duplicates, 8 families for the last spot, email) | **No, not without changing `src/lib/db.ts`** (see 3.2) | Not applicable; needs a server host later |
| Cost if you outgrow it | Personal $9 / month | Workers Paid $5 / month | none expected |
| Main risk | Monthly credit cap: the whole site is **paused** if it runs out | Booking code would need rework; no image optimisation by default | Two hosting setups over time |

**Why not simply pick the cheapest?** Cloudflare's static hosting is the most robust way to publish pages (its static
asset requests are free and unlimited), but it cannot run the booking code, so you would migrate hosts the day camp
registration opens. Netlify Free runs everything now and later; its weakness (a hard monthly cap) is a monitoring
problem, not a rewrite. **If the cap ever bites, the fallback is the static Cloudflare copy (section 4) or Netlify
Personal at $9.**

*Vercel's Hobby plan is not an option for a business: its fair-use rules limit Hobby to non-commercial personal use
(see sources), which is why Pro was on the table.*

---

## 2. What I found in the repository

- **Every informational page is prerendered static HTML** (`/`, `/about`, `/lessons`, `/clinics`, `/book`,
  `/junior-programs`, `/junior-camps`, `/contact`, `/privacy`, `/fr/...`). Only the API routes, the admin dashboard and
  the private reservation pages (`/camp-registration/[token]`) are rendered on demand. A host therefore serves the whole
  public site from its CDN, which is what makes it fast on any of them.
- **No middleware or proxy file**, no Edge runtime, no Vercel-only feature (`vercel.json` does not exist). The
  scheduled check is host-independent (`docs/SCHEDULING.md` already offers GitHub Actions and Google Apps Script).
- Two public pages call a server route on load: `/clinics` calls `/api/clinic-capacity` and `/book` calls
  `/api/lesson-availability`. In launch mode each answers "not configured"; a visit costs one tiny function call.
- **Server code is heavy but that is fine**: `googleapis` (the old Google booking code), `exceljs`, `nodemailer` and
  `pg`. The server bundle contains one 12.7 MB chunk (the Google library).
- **Weight:** first visit to the home page about 0.9 MB transferred, other pages 0.3 to 0.5 MB (the first load includes
  about 300 KB of shared scripts). `public/videos` holds 9 MB of video that **no page uses**; it costs nothing unless
  requested.
- **Security headers** (`next.config.ts`: no framing, no caching, no sniffing for the admin and reservation paths) are
  honoured by both Netlify and Cloudflare in my tests.

---

## 3. What I tested, and the results

All hosts were run locally with **no booking settings at all** and then with the booking system configured against a
throwaway local PostgreSQL and a local mail recorder. The 23 launch checks are the repo's own
(`npm run test:launch-mode`, which now also accepts `LAUNCH_MODE_URL=https://address` to test any running site).

### 3.1 Netlify (Next.js runtime 5.16.2, Netlify CLI 27.13.0, Next 16.4.1)

| Check | Result |
| --- | --- |
| `netlify build` with the real Netlify Next.js runtime, no source changes | **Built in 42 s** |
| What it produced | One server function (29.6 MB zipped, 85 MB unzipped), 16 MB of static files, no Edge functions registered |
| 23 launch checks against `netlify serve` | **23 pass** |
| Admin and reservation security headers | identical to the plain Next.js server |
| Image optimiser (`/_next/image`) | works (91 KB WebP from a 280 KB JPEG) |
| Booking system configured: `staging-verify.mjs` drills (duplicate submissions, 8 families racing for the last place, email outbox) | **All pass** |

*Limits of this test:* it is Netlify's own local emulation, not the real service. It cannot show real network speed, the
real image CDN, or whether post-response email sending (`after()`) is honoured in production. The emulation also
needed Deno from npm because the sandbox cannot download it; that is a sandbox restriction.

### 3.2 Cloudflare Workers (OpenNext adapter 1.20.12, Wrangler 4.151.1, local `workerd`)

| Check | Result |
| --- | --- |
| Adapter supports Next 16.4.1 | Yes (its peer range is `>=16.4.1`) |
| `opennextjs-cloudflare build`, default settings | **Fails**: the PostgreSQL driver cannot resolve `pg-cloudflare` |
| With a 3-line `outputFileTracingIncludes` addition to `next.config.ts` | Builds in 47 s |
| Worker size | 29.6 MiB uncompressed, **3.1 MiB gzip** (Cloudflare's docs source says only the 64 MiB uncompressed size counts; OpenNext's page still says 3 MiB compressed on the free plan; see section 6) |
| 23 launch checks against the local Worker | **23 pass**, headers honoured |
| `/_next/image` | returns the **original** 280 KB JPEG: no optimisation until a Cloudflare Images binding is configured |
| Booking system configured | The **first** database request works; the **next request is cancelled** by the Workers runtime as "hung". Cloudflare does not let a database connection made in one request be reused by another, and the app keeps a shared connection pool. Enabling bookings would need `src/lib/db.ts` changed to open a connection per request (or use Cloudflare's Hyperdrive), then every booking suite re-run |

*Not tested and likely a problem:* `nodemailer`, `exceljs` (roster downloads) and `googleapis` inside Workers, and the free
plan's **10 ms CPU limit per request**. I would expect the bookings to need Workers Paid ($5 / month).

### 3.3 Static copy of the public pages (Cloudflare Pages or Workers static assets, or Netlify)

Recipe tested in a scratch copy only: leave out `src/app/api`, the admin pages and the two reservation-page folders,
set `output: "export"` and `images.unoptimized`. **Nothing is removed from the real repository.**

| Check | Result |
| --- | --- |
| Build | 15 s, 14 pages, **18 MB**, no server |
| In a browser (phone width), English and French | Camp page "coming soon / bientôt" with phone and email, no form; `/clinics` and `/book` fall back to "being finalized, call or email" even though their API is absent (one harmless 404 in the console per visit) |
| Images | not optimised (the export cannot run the image optimiser), so heavier on mobile unless images are pre-compressed |

---

## 4. Free-tier limits that matter (current figures and where they come from)

### Netlify Free
- **300 credits a month; hard limit.** When credits run out, **all** sites on the account are paused ("Site not available")
  until the next cycle, and **extra credits cannot be bought on the Free plan.** Warnings arrive at 50, 75, 90 and 100%.
- Rates (Netlify's current docs): **15 credits per production deploy**, **20 credits per GB of bandwidth**,
  **2 credits per 10,000 web requests** (static files count), **10 credits per GB-hour of function compute**. Preview and
  branch deploys are free.
- **What that means for you** (my arithmetic from the measured page weights; assumptions: a visitor loads the home page
  plus one or two pages with an empty cache, about 1.3 MB and 90 requests): about **0.045 credits per visit**. After
  reserving 5 to 10 production deploys a month, **roughly 3,500 to 5,500 visits a month** fit before the site pauses.
  Fine for a local coaching site; an Instagram spike or heavy bot traffic could exceed it.
- A few Netlify forum posts from mid-2026 describe Free-plan accounts shown as "out of credits" while about 30 remained;
  those are user reports, not confirmed by Netlify, but they argue for watching the usage page.
- Functions run in one region (US East, Ohio by default; not configurable). Synchronous functions may run up to 60 s,
  scheduled functions 30 s (current docs; older forum posts say 10 to 26 s).
- **Commercial use:** Netlify staff answers on its forum say the Free plan may be used for commercial projects; the
  self-serve agreement says the free tier is offered at Netlify's sole discretion and may change. *Permitted in practice,
  not guaranteed by contract.*

### Cloudflare Workers Free and static assets
- **100,000 Worker requests a day**; **static asset requests are free and unlimited**; **10 ms CPU per request**; 50
  subrequests; 5 cron triggers; up to 20,000 static files, 25 MiB each (Cloudflare's docs source).
- Beyond the daily limit, requests fail (error 1027) rather than pausing the account.
- Commercial use: the Free plan is described as for personal or hobby, non-critical projects on Cloudflare's plans page;
  community readings of the subscription agreement find no commercial restriction; **no SLA or support** on Free.
  *Likely fine, to be confirmed with Cloudflare before relying on it.*

### Vercel (for the record)
Hobby is limited to non-commercial personal use; commercial use requires Pro (about US$20 per user per month).

---

## 5. Security comparison

| | Netlify Free | Cloudflare (Workers or static) |
| --- | --- | --- |
| HTTPS and certificates | Managed by the platform (vendor feature; confirm on the preview) | Managed by the platform (same) |
| Admin / reservation headers (no framing, no cache, no referrer) | Honoured (tested) | Honoured (tested) |
| App-level protections (login lockout, rate limits, reauthentication for downloads, same-origin checks, append-only audit) | Unchanged: they live in the app and the database | Unchanged, if the database connection issue were solved |
| Network protection | Platform-level; no WAF or rate-limit product on the Free plan that I could confirm | Cloudflare's free DDoS protection and basic firewall rules are the strongest of the three (vendor feature; confirm) |
| Secrets | Dashboard environment variables, none needed for the informational launch | Same |
| Where customer data would be processed once bookings run | Functions in one US region; the database (Neon) is separate | Edge locations worldwide; the database is separate |
| Supply chain | The Next.js runtime plugin is installed and updated by Netlify at build time (pin it later if you want strict reproducibility) | The adapter is a dev dependency you install and pin |

For the informational launch **no personal data and no secret exists on the host**: the booking settings are unset and the
APIs answer 503. The Law 25 question about where booking data is stored only arrives when bookings open, and it is the same
open item already in `docs/PRIVACY_AND_LAW25.md`.

---

## 6. What I could not verify (and how to close each gap)

- **Real-world speed, real image CDN, real certificates, real function behaviour.** Needs a preview deployment.
- **Cloudflare's Free-plan Worker size rule.** Two sources disagree (Cloudflare's docs source: no compressed limit, 64 MiB
  uncompressed; OpenNext's page: 3 MiB compressed). My bundle is 3.1 MiB gzip, so it matters only if you pick the full
  Cloudflare app. A real upload would settle it.
- **Netlify's commercial-use wording and exact free-plan terms.** The vendor documentation sites are blocked from this
  work environment; figures come from Netlify's and Cloudflare's published documentation as returned by search, from the
  public documentation source repositories, and from the packages' own metadata. Re-read netlify.com/pricing and the
  terms before you rely on any figure, especially the credit rates (they changed in April 2026).
- **`after()` email sending and scheduled functions on real Netlify.** In the emulation, emails went out. In production the
  scheduled check (`/api/cron/payment-review`) still needs one of the documented schedulers.

---

## 7. What it takes to enable full bookings later

| | Netlify | Cloudflare Workers | Static copy |
| --- | --- | --- | --- |
| Code changes | **None expected** | `src/lib/db.ts` (per-request database connections or Hyperdrive), a `next.config.ts` tweak, an image binding, and checks of `nodemailer`, `exceljs`, `googleapis` | None, but you must move to a server host |
| Settings | The same environment variables as the camp rehearsal (`docs/LAUNCH_CHECKLIST.md`); a Neon pooled connection string with `DB_POOL_MAX=1` | the same, as Worker variables | the same, on the new host |
| Scheduler | Any documented option (GitHub Actions, Apps Script) or a Netlify scheduled function (30 s limit; not built) | a Worker cron trigger (not built) | n/a |
| Rehearsal | Re-run the existing staging drills against a Netlify preview + a Neon branch | as left, plus a rewrite's tests | after migration |
| Plan | Stay on Free if usage allows, else Personal $9 | Workers Paid $5 almost certainly | n/a |
| My estimate of the work | about half a day to switch on and rehearse | several days and a full re-test | the day you migrate hosts |

---

## 8. How to launch on Netlify, when you approve (nothing below has been done)

1. **You** create a Netlify account (free) and connect the GitHub repository. *I cannot and will not do this for you.*
2. Add `netlify.toml` (copy `docs/hosting/netlify.toml` to the project root) in a commit you approve. Do **not** set any
   booking environment variable.
3. Deploy the launch branch as a **branch deploy / deploy preview** first (free of credits). Run
   `LAUNCH_MODE_URL=https://<the-preview-address> npm run test:launch-mode` (23 checks), look at the site on a phone, check the
   certificate and the response headers (`strict-transport-security` etc.), and read the **usage** page.
4. Point the domain at it only when you approve the go-live. A production deploy costs 15 credits.
5. Turn on Netlify's usage warnings; **tripwire:** if usage passes 70% of the credits in two months, or any pause happens,
   either upgrade to Personal ($9) or switch to the static Cloudflare copy.
6. Keep the booking switches off: leave `DATABASE_URL`, `ADMIN_PASSWORD`, the Google and mail settings and
   `SEASON_PREVIEW` unset. The camp stays "coming soon"; clinics and lessons stay "call or email".

---

## 9. Decisions for you

| ID | Question | My recommendation |
| --- | --- | --- |
| **H1** | May I commit `netlify.toml` to the launch branch (still no deploy)? | Yes, when you are ready to connect Netlify |
| **H2** | Accept Netlify Free's hard monthly credit cap (about 3,500 to 5,500 visits a month by my estimate) for the launch? | Yes, with the 70% tripwire; otherwise Personal at $9 |
| **H3** | Do you want me to write the static-copy build script (leaves the repository untouched) as a ready fallback? | Only if you want a second option; not needed to launch |
| **H4** | Remove the two unused videos (9 MB) from `public/`? | Not needed; harmless |

---

## Sources

Netlify (documentation as returned by search; the vendor sites themselves are blocked here)
- [How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)
- [Billing FAQ for credit-based plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/)
- [Resume paused projects](https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/)
- [Pricing updates for credit-based plans (April 2026)](https://www.netlify.com/changelog/2026-04-14-pricing-updates-april-2026/)
- [Configuration for functions](https://docs.netlify.com/build/functions/configuration/)
- [Self-Serve Subscription Agreement](https://www.netlify.com/legal/self-serve-subscription-agreement/)
- [Forum: can the Free plan be used commercially?](https://answers.netlify.com/t/can-we-use-netlify-free-plan-for-commercial-purposes/41545)
- [Forum: Free plan shows "out of credits" with credits left](https://answers.netlify.com/t/free-plan-shows-run-out-of-credits-but-29-9-30-available-production-deploys-blocked/165597)
- [Netlify Next.js Runtime (README)](https://github.com/opennextjs/opennextjs-netlify)

Cloudflare
- [Workers limits (documentation source)](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/limits.mdx)
- [Workers pricing (documentation source)](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/pricing.mdx)
- [OpenNext for Cloudflare](https://opennext.js.org/cloudflare)
- [Community: Pages and Workers free plan for commercial use](https://community.cloudflare.com/t/is-cloudflare-pages-workers-free-plan-free-for-commercial-use/291741)

Vercel
- [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- [Hobby plan](https://vercel.com/docs/plans/hobby)
