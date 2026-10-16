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
    infoConsent: `En envoyant le formulaire d’inscription, vous acceptez que vos renseignements soient communiqués à ${business.name} aux fins de l’administration des camps de golf juniors. Tous les renseignements sont confidentiels et ne seront pas communiqués sans autorisation.`,
    submit: "S’inscrire",
    sending: "Envoi en cours…",
    notOpenYet: "Les inscriptions ne sont pas encore ouvertes",
    pickWeekFirst: "Veuillez choisir au moins une semaine de camp ci-dessus.",
    fillEveryField: "Veuillez remplir tous les champs pour chaque enfant.",
    acceptBoth: "Veuillez accepter le code de conduite et le consentement relatif aux renseignements ci-dessous.",
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
    consentRequired: "Veuillez accepter le code de conduite et le consentement relatif aux renseignements pour continuer.",
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
