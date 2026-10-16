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

### L10. Registration form, the first consent tick box (privacy)

**`consent.privacyBefore`**

- English:
  > I am the parent or legal guardian of each child I am registering. I have read the 
- Français:
  > Je suis le parent ou le tuteur légal de chaque enfant que j’inscris. J’ai lu l’

**`consent.privacyLink`**

- English:
  > privacy notice
- Français:
  > avis de confidentialité

**`consent.privacyAfter`**

- English:
  >  and I consent to James Dean Golf collecting, using and keeping my information and my child's information to register my child, run the camp, take payment and contact me about it.
- Français:
  >  et je consens à ce que James Dean Golf recueille, utilise et conserve mes renseignements et ceux de mon enfant afin d’inscrire mon enfant, d’organiser le camp, de traiter le paiement et de communiquer avec moi à ce sujet.

- **Why it may matter:** Law 25 requires consent to be clear, free, informed and given for specific purposes, requested in plain words, separately from other information. A child under 14's information is consented to by the parent.
- **Question for the lawyer:** Is this wording sufficient for the collection, use and keeping of the parent's and the child's information? Does "I am the parent or legal guardian" adequately cover consent for a minor?
- **What the draft does for now:** A required tick box, separate from the code of conduct, that links to the privacy notice. The version of the notice is saved with the registration.

### L11. Registration form, the second consent tick box (health information)

**`consent.health`**

- English:
  > I consent to James Dean Golf collecting the health information I give about my child (allergies, medical conditions, medication) and sharing it only with the coaches and staff who supervise my child, so they can keep my child safe. I can ask to see, correct or erase it at any time.
- Français:
  > Je consens à ce que James Dean Golf recueille les renseignements de santé que je fournis au sujet de mon enfant (allergies, problèmes de santé, médicaments) et ne les communique qu’aux entraîneurs et au personnel qui supervisent mon enfant, afin d’assurer sa sécurité. Je peux demander à consulter, corriger ou effacer ces renseignements en tout temps.

- **Why it may matter:** Health information is sensitive personal information; consent to collect it is expected to be express and specific.
- **Question for the lawyer:** Is a separate tick box the right way? Is the stated purpose and the limit on who sees it accurate and enough?
- **What the draft does for now:** A second required tick box, saved as its own field. The health field itself still has to be filled in (the parent writes "None" if there is nothing): this is a safety choice, not a legal one; tell us if the lawyer prefers it optional.

### L12. Registration form, "How we use your information" box above the tick boxes

**`consent.panelTitle`**

- English:
  > How we use your information
- Français:
  > Comment nous utilisons vos renseignements

**`consent.panel`**

- English:
  > (not a plain text message)
- Français:
  > (not a plain text message)

- **Why it may matter:** At the moment information is collected the person must be told the purposes, the means, their rights of access and correction, the categories of people who see it, and the possibility that it is stored outside Quebec.
- **Question for the lawyer:** Does this short notice carry everything required at the point of collection, with the full notice a click away?
- **What the draft does for now:** Written to cover each of those points in plain language.

### L13. Privacy notice, "Where it is kept" and "How long we keep it"

**`privacy.where`**

- English:
  > Our providers keep information on servers that may be outside Quebec, including in the United States. It travels encrypted (https) and is protected by passwords and access controls.
- Français:
  > Nos fournisseurs conservent les renseignements sur des serveurs qui peuvent se trouver à l’extérieur du Québec, notamment aux États-Unis. Ils circulent de façon chiffrée (https) et sont protégés par des mots de passe et des contrôles d’accès.

**`privacy.keep`**

- English:
  > (not a plain text message)
- Français:
  > (not a plain text message)

- **Why it may matter:** Keeping information only as long as needed, and the outside-Quebec storage statement, are legal requirements. The 90 days and the six-year accounting retention are PROPOSALS, not decisions.
- **Question for the lawyer:** Confirm or change the retention periods, and say what assessment of the transfer outside Quebec must be done before launch, by whom.
- **What the draft does for now:** 90 days after the last camp week for sensitive details; six years for the accounting record (reference, amounts, dates, payer name). The system enforces whatever number is set (src/lib/privacy.ts).

