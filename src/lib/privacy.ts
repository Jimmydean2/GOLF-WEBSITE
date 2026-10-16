// The facts the privacy notice, the consent record and the clean-up job all share, written once.
// Pure data: safe on the server and in the browser.

import { business } from "./content";

// The version of the privacy notice a family agrees to. It is saved with each registration, so
// the owner can always say which text a family consented to. Change it (and only it) whenever the
// notice's meaning changes: the date is the day of the change.
export const PRIVACY_NOTICE_VERSION = "2026-10-16-draft";

// Has a Quebec lawyer read the notice and the consent wording, and has the owner approved them?
// Until this is true the notice says "draft" on rehearsal sites and the preflight check for the
// real site (--production) fails. Set it in the commit that records the approval.
export const PRIVACY_NOTICE_REVIEWED = false;

// How long a family's sensitive details are kept after the last camp week they registered for:
// the child's date of birth, the health information, the emergency contact, the contact details.
// PROPOSED, not decided: see docs/PRIVACY_AND_LAW25.md, question P2. The notice, the clean-up job
// and the dashboard all read this one number.
export const RETENTION_DAYS = 90;

// Tax and accounting rules require the business to keep its records of transactions for six
// years. What is kept: the reference, the amounts, the dates and the parent's name as payer.
export const ACCOUNTING_RECORD_YEARS = 6;

// The person responsible for the protection of personal information (Law 25). By default that
// is the owner. The legal name is a decision for the owner (docs/PRIVACY_AND_LAW25.md, P1).
export const privacyOfficer = {
  name: "James (Coach James), owner of James Dean Golf",
  title: "Owner",
  email: business.email,
  phone: business.phone,
};

// The service providers that handle families' information for the site. Named in the notice.
export const PROVIDERS = [
  { id: "vercel", name: "Vercel", role: { en: "hosts the website", fr: "héberge le site Web" } },
  { id: "neon", name: "Neon", role: { en: "stores the registration database", fr: "héberge la base de données des inscriptions" } },
  { id: "google", name: "Google (Gmail)", role: { en: "sends the emails you receive from us", fr: "envoie les courriels que vous recevez de nous" } },
] as const;
