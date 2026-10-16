# Wording that needs a Quebec lawyer's review

> **This is not legal advice.** It lists the places in the camp journey where a Quebec rule *might*
> apply, shows the exact wording in both languages, and gives the question to put to a lawyer. It
> does not say the wording is wrong. The French is a careful draft written for this site and has
> **not** been read by a Quebec translator: have a native reader check it, and have the lawyer
> check the sections below before launch.
>
> GENERATED from `src/lib/i18n/legal.ts` and the dictionaries by `npm run legal:write`. A test fails
> if this file is out of date.

## 1. Wording to review

### L1. Registration form, first tick box

**`form.conductConsent`**

- English:
  > I understand that my child is expected to follow program rules and demonstrate respectful behavior at all times. I acknowledge that the program reserves the right to send my child home if these expectations are not met, and that this registration will not be considered valid unless this acknowledgment is accepted.
- Français:
  > Je comprends que mon enfant doit respecter les règles du programme et faire preuve de respect en tout temps. Je reconnais que le programme se réserve le droit de renvoyer mon enfant à la maison si ces attentes ne sont pas respectées, et que cette inscription n’est valide que si cette reconnaissance est acceptée.

- **Why it may matter:** It gives the camp a right (to send a child home) and says the registration is not valid without the tick. A standard take-it-or-leave-it form may be a contract of adhesion, and Quebec's consumer rules limit what such a contract can say.
- **Question for the lawyer:** Is this acknowledgement enforceable as written? Does sending a child home mid-week need a stated refund or credit rule? Must a French version be offered first (Charter of the French Language, section 55)?
- **What the draft does for now:** Kept as the owner wrote it, translated closely. No refund promise is made.

### L2. Registration form, "Method of payment" list

**`form.payCancelFee`**

- English:
  > Cancellations are subject to a $50 administrative fee.
- Français:
  > Des frais d’administration de 50 $ s’appliquent à toute annulation.

- **Why it may matter:** A cancellation fee is a contract term. It does not say per child, per week or per registration, how long before camp a family can cancel, or what is refunded.
- **Question for the lawyer:** How should the fee be stated (amount, what it applies to, deadlines)? Are there statutory cancellation rights for a service bought online that must be mentioned?
- **What the draft does for now:** One sentence, as written by the owner. The owner must supply the real policy (docs/SEASON_2027.md, S8).

### L3. Registration form, under the price summary

**`form.firstComeNote`**

- English:
  > Reservations are made on a first-come, first-served basis. Camps fill up quickly. Availability and pricing subject to change. Certain conditions may apply.
- Français:
  > Les places sont accordées selon l’ordre des inscriptions. Les camps se remplissent rapidement. Les disponibilités et les prix peuvent changer. Certaines conditions peuvent s’appliquer.

- **Why it may matter:** "Certain conditions may apply" does not say which. Consumer-protection rules discourage leaving out or blurring important conditions.
- **Question for the lawyer:** Delete the last sentence, or list the conditions?
- **What the draft does for now:** Kept as written by the owner. Recommend deleting "Certain conditions may apply" unless the conditions are listed.

### L4. Camp pages and the family's confirmation email ("Safety & Responsibility")

**`info.safetyInfo`**

- English:
  - A CPGA-certified coach and on-site staff supervise all campers throughout the day.
  - Regular sun-safety and water breaks are built into the daily schedule.
  - Please make sure any allergies or medical conditions are noted on the registration form.
  - Campers may only be picked up by a parent/guardian or someone they've authorized in advance.
  - Camps run rain or shine Monday–Thursday; Friday is held in reserve as a weather makeup day.