### L14. Privacy notice, "Your rights"

**`privacy.rights`**

- English:
  - See the information we hold about you and your child, and ask for a copy in a common electronic format.
  - Ask us to correct it.
  - Withdraw your consent, or ask us to erase your information. We may keep what the law requires us to keep (such as accounting records), and withdrawing consent may mean your child cannot take part.
- Français:
  - Consulter les renseignements que nous détenons à votre sujet et au sujet de votre enfant, et en obtenir une copie dans un format électronique courant.
  - Nous demander de les corriger.
  - Retirer votre consentement ou nous demander d’effacer vos renseignements. Nous pouvons conserver ce que la loi nous oblige à conserver (par exemple les registres comptables), et le retrait du consentement peut empêcher votre enfant de participer.

**`privacy.rightsContact`**

- English:
  > (not a plain text message)
- Français:
  > (not a plain text message)

**`privacy.rightsComplaint`**

- English:
  > If you are not satisfied with our answer, you may complain to the Commission d’accès à l’information du Québec (cai.gouv.qc.ca).
- Français:
  > Si notre réponse ne vous satisfait pas, vous pouvez porter plainte à la Commission d’accès à l’information du Québec (cai.gouv.qc.ca).

- **Why it may matter:** Rights of access, correction, withdrawal and (since 2024) portability, a response time, and the complaint route to the Commission d'accès à l'information.
- **Question for the lawyer:** Is the 30-day reply promise correct, and is the list of rights complete and accurate?
- **What the draft does for now:** Lists access, copy in a common format, correction, withdrawal/erasure, 30-day reply and the CAI. The dashboard can produce a copy of one family's data and erase it.

### L15. Privacy notice, the remaining sections

**`privacy.collectItems`**

- English:
  - About you, the parent or guardian: your name, email address and phone number (and a second phone number, if you give one).
  - About your child: name, date of birth and age.
  - Health information you choose to give about your child: allergies, medical conditions, medication.
  - Your emergency contact: name, relationship to your child and phone number.
  - About your registration: the weeks you chose, the amount, your payment reference, whether and when we confirmed your payment, the language you used and the consents you gave.
  - If you join a waiting list: your name, email address, phone number (if you give one), the number of children you would register, the weeks you chose and the language you used. Nothing about your child.
  - We never receive your bank or card details. You pay by Interac e-Transfer from your own bank, and we only see what your bank shows the account holder (usually your name and the amount).
  - To stop automated abuse, the website briefly keeps a scrambled (hashed) form of your internet address in a counter. It cannot be turned back into your address and is cleared automatically within a few days.
- Français:
  - À votre sujet, en tant que parent ou tuteur : votre nom, votre adresse courriel et votre numéro de téléphone (et un deuxième numéro, si vous en indiquez un).
  - Au sujet de votre enfant : son nom, sa date de naissance et son âge.
  - Les renseignements de santé que vous choisissez de nous donner au sujet de votre enfant : allergies, problèmes de santé, médicaments.
  - Votre personne à joindre en cas d’urgence : son nom, son lien avec votre enfant et son numéro de téléphone.
  - Au sujet de votre inscription : les semaines choisies, le montant, votre numéro de référence de paiement, si et quand nous avons confirmé votre paiement, la langue utilisée et les consentements donnés.
  - Si vous vous inscrivez sur une liste d’attente : votre nom, votre adresse courriel, votre numéro de téléphone (si vous en donnez un), le nombre d’enfants que vous inscririez, les semaines choisies et la langue utilisée. Rien au sujet de votre enfant.
  - Nous ne recevons jamais vos renseignements bancaires ni ceux de votre carte. Vous payez par virement Interac à partir de votre propre institution financière, et nous ne voyons que ce que celle-ci montre au titulaire du compte (généralement votre nom et le montant).
  - Pour empêcher les abus automatisés, le site Web conserve brièvement, dans un compteur, une version brouillée (hachée) de votre adresse Internet. Elle ne peut pas être reconvertie en votre adresse et est effacée automatiquement en quelques jours.

**`privacy.whyItems`**

