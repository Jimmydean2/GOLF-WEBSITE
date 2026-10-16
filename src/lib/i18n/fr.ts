// Canadian French for the camp journey. Same shape as en.ts (the compiler checks it).
//
// DRAFT FOR REVIEW: written for this site and not yet read by a Quebec translator or lawyer.
// Anything that touches a legal term (consent, cancellation, refunds, privacy, safety claims) is
// listed in legal.ts and printed in docs/QUEBEC_LEGAL_REVIEW.md. French typography (no-break
// spaces before a colon, inside « », before % and $) is applied when the dictionary is built.

import { business, juniorCamps, locations } from "../content";
import { b } from "./rich";
import { formatMoney, formatDollars, dePrefix } from "./format";
import type { Messages } from "./types";

const phone = business.phone;
const venue = locations[juniorCamps.venue];
const L = "fr" as const;
const s = (n: number) => (n > 1 ? "s" : ""); // French: 0 and 1 are singular

export const fr: Messages = {
  lang: {
    code: "fr",
    htmlLang: "fr-CA",
    switchLabel: "English",
    switchAria: "View this page in English",
  },

  site: {
    footerTagline: "Leçons privées, ateliers de groupe et programmes juniors dans la région de Montréal.",
    footerExplore: "Explorer",
    footerContact: "Nous joindre",
    summer: "Été",
    winter: "Hiver",
    rights: (year) => `© ${year} ${business.name}. Tous droits réservés.`,
    privacy: "Avis de confidentialité",
    bookLesson: "Réserver une leçon",
    logoAlt: `Logo de ${business.name}`,
  },

  info: {
    hoursLabel: "Camps d’une journée complète",
    hours: "9 h 30 – 16 h",
    scheduleNote: "Les camps ont lieu du lundi au jeudi. Le vendredi est réservé comme journée de reprise en cas de pluie.",
    dropOffTime: "9 h 15 – 9 h 30",
    pickUpTime: "16 h – 16 h 15",
    priceNote: "+ taxes par enfant",
    whatToBring: [
      "De la crème solaire, appliquée avant l’arrivée (un petit format de voyage pour la réappliquer est une bonne idée)",
      "Une bouteille d’eau réutilisable",
      "Un dîner et des collations pour la journée",
      "Un peu d’argent de poche pour le casse-croûte",
      "Des vêtements de sport confortables, des chaussures de golf ou de course, et un chapeau ou une casquette",
    ],
    safetyInfo: [
      "Un entraîneur certifié de la PGA du Canada (CPGA) et le personnel sur place supervisent tous les campeurs tout au long de la journée.",
      "Des pauses pour se protéger du soleil et s’hydrater sont prévues régulièrement dans l’horaire de la journée.",
      "Veuillez vous assurer que les allergies et les problèmes de santé sont indiqués dans le formulaire d’inscription.",
      "Les campeurs ne peuvent être récupérés que par un parent ou un tuteur, ou par une personne que vous avez autorisée à l’avance.",
      "Les camps ont lieu qu’il pleuve ou qu’il fasse beau, du lundi au jeudi; le vendredi est réservé comme journée de reprise en cas de mauvais temps.",
    ],
    venueName: venue.name,
    venueAddress: venue.address,
  },

  camp: {
    metaTitle: (year) => `Camps juniors ${year} | ${business.name}`,
    metaDescription: (year) =>
      `Camps de golf juniors d’été ${year} à ${venue.name}, à Dorval : une semaine à la fois, limité à ${juniorCamps.maxPerWeek} enfants par semaine.`,
    heroEyebrow: (year) => `Camps de jour d’été ${year}`,
    heroTitle: "Camps juniors",
    heroAlt: "De jeunes golfeurs lors d’une séance de camp d’été",
    heroIntro: `Une journée complète de golf, de jeux et d’entraînement à ${venue.name} — une semaine à la fois, limité à ${juniorCamps.maxPerWeek} enfants par semaine.`,
    pickAnyWeek: `Choisissez la ou les semaines de votre choix ci-dessous : chacune est un camp d’une journée complète, limité à ${juniorCamps.maxPerWeek} enfants afin que chaque campeur profite d’un véritable encadrement.`,
    tapWeek: "Touchez une semaine pour passer directement à l’inscription.",
    registerThisWeek: "S’inscrire à cette semaine →",
    priceLine: (price) => `${formatDollars(price, L)} + taxes par enfant, par semaine`,
    maxLine: (hours) => `Maximum de ${juniorCamps.maxPerWeek} enfants par semaine · ${hours}`,
    registerEyebrow: "Inscription limitée",
    registerTitle: "Inscrire votre enfant",
    registerIntro: "Veuillez remplir le formulaire ci-dessous pour inscrire votre enfant. Les frères et sœurs peuvent être inscrits ensemble : ajoutez chaque enfant ci-dessous.",
    comingSoonTitle: (year) => `Dates des camps ${year} : bientôt annoncées`,
    comingSoonBody: (year) =>
      `Nous mettons la dernière main au calendrier des camps d’été ${year}. Les inscriptions ouvriront dès que les dates seront annoncées. Une question d’ici là? Appelez-nous ou écrivez-nous :`,
    privacyLink: "Comment nous traitons vos renseignements",
  },

  week: {
    checking: "Vérification des places…",
    full: "Complet",
    fullWaitlist: "Complet. Vous pouvez vous inscrire à la liste d’attente plus bas.",
    spotsLeft: (n, max) => `${n} place${s(n)} restante${s(n)} sur ${max}`,
    fillingUp: "Les places partent vite — n’attendez pas!",
  },

  form: {
    section1: "Section 1 — Renseignements sur le parent ou tuteur",
    parentName: "Nom complet du parent ou tuteur",
    email: "Adresse courriel",
    primaryPhone: "Téléphone principal",
    secondaryPhone: "Téléphone secondaire (facultatif)",
    section2: (n) => `Section 2 — ${n === 1 ? "Enfant" : "Enfants"}`,
    addChild: "+ Ajouter un autre enfant",
    siblingsHint: "Inscrivez la fratrie ensemble : ajoutez chaque enfant ci-dessous, et les semaines choisies plus bas s’appliquent à tous.",
    childN: (i) => `Enfant ${i}`,
    removeChildAria: (i) => `Retirer l’enfant ${i}`,
    remove: "Retirer",
    childName: "Nom complet de l’enfant",
    childAge: "Âge de l’enfant",
    childDob: "Date de naissance",
    childHealth: "Renseignements de santé (allergies, problèmes de santé, médicaments)",
    childHealthHint: "Écrivez « Aucun » s’il n’y a rien à signaler.",
    section3: "Section 3 — Personne à joindre en cas d’urgence",
    emergencyName: "Nom de la personne à joindre en cas d’urgence",
    emergencyRelationship: "Lien avec l’enfant (mère, père, tante, oncle, etc.)",
    emergencyPhone: "Téléphone de la personne à joindre en cas d’urgence",
    section4: "Section 4 — Semaine(s) de camp",
    hoursLine: (label, hours) => `${label} — ${hours}, à ${venue.name}.`,
    pickWeeksHint: "Choisissez autant de semaines que vous le souhaitez : elles s’appliquent à chacun des enfants ci-dessus.",
    childrenTimesWeeks: (children, weeks) => `${children} enfant${s(children)} × ${weeks} semaine${s(weeks)}`,
    subtotal: "Sous-total",
    gst: "TPS (5 %)",
    qst: "TVQ (9,975 %)",
    total: "Total",
    priceFrom: (price) => `${formatDollars(price, L)} + taxes par enfant, par semaine`,
    money: (cents) => formatMoney(cents, L),
    firstComeNote:
      "Les places sont accordées selon l’ordre des inscriptions. Les camps se remplissent rapidement. Les disponibilités et les prix peuvent changer. Certaines conditions peuvent s’appliquer.",
    conductConsent:
      "Je comprends que mon enfant doit respecter les règles du programme et faire preuve de respect en tout temps. Je reconnais que le programme se réserve le droit de renvoyer mon enfant à la maison si ces attentes ne sont pas respectées, et que cette inscription n’est valide que si cette reconnaissance est acceptée.",
    paymentTitle: "Mode de paiement",
    payHold:
      "Votre inscription réserve votre place tout de suite. À l’écran suivant (et par courriel), vous recevrez votre numéro de référence unique et les instructions pour le virement Interac.",
    paySend: (button) =>
      `Envoyez votre virement Interac dans les 12 heures pour conserver votre place, puis touchez ${b(`« ${button} »`)}. Aucun compte ni capture d’écran n’est nécessaire.`,
    payConfirm: "Votre place est confirmée une fois que nous avons vérifié le paiement dans notre compte bancaire.",
    payCancelFee: `Des frais d’administration de ${juniorCamps.cancellationFee} $ s’appliquent à toute annulation.`,
    payNotVenue: `Aucun paiement ne sera accepté par ${venue.name}.`,
    submit: "S’inscrire",
    sending: "Envoi en cours…",
    notOpenYet: "Les inscriptions ne sont pas encore ouvertes",
    pickWeekFirst: "Veuillez choisir au moins une semaine de camp ci-dessus.",
    fillEveryField: "Veuillez remplir tous les champs pour chaque enfant.",
    acceptBoth: "Veuillez cocher le code de conduite et les deux consentements ci-dessous.",
    errorFallback: `Une erreur s’est produite. Veuillez réessayer ou communiquer directement avec nous au ${phone}.`,
    somethingWrong: "Une erreur s’est produite. Veuillez réessayer.",
    notConnected: "L’inscription en ligne est en cours de mise au point. D’ici là, réservez une place en nous appelant ou en nous écrivant :",
    notAnnouncedTitle: (year) => `L’inscription aux camps ${year} n’est pas encore ouverte.`,
    notAnnouncedBody: (year) => `Les dates des camps ${year} seront annoncées bientôt. Une question? Appelez-nous ou écrivez-nous :`,
    opensBanner: (when) => `Les inscriptions ouvrent le ${when} (heure de Montréal).`,
    opensBannerBody: "Vous pouvez consulter le formulaire dès maintenant. Il ne pourra être envoyé qu’à ce moment-là, et cette page se débloquera d’elle-même.",
    successTitle: "Inscription reçue!",
    successBody: (children) =>
      `Une place est réservée pour ${children === 1 ? "votre enfant" : `chacun de vos ${children} enfants`} pour chaque semaine choisie. Veuillez consulter votre courriel pour obtenir vos instructions de paiement et votre numéro de référence — les places ne sont garanties qu’une fois le paiement reçu en entier.`,
    successTotal: (children, weeks, cents) =>
      `Total à payer : ${children} enfant${s(children)} × ${weeks} semaine${s(weeks)} = ${formatMoney(cents, L)} (taxes incluses)`,
  },

  parent: {
    metaTitle: `Votre réservation au camp | ${business.name}`,
    eyebrow: "Réservation au camp junior",
    reference: "Votre numéro de référence",
    amountDue: "Montant à payer",
    taxIncluded: "taxes incluses",
    sendPayment: "Envoyez votre paiement",
    heldUntil: (when) => `Votre place est réservée jusqu’au ${b(when)} (heure de Montréal).`,
    emailedTo: (masked, phoneNumber) =>
      `Nous avons aussi envoyé ces instructions et le lien privé de cette page à ${b(masked)}. Ce n’est pas la bonne adresse? Appelez-nous au ${phoneNumber}.`,
    tapNote:
      "En touchant le bouton, vous nous indiquez que vous avez envoyé le paiement. Votre place est confirmée une fois le paiement vérifié dans notre compte bancaire.",
    reportedTitle: "Merci — nous vérifions votre paiement",
    reportedBody: (reference) =>
      `Nous avons noté que vous avez envoyé votre paiement, et votre place est réservée pendant que nous le vérifions. Vous recevrez un courriel dès qu’il sera confirmé. Conservez votre numéro de référence, ${b(reference)}, au cas où nous aurions besoin de l’associer à votre paiement.`,
    paidTitle: "C’est confirmé!",
    paidBody: "Votre paiement a été reçu et votre place est confirmée. Les détails du camp se trouvent dans votre courriel de confirmation.",
    inactiveTitle: "Cette réservation n’est plus active",
    inactiveExpired:
      "Elle a été libérée parce que nous n’avons pas reçu d’avis de paiement à temps. Si vous avez déjà envoyé votre virement Interac, votre argent n’est pas perdu.",
    inactiveReleased: "Elle a été libérée.",
    inactiveContact: "Veuillez communiquer avec nous en indiquant votre numéro de référence et nous réglerons la situation.",
    questions: "Des questions?",
    callWord: "Appelez le",
    orEmail: "ou écrivez à",
  },

  report: {
    button: "J’ai envoyé mon paiement",
    sending: "Envoi en cours…",
    error: "Une erreur s’est produite. Veuillez réessayer.",
  },

  errors: {
    unavailable: "L’inscription en ligne n’est pas encore configurée. Veuillez nous appeler ou nous écrire.",
    tooLarge: "Cette demande était trop volumineuse.",
    invalidRequest: "Demande invalide.",
    missingFields: "Veuillez remplir tous les champs obligatoires, ajouter au moins un enfant et choisir au moins une semaine de camp.",
    tooLong: "Certains renseignements saisis sont trop longs. Veuillez les raccourcir et réessayer.",
    invalidEmail: "Veuillez saisir une adresse courriel valide.",
    invalidPhone: "Veuillez saisir chaque numéro de téléphone avec l’indicatif régional, par exemple 514-555-0100.",
    consentRequired: "Veuillez accepter le code de conduite et les deux consentements pour continuer.",
    invalidWeeks: "Veuillez choisir des semaines de camp valides.",
    tooManyChildren: (max) => `Une inscription peut comprendre jusqu’à ${max} enfants. Pour un groupe plus important, veuillez communiquer avec nous au ${phone}.`,
    invalidBirthDate: (name) => `Veuillez vérifier la date de naissance de ${name}.`,
    duplicateChild: (name) => `${name} figure deux fois. Veuillez inscrire chaque enfant une seule fois.`,
    rateLimited: "Trop d’inscriptions provenant de cette connexion en peu de temps. Veuillez patienter un peu ou communiquer directement avec nous.",
    tooManyOpen: `Plusieurs réservations faites avec ce courriel ou ce numéro de téléphone n’ont pas encore été confirmées. Veuillez d’abord payer ces réservations (ou attendre que nous les ayons confirmées), ou communiquer avec nous au ${phone}.`,
    weeksFull: (labels) => `Ces semaines viennent d’être comblées : ${labels.join("; ")}. Veuillez les retirer et réessayer.`,
    weeksUnavailable: (labels) => `Ces semaines ne sont pas offertes : ${labels.join("; ")}. Veuillez les retirer et réessayer.`,
    alreadyRegistered: (names, weeks, resent) => {
      const shown = names.slice(0, 3);
      const more = names.length - shown.length;
      const who = shown.join(", ") + (more > 0 ? ` et ${more} autre${more > 1 ? "s" : ""}` : "");
      return (
        `Nous avons déjà une réservation pour ${who} pour ${weeks.join("; ")} avec ce courriel ou ce numéro de téléphone; nous n’en avons donc pas fait une deuxième. ` +
        (resent
          ? "Si elle n’est pas encore payée, nous vous renvoyons ses instructions de paiement et son lien privé : veuillez vérifier votre boîte de réception et vos courriers indésirables. "
          : "") +
        `Pour modifier quoi que ce soit, appelez-nous au ${phone}.`
      );
    },
    serverError: "Une erreur s’est produite lors de l’envoi de votre inscription. Veuillez réessayer ou communiquer directement avec nous.",
    notAnnounced: (year) => `Les inscriptions aux camps ${year} ne sont pas encore ouvertes. Revenez bientôt, ou appelez-nous au ${phone}.`,
    opensLater: (when) => `Les inscriptions ouvrent le ${when} (heure de Montréal). Revenez à ce moment-là.`,
    reportSetup: "L’inscription en ligne n’est pas encore configurée.",
    tooManyAttempts: "Trop de tentatives. Veuillez patienter un peu.",
    linkInvalid: "Ce lien n’est pas valide.",
    tryAgain: "Une erreur s’est produite. Veuillez réessayer.",
    reportReleased: `Cette réservation a été libérée. Si vous avez déjà envoyé votre paiement, veuillez communiquer avec nous au ${phone} ou à ${business.email} en indiquant votre numéro de référence.`,
    reportWindowClosed: `Le délai pour signaler le paiement est dépassé; cette réservation est donc en cours de libération. Si vous avez déjà envoyé votre paiement, veuillez communiquer avec nous au ${phone} ou à ${business.email} en indiquant votre numéro de référence.`,
    reportUnavailable: `Nous ne pouvons pas accepter d’avis de paiement en ligne pour cette réservation. Veuillez communiquer avec nous au ${phone} ou à ${business.email} en indiquant votre numéro de référence.`,
  },

  payment: {
    send: (amount, address) => `Envoyez un virement Interac de ${amount} à ${address}.`,
    reference: (reference) => `Inscrivez votre numéro de référence, ${reference}, dans le champ « Message » du virement afin que nous puissions l’associer à votre inscription.`,
    autodeposit: "Cette adresse accepte les virements automatiquement (dépôt automatique) : il n’y a donc ni mot de passe ni question de sécurité.",
    securityQuestion: `Si votre institution financière vous demande une question de sécurité et sa réponse, appelez-nous au ${phone} et nous réglerons cela.`,
    thenPage: "Revenez ensuite sur cette page et touchez « J’ai envoyé mon paiement ». Vous n’avez rien à téléverser ni aucun compte à créer.",
    thenEmail: "Ouvrez ensuite votre page de réservation (le bouton ci-dessous) et touchez « J’ai envoyé mon paiement ». Vous n’avez rien à téléverser ni aucun compte à créer.",
  },

  consent: {
    panelTitle: "Comment nous utilisons vos renseignements",
    panel: (days) =>
      `Nous les recueillons pour inscrire votre enfant, organiser le camp en toute sécurité, traiter le paiement et communiquer avec vous à ce sujet. Seuls le propriétaire ainsi que les entraîneurs et le personnel du camp y ont accès. Les fournisseurs qui exploitent notre site Web, notre base de données et notre courriel les traitent pour nous et peuvent les conserver à l’extérieur du Québec. Nous conservons les renseignements de santé, les dates de naissance et les coordonnées des personnes à joindre en cas d’urgence pendant ${days} jours après la dernière semaine de camp de votre enfant, puis nous les effaçons. Vous pouvez demander à consulter, corriger ou effacer vos renseignements en tout temps : ${phone} · ${business.email}.`,
    privacyBefore: "Je suis le parent ou le tuteur légal de chaque enfant que j’inscris. J’ai lu l’",
    privacyLink: "avis de confidentialité",
    privacyAfter: ` et je consens à ce que ${business.name} recueille, utilise et conserve mes renseignements et ceux de mon enfant afin d’inscrire mon enfant, d’organiser le camp, de traiter le paiement et de communiquer avec moi à ce sujet.`,
    health: `Je consens à ce que ${business.name} recueille les renseignements de santé que je fournis au sujet de mon enfant (allergies, problèmes de santé, médicaments) et ne les communique qu’aux entraîneurs et au personnel qui supervisent mon enfant, afin d’assurer sa sécurité. Je peux demander à consulter, corriger ou effacer ces renseignements en tout temps.`,
  },

  // La liste d’attente facultative pour les semaines complètes. Elle n’inscrit aucun enfant et ne réserve aucune place.
  waitlist: {
    heading: "Votre semaine est complète? Inscrivez-vous à la liste d’attente",
    intro: `S’inscrire à la liste d’attente n’inscrit pas votre enfant et ne vous réserve aucune place. Si une place se libère, nous pourrions vous écrire, mais les places sont accordées selon l’ordre des inscriptions, au moyen du formulaire d’inscription ci-dessus : vous devriez donc vous inscrire sans tarder. Pour être retiré de la liste, appelez-nous au ${phone} ou répondez à notre courriel.`,
    weeksLegend: "Pour quelles semaines complètes voulez-vous attendre?",
    checking: "Vérification des places…",
    noFullWeeks: "Toutes les semaines ont encore des places. Veuillez utiliser le formulaire d’inscription ci-dessus.",
    name: "Votre nom complet",
    email: "Adresse courriel",
    phone: "Téléphone (facultatif)",
    places: "Combien d’enfants inscririez-vous?",
    consentBefore: `J’accepte que ${business.name} utilise mon nom, mon adresse courriel et mon numéro de téléphone uniquement pour me joindre si une place se libère durant les semaines choisies, et les conserve jusqu’à la fin de ces semaines. Je comprends que cela n’inscrit pas mon enfant et ne réserve aucune place. `,
    consentLink: "Avis de confidentialité",
    submit: "M’inscrire à la liste d’attente",
    sending: "Envoi en cours…",
    doneHeading: "Vous êtes sur la liste d’attente",
    done: (weeks, email) =>
      `Nous vous avons ajouté à la liste d’attente pour ${weeks} et nous avons envoyé une confirmation à ${email}. Il ne s’agit pas d’une inscription, et aucune place ne vous est réservée.`,
    again: "Ajouter une autre famille",
    errors: {
      missing: "Veuillez indiquer votre nom et votre adresse courriel, choisir au moins une semaine et cocher la case.",
      consent: "Veuillez cocher la case afin que nous puissions vous écrire si une place se libère.",
      weekHasRoom: (labels) => `Bonne nouvelle : ${labels.join("; ")} ${labels.length > 1 ? "ont" : "a"} encore des places. Veuillez plutôt vous inscrire au moyen du formulaire ci-dessus.`,
      listFull: `Cette liste d’attente est pleine. Veuillez nous appeler au ${phone}.`,
      off: `La liste d’attente n’est pas offerte pour le moment. Veuillez nous appeler au ${phone}.`,
      tryAgain: "Une erreur s’est produite. Veuillez réessayer ou nous joindre directement.",
    },
  },

  privacy: {
    metaTitle: `Avis de confidentialité | ${business.name}`,
    heading: "Avis de confidentialité : camps juniors",
    version: (version) => `Version ${version}`,
    draftBanner: "ÉBAUCHE. Cet avis n’a pas encore été révisé par un avocat ni approuvé par le propriétaire. Il n’apparaît que sur ce site d’essai.",
    intro: `Cet avis explique quels renseignements personnels ${business.name} recueille lorsque vous inscrivez un enfant à un camp junior, pourquoi nous les recueillons, qui peut y accéder, où ils sont conservés, pendant combien de temps nous les gardons et comment nous poser des questions à ce sujet.`,
    responsibleHeading: "Qui est responsable",
    responsible: (name, email, telephone) =>
      `${business.name} est responsable des renseignements que vous nous confiez. La personne chargée de la protection des renseignements personnels est ${name}. Vous pouvez la joindre à ${email} ou au ${telephone}.`,
    collectHeading: "Ce que nous recueillons",
    collectItems: [
      "À votre sujet, en tant que parent ou tuteur : votre nom, votre adresse courriel et votre numéro de téléphone (et un deuxième numéro, si vous en indiquez un).",
      "Au sujet de votre enfant : son nom, sa date de naissance et son âge.",
      "Les renseignements de santé que vous choisissez de nous donner au sujet de votre enfant : allergies, problèmes de santé, médicaments.",
      "Votre personne à joindre en cas d’urgence : son nom, son lien avec votre enfant et son numéro de téléphone.",
      "Au sujet de votre inscription : les semaines choisies, le montant, votre numéro de référence de paiement, si et quand nous avons confirmé votre paiement, la langue utilisée et les consentements donnés.",
      "Si vous vous inscrivez sur une liste d’attente : votre nom, votre adresse courriel, votre numéro de téléphone (si vous en donnez un), le nombre d’enfants que vous inscririez, les semaines choisies et la langue utilisée. Rien au sujet de votre enfant.",
      "Nous ne recevons jamais vos renseignements bancaires ni ceux de votre carte. Vous payez par virement Interac à partir de votre propre institution financière, et nous ne voyons que ce que celle-ci montre au titulaire du compte (généralement votre nom et le montant).",
      "Pour empêcher les abus automatisés, le site Web conserve brièvement, dans un compteur, une version brouillée (hachée) de votre adresse Internet. Elle ne peut pas être reconvertie en votre adresse et est effacée automatiquement en quelques jours.",
    ],
    whyHeading: "Pourquoi nous les recueillons",
    whyItems: [
      "pour inscrire votre enfant et lui réserver sa place;",
      "pour recevoir le paiement et le confirmer;",
      "pour organiser le camp en toute sécurité (renseignements de santé et personnes à joindre en cas d’urgence);",
      "pour communiquer avec vous au sujet de votre inscription : instructions de paiement, rappels, confirmation, changements et annulations;",
      "pour tenir les registres comptables exigés par la loi.",
    ],
    noMarketing:
      "Nous ne vendons pas vos renseignements, ne les utilisons pas à des fins publicitaires et n’envoyons pas de messages de marketing. Nous vous écrivons seulement au sujet de votre inscription (et, si vous vous inscrivez sur une liste d’attente, au sujet de cette liste).",
    whoHeading: "Qui peut y accéder",
    who: [
      "Le propriétaire ainsi que les entraîneurs et le personnel du camp, uniquement dans la mesure où ils en ont besoin. Par exemple, un entraîneur voit les notes de santé et les personnes à joindre en cas d’urgence des enfants qu’il supervise.",
    ],
    providersIntro: "Les fournisseurs de services qui exploitent le site Web pour nous. Ils traitent les renseignements en notre nom et ne peuvent pas les utiliser à leurs propres fins :",
    whoExtra:
      "Nous ne communiquons vos renseignements à personne d’autre, sauf si la loi l’exige ou si la sécurité d’une personne est en jeu (par exemple, informer des ambulanciers d’une allergie).",
    whereHeading: "Où ils sont conservés",
    where:
      "Nos fournisseurs conservent les renseignements sur des serveurs qui peuvent se trouver à l’extérieur du Québec, notamment aux États-Unis. Ils circulent de façon chiffrée (https) et sont protégés par des mots de passe et des contrôles d’accès.",
    keepHeading: "Combien de temps nous les conservons",
    keep: (days, years) => [
      `${days} jours après la dernière semaine de camp à laquelle vous avez inscrit votre enfant, nous effaçons de nos dossiers la date de naissance de votre enfant, les renseignements de santé, votre personne à joindre en cas d’urgence, vos numéros de téléphone et votre adresse courriel.`,
      `Nous ne conservons pendant ${years} ans que ce qu’exigent les règles fiscales et comptables : votre nom en tant que payeur, le numéro de référence du paiement, les montants et les dates.`,
      "Si vous vous inscrivez sur une liste d’attente, nous effaçons votre demande une fois la semaine de camp passée, ou plus tôt si vous nous le demandez.",
    ],
    protectHeading: "Comment nous les protégeons",
    protect: [
      "Votre page de réservation ne peut être ouverte qu’avec le lien privé que nous vous envoyons par courriel.",
      "Les détails des inscriptions ne sont visibles que par le propriétaire, après une connexion par mot de passe qui se verrouille après plusieurs essais erronés.",
      "Les courriels que nous vous envoyons ne contiennent jamais la date de naissance de votre enfant ni ses renseignements de santé.",
      "La base de données comporte des protections contre les doubles réservations et garde une trace de qui a modifié quoi.",
      "Si un incident de confidentialité touchait un jour vos renseignements et présentait un risque de préjudice sérieux, nous vous en aviserions ainsi que la Commission d’accès à l’information du Québec.",
    ],
    rightsHeading: "Vos droits",
    rights: [
      "Consulter les renseignements que nous détenons à votre sujet et au sujet de votre enfant, et en obtenir une copie dans un format électronique courant.",
      "Nous demander de les corriger.",
      "Retirer votre consentement ou nous demander d’effacer vos renseignements. Nous pouvons conserver ce que la loi nous oblige à conserver (par exemple les registres comptables), et le retrait du consentement peut empêcher votre enfant de participer.",
    ],
    rightsContact: (email, telephone) => `Nous répondons dans un délai de 30 jours. Écrivez à ${email} ou téléphonez au ${telephone}.`,
    rightsComplaint:
      "Si notre réponse ne vous satisfait pas, vous pouvez porter plainte à la Commission d’accès à l’information du Québec (cai.gouv.qc.ca).",
    childrenHeading: "Enfants",
    children: "Les renseignements d’un enfant sont recueillis auprès de son parent ou de son tuteur légal, qui donne le consentement en son nom.",
    cookiesHeading: "Témoins (cookies) et suivi",
    cookies:
      "Ce site Web n’utilise ni témoins publicitaires ni témoins de suivi, et n’utilise pas de services d’analyse. Le seul témoin est celui qui sert lorsque le propriétaire se connecte aux pages d’administration.",
    changesHeading: "Modifications de cet avis",
    changes: "Si cet avis change, la version indiquée ci-dessus change. La version que vous avez acceptée est conservée avec votre inscription.",
    back: "Retour à la page des camps",
    officerName: "James (l’entraîneur James), propriétaire de James Dean Golf",
  },

  email: {
    hello: (first) => `Bonjour ${first},`,
    taxIncluded: "taxes incluses",

    instructions: {
      subject: (children, reference) => `Envoyez votre paiement pour garder la place ${dePrefix(children)}${children} au camp (${reference})`,
      heading: "Votre place est réservée — envoyez votre paiement",
      intro: (first, children, weeks, payBy) =>
        `Bonjour ${first}, nous gardons une place pour ${b(children)} pour ${weeks}. Elle est réservée jusqu’au ${b(payBy)} (heure de Montréal).`,
      referenceLabel: "Votre numéro de référence",
      amountLabel: "Montant à envoyer",
      button: "Ouvrir ma page de réservation",
      footer:
        "Votre place n’est confirmée qu’une fois le paiement vérifié dans notre compte bancaire. Conservez ce courriel : le bouton ci-dessus est votre lien privé; veuillez ne pas le transférer.",
      textLink: "Votre page de réservation privée (veuillez ne pas la transférer) :",
      textAmount: (amount) => `${amount} (taxes incluses)`,
      textFooter: "Votre place n’est confirmée qu’une fois le paiement vérifié dans notre compte bancaire.",
    },

    reminder: {
      subject: (children, payBy) => `Rappel : la place ${dePrefix(children)}${children} au camp est réservée jusqu’au ${payBy}`,
      heading: "Votre place au camp est toujours réservée",
      intro: (first, children, reference, payBy) =>
        `Bonjour ${first}, nous n’avons pas reçu d’avis de paiement pour ${b(children)} (référence ${b(reference)}). La place sera libérée automatiquement le ${b(payBy)} (heure de Montréal) afin qu’une autre famille puisse en profiter.`,
      alreadySent: (button) =>
        `${b("Vous avez déjà envoyé votre virement Interac?")} Ouvrez votre page de réservation ci-dessous et touchez ${b(`« ${button} »`)}. C’est tout ce dont nous avons besoin pour garder votre place pendant que nous vérifions notre compte bancaire.`,
      notYetSent: (amount, address, reference) =>
        `${b("Vous ne l’avez pas encore envoyé?")} Envoyez ${amount} (taxes incluses) par virement Interac à ${address} en inscrivant la référence ${reference} dans le message, puis touchez le même bouton.`,
      button: "Ouvrir ma page de réservation",
      footer: `Besoin de plus de temps ou d’une réponse à une question? Appelez-nous au ${phone}. Ce bouton est votre lien privé : veuillez ne pas transférer ce courriel.`,
      textLink: "Votre page de réservation privée (veuillez ne pas transférer ce courriel) :",
    },

    release: {
      subject: (children, reference) => `Votre réservation au camp pour ${children} a été libérée (${reference})`,
      heading: "Votre réservation a été libérée",
      reference: (reference, children) => `Référence ${b(reference)} · ${children}`,
      body:
        "Votre réservation a été libérée parce que nous n’avons pas reçu d’avis de paiement à temps. " +
        "Si vous avez déjà envoyé votre virement Interac, votre argent n’est pas perdu : répondez à ce courriel en indiquant votre numéro de référence; " +
        "nous vérifierons et nous rétablirons votre inscription s’il reste une place, sinon nous vous rembourserons. " +
        "Si vous souhaitez toujours une place, vous pouvez vous inscrire de nouveau.",
    },

    confirmation: {
      subject: (children) => `C’est confirmé! La place ${dePrefix(children)}${children} au camp junior de ${business.name}`,
      heading: "Merci — tout est en ordre!",
      intro: (children, plural, count) =>
        `Le paiement a été reçu et ${plural ? "les places" : "la place"} ${dePrefix(children)}${b(children)} ${plural ? "sont" : "est"} maintenant confirmée${plural ? "s" : ""} au camp junior de ${venue.name}. Nous avons hâte ${count === 1 ? "de l’accueillir" : "de tous les accueillir"} sur le parcours! Voici tout ce qu’il vous faut pour la journée de camp.`,
      confirmationNumber: "Numéro de confirmation",
      children: "Enfants",
      confirmedWeeks: (n) => `Semaine${s(n)} confirmée${s(n)}`,
      amountPaid: "Montant payé",
      hours: "Heures",
      location: "Lieu",
      dropPickTitle: "Arrivée et départ",
      dropOff: "Arrivée",
      pickUp: "Départ",
      toBring: "Quoi apporter",
      safety: "Sécurité et responsabilité",
      closing: (phoneNumber) => `Des questions avant le camp? Répondez simplement à ce courriel ou joignez-nous au ${phoneNumber}. Nous sommes impatients de vivre une belle semaine avec vous!`,
      textClosing: (phoneNumber) => `Des questions? Répondez à ce courriel ou appelez-nous au ${phoneNumber}.`,
      textIntro: (children, plural) => `Le paiement a été reçu et ${plural ? "les places" : "la place"} ${dePrefix(children)}${children} ${plural ? "sont" : "est"} confirmée${plural ? "s" : ""} au camp junior de ${venue.name}.`,
    },

    // La liste d’attente : ce que nous disons quand quelqu’un s’y inscrit, et quand le propriétaire l’informe qu’une place est peut-être libre. Aucun des deux ne promet ni ne réserve quoi que ce soit.
    waitlistAck: {
      subject: (weeks) => `Vous êtes sur la liste d’attente pour ${weeks}`,
      heading: "Vous êtes sur la liste d’attente",
      intro: (first, weeks) => `Bonjour ${first}, nous vous avons ajouté à la liste d’attente pour ${b(weeks)}.`,
      notRegistration: "Il ne s’agit pas d’une inscription, et aucune place ne vous est réservée. Nous ne pouvons pas promettre qu’une place se libérera.",
      whatNext: "Si une place se libère, nous pourrions vous écrire. Les places sont accordées selon l’ordre des inscriptions, au moyen du formulaire d’inscription de notre site Web : vous devriez donc vous inscrire sans tarder.",
      remove: (phoneNumber) => `Pour être retiré de la liste, répondez à ce courriel ou appelez-nous au ${phoneNumber}.`,
    },
    waitlistNotify: {
      subject: (week) => `Une place s’est peut-être libérée pour ${week}`,
      heading: "Une place est peut-être disponible",
      intro: (first, week) => `Bonjour ${first}, une place s’est peut-être libérée pour ${b(week)}.`,
      notHeld: "Aucune place ne vous est réservée, et nous ne pouvons pas promettre qu’il en reste une au moment où vous lisez ce courriel. Les places sont accordées selon l’ordre des inscriptions : si vous en voulez une, inscrivez-vous sur notre site Web dès que possible.",
      button: "Aller à la page d’inscription",
      textLink: "La page d’inscription :",
      remove: (phoneNumber) => `Si vous n’avez plus besoin d’une place, répondez à ce courriel ou appelez-nous au ${phoneNumber} et nous vous retirerons de la liste.`,
    },

    cancellation: {
      subjectCancelled: (children, reference) => `Votre inscription au camp pour ${children} a été annulée (${reference})`,
      subjectNotReceived: (children, reference) => `Nous n’avons pas trouvé votre paiement pour ${children} (${reference})`,
      headingCancelled: "Votre inscription a été annulée",
      headingNotReceived: "Nous n’avons pas trouvé votre paiement",
      reference: (reference, children) => `Référence ${b(reference)} · ${children}`,
      weeksReleased: (weeks) => `Les places pour ${weeks} ont été libérées.`,
      cancelledPaid:
        "Cette inscription a été annulée et ses places ont été libérées. Si un remboursement est dû en vertu de nos conditions d’annulation, nous le réglerons directement avec vous. Si vous n’avez pas demandé cette annulation, veuillez nous appeler sans tarder.",
      cancelledUnpaid:
        "Cette réservation a été annulée et ses places ont été libérées. Aucun paiement n’avait été confirmé pour cette réservation. Si vous avez bel et bien envoyé un virement Interac, répondez à ce courriel en indiquant votre numéro de référence afin que nous puissions l’associer.",
      notReceived:
        "Nous avons cherché votre virement Interac sans le trouver; les places réservées pour cette inscription ont donc été libérées pour d’autres familles. Si vous avez bel et bien envoyé un paiement, votre argent n’est pas perdu : répondez à ce courriel en indiquant votre numéro de référence et le numéro de confirmation de votre institution financière; nous vérifierons et réglerons la situation, y compris en rétablissant vos places si elles sont encore libres.",
      register: "Si vous souhaitez toujours une place, vous pouvez vous inscrire de nouveau.",
      contact: (phoneNumber) => `Des questions? Répondez à ce courriel ou appelez-nous au ${phoneNumber}.`,
    },
  },
};
