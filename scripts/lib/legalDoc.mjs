// Renders docs/QUEBEC_LEGAL_REVIEW.md from the list in src/lib/i18n/legal.ts and the two
// dictionaries, so a lawyer reads the wording exactly as a family sees it. `npm run legal:write`
// writes it; the test suite fails if the file on disk is out of date.

import { LEGAL_REVIEW } from "../../src/lib/i18n/legal.ts";
import { getMessages } from "../../src/lib/i18n/index.ts";

function lookup(messages, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), messages);
}

const strip = (text) => String(text).replace(/[]/g, "");

function render(value) {
  if (Array.isArray(value)) return value.map((v) => `  - ${strip(v)}`).join("\n");
  if (typeof value === "string") return `  > ${strip(value)}`;
  return "  > (not a plain text message)";
}

export function renderLegalDoc() {
  const en = getMessages("en");
  const fr = getMessages("fr");
  const blocks = LEGAL_REVIEW.map((item) => {
    const texts = item.keys
      .map((key) => {
        const a = lookup(en, key);
        const b = lookup(fr, key);
        return `**\`${key}\`**\n\n- English:\n${render(a)}\n- Français:\n${render(b)}`;
      })
      .join("\n\n");
    return `### ${item.id}. ${item.where}\n\n${texts ? texts + "\n\n" : ""}- **Why it may matter:** ${item.why}\n- **Question for the lawyer:** ${item.ask}\n- **What the draft does for now:** ${item.draft}\n`;
  });

  return `# Wording that needs a Quebec lawyer's review

> **This is not legal advice.** It lists the places in the camp journey where a Quebec rule *might*
> apply, shows the exact wording in both languages, and gives the question to put to a lawyer. It
> does not say the wording is wrong. The French is a careful draft written for this site and has
> **not** been read by a Quebec translator: have a native reader check it, and have the lawyer
> check the sections below before launch.
>
> GENERATED from \`src/lib/i18n/legal.ts\` and the dictionaries by \`npm run legal:write\`. A test fails
> if this file is out of date.

## 1. Wording to review

${blocks.join("\n")}
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
   (the hosting providers store data outside Quebec). See \`docs/PRIVACY_AND_LAW25.md\`.
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
`;
}
