# French and English: what is built, and what still needs a human

**Short answer: the whole parent journey now exists in both languages** (camp pages, the
registration form and its consent boxes, the family's private reservation page, the payment
instructions, the instructions / reminder / release / confirmation / cancellation emails, and the
privacy notice). The French is a **careful draft that nobody from Quebec has read yet**. Two
things have to happen before launch, and neither is code: a **native Quebec reader** goes through
the French, and a **Quebec lawyer** looks at the passages listed in
[`QUEBEC_LEGAL_REVIEW.md`](QUEBEC_LEGAL_REVIEW.md).

> This is not legal advice. Quebec's language rules have changed recently and have details I
> cannot judge. The Charter of the French Language and Bill 96 appear to expect French to be
> available, and at least as prominent as English, for a business that serves Quebec families
> online, and (section 55) to offer a standard take-it-or-leave-it contract in French first. Please
> have a Quebec lawyer, or the Office québécois de la langue française (OQLF), confirm what applies
> before you rely on any of this. Sources I read: [Canadian Marketing Association](https://www.thecma.ca/topic/articles/2022/08/09/the-impact-of-quebec-s-new-language-law-on-marketing),
> [Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2023/bill-96-s-french-first-rule-takes-effect/),
> [Osler](https://www.osler.com/en/insights/updates/quebec-makes-sweeping-changes-to-its-french-language-laws/).

---

## 1. How it works for a parent

| | English | Français |
| --- | --- | --- |
| Home | `/` | `/fr` |
| Camp page and registration form | `/junior-camps` | `/fr/camps-juniors` |
| Privacy notice | `/privacy` | `/fr/confidentialite` |
| A family's private reservation page | `/camp-registration/<link>` | `/fr/inscription-camp/<link>` (same link, other language) |

- A **language switch** ("Français" / "English") sits in the header of every page. On a family's
  private page it keeps them on the *same* reservation.
- The page language is the **parent's choice** and is saved with the registration. Every email to
  that family (instructions, reminder, release notice, confirmation, cancellation notice) is written
  in that language **at the moment it is sent**, so a retried email is still in the right language.
- Nothing is guessed from the browser. A French-speaking parent who lands on the English page
  sees "Voir cette page en français" at the top, in French.
- `<html lang="fr-CA">`, `hreflang` pairs, French page titles, and the private-page "do not
  index / do not cache" headers apply to the French addresses too.
- Formats: `436,91 $`, "21, 22, 23 et 25 juin", "sam. 17 oct., 0 h 30 (heure de Montréal)",
  TPS (5 %) / TVQ (9,975 %), "virement Interac", non-breaking spaces before `:`, `;`, `%`, `$` and
  inside « ».

**Your own emails and the dashboard stay English on purpose** (they are for you). A registration
from a francophone family is tagged "Français" in the review queue and in search, and the
notification email says "reply in French".

## 2. What I tested

`npm run test:i18n` (85 checks) plus a real-browser run (36 checks, phone and desktop):

- The two dictionaries have the **same keys and the same placeholders**: a missing or extra
  piece of French fails the tests.
- Every French message is French (none left in English) and the typography rules above hold,
  including elision such as "d'Émilie".
- Money, dates and week names come out right in both languages; the two holiday weeks explain
  themselves ("Fête nationale du Québec", "Canada Day").
- The registration API answers (errors, "already registered", "week full") in the family's
  language, for every stable error code.
- Each email is in the family's language, contains no health note / birth date / emergency
  contact, and the confirmation email reads correctly in both.
- A cancellation notice is sent once per cancellation, in the family's language, **never shows the
  owner's private note**, and is not sent to an erased family.
- In a real Chromium: a francophone parent on a phone and an anglophone family on a laptop each
  register end to end; every step is in their language; no sideways scrolling.

## 3. What still needs you (see `QUEBEC_LEGAL_REVIEW.md`)

1. **A native Quebec-French reader** for all the dictionary text (about 400 lines per language).
   I wrote a careful draft, not a certified translation. The consent and cancellation passages
   especially.
2. **A Quebec lawyer** on the 15 flagged passages (L1 to L15) and the extra questions (a
   cancellation fee that does not say per child or per week, "Certain conditions may apply",
   "send your child home", health-data consent, where data is stored, the 12-hour automatic
   release).
3. **The pages that stay English** (lessons, clinics, about, contact, booking). The camp journey
   is bilingual; the rest of the site is not (L9). Ask the lawyer whether those need French too.
4. **The word "Interac"** in the payment instructions: check it against what your own bank's
   screens say, so parents are not told to look for a button that is named differently.

## 4. How a translation is changed later

Text lives in `src/lib/i18n/en.ts` and `src/lib/i18n/fr.ts` (one entry per message, the same keys
in both). Edit the French there. `npm run test:i18n` refuses a French entry that is missing, has
different placeholders, is still English, or breaks the typography rules. If you change a passage
that is flagged for the lawyer, run `npm run legal:write` to refresh `docs/QUEBEC_LEGAL_REVIEW.md`
(a test fails if it is out of date).
