# Privacy and Quebec's Law 25: what is built, what is not, what needs a lawyer

> **This is not legal advice.** It separates three things, so you always know which is which:
>
> * **Built and tested** — a technical safeguard that exists in the software and is checked by the
>   automated tests (`npm test`).
> * **Needs your decision** — a choice only you can make; the software follows whatever you decide.
> * **Needs legal review** — a question about what the law requires. Nothing here answers it. The exact
>   wording a lawyer should read is in [`QUEBEC_LEGAL_REVIEW.md`](QUEBEC_LEGAL_REVIEW.md).
>
> The summaries of the law below are my reading of public guides (Commission d'accès à l'information,
> CFIB, law-firm notes), not a verdict. Law 25 is the 2021 reform of Quebec's private-sector privacy act.

## 1. The short answer

1. The registration collects **children's names, dates of birth and health information**. That is
   sensitive. Until today the site had a two-line consent sentence and no privacy notice.
2. **Now built:** a plain-language privacy notice (English and French), a consent flow with **two separate
   tick boxes** (privacy; health information) and a short "how we use your information" box, the consent
   **recorded with each registration** (which tick boxes, which version of the notice, when), a database rule
   that refuses a registration without that record, a way to **give a family a copy** of what we hold, a way to
   **erase a family's personal details**, and a **clean-up after the season**.
3. **Nothing about the wording has been reviewed by a lawyer.** The notice is marked DRAFT on test sites and the
   real-site check (`npm run preflight -- --production`) **refuses to pass** until you record that it has been
   reviewed.
4. **Four things only you can do:** name the person in charge of personal information (default: you); decide the
   retention period (I propose 90 days); decide whether you need both the date of birth and the age; and have the
   assessment of storing data outside Quebec done (section 7).
5. **Google Sheets is off for camp data by default** (item 4 of this work): a copy of children's information in a
   spreadsheet at Google is exactly the kind of extra copy the law wants you to avoid. Roster downloads (Excel and
   CSV) are now behind a recent password check, labelled CONFIDENTIAL, never cached and recorded in the activity log,
   with a **sign-in sheet** version that leaves out health and emergency details. The optional waiting list for full
   weeks collects only contact details and is deleted when its week has passed. See `ROSTERS_CONFIRMING_AND_WAITLIST.md`.

## 2. What the system collects, why, and who sees it

| Data | Why | Where it is stored | Who sees it | Erased by |
|------|-----|--------------------|-------------|-----------|
| Parent: name, email, phone(s) | contact, match the payment | Postgres (Neon) | you; coaches see names/phones on printed rosters | clean-up / erase (name kept as payer unless you choose) |
| Child: name, date of birth, age | register, identify, camp safety | Postgres | you and the coaches (roster) | clean-up / erase |
| Child: health information | safety | Postgres | you and the coaches (roster); **never in an email** | clean-up / erase |
| Emergency contact: name, relationship, phone | safety | Postgres | you and the coaches (roster) | clean-up / erase |
| Registration: weeks, amounts, reference, payment status and times, bank confirmation number | take and prove payment, accounting | Postgres | you | **kept 6 years** (accounting) |
| Consent record: two ticks, notice version, time, language | prove consent | Postgres | you | kept with the accounting record |
| Waiting list (only if switched on): parent's name, email, phone (optional), number of children, weeks, language, consent record | tell a family a place may be open (no child details, no health information) | Postgres (`waitlist_entries`) | you | **deleted when its camp week has passed**, on your removal, or when you erase a family with that email |
| Your free-text notes about a family | your own record | Postgres (`admin_notes`, the registration row) | you | erase / clean-up |
| Emails sent to the family (not their text) | prove what was sent | Postgres (a status row) | you | erase / clean-up |
| A scrambled (hashed) form of an internet address, in a counter | stop abuse | Postgres | nobody (cannot be reversed) | automatically within days |
| Administrator sign-ins: internet address, device | stop password-guessing | Postgres | you | automatically after 30 days (clean-up) |
| Emails themselves | the family's copy | Gmail (Google) | Google; the family | Gmail's own retention: **see decision P7** |

What is **not** collected: bank or card numbers (families pay by Interac e-Transfer from their own bank),
photos, cookies for parents, analytics, advertising identifiers. The site has no analytics or tracking code
(checked in the source).

## 3. Technical safeguards that exist (all tested)

