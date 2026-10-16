import { business } from "./content";

// Shared wording for the parent's payment instructions, so the on-screen page and the
// email always say the same thing. Pure functions; safe on server or client.

// The address parents send the Interac e-Transfer to. Set ETRANSFER_EMAIL to use a
// dedicated address; otherwise the business email is shown.
export function etransferAddress(): string {
  return process.env.ETRANSFER_EMAIL || business.email;
}

// Only claim automatic deposit once the bank has confirmed it (ETRANSFER_AUTODEPOSIT=true).
// Until then parents are told to get in touch if their bank asks for a security question.
export function etransferInstructionLines(reference: string, amountText: string, surface: "page" | "email" = "page"): string[] {
  const autodeposit = process.env.ETRANSFER_AUTODEPOSIT === "true";
  return [
    `Send an Interac e-Transfer of ${amountText} to ${etransferAddress()}.`,
    `Put your reference, ${reference}, in the message box of the transfer so we can match it.`,
    autodeposit
      ? "This address accepts transfers automatically, so there is no password or security question."
      : `If your bank asks for a security question and answer, please call ${business.phone} and we'll sort it out.`,
    surface === "email"
      ? "Then open your reservation page (the button below) and tap “I’ve Sent My Payment.” You don’t need to upload anything or create an account."
      : "Then come back to this page and tap “I’ve Sent My Payment.” You don’t need to upload anything or create an account.",
  ];
}

// Dates are shown in Montreal time, because that is where the family and the camp are.
export function formatMontreal(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