- Français:
  - Un entraîneur certifié de la PGA du Canada (CPGA) et le personnel sur place supervisent tous les campeurs tout au long de la journée.
  - Des pauses pour se protéger du soleil et s’hydrater sont prévues régulièrement dans l’horaire de la journée.
  - Veuillez vous assurer que les allergies et les problèmes de santé sont indiqués dans le formulaire d’inscription.
  - Les campeurs ne peuvent être récupérés que par un parent ou un tuteur, ou par une personne que vous avez autorisée à l’avance.
  - Les camps ont lieu qu’il pleuve ou qu’il fasse beau, du lundi au jeudi; le vendredi est réservé comme journée de reprise en cas de mauvais temps.

**`info.scheduleNote`**

- English:
  > Camps run Monday through Thursday. Friday is held in reserve as a makeup day in case of rain.
- Français:
  > Les camps ont lieu du lundi au jeudi. Le vendredi est réservé comme journée de reprise en cas de pluie.

- **Why it may matter:** Statements about supervision, certification and what happens in bad weather are promises a parent relies on. The French name of the coaching body ("PGA du Canada") should be checked. No staff-to-camper ratio is stated.
- **Question for the lawyer:** Are these statements accurate and sufficient? What should be said about severe weather, and is a refund or credit owed when a day is lost?
- **What the draft does for now:** Owner's words, translated. The French says "PGA du Canada (CPGA)"; please confirm the official French name.

### L5. Email to a family whose unpaid reservation was released

**`email.release.body`**

- English:
  > Your reservation was released because we didn't see a payment report in time. If you already sent your e-Transfer, your money isn't lost: reply to this email with your reference, and we'll check and reinstate you if a spot is still free, or refund you. If you still want a spot, you're welcome to register again.
- Français:
  > Votre réservation a été libérée parce que nous n’avons pas reçu d’avis de paiement à temps. Si vous avez déjà envoyé votre virement Interac, votre argent n’est pas perdu : répondez à ce courriel en indiquant votre numéro de référence; nous vérifierons et nous rétablirons votre inscription s’il reste une place, sinon nous vous rembourserons. Si vous souhaitez toujours une place, vous pouvez vous inscrire de nouveau.