- English:
  - to register your child and hold their place;
  - to take payment and confirm it;
  - to run the camp safely (health information and emergency contacts);
  - to contact you about your registration: payment instructions, reminders, confirmation, changes and cancellations;
  - to keep the accounting records the law requires.
- Français:
  - pour inscrire votre enfant et lui réserver sa place;
  - pour recevoir le paiement et le confirmer;
  - pour organiser le camp en toute sécurité (renseignements de santé et personnes à joindre en cas d’urgence);
  - pour communiquer avec vous au sujet de votre inscription : instructions de paiement, rappels, confirmation, changements et annulations;
  - pour tenir les registres comptables exigés par la loi.

**`privacy.who`**

- English:
  - The owner, and the coaches and staff who run the camp, only to the extent they need it. For example, a coach sees the health notes and emergency contacts of the children they supervise.
- Français:
  - Le propriétaire ainsi que les entraîneurs et le personnel du camp, uniquement dans la mesure où ils en ont besoin. Par exemple, un entraîneur voit les notes de santé et les personnes à joindre en cas d’urgence des enfants qu’il supervise.

**`privacy.providersIntro`**

- English:
  > Service providers that run the website for us. They handle the information on our behalf and may not use it for their own purposes:
- Français:
  > Les fournisseurs de services qui exploitent le site Web pour nous. Ils traitent les renseignements en notre nom et ne peuvent pas les utiliser à leurs propres fins :

**`privacy.noMarketing`**

- English:
  > We do not sell your information, use it for advertising or send marketing messages. We email you only about your registration (and, if you join a waitlist, about that waitlist).
- Français:
  > Nous ne vendons pas vos renseignements, ne les utilisons pas à des fins publicitaires et n’envoyons pas de messages de marketing. Nous vous écrivons seulement au sujet de votre inscription (et, si vous vous inscrivez sur une liste d’attente, au sujet de cette liste).

**`privacy.protect`**

- English:
  - Your reservation page can only be opened with the private link we email you.
  - Registration details are visible only to the owner, after a password sign-in that locks after repeated wrong attempts.
  - Emails to you never contain your child's date of birth or health information.
  - The database has safeguards against double-booking and keeps a record of who changed what.
  - If a confidentiality incident ever involves your information and presents a risk of serious harm, we will tell you and the Commission d’accès à l’information du Québec.
- Français:
  - Votre page de réservation ne peut être ouverte qu’avec le lien privé que nous vous envoyons par courriel.
  - Les détails des inscriptions ne sont visibles que par le propriétaire, après une connexion par mot de passe qui se verrouille après plusieurs essais erronés.
  - Les courriels que nous vous envoyons ne contiennent jamais la date de naissance de votre enfant ni ses renseignements de santé.
  - La base de données comporte des protections contre les doubles réservations et garde une trace de qui a modifié quoi.
  - Si un incident de confidentialité touchait un jour vos renseignements et présentait un risque de préjudice sérieux, nous vous en aviserions ainsi que la Commission d’accès à l’information du Québec.

**`privacy.cookies`**

- English:
  > This website does not use advertising or tracking cookies and does not use analytics services. The only cookie is the one used when the owner signs in to the administration pages.
- Français:
  > Ce site Web n’utilise ni témoins publicitaires ni témoins de suivi, et n’utilise pas de services d’analyse. Le seul témoin est celui qui sert lorsque le propriétaire se connecte aux pages d’administration.

**`privacy.children`**

- English:
  > A child's information is collected from their parent or legal guardian, who gives the consent for them.
- Français:
  > Les renseignements d’un enfant sont recueillis auprès de son parent ou de son tuteur légal, qui donne le consentement en son nom.

- **Why it may matter:** The notice is the public statement of what the business does with personal information. Anything untrue or missing is a problem. Each line was written from what the system really does.
- **Question for the lawyer:** Is anything missing or overstated? In particular the statements about who sees the information, about security, about incidents, and "no tracking cookies".
- **What the draft does for now:** Plain-language draft. It is marked DRAFT on rehearsal sites, and the real site refuses to launch until the owner records that it has been reviewed (PRIVACY_NOTICE_REVIEWED).

