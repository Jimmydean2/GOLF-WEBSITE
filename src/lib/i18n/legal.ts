// The wording in the camp journey that touches a legal rule in Quebec, listed so a Quebec
// lawyer can review exactly what a parent reads, in both languages, and nothing else.
// docs/QUEBEC_LEGAL_REVIEW.md is generated from this list (npm run legal:write) and a test fails
// if the two disagree, so the lawyer always sees the current text.
//
// This is not legal advice and it does not say the wording is wrong. It says: these are the
// places where a rule might apply, and these are the questions to put to someone qualified.

export type LegalItem = {
  id: string;
  /** Where a family meets this wording. */
  where: string;
  /** Dictionary keys (for example "form.payCancelFee"). A key may hold a string or a list of strings. */
  keys: string[];
  /** Why it may matter. */
  why: string;
  /** What to ask. */
  ask: string;
  /** What the draft does for now, until the lawyer answers. */
  draft: string;
};

export const LEGAL_REVIEW: LegalItem[] = [
  {
    id: "L1",
    where: "Registration form, first tick box",
    keys: ["form.conductConsent"],
    why: "It gives the camp a right (to send a child home) and says the registration is not valid without the tick. A standard take-it-or-leave-it form may be a contract of adhesion, and Quebec's consumer rules limit what such a contract can say.",
    ask: "Is this acknowledgement enforceable as written? Does sending a child home mid-week need a stated refund or credit rule? Must a French version be offered first (Charter of the French Language, section 55)?",
    draft: "Kept as the owner wrote it, translated closely. No refund promise is made.",
  },
  {
    id: "L2",
    where: "Registration form, \"Method of payment\" list",
    keys: ["form.payCancelFee"],
    why: "A cancellation fee is a contract term. It does not say per child, per week or per registration, how long before camp a family can cancel, or what is refunded.",
    ask: "How should the fee be stated (amount, what it applies to, deadlines)? Are there statutory cancellation rights for a service bought online that must be mentioned?",
    draft: "One sentence, as written by the owner. The owner must supply the real policy (docs/SEASON_2027.md, S8).",
  },
  {
    id: "L3",
    where: "Registration form, under the price summary",
    keys: ["form.firstComeNote"],
    why: "\"Certain conditions may apply\" does not say which. Consumer-protection rules discourage leaving out or blurring important conditions.",
    ask: "Delete the last sentence, or list the conditions?",
    draft: "Kept as written by the owner. Recommend deleting \"Certain conditions may apply\" unless the conditions are listed.",
  },
  {
    id: "L4",
    where: "Camp pages and the family's confirmation email (\"Safety & Responsibility\")",
    keys: ["info.safetyInfo", "info.scheduleNote"],
    why: "Statements about supervision, certification and what happens in bad weather are promises a parent relies on. The French name of the coaching body (\"PGA du Canada\") should be checked. No staff-to-camper ratio is stated.",
    ask: "Are these statements accurate and sufficient? What should be said about severe weather, and is a refund or credit owed when a day is lost?",
    draft: "Owner's words, translated. The French says \"PGA du Canada (CPGA)\"; please confirm the official French name.",
  },
  {
    id: "L5",
    where: "Email to a family whose unpaid reservation was released",
    keys: ["email.release.body"],
    why: "It tells the family that, if they already paid, they will be reinstated or refunded. That is a promise about money.",
    ask: "Is a refund commitment appropriate here, and in what words?",
    draft: "Kept (it is the owner's existing wording). It is only sent for reservations the family never reported as paid.",
  },
  {
    id: "L6",
    where: "Email to a family whose registration the owner cancelled, or whose payment could not be found",
    keys: ["email.cancellation.cancelledPaid", "email.cancellation.cancelledUnpaid", "email.cancellation.notReceived"],
    why: "These say that a refund will be arranged when one is owed, and that money sent is not lost. They are statements about the family's rights.",
    ask: "Are they accurate, and is anything required that is missing (for example the deadline for a refund)?",
    draft: "Deliberately general: no amount and no deadline is stated, because the policy has not been supplied.",
  },
  {
    id: "L7",
    where: "A family's private reservation page, after a release",
    keys: ["parent.inactiveExpired"],
    why: "\"Your money isn't lost\" is an assurance about funds.",
    ask: "Same question as L5.",
    draft: "Kept as the owner wrote it. The sentence only appears for reservations the family never reported as paid.",
  },
  {
    id: "L8",
    where: "Registration form, health field",
    keys: ["form.childHealth", "form.childHealthHint"],
    why: "Health information about a child is sensitive personal information (Law 25). It is collected here for the child's safety.",
    ask: "Is a separate, express consent required for it and how must it be worded? See docs/PRIVACY_AND_LAW25.md for the consent flow that has been built.",
    draft: "Collected, with a clear purpose line in the consent flow.",
  },
  {
    id: "L9",
    where: "Every page, the footer, and the pages that stay English",
    keys: [],
    why: "The Charter of the French Language may require the commercial website as a whole (not only the camp pages) to be available in French on terms at least as favourable as English. Only the camp journey is in French today.",
    ask: "What must be translated for a Quebec business with this site, and by when?",
    draft: "Camp journey bilingual; lessons, clinics, about, contact and booking remain English (docs/FRENCH_READINESS.md, options A to C).",
  },
  {
    id: "L10",
    where: "Registration form, the first consent tick box (privacy)",
    keys: ["consent.privacyBefore", "consent.privacyLink", "consent.privacyAfter"],
    why: "Law 25 requires consent to be clear, free, informed and given for specific purposes, requested in plain words, separately from other information. A child under 14's information is consented to by the parent.",
    ask: "Is this wording sufficient for the collection, use and keeping of the parent's and the child's information? Does \"I am the parent or legal guardian\" adequately cover consent for a minor?",
    draft: "A required tick box, separate from the code of conduct, that links to the privacy notice. The version of the notice is saved with the registration.",
  },
  {
    id: "L11",
    where: "Registration form, the second consent tick box (health information)",
    keys: ["consent.health"],
    why: "Health information is sensitive personal information; consent to collect it is expected to be express and specific.",
    ask: "Is a separate tick box the right way? Is the stated purpose and the limit on who sees it accurate and enough?",
    draft: "A second required tick box, saved as its own field. The health field itself still has to be filled in (the parent writes \"None\" if there is nothing): this is a safety choice, not a legal one; tell us if the lawyer prefers it optional.",
  },
  {
    id: "L12",
    where: "Registration form, \"How we use your information\" box above the tick boxes",
    keys: ["consent.panelTitle", "consent.panel"],
    why: "At the moment information is collected the person must be told the purposes, the means, their rights of access and correction, the categories of people who see it, and the possibility that it is stored outside Quebec.",
    ask: "Does this short notice carry everything required at the point of collection, with the full notice a click away?",
    draft: "Written to cover each of those points in plain language.",
  },
  {
    id: "L13",
    where: "Privacy notice, \"Where it is kept\" and \"How long we keep it\"",
    keys: ["privacy.where", "privacy.keep"],
    why: "Keeping information only as long as needed, and the outside-Quebec storage statement, are legal requirements. The 90 days and the six-year accounting retention are PROPOSALS, not decisions.",
    ask: "Confirm or change the retention periods, and say what assessment of the transfer outside Quebec must be done before launch, by whom.",
    draft: "90 days after the last camp week for sensitive details; six years for the accounting record (reference, amounts, dates, payer name). The system enforces whatever number is set (src/lib/privacy.ts).",
  },
  {
    id: "L14",
    where: "Privacy notice, \"Your rights\"",
    keys: ["privacy.rights", "privacy.rightsContact", "privacy.rightsComplaint"],
    why: "Rights of access, correction, withdrawal and (since 2024) portability, a response time, and the complaint route to the Commission d'accès à l'information.",
    ask: "Is the 30-day reply promise correct, and is the list of rights complete and accurate?",
    draft: "Lists access, copy in a common format, correction, withdrawal/erasure, 30-day reply and the CAI. The dashboard can produce a copy of one family's data and erase it.",
  },
  {
    id: "L15",
    where: "Privacy notice, the remaining sections",
    keys: ["privacy.collectItems", "privacy.whyItems", "privacy.who", "privacy.providersIntro", "privacy.noMarketing", "privacy.protect", "privacy.cookies", "privacy.children"],
    why: "The notice is the public statement of what the business does with personal information. Anything untrue or missing is a problem. Each line was written from what the system really does.",
    ask: "Is anything missing or overstated? In particular the statements about who sees the information, about security, about incidents, and \"no tracking cookies\".",
    draft: "Plain-language draft. It is marked DRAFT on rehearsal sites, and the real site refuses to launch until the owner records that it has been reviewed (PRIVACY_NOTICE_REVIEWED).",
  },
  {
    id: "L16",
    where: "Waiting list form (shown only when a week is full), its tick box and introduction",
    keys: ["waitlist.intro", "waitlist.consentBefore"],
    why: "A waiting list collects personal information (a name, an email address, optionally a phone number) for a purpose different from registering a child. It must not suggest a place is promised, and it must be easy to leave.",
    ask: "Is this consent wording enough for a waiting list, and is it clear that nothing is promised or held? Is a withdrawal by phone or reply email sufficient, or must the email carry a one-click removal link? Is deleting the request once the week has passed an acceptable retention period?",
    draft: "A separate tick box, a statement that it is not a registration and holds no place, deletion once the camp week has passed, removal on request by phone or reply. The privacy notice (L15) lists what is collected for the waiting list.",
  },
  {
    id: "L17",
    where: "The two waiting-list emails (confirmation of joining, and \"a place may have opened\")",
    keys: ["email.waitlistAck.notRegistration", "email.waitlistAck.whatNext", "email.waitlistNotify.notHeld"],
    why: "When the owner emails a family that a place may be open, the family may believe a place is theirs. Wording that sounds like an offer could create an expectation, and a French-speaking parent must read the same limits.",
    ask: "Does this wording make clear in both languages that no place is held, none is promised, and places are first come, first served? Should it say anything about what happens if two families answer the same email?",
    draft: "Says in each email that nothing is held and nothing is promised, and that the family must register through the ordinary form. The owner can only send it while the week really has room.",
  },
];
