import { business } from "./content";
import type { Lang } from "./lang";
import { getMessages } from "./i18n";
import { formatMontreal as formatMontrealIn } from "./i18n/format";

// Shared wording for the parent's payment instructions, so the on-screen page and the
// email always say the same thing. Pure functions; safe on server or client.

// The address parents send the Interac e-Transfer to. Set ETRANSFER_EMAIL to use a
// dedicated address; otherwise the business email is shown.
export function etransferAddress(): string {
  return process.env.ETRANSFER_EMAIL || business.email;
}

// Only claim automatic deposit once the bank has confirmed it (ETRANSFER_AUTODEPOSIT=true).
// Until then parents are told to get in touch if their bank asks for a security question.
export function etransferInstructionLines(
  reference: string,
  amountText: string,
  surface: "page" | "email" = "page",
  lang: Lang = "en"
): string[] {
  const m = getMessages(lang).payment;
  const autodeposit = process.env.ETRANSFER_AUTODEPOSIT === "true";
  return [
    m.send(amountText, etransferAddress()),
    m.reference(reference),
    autodeposit ? m.autodeposit : m.securityQuestion,
    surface === "email" ? m.thenEmail : m.thenPage,
  ];
}

// Dates are shown in Montreal time, because that is where the family and the camp are.
export function formatMontreal(iso: string, lang: Lang = "en"): string {
  return formatMontrealIn(iso, lang);
}