### L16. Waiting list form (shown only when a week is full), its tick box and introduction

**`waitlist.intro`**

- English:
  > Joining the waiting list does not register your child and does not hold a place for you. If a place opens up we may email you, but places are first come, first served through the registration form above, so you would need to register right away. To be removed from the list, call 514-816-3454 or reply to our email.
- Français:
  > S’inscrire à la liste d’attente n’inscrit pas votre enfant et ne vous réserve aucune place. Si une place se libère, nous pourrions vous écrire, mais les places sont accordées selon l’ordre des inscriptions, au moyen du formulaire d’inscription ci-dessus : vous devriez donc vous inscrire sans tarder. Pour être retiré de la liste, appelez-nous au 514-816-3454 ou répondez à notre courriel.

**`waitlist.consentBefore`**

- English:
  > I agree that James Dean Golf may use my name, email address and phone number only to contact me if a place opens in the weeks I chose, and keep them until those weeks have passed. I understand this does not register my child or hold a place. 
- Français:
  > J’accepte que James Dean Golf utilise mon nom, mon adresse courriel et mon numéro de téléphone uniquement pour me joindre si une place se libère durant les semaines choisies, et les conserve jusqu’à la fin de ces semaines. Je comprends que cela n’inscrit pas mon enfant et ne réserve aucune place. 

- **Why it may matter:** A waiting list collects personal information (a name, an email address, optionally a phone number) for a purpose different from registering a child. It must not suggest a place is promised, and it must be easy to leave.
- **Question for the lawyer:** Is this consent wording enough for a waiting list, and is it clear that nothing is promised or held? Is a withdrawal by phone or reply email sufficient, or must the email carry a one-click removal link? Is deleting the request once the week has passed an acceptable retention period?
- **What the draft does for now:** A separate tick box, a statement that it is not a registration and holds no place, deletion once the camp week has passed, removal on request by phone or reply. The privacy notice (L15) lists what is collected for the waiting list.

### L17. The two waiting-list emails (confirmation of joining, and "a place may have opened")

**`email.waitlistAck.notRegistration`**

- English:
  > This is not a registration, and no place is being held for you. We cannot promise that a place will open.
- Français:
  > Il ne s’agit pas d’une inscription, et aucune place ne vous est réservée. Nous ne pouvons pas promettre qu’une place se libérera.

**`email.waitlistAck.whatNext`**

- English:
  > If a place opens, we may email you. Places are first come, first served through the registration form on our website, so you would need to register right away.
- Français:
  > Si une place se libère, nous pourrions vous écrire. Les places sont accordées selon l’ordre des inscriptions, au moyen du formulaire d’inscription de notre site Web : vous devriez donc vous inscrire sans tarder.

**`email.waitlistNotify.notHeld`**

- English:
  > No place is being held for you, and we cannot promise one is still free when you read this. Places are first come, first served: if you would like one, please register on our website as soon as you can.
- Français:
  > Aucune place ne vous est réservée, et nous ne pouvons pas promettre qu’il en reste une au moment où vous lisez ce courriel. Les places sont accordées selon l’ordre des inscriptions : si vous en voulez une, inscrivez-vous sur notre site Web dès que possible.

- **Why it may matter:** When the owner emails a family that a place may be open, the family may believe a place is theirs. Wording that sounds like an offer could create an expectation, and a French-speaking parent must read the same limits.
- **Question for the lawyer:** Does this wording make clear in both languages that no place is held, none is promised, and places are first come, first served? Should it say anything about what happens if two families answer the same email?
- **What the draft does for now:** Says in each email that nothing is held and nothing is promised, and that the family must register through the ordinary form. The owner can only send it while the week really has room.

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
8. **Automated decisions (Law 25).** The site releases an unpaid, unreported reservation by itself after
   12 hours. The family is told the rule in advance (page and emails) and the owner can reinstate it.
   Does that count as a decision made only by automated processing that must be disclosed, with a right
   to ask for a review?
9. **Distance contracts.** A registration made online is a contract by distance. Does the
   confirmation email (the family's copy) contain everything required: the business's identity,
   address and telephone, a description of the service, the total price and payment terms, and
   the cancellation conditions?