- **Why it may matter:** It tells the family that, if they already paid, they will be reinstated or refunded. That is a promise about money.
- **Question for the lawyer:** Is a refund commitment appropriate here, and in what words?
- **What the draft does for now:** Kept (it is the owner's existing wording). It is only sent for reservations the family never reported as paid.

### L6. Email to a family whose registration the owner cancelled, or whose payment could not be found

**`email.cancellation.cancelledPaid`**

- English:
  > This registration has been cancelled and its spots released. If a refund is owed under our cancellation terms, we will arrange it with you directly. If you did not ask for this cancellation, please call us right away.
- Français:
  > Cette inscription a été annulée et ses places ont été libérées. Si un remboursement est dû en vertu de nos conditions d’annulation, nous le réglerons directement avec vous. Si vous n’avez pas demandé cette annulation, veuillez nous appeler sans tarder.

**`email.cancellation.cancelledUnpaid`**

- English:
  > This reservation has been cancelled and its spots released. No payment had been confirmed for it. If you did send an e-Transfer, please reply to this email with your reference so we can match it.
- Français:
  > Cette réservation a été annulée et ses places ont été libérées. Aucun paiement n’avait été confirmé pour cette réservation. Si vous avez bel et bien envoyé un virement Interac, répondez à ce courriel en indiquant votre numéro de référence afin que nous puissions l’associer.

**`email.cancellation.notReceived`**

- English:
  > We looked for your e-Transfer and could not find it, so the spots held for this reservation have been released for other families. If you did send a payment, your money is not lost: reply to this email with your reference and the bank’s confirmation number, and we will check and sort it out, including restoring your spots if they are still free.
- Français:
  > Nous avons cherché votre virement Interac sans le trouver; les places réservées pour cette inscription ont donc été libérées pour d’autres familles. Si vous avez bel et bien envoyé un paiement, votre argent n’est pas perdu : répondez à ce courriel en indiquant votre numéro de référence et le numéro de confirmation de votre institution financière; nous vérifierons et réglerons la situation, y compris en rétablissant vos places si elles sont encore libres.

- **Why it may matter:** These say that a refund will be arranged when one is owed, and that money sent is not lost. They are statements about the family's rights.
- **Question for the lawyer:** Are they accurate, and is anything required that is missing (for example the deadline for a refund)?
- **What the draft does for now:** Deliberately general: no amount and no deadline is stated, because the policy has not been supplied.

### L7. A family's private reservation page, after a release

**`parent.inactiveExpired`**

- English:
  > It was released because we didn't see a payment report in time. If you already sent your e-Transfer, your money isn't lost.
- Français:
  > Elle a été libérée parce que nous n’avons pas reçu d’avis de paiement à temps. Si vous avez déjà envoyé votre virement Interac, votre argent n’est pas perdu.

- **Why it may matter:** "Your money isn't lost" is an assurance about funds.
- **Question for the lawyer:** Same question as L5.
- **What the draft does for now:** Kept as the owner wrote it. The sentence only appears for reservations the family never reported as paid.

### L8. Registration form, health field

**`form.childHealth`**

- English:
  > Health & medical information (allergies, medical conditions, medication)
- Français:
  > Renseignements de santé (allergies, problèmes de santé, médicaments)

**`form.childHealthHint`**

- English:
  > Write “None” if there is nothing to report.
- Français:
  > Écrivez « Aucun » s’il n’y a rien à signaler.

- **Why it may matter:** Health information about a child is sensitive personal information (Law 25). It is collected here for the child's safety.
- **Question for the lawyer:** Is a separate, express consent required for it and how must it be worded? See docs/PRIVACY_AND_LAW25.md for the consent flow that has been built.
- **What the draft does for now:** Collected, with a clear purpose line in the consent flow.

### L9. Every page, the footer, and the pages that stay English

- **Why it may matter:** The Charter of the French Language may require the commercial website as a whole (not only the camp pages) to be available in French on terms at least as favourable as English. Only the camp journey is in French today.
- **Question for the lawyer:** What must be translated for a Quebec business with this site, and by when?
- **What the draft does for now:** Camp journey bilingual; lessons, clinics, about, contact and booking remain English (docs/FRENCH_READINESS.md, options A to C).

## 2. Questions that are not about a line of text on a page

1. **Liability and insurance.** There is no waiver or assumption-of-risk text anywhere. In Quebec a
   clause that excludes or limits liability for bodily injury is generally not enforceable (Civil
   Code, art. 1474). What acknowledgement, if any, should a parent give, and what does the camp's
   insurance (and Golf Dorval's) require?
2. **Photos and video.** The form does not ask permission to photograph campers. If any photo of a
   child is posted (for example on Instagram), a separate consent is needed. Either do not
   photograph, or add an optional, separate tick box once the lawyer words it.
3. **Marketing email.** The site sends no marketing: only the registration emails. Using parents'
   addresses to announce next year's camps needs consent under Canada's anti-spam law. Ask
   whether and how to collect it.
4. **Charter of the French Language.** Scope (website, forms, contracts of adhesion, section 55
   "French first"), and whether a French version of the whole commercial site is required, not
   only the camp pages.
5. **Privacy officer and governance (Law 25).** The person responsible for personal information must
   be named and reachable, a plain-language privacy policy published, a register of confidentiality
   incidents kept, and a privacy impact assessment done before personal information leaves Quebec
   (the hosting providers store data outside Quebec). See `docs/PRIVACY_AND_LAW25.md`.
6. **Children under 14.** Their information is collected from the parent, who consents. Is the
   wording ("I am the parent or legal guardian") enough?
7. **Retention.** How long camper records, health information and payment records must or may be
   kept (the documents propose a schedule; the lawyer and the accountant decide).
8. **Distance contracts.** A registration made online is a contract by distance. Does the
   confirmation email (the family's copy) contain everything required: the business's identity,
   address and telephone, a description of the service, the total price and payment terms, and
   the cancellation conditions?
