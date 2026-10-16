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
];
