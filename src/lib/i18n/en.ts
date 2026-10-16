// English text for everything a family sees in the camp journey: the camp page, the form, the
// private reservation page, the messages the registration API returns, the payment
// instructions and the emails sent to parents. fr.ts is the same shape in Canadian French; the
// compiler refuses a French dictionary that is missing a message or takes different arguments.
//
// Not here, on purpose: the administrator's dashboard and the emails addressed to the
// administrators (those stay in English; they show the family's language).
//
// Wording that touches a legal term (consent, cancellation, refunds, privacy, safety claims)
// is listed in legal.ts for review by a Quebec lawyer; docs/QUEBEC_LEGAL_REVIEW.md prints it.

import { business, juniorCamps, locations } from "../content";
import { b } from "./rich";
import { formatMoney, formatDollars, joinNames } from "./format";

const phone = business.phone;
const venue = locations[juniorCamps.venue];
const L = "en" as const;

export const en = {
  lang: {
    code: "en" as "en" | "fr",
    htmlLang: "en",
    switchLabel: "Français",
    switchAria: "Voir cette page en français",
  },

  site: {
    footerTagline: "Private lessons, group clinics, and junior programs in the Montreal area.",
    footerExplore: "Explore",
    footerContact: "Get in Touch",
    summer: "Summer",
    winter: "Winter",
    rights: (year: number) => `© ${year} ${business.name}. All rights reserved.`,
    privacy: "Privacy notice",
    bookLesson: "Book a Lesson",
    logoAlt: `${business.name} logo`,
  },

  // The facts about the camp, in this language (the English values are content.ts).
  info: {
    hoursLabel: juniorCamps.hoursLabel,
    hours: juniorCamps.hours,
    scheduleNote: juniorCamps.scheduleNote,
    dropOffTime: juniorCamps.dropOffTime,
    pickUpTime: juniorCamps.pickUpTime,
    priceNote: juniorCamps.priceNote,
    whatToBring: juniorCamps.whatToBring as readonly string[],
    safetyInfo: juniorCamps.safetyInfo as readonly string[],
    venueName: venue.name,
    venueAddress: venue.address,
  },

  camp: {
    metaTitle: (year: number) => `Junior Camps ${year} | ${business.name}`,
    metaDescription: (year: number) =>
      `${year} summer junior golf day camps at ${venue.name}, Dorval: one week at a time, limited to ${juniorCamps.maxPerWeek} kids per week.`,
    heroEyebrow: (year: number) => `Summer Day Camps ${year}`,
    heroTitle: "Junior Camps",
    heroAlt: "Junior golfers at a summer camp session",
    heroIntro: `A full day of golf, games, and coaching at ${venue.name} — one week at a time, limited to ${juniorCamps.maxPerWeek} kids per week.`,
    pickAnyWeek: `Pick any week below — each one runs as its own full-day camp, capped at ${juniorCamps.maxPerWeek} kids so every camper gets real coaching time.`,
    tapWeek: "Tap a week to jump straight to registration.",
    registerThisWeek: "Register for this week →",
    priceLine: (price: number) => `${formatDollars(price, L)} ${juniorCamps.priceNote} per week`,
    maxLine: (hours: string) => `Max ${juniorCamps.maxPerWeek} kids per week · ${hours}`,
    registerEyebrow: "Limited Registration",
    registerTitle: "Register Your Child",
    registerIntro: "Please fill out the form below to register your child. Brothers and sisters can be registered together: add each child below.",
    comingSoonTitle: (year: number) => `${year} camp dates coming soon`,
    comingSoonBody: (year: number) =>
      `We are finalizing the ${year} summer camp calendar. Registration opens once the dates are announced. Questions in the meantime? Call or email us:`,
    privacyLink: "How we handle your information",
  },

  week: {
    checking: "Checking availability…",
    full: "Full",
    spotsLeft: (n: number, max: number) => `${n} of ${max} spots left`,
    fillingUp: "Filling up fast — don't wait!",
  },

  form: {
    section1: "Section 1 — Parent/Guardian Information",
    parentName: "Parent/guardian full name",
    email: "Email address",
    primaryPhone: "Primary phone",
    secondaryPhone: "Secondary phone (optional)",
    section2: (n: number) => `Section 2 — Child${n === 1 ? "" : "ren"}`,
    addChild: "+ Add another child",
    siblingsHint: "Register siblings together — add each child below, and the weeks you pick further down apply to all of them.",
    childN: (i: number) => `Child ${i}`,
    removeChildAria: (i: number) => `Remove child ${i}`,
    remove: "Remove",
    childName: "Child's full name",
    childAge: "Child's age",
    childDob: "Date of birth",
    childHealth: "Health & medical information (allergies, medical conditions, medication)",
    childHealthHint: "Write “None” if there is nothing to report.",
    section3: "Section 3 — Emergency Contact Information",
    emergencyName: "Emergency contact name",
    emergencyRelationship: "Relationship (mother, father, aunt, uncle, etc.)",
    emergencyPhone: "Emergency contact phone",
    section4: "Section 4 — Camp Week(s)",
    hoursLine: (label: string, hours: string) => `${label} — ${hours}, at ${venue.name}.`,
    pickWeeksHint: "Select as many weeks as you'd like — they apply to every child above.",
    childrenTimesWeeks: (children: number, weeks: number) => `${children} child${children === 1 ? "" : "ren"} × ${weeks} week${weeks === 1 ? "" : "s"}`,
    subtotal: "Subtotal",
    gst: "GST (5%)",
    qst: "QST (9.975%)",
    total: "Total",
    priceFrom: (price: number) => `${formatDollars(price, L)} + tax per child, per week`,
    money: (cents: number) => formatMoney(cents, L),
    firstComeNote: "Reservations are made on a first-come, first-served basis. Camps fill up quickly. Availability and pricing subject to change. Certain conditions may apply.",
    conductConsent:
      "I understand that my child is expected to follow program rules and demonstrate respectful behavior at all times. I acknowledge that the program reserves the right to send my child home if these expectations are not met, and that this registration will not be considered valid unless this acknowledgment is accepted.",
    paymentTitle: "Method of Payment",
    payHold: "Registering holds your spot right away. On the next screen (and by email) you'll get your unique reference and the Interac e-Transfer instructions.",
    paySend: (button: string) => `Send your e-Transfer within 12 hours to keep your spot, then tap ${b(`“${button}.”`)} No account and no screenshots needed.`,
    payConfirm: "Your spot is confirmed once we verify the payment in our bank account.",
    payCancelFee: `Cancellations are subject to a $${juniorCamps.cancellationFee} administrative fee.`,
    payNotVenue: `No payments to ${venue.name} will be accepted.`,
    infoConsent: `By submitting the registration form you agree that information may be disclosed to ${business.name} for the purpose of administering the junior golf camps. All information is confidential and shall not be shared without permission.`,
    submit: "Register Now",
    sending: "Sending…",
    notOpenYet: "Registration is not open yet",
    pickWeekFirst: "Please pick at least one camp week above.",
    fillEveryField: "Please fill in every field for each child.",
    acceptBoth: "Please accept the code of conduct and information consent below.",
    errorFallback: `Something went wrong. Please try again, or contact ${phone} directly.`,
    somethingWrong: "Something went wrong. Please try again.",
    notConnected: "Online registration is being finalized. In the meantime, reserve a spot by calling or emailing directly:",
    notAnnouncedTitle: (year: number) => `${year} camp registration isn't open yet.`,
    notAnnouncedBody: (year: number) => `The ${year} camp dates will be announced soon. Questions? Call or email us:`,
    opensBanner: (when: string) => `Registration opens ${when} (Montreal time).`,
    opensBannerBody: "You can look over the form now. It can't be sent until then, and this page will unlock by itself.",
    successTitle: "Registration received!",
    successBody: (children: number) =>
      `A spot is being held for ${children === 1 ? "your child" : `each of your ${children} children`} for every week you selected. Please check your email for your payment instructions and reference — spots are only secured once payment is received in full.`,
    successTotal: (children: number, weeks: number, cents: number) =>
      `Total due: ${children} child${children === 1 ? "" : "ren"} × ${weeks} week${weeks === 1 ? "" : "s"} = ${formatMoney(cents, L)} (tax included)`,
  },

  parent: {
    metaTitle: `Your camp reservation | ${business.name}`,
    eyebrow: "Junior Camp reservation",
    reference: "Your reference",
    amountDue: "Amount due",
    taxIncluded: "tax included",
    sendPayment: "Send your payment",
    heldUntil: (when: string) => `Your spot is held until ${b(when)} (Montreal time).`,
    emailedTo: (masked: string, phone: string) =>
      `We've also emailed these instructions and this page's private link to ${b(masked)}. Not the right address? Call ${phone}.`,
    tapNote: "Tapping the button tells us you've sent it. Your spot is confirmed once we verify the payment in our bank account.",
    reportedTitle: "Thank you — we're checking your payment",
    reportedBody: (reference: string) =>
      `We've noted that you sent your payment, and your spot is being held while we verify it. You'll get an email as soon as it's confirmed. Please keep your reference, ${b(reference)}, handy in case we need to match it.`,
    paidTitle: "You're confirmed!",
    paidBody: "Your payment has been received and your spot is confirmed. Camp details are in your confirmation email.",
    inactiveTitle: "This reservation isn't active",
    inactiveExpired: "It was released because we didn't see a payment report in time. If you already sent your e-Transfer, your money isn't lost.",
    inactiveReleased: "It has been released.",
    inactiveContact: "Please contact us with your reference and we'll sort it out.",
    questions: "Questions?",
    callWord: "Call",
    orEmail: "or email",
  },

  report: {
    button: "I’ve Sent My Payment",
    sending: "Sending…",
    error: "Something went wrong. Please try again.",
  },

  // What the registration API says, by code (the same codes the form and the tests use).
  errors: {
    unavailable: "Online registration isn't set up yet. Please call or email instead.",
    tooLarge: "That request was too large.",
    invalidRequest: "Invalid request.",
    missingFields: "Please fill in all required fields, add at least one child, and pick at least one camp week.",
    tooLong: "Some of the information entered is too long. Please shorten it and try again.",
    invalidEmail: "Please enter a valid email address.",
    invalidPhone: "Please enter each phone number with its area code, for example 514-555-0100.",
    consentRequired: "Please accept the code of conduct and information consent to continue.",
    invalidWeeks: "Please pick valid camp weeks.",
    tooManyChildren: (max: number) => `One registration can include up to ${max} children. For a larger group, please contact us at ${phone}.`,
    invalidBirthDate: (name: string) => `Please check the date of birth for ${name}.`,
    duplicateChild: (name: string) => `${name} appears twice. Please list each child once.`,
    rateLimited: "Too many registrations from this connection just now. Please wait a little while, or contact us directly.",
    tooManyOpen: `There are already several reservations under this email or phone number that haven't been confirmed yet. Please finish paying for those (or wait until we've confirmed them), or contact us at ${phone}.`,
    weeksFull: (labels: string[]) => `These weeks just filled up: ${labels.join("; ")}. Please remove them and try again.`,
    weeksUnavailable: (labels: string[]) => `These weeks aren't available: ${labels.join("; ")}. Please remove them and try again.`,
    alreadyRegistered: (names: string[], weeks: string[], resent: boolean) =>
      `We already have a reservation for ${listNamesEn(names)} for ${weeks.join("; ")} under this email address or phone number, so we haven't made a second one. ` +
      (resent
        ? "If it is still unpaid, we are sending you its payment instructions and private link again: please check your inbox and your junk folder. "
        : "") +
      `To change something, call us at ${phone}.`,
    serverError: "Something went wrong submitting your registration. Please try again or contact us directly.",
    notAnnounced: (year: number) => `Registration for the ${year} camps has not opened yet. Please check back soon, or call ${phone}.`,
    opensLater: (when: string) => `Registration opens ${when} (Montreal time). Please come back then.`,
    reportSetup: "Online registration isn't set up yet.",
    tooManyAttempts: "Too many attempts. Please wait a little while.",
    linkInvalid: "This link isn't valid.",
    tryAgain: "Something went wrong. Please try again.",
    reportReleased: `This reservation has been released. If you already sent your payment, please contact us at ${phone} or ${business.email} with your reference.`,
    reportWindowClosed: `The time to report has passed, so this reservation is being released. If you already sent your payment, please contact us at ${phone} or ${business.email} with your reference.`,
    reportUnavailable: `We can't take a payment report online for this reservation. Please contact us at ${phone} or ${business.email} with your reference.`,
  },

  payment: {
    send: (amount: string, address: string) => `Send an Interac e-Transfer of ${amount} to ${address}.`,
    reference: (reference: string) => `Put your reference, ${reference}, in the message box of the transfer so we can match it.`,
    autodeposit: "This address accepts transfers automatically, so there is no password or security question.",
    securityQuestion: `If your bank asks for a security question and answer, please call ${phone} and we'll sort it out.`,
    thenPage: "Then come back to this page and tap “I’ve Sent My Payment.” You don’t need to upload anything or create an account.",
    thenEmail: "Then open your reservation page (the button below) and tap “I’ve Sent My Payment.” You don’t need to upload anything or create an account.",
  },

  email: {
    hello: (first: string) => `Hi ${first},`,
    taxIncluded: "tax included",

    instructions: {
      subject: (children: string, reference: string) => `Send your payment to hold ${children}'s camp spot (${reference})`,
      heading: "Your spot is reserved — send your payment",
      intro: (first: string, children: string, weeks: string, payBy: string) =>
        `Hi ${first}, we're holding a spot for ${b(children)} for ${weeks}. It stays held until ${b(payBy)} (Montreal time).`,
      referenceLabel: "Your reference",
      amountLabel: "Amount to send",
      button: "Open my reservation page",
      footer: "Your spot is confirmed only once the payment is verified in our bank account. Keep this email: the button above is your private link, so please don't forward it.",
      textLink: "Your private reservation page (please don't forward it):",
      textAmount: (amount: string) => `${amount} (tax included)`,
      textFooter: "Your spot is confirmed only once the payment is verified in our bank account.",
    },

    reminder: {
      subject: (children: string, payBy: string) => `Reminder: ${children}'s camp spot is held until ${payBy}`,
      heading: "Your camp spot is still being held",
      intro: (first: string, children: string, reference: string, payBy: string) =>
        `Hi ${first}, we haven't heard that payment was sent for ${b(children)} (reference ${b(reference)}). The spot will be released automatically at ${b(payBy)} (Montreal time) so another family can have it.`,
      alreadySent: (button: string) =>
        `${b("Already sent your e-Transfer?")} Open your reservation page below and tap ${b(`“${button}”`)}. That’s all we need to keep your spot while we check our bank account.`,
      notYetSent: (amount: string, address: string, reference: string) =>
        `${b("Haven’t sent it yet?")} Send ${amount} (tax included) by Interac e-Transfer to ${address} with the reference ${reference} in the message, then tap the same button.`,
      button: "Open my reservation page",
      footer: `Need more time or have a question? Call ${phone}. This button is your private link, so please don’t forward this email.`,
      textLink: "Your private reservation page (please don't forward this email):",
    },

    release: {
      subject: (children: string, reference: string) => `Your camp reservation for ${children} was released (${reference})`,
      heading: "Your reservation was released",
      reference: (reference: string, children: string) => `Reference ${b(reference)} · ${children}`,
      body:
        "Your reservation was released because we didn't see a payment report in time. " +
        "If you already sent your e-Transfer, your money isn't lost: reply to this email with your reference, " +
        "and we'll check and reinstate you if a spot is still free, or refund you. " +
        "If you still want a spot, you're welcome to register again.",
    },

    confirmation: {
      subject: (children: string) => `You're confirmed! ${children}'s spot at ${business.name} Junior Camp`,
      heading: "Thank you — you're all set!",
      intro: (children: string, plural: boolean, count: number) =>
        `Payment has been received and ${b(`${children}'s`)} spot${plural ? "s are" : " is"} now confirmed for Junior Camp at ${venue.name}. We can't wait to see ${count === 1 ? "them" : "everyone"} on the course! Here's everything you need for camp day.`,
      confirmationNumber: "Confirmation Number",
      children: "Children",
      confirmedWeeks: (n: number) => `Confirmed Week${n === 1 ? "" : "s"}`,
      amountPaid: "Amount Paid",
      hours: "Hours",
      location: "Location",
      dropPickTitle: "Drop-off & Pick-up",
      dropOff: "Drop-off",
      pickUp: "Pick-up",
      toBring: "What to Bring",
      safety: "Safety & Responsibility",
      closing: (phoneNumber: string) => `Questions before camp day? Just reply to this email or reach us at ${phoneNumber}. We're looking forward to a great week!`,
      textClosing: (phoneNumber: string) => `Questions? Reply to this email or call ${phoneNumber}.`,
      textIntro: (children: string, plural: boolean) => `Payment has been received and ${children}'s spot${plural ? "s are" : " is"} confirmed for Junior Camp at ${venue.name}.`,
    },

    // Sent when the owner cancels or releases a registration from the dashboard.
    cancellation: {
      subjectCancelled: (children: string, reference: string) => `Your camp registration for ${children} was cancelled (${reference})`,
      subjectNotReceived: (children: string, reference: string) => `We could not find your payment for ${children} (${reference})`,
      headingCancelled: "Your registration was cancelled",
      headingNotReceived: "We could not find your payment",
      reference: (reference: string, children: string) => `Reference ${b(reference)} · ${children}`,
      weeksReleased: (weeks: string) => `The spots for ${weeks} have been released.`,
      cancelledPaid:
        "This registration has been cancelled and its spots released. If a refund is owed under our cancellation terms, we will arrange it with you directly. If you did not ask for this cancellation, please call us right away.",
      cancelledUnpaid:
        "This reservation has been cancelled and its spots released. No payment had been confirmed for it. If you did send an e-Transfer, please reply to this email with your reference so we can match it.",
      notReceived:
        "We looked for your e-Transfer and could not find it, so the spots held for this reservation have been released for other families. If you did send a payment, your money is not lost: reply to this email with your reference and the bank’s confirmation number, and we will check and sort it out, including restoring your spots if they are still free.",
      register: "If you would still like a place, you are welcome to register again.",
      contact: (phoneNumber: string) => `Questions? Reply to this email or call ${phoneNumber}.`,
    },
  },
};

function listNamesEn(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
}

export { joinNames };