| Safeguard | Test |
|-----------|------|
| A family's page can only be opened with the private link in their email (signed; a changed character gives "not found"); the page is never cached, never indexed, sends no referrer | `http-privacy`, `launch-http` |
| One family cannot see another's data (private links, search, rosters need the administrator login) | `http-privacy`, `families` |
| The administrator dashboard: strong password, lock-out after 5 wrong tries, sessions in the database, a fresh password check before any payment or privacy action | `admin-security`, `launch-http` |
| **No health information, date of birth or emergency contact is ever put in an email** (including the owner's) | `outbox`, `i18n` |
| **Consent is required, split in two, and recorded** (also enforced by the database, even against a coding mistake) | `privacy` |
| **The audit log holds no personal detail**: your free-text notes live in an erasable table; the append-only log only says a note exists | `privacy` |
| **Give a family a copy** of what is held, as a file; the download is logged | `privacy`, `launch-http` |
| **Erase a family's personal details** (child's name, date of birth, age, health, emergency contact, phones, email, your notes, queued emails, abuse strikes), keep the accounting record. A search of every text column of every table afterwards finds no trace | `privacy` |
| **Clean-up after the season** at the retention period, never touching a registration whose payment is unresolved, never changing a status or the capacity counts | `privacy` |
| **Roster downloads need a recent password, come only from this site, are never cached, are named CONFIDENTIAL, and are logged without personal details**; a sign-in version omits health, emergency and email details | `roster-export`, `roster-http` |
| **The Google Sheets copy of camp registrations is off** unless `CAMP_SHEETS_COPY=true`; availability, booking and rosters never read Google | `roster-export` |
| **A waiting list cannot hold or assign a place** (no link to registrations or capacity; a source scan; a place opening changes nothing on it); it can be switched off; it collects no child details | `waitlist`, `waitlist-http` |
| Logs never contain a database row, an email address or a health note | `log-safety` |
| Data in transit is encrypted (https; the database connection verifies the server's certificate) | `rehearsal-kit` |
| Database safeguards against double-booking and against marking a payment received without proof | `payment-integrity`, `concurrency` |

## 4. The consent flow, as the parent sees it

On the registration form, above the Register button (French identical in meaning):

1. A box **"How we use your information"**: why it is collected, who sees it, that providers may store it
   outside Quebec, how long it is kept, how to see/correct/erase it, and who to call.
2. Tick box one (required): *"I am the parent or legal guardian of each child I am registering. I have read the
   **privacy notice** [link] and I consent to James Dean Golf collecting, using and keeping my information and my
   child's information to register my child, run the camp, take payment and contact me about it."*
3. Tick box two (required): *"I consent to James Dean Golf collecting the health information I give about my child
   … and sharing it only with the coaches and staff who supervise my child, so they can keep my child safe. I can
   ask to see, correct or erase it at any time."*
4. The code of conduct tick box (unchanged).

Recorded with the registration: both consents, the **version** of the notice (`2026-10-16-draft` today), the
time, and the language. **Needs legal review:** items L10 to L12 in `QUEBEC_LEGAL_REVIEW.md`.

## 5. Retention: how long, and what "erased" means

**Proposed (needs your decision, P2, and your accountant's and lawyer's agreement):**

* **90 days after the last camp week** a family registered for: the child's date of birth, age and health
  information, the emergency contact, the parent's phone numbers and email, and your notes are overwritten.
* **Six years:** only the accounting record stays: the reference, amounts, dates, the bank confirmation number,
  the consent record, and the parent's name as payer (you may choose to remove the name too). Six years is my
  understanding of the tax record-keeping rule; **confirm with your accountant.**
* Registrations whose payment is **unresolved** (reported, not confirmed) are never erased automatically; the
  dashboard lists them for you to resolve first.

**How it is done.** On the dashboard, bottom of the page: **"Privacy: season clean-up"** shows how many families
are due; type `CLEAN UP` to run it (it also asks for your password again). Or from the command line, by whoever
maintains the site: `npm run retention` (shows what would happen; changes nothing) and
`npm run retention -- --apply --confirm-retention` (does it). The number of days is one constant,
`RETENTION_DAYS` in `src/lib/privacy.ts`; the notice, the consent box and the clean-up all read it, so they cannot
disagree.

**One family, now:** search for them on the dashboard, then **Erase personal details…** (type the reference to
confirm). If they still hold places, the places are released first and the family is **not** emailed.

## 6. Answering a family's request (30 days)

| They ask to… | You do |
|---|---|
| See what you hold / get a copy | Dashboard, find them, **Download this family's data**. It is a small file (JSON) with everything, in a common format (which also covers the right to take their data elsewhere). Send it to the email address they registered with. Delete your copy afterwards. |
| Correct something | Tell Claude or your developer; there is no edit screen yet (phone number typos are the usual case). **Decision P8: do you want an "edit" button?** |
| Withdraw consent / erase | Dashboard, **Erase personal details…** Explain that their child cannot take part without the information, and that accounting records are kept by law. |
| Complain | Give them the Commission d'accès à l'information du Québec (cai.gouv.qc.ca). |

Write each request and your answer in the incident-and-requests log below.

## 7. Where the data lives (outside Quebec)

| Provider | What it holds | Location | What to do |
|---|---|---|---|
| Vercel | the website code, server logs (no personal data in our logs) | United States (and a CDN) | Choose the nearest function region (Montreal is closest to `iad1`/Washington); accept Vercel's data-processing terms |
| Neon | **the database (everything in section 2)** | the region you choose when you create the project (check whether a Canadian region is offered; otherwise the United States) | Choose the region deliberately; accept Neon's data-processing terms; this is the one that matters |
| Google (Gmail) | the emails sent to and from the camp address | Google's data centres | Use the camp's own Google account; accept Google's terms |

Law 25 asks for an **assessment of the privacy risks before personal information is communicated outside Quebec**,
and for a written agreement with each service provider. **Not done, needs legal review (L13 and the questions at
the end of `QUEBEC_LEGAL_REVIEW.md`).** A starting point for the assessment: the table in section 2 is the data
inventory; section 3 is the protections; the risks are a breach at a provider and access by foreign authorities;
the mitigations are encryption in transit, no health data in email or logs, the shortest retention you decide on,
and choosing the provider region deliberately.

## 8. The Law 25 checklist

| # | Obligation (my summary of the law) | Status |
|---|---|---|
| 1 | Name the person responsible for personal information; publish their title and contact | **Needs your decision (P1).** The notice names "James … owner" and your email and phone. Give the name you want shown. |
| 2 | Publish clear governance policies (the privacy notice) | **Built (draft); needs legal review (L15).** |
| 3 | Assessment of privacy risks for the system, and before data leaves Quebec | **Not done; needs legal review.** Section 7 is the starting material. |
| 4 | Confidentiality incidents: keep a register; tell the Commission and the people concerned when there is a risk of serious harm | **Process below; the register is yours to keep.** Needs legal review for the threshold. |
| 5 | Consent: clear, free, informed, specific, separate from other information; express for sensitive information; parent consents for a child under 14 | **Built; needs legal review (L10, L11).** |
| 6 | Tell people at the moment of collection: why, how, their rights, who sees it, storage outside Quebec | **Built (the box and the notice); needs legal review (L12).** |
| 7 | Collect only what is necessary | **Needs your decision (P4, P5).** Both date of birth and age are collected; the health field must be filled in. |
| 8 | Destroy or anonymise when the purpose is achieved | **Built (clean-up, erase, waiting-list deletion); the period is yours to decide (P2).** |
| 9 | Access, correction, withdrawal; answer within 30 days; copy in a common format | **Access/copy/erase built; correction by hand (P8).** |
| 10 | Security safeguards proportionate to the sensitivity | **Built (section 3).** |
| 11 | Written agreements with service providers | **Not done.** Accepting each provider's data-processing terms is the usual way; ask the lawyer. |
| 12 | Automated decisions: tell people when a decision is made only by automated processing | **Needs legal review.** The site releases an unpaid, unreported reservation automatically after 12 hours; the family is told the rule in advance and the owner can reinstate. Does that count? |
| 13 | Cookies, trackers, profiling | **Not applicable:** none are used. |

## 9. A confidentiality incident: what to do

Examples: someone other than the family opens their reservation page; an email goes to the wrong person; the
administrator password is guessed; a laptop with a roster is lost; a printed roster is left at the course.

1. **Contain.** If a link or the password may be exposed: change `ADMIN_PASSWORD`, use **Log out everywhere** on
   the dashboard, and, if links were exposed, tell Claude/your developer (changing `REGISTRATION_LINK_SECRET`
   breaks every link already emailed, so it is a last resort).
2. **Assess** whether the incident presents **a risk of serious harm** (the more sensitive the information, such as
   a child's health, the higher the risk).
3. If it does: **notify the Commission d'accès à l'information and the people concerned promptly** (ask the
   lawyer for the exact form).
4. **Always write it in the register** (even a small one that needs no notice). Keep it where only you can read it.

Register template (a spreadsheet is fine): *date discovered · date it happened · what happened · what information ·
how many people · the risk assessment and why · who was told and when · what was done to stop it happening again.*

## 10. Decisions for you

| # | Decision | Default in the software |
|---|---|---|
| P1 | Who is the person in charge, and the name to publish? | "James (Coach James), owner of James Dean Golf" |
| P2 | Retention: how long after a family's last camp week do you keep their sensitive details? | 90 days |
| P3 | Keep the parent's name as payer for six years? | Yes |
| P4 | Do you need the exact **date of birth**, or only the **age**? Collecting both is more than needed. | Both, as before |
| P5 | Must the health field always be filled in ("None" if nothing), or optional? | Must be filled in (a safety choice) |
| P6 | Neon and Vercel regions | You choose when you create them |
| P7 | How long do you keep the camp Gmail's sent messages and replies? | Gmail's default (forever) |
| P8 | An "edit this family's details" button on the dashboard? | Not built; corrections are done by hand |
| P9 | Photos and video of campers: allowed? | Not collected; do not post photos without a separate consent |
| P10 | Who may download and print rosters, and how are printed rosters kept and destroyed? | One administrator password; downloads need a recent password, are named CONFIDENTIAL and are logged (`ROSTERS_CONFIRMING_AND_WAITLIST.md` §1). Print the **sign-in sheet** for a table; keep the full roster with the head coach; shred after the week. |
| P11 | Offer the waiting list for full weeks, and delete each request once its week has passed? | Built and **off** (`WAITLIST_ENABLED`); deleted when the week has passed |
| P12 | Is a withdrawal from the waiting list by phone or reply email enough, or must each email carry a one-click "remove me" link? | Phone or reply (`QUEBEC_LEGAL_REVIEW.md` L16) |
