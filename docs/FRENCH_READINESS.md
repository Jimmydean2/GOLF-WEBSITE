# Is the registration ready for French-speaking families?

**Short answer: no. Every page and every email a parent sees is in English only.** Nothing is
broken, but if the camp is marketed to the public in Quebec this is the biggest launch decision
that is *not* a technical one. This page measures the gap, explains the rules as far as a
non-lawyer can, and gives you three ways forward.

> This is a readiness audit, not legal advice. Quebec's language rules have changed recently and
> have details I cannot judge. Please have a Quebec lawyer, or the Office québécois de la langue
> française (OQLF), confirm what applies to the camp before you rely on anything below.

---

## 1. What the rules appear to say

| Rule | What it means for the camp | Source |
| --- | --- | --- |
| **The Charter of the French Language** requires businesses to inform and serve clients in French. Law-firm and marketing-association summaries say this already reaches **websites, social media and newsletters** of organizations providing goods or services in Quebec. | A camp site that takes registrations from Quebec families should be available in French, with French at least as prominent and as good as the English. | [Canadian Marketing Association](https://www.thecma.ca/topic/articles/2022/08/09/the-impact-of-quebec-s-new-language-law-on-marketing), [CFIB summary of Bill 96](https://cfib-fcei.ca/en/site/qc-law-14-bill-96) |
| **"French first" for contracts of adhesion** (section 55, in force since **June 1, 2023**). A standard contract offered take-it-or-leave-it may bind the customer in English only if a **French version was provided first** and the customer then chose English. | The camp's two acceptance boxes (code of conduct, information consent) and the payment terms ("Cancellations are subject to a $50 administrative fee") may count. A "choose your language" line is not enough. | [Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2023/bill-96-s-french-first-rule-takes-effect/), [Osler](https://www.osler.com/en/insights/updates/quebec-makes-sweeping-changes-to-its-french-language-laws/) |
| **Enforcement** is by complaint to the OQLF. | The practical risk is a complaint from a parent or competitor, not an inspection. | the same summaries |

Questions only a lawyer can answer: whether the camp's materials are caught as written;
whether the acceptance text is a "contract of adhesion"; and what is required for the existing
non-registration pages (lessons, clinics, about).

## 2. How much English is there? (measured)

`node scripts/i18n-audit.mjs` counts the English a parent can see in the registration journey
(approximate, ±10%):

| Area | Strings | Words |
| --- | ---: | ---: |
| Registration form (labels, buttons, consent text, payment explanation) | 42 | 317 |
| Camp information pages (what a parent reads first) | 42 | 193 |
| Parent's private reservation page | 21 | 166 |
| Messages the registration API shows (errors, "already registered", "week full") | 38 | 385 |
| Payment instructions (page and email, shared) | 5 | 77 |
| Emails to parents (instructions, reminder, release notice, confirmation) | 114 | 746 |
| Camp content (week labels, what to bring, safety notes) | 78 | 610 |
| **Total** | **~340** | **~2,500** |

(The administrator's dashboard and the emails to you are English on purpose; they are for you.)

### English-only formatting that also needs attention

| Today | French Canada |
| --- | --- |
| `<html lang="en">` | `lang="fr"` on French pages, and an `hreflang` pair so search engines and screen readers know |
| `$436.91` | `436,91 $` |
| "Fri, Jul 10, 9:45 p.m." (`en-CA`) | "ven. 10 juill., 21 h 45" |
| "Interac e-Transfer" | "virement Interac" |
| "GST (5%) / QST (9.975%)" | "TPS (5 %) / TVQ (9,975 %)" |
| Camp week labels "June 22, 23, 25 & 26" | "22, 23, 25 et 26 juin" |
| Error messages in English (each already carries a stable code, e.g. `weeks_full`) | translated by code |

### What already works for French

- **Accented names** go through the whole system intact (form → database → emails → roster
  spreadsheet). Tested with a real mail conversation (`npm run test:smtp-stack`): "Émilie Côté"
  arrives correctly in subjects and bodies.
- Duplicate detection ignores accents and capital letters ("Émile" and "emile" are the same child).
- The API returns a stable `code` with every error, which is what a French page would translate.
- Money, dates and week names are produced in a few helper functions (`pricing.ts`, `payment.ts`,
  `content.ts`), not scattered through the pages.

## 3. What building it involves

| Piece | Work |
| --- | --- |
| Translations (about 2,500 words, plus the legal-sounding acceptance text) | A **professional Quebec-French translation** and a review by a native speaker. Machine translation is not suitable for the consent and cancellation text. |
| French pages | A language switch and `/fr/…` versions of the camp pages, the form and the private reservation page, using one dictionary per language. About 2–3 days of development. |
| French emails | The parent's language is saved with the registration (one new column) and every email is built in that language, including the reminder and the release notice. About 1 day. |
| Formats | `fr-CA` formatting for dates, money and the tax names. Half a day. |
| Tests | The same suites, run in both languages; a check that no English string remains on a French page. About 1 day. |

Roughly **5 working days of development plus the translation**, which I can start as soon as you decide and the translation exists.

## 4. Your options

| | What it is | Risk | Cost |
| --- | --- | --- | --- |
| **A. Bilingual at launch** (recommended if the camp is advertised publicly in Quebec) | French and English versions of the registration journey, translated and reviewed, before launch | Lowest legal risk; best experience for francophone families | Translation fee + about a week of development |
| **B. English at launch, French soon after** | Launch in English with a clear French contact line ("Pour vous inscrire en français, appelez le 514-816-3454"), build French in the first weeks | Some exposure until French exists (a complaint is possible); francophone families may phone instead | Same cost, spread out |
| **C. English only** | As it is today | Highest: language-law exposure, and you lose or burden francophone families | None |

The camp is in Dorval, in a bilingual community, and most families probably read English, but
the legal duty does not depend on that.

## 5. A related issue: personal-information law (Law 25)

The form collects **children's names, birth dates and health information**. Quebec's private-sector
privacy law (Law 25) is relevant, and **the site has no privacy notice today**; the form's consent
sentence is two lines. From the compliance guides I read (to be confirmed with counsel):
the business must name a person in charge of personal information and publish how to reach them,
publish a plain-language privacy policy on the site, get a parent's consent for children under 14,
keep a register of confidentiality incidents, and assess a transfer of personal information outside
Quebec before it happens (the site stores data with Neon, Vercel, Google and, optionally, Google
Sheets). Sources: [CFIB](https://www.cfib-fcei.ca/en/site/qc-law-25), [CookieYes summary](https://www.cookieyes.com/blog/quebec-law-25/).

This is listed as a decision in docs/LAUNCH_CHECKLIST.md. It is separate from French, but a
privacy notice has to exist in French as well.
