import { business } from "./content";
import type { RegistrationDetail } from "./campDb";
import { calculateTotal, formatCents } from "./pricing";
import { etransferAddress, etransferInstructionLines, formatMontreal } from "./payment";
import type { Lang } from "./lang";
import { getMessages, renderRichHtml, renderRichText, formatMoney } from "./i18n";
import { labelForWeekId, season } from "./season";

const FOREST = "#1f4a34";
const GOLD = "#c89b3c";
const INK_SOFT = "#4a463c";
const CREAM = "#fbf6ea";
const BORDER = "#e4d9b8";

// Every value below comes from the public registration form — escape before
// interpolating into HTML so a submitted name/note can't inject markup or
// links into the coach's or parent's email.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The administrators' emails are always in English.
function weekLabel(weekId: string): string {
  return labelForWeekId(weekId, "en");
}

function emailShell(bodyHtml: string, lang: Lang = "en"): string {
  return `<!doctype html>
<html lang="${lang === "fr" ? "fr-CA" : "en"}">
  <body style="margin:0; padding:0; background:${CREAM}; font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif; color:#1b1b16;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid ${BORDER};" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:${FOREST}; padding:24px 32px;">
                <span style="font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${CREAM};">${business.name}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background:${CREAM}; border-top:1px solid ${BORDER}; font-size:12px; color:${INK_SOFT};">
                ${business.name} &middot; <a href="tel:${business.phoneHref.replace("tel:", "")}" style="color:${FOREST};">${business.phone}</a> &middot; <a href="mailto:${business.email}" style="color:${FOREST};">${business.email}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function listHtml(items: string[]): string {
  return `<ul style="margin:8px 0 0; padding-left:20px; color:${INK_SOFT}; font-size:14px; line-height:1.7;">
    ${items.map((item) => `<li>${item}</li>`).join("\n    ")}
  </ul>`;
}

function priceBreakdownRows(subtotalCents: number): [string, string][] {
  const { gstCents, qstCents, totalCents } = calculateTotal(subtotalCents);
  return [
    ["Subtotal", `$${formatCents(subtotalCents)}`],
    ["GST (5%)", `$${formatCents(gstCents)}`],
    ["QST (9.975%)", `$${formatCents(qstCents)}`],
    ["Total", `$${formatCents(totalCents)}`],
  ];
}

// `dashboardUrl` is the owner's admin page. The email deliberately contains no
// link that changes a payment status: opening an email link (or a mail
// scanner prefetching it) must never confirm a registration. Payment is
// confirmed only from the logged-in dashboard, after seeing the deposit.
export function buildCoachNotificationEmail(
  registration: RegistrationDetail,
  dashboardUrl: string
): { subject: string; html: string; text: string } {
  const weekLabels = registration.weekIds.map(weekLabel);
  const weekCount = weekLabels.length;
  const weeksDisplay = weekLabels.join(", ");
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const subject = `New camp registration — ${childNames} (${registration.children.length} child${registration.children.length === 1 ? "" : "ren"}, ${weekCount} week${weekCount === 1 ? "" : "s"})`;

  // Deliberately NOT in the email: dates of birth, health and medical details, emergency
  // contacts. They are sensitive, an email is copied to several mailboxes, and the
  // administrator's dashboard (login required) has all of it.
  const parentRows: [string, string][] = [
    ["Camp week" + (weekCount === 1 ? "" : "s"), weeksDisplay],
    ["Parent/guardian", registration.parentName],
    ["Parent email", registration.email],
    ["Primary phone", registration.primaryPhone],
    ["Language", registration.language === "fr" ? "Français (reply in French)" : "English"],
  ];

  const childRows = registration.children
    .map(
      (child, i) => `
    <tr><td style="padding:4px 0; font-size:13px; color:${INK_SOFT}; width:40%; vertical-align:top;">Child ${i + 1}</td><td style="padding:4px 0; font-size:13px; color:#1b1b16; font-weight:600;">${escapeHtml(child.fullName)} (age ${escapeHtml(child.age)})</td></tr>`
    )
    .join("\n");

  const parentRowsHtml = parentRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0; font-size:13px; color:${INK_SOFT}; width:40%; vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0; font-size:13px; color:#1b1b16; font-weight:600; vertical-align:top;">${escapeHtml(value)}</td></tr>`
    )
    .join("\n");

  const priceRowsHtml = priceBreakdownRows(registration.totalPriceCents)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 0; font-size:13px; color:${INK_SOFT};">${label}</td><td style="padding:3px 0; font-size:13px; color:#1b1b16; font-weight:700; text-align:right;">${value}</td></tr>`
    )
    .join("\n");

  const html = emailShell(`
    <p style="margin:0 0 4px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">New Junior Camp registration</p>
    <p style="margin:0 0 20px; font-size:12px; color:${INK_SOFT};">Reference ${registration.reference}</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">A new registration came in for <strong>${weeksDisplay}</strong> (${registration.children.length} child${registration.children.length === 1 ? "" : "ren"}). Their spot is held for 12 hours. Reference <strong>${registration.reference}</strong>, amount due <strong>$${formatCents(registration.amountDueCents)}</strong> (tax included). Once you can see the e-transfer in your bank account, open the dashboard and confirm payment — that confirms ${weekCount === 1 ? "the spot" : "all spots"} and sends the parent their full confirmation email.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      ${parentRowsHtml}
      ${childRows}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px; border-top:1px solid ${BORDER}; padding-top:8px;">
      ${priceRowsHtml}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="border-radius:999px; background:${GOLD};">
          <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">Open the admin dashboard</a>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0; font-size:12px; color:${INK_SOFT}; text-align:center;">Confirm payment only once the full amount is showing in your bank account.</p>
  `);

  const text = `New Junior Camp registration — ${weeksDisplay}
Reference ${registration.reference}

${parentRows.map(([label, value]) => `${label}: ${value}`).join("\n")}

${registration.children.map((c, i) => `Child ${i + 1}: ${c.fullName} (age ${c.age})`).join("\n")}

Health, emergency-contact and birth-date details are in the dashboard, not in this email.

${priceBreakdownRows(registration.totalPriceCents)
  .map(([label, value]) => `${label}: ${value}`)
  .join("\n")}

Once you can see the deposit in your bank account, confirm payment from your admin dashboard (login required):
${dashboardUrl}`;

  return { subject, html, text };
}

// A short block of key facts, repeated in the HTML emails to parents.
function labelHtml(text: string): string {
  return `<p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">${escapeHtml(text)}</p>`;
}

function priceRowsFor(subtotalCents: number, lang: Lang): [string, string][] {
  const { gstCents, qstCents, totalCents } = calculateTotal(subtotalCents);
  const f = getMessages(lang).form;
  return [
    [f.subtotal, formatMoney(subtotalCents, lang)],
    [f.gst, formatMoney(gstCents, lang)],
    [f.qst, formatMoney(qstCents, lang)],
    [f.total, formatMoney(totalCents, lang)],
  ];
}

function weekNoteFor(weekId: string, lang: Lang): string | null {
  const note = season.weeks.find((w) => w.id === weekId)?.note;
  return note ? note[lang] : null;
}

export function buildParentConfirmationEmail(registration: RegistrationDetail): {
  subject: string;
  html: string;
  text: string;
} {
  const lang = registration.language;
  const m = getMessages(lang);
  const e = m.email.confirmation;
  const info = m.info;
  const weekLabels = registration.weekIds.map((id) => labelForWeekId(id, lang));
  const weekCount = weekLabels.length;
  const notes = registration.weekIds.map((id) => weekNoteFor(id, lang)).filter((n): n is string => Boolean(n));
  const datesHtml = weekLabels.map((l) => `<span style="display:block;">${escapeHtml(l)}</span>`).join("");
  const datesText = weekLabels.join("\n");
  const firstName = registration.parentName.split(" ")[0] || registration.parentName;
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const subject = e.subject(childNames);
  const plural = !(weekCount === 1 && registration.children.length === 1);
  const rows = priceRowsFor(registration.totalPriceCents, lang);

  const priceRowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 0; font-size:13px; color:${INK_SOFT};">${escapeHtml(label)}</td><td style="padding:3px 0; font-size:13px; color:#1b1b16; font-weight:700; text-align:right;">${escapeHtml(value)}</td></tr>`
    )
    .join("\n");
  const notesHtml = notes.map((n) => `<p style="margin:0 0 10px; font-size:13px; color:${INK_SOFT}; line-height:1.5;">${escapeHtml(n)}</p>`).join("");

  const html = emailShell(
    `
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:22px; font-weight:bold; color:${FOREST};">${escapeHtml(e.heading)}</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(m.email.hello(firstName))}</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">
      ${renderRichHtml(e.intro(childNames, plural, registration.children.length))}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid ${BORDER}; border-radius:12px;">
      <tr>
        <td style="padding:16px 20px;">
          ${labelHtml(e.confirmationNumber)}
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16; font-weight:700;">${escapeHtml(registration.reference)}</p>
          ${labelHtml(e.children)}
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16;">${escapeHtml(childNames)}</p>
          ${labelHtml(e.confirmedWeeks(weekCount))}
          <div style="margin:0 0 10px; font-size:16px; font-weight:bold; color:${FOREST};">${datesHtml}</div>
          ${notesHtml}
          ${labelHtml(e.amountPaid)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">${priceRowsHtml}</table>
          ${labelHtml(e.hours)}
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16;">${escapeHtml(info.hours)}</p>
          ${labelHtml(e.location)}
          <p style="margin:0; font-size:14px; color:#1b1b16;">${escapeHtml(info.venueName)}, ${escapeHtml(info.venueAddress)}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 4px; font-size:15px; font-weight:bold; color:${FOREST};">${escapeHtml(e.dropPickTitle)}</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.7;">
      ${escapeHtml(e.dropOff)}: <strong>${escapeHtml(info.dropOffTime)}</strong><br>
      ${escapeHtml(e.pickUp)}: <strong>${escapeHtml(info.pickUpTime)}</strong><br>
      ${escapeHtml(info.scheduleNote)}
    </p>

    <p style="margin:0 0 4px; font-size:15px; font-weight:bold; color:${FOREST};">${escapeHtml(e.toBring)}</p>
    ${listHtml(info.whatToBring.map(escapeHtml))}

    <p style="margin:20px 0 4px; font-size:15px; font-weight:bold; color:${FOREST};">${escapeHtml(e.safety)}</p>
    ${listHtml(info.safetyInfo.map(escapeHtml))}

    <p style="margin:24px 0 0; font-size:14px; color:${INK_SOFT}; line-height:1.6;">
      ${escapeHtml(e.closing(business.phone))}
    </p>
  `,
    lang
  );

  const colon = lang === "fr" ? " :" : ":";
  const text = `${e.heading}

${m.email.hello(firstName)}

${renderRichText(e.textIntro(childNames, plural))}

${e.confirmationNumber.toUpperCase()}${colon} ${registration.reference}

${e.confirmedWeeks(weekCount).toUpperCase()}${colon}
${datesText}
${notes.length ? `\n${notes.join("\n")}\n` : ""}
${rows.map(([label, value]) => `${label}${colon} ${value}`).join("\n")}

${e.hours.toUpperCase()}${colon} ${info.hours}
${e.location.toUpperCase()}${colon} ${info.venueName}, ${info.venueAddress}

${e.dropOff.toUpperCase()}${colon} ${info.dropOffTime}
${e.pickUp.toUpperCase()}${colon} ${info.pickUpTime}
${info.scheduleNote}

${e.toBring.toUpperCase()}${colon}
${info.whatToBring.map((i) => `- ${i}`).join("\n")}

${e.safety.toUpperCase()}${colon}
${info.safetyInfo.map((i) => `- ${i}`).join("\n")}

${e.textClosing(business.phone)}
`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------------------
// Payment-policy emails: the parent's instructions, the administrators' alerts, and the
// notice a parent gets when an unreported reservation is released. None of them contains a
// link that changes a payment status; every link goes to a page that needs the parent's
// private token (view / report only) or the administrators' login.
// ---------------------------------------------------------------------------------------

export function buildParentInstructionsEmail(
  registration: RegistrationDetail,
  opts: { statusUrl: string; payByAt: string }
): { subject: string; html: string; text: string } {
  const lang = registration.language;
  const m = getMessages(lang);
  const e = m.email.instructions;
  const amount = formatMoney(registration.amountDueCents, lang);
  const lines = etransferInstructionLines(registration.reference, amount, "email", lang);
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const weeks = registration.weekIds.map((id) => labelForWeekId(id, lang));
  const firstName = registration.parentName.split(" ")[0] || registration.parentName;
  const subject = e.subject(childNames, registration.reference);
  const payBy = formatMontreal(opts.payByAt, lang);
  const intro = e.intro(firstName, childNames, weeks.join(", "), payBy);

  const html = emailShell(
    `
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(e.heading)}</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px; border:1px solid ${BORDER}; border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        ${labelHtml(e.referenceLabel)}
        <p style="margin:0 0 12px; font-size:22px; color:#1b1b16; font-weight:700; letter-spacing:0.05em;">${escapeHtml(registration.reference)}</p>
        ${labelHtml(e.amountLabel)}
        <p style="margin:0; font-size:18px; color:#1b1b16; font-weight:700;">${escapeHtml(amount)} <span style="font-size:12px; font-weight:400; color:${INK_SOFT};">(${escapeHtml(m.email.taxIncluded)})</span></p>
      </td></tr>
    </table>
    <ol style="margin:0 0 16px; padding-left:20px; color:${INK_SOFT}; font-size:14px; line-height:1.7;">
      ${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n      ")}
    </ol>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.statusUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">${escapeHtml(e.button)}</a>
    </td></tr></table>
    <p style="margin:0; font-size:12px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(e.footer)}</p>
  `,
    lang
  );

  const colon = lang === "fr" ? " :" : ":";
  const text = `${e.heading}

${renderRichText(intro)}

${e.referenceLabel}${colon} ${registration.reference}
${e.amountLabel}${colon} ${e.textAmount(amount)}

${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

${e.textLink}
${opts.statusUrl}

${e.textFooter}`;
  return { subject, html, text };
}

export type AdminAlertTier = "reported" | "due_soon" | "overdue" | "reminder" | "escalated" | "critical";

export type AdminAlertSubject = {
  reference: string;
  parentName: string;
  email: string;
  primaryPhone: string;
  childNames: string[];
  weekIds: string[];
  heldSpots: number;
  amountDueCents: number;
  paymentReportedAt: string | null;
  reviewDueAt: string | null;
};

const TIER_PREFIX: Record<AdminAlertTier, string> = {
  reported: "Payment reported",
  due_soon: "Review due soon",
  overdue: "[URGENT] Payment review overdue",
  reminder: "[REMINDER] Payment review still overdue",
  escalated: "[ESCALATED] Payment review overdue",
  critical: "[CRITICAL] Spots blocked by an unverified payment",
};

export function buildAdminAlertEmail(
  tier: AdminAlertTier,
  s: AdminAlertSubject,
  opts: { hoursOverdue: number; hoursUntilDue: number; dashboardUrl: string }
): { subject: string; html: string; text: string } {
  const names = s.childNames.join(", ");
  const subject = `${TIER_PREFIX[tier]}: ${s.reference} (${names})`;
  const status =
    tier === "reported"
      ? "A parent says they have sent an e-Transfer. Nothing is confirmed until you see the deposit in your bank account."
      : tier === "due_soon"
        ? `This reported payment needs verifying within about ${Math.max(opts.hoursUntilDue, 0)} hour(s). Its spot is held until you act.`
        : `This reported payment is ${opts.hoursOverdue} hour(s) overdue for review. Its ${s.heldSpots} spot(s) are STILL HELD and will stay held until you confirm, release or extend it.`;
  const rows: [string, string][] = [
    ["Reference", s.reference],
    ["Parent", `${s.parentName} (${s.email}, ${s.primaryPhone})`],
    ["Children", names],
    ["Weeks", s.weekIds.map(weekLabel).join(", ")],
    ["Amount due", `$${formatCents(s.amountDueCents)} (tax included)`],
    ["Reported", s.paymentReportedAt ? formatMontreal(s.paymentReportedAt) : "-"],
    ["Review due", s.reviewDueAt ? formatMontreal(s.reviewDueAt) : "-"],
  ];
  const next =
    "What to do: check your bank for the reference and amount. If you see it, confirm payment. If you see nothing, contact the parent for the bank's confirmation number. If the bank shows the transfer as pending, extend the review. If you still can't find it, release it as payment not received.";

  const html = emailShell(`
    <p style="margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(TIER_PREFIX[tier])}</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(status)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      ${rows.map(([k, v]) => `<tr><td style="padding:5px 0; font-size:13px; color:${INK_SOFT}; width:32%; vertical-align:top;">${escapeHtml(k)}</td><td style="padding:5px 0; font-size:13px; color:#1b1b16; font-weight:600;">${escapeHtml(v)}</td></tr>`).join("\n      ")}
    </table>
    <p style="margin:0 0 16px; font-size:13px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(next)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.dashboardUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">Open the review queue</a>
    </td></tr></table>
  `);
  const text = `${TIER_PREFIX[tier]}

${status}

${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}

${next}

Review queue (login required): ${opts.dashboardUrl}`;
  return { subject, html, text };
}

export function buildParentReleaseNoticeEmail(registration: RegistrationDetail): { subject: string; html: string; text: string } {
  const lang = registration.language;
  const e = getMessages(lang).email.release;
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const subject = e.subject(childNames, registration.reference);
  const reference = e.reference(registration.reference, childNames);
  const html = emailShell(
    `
    <p style="margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(e.heading)}</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(reference)}</p>
    <p style="margin:0; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(e.body)}</p>
  `,
    lang
  );
  const text = `${e.heading}\n\n${renderRichText(reference)}\n\n${e.body}`;
  return { subject, html, text };
}

// The family's notice when the owner cancels their registration, or releases it because no
// payment could be found. Sent only when the owner leaves "email the family" ticked.
export function buildParentCancellationEmail(registration: RegistrationDetail): { subject: string; html: string; text: string } {
  const lang = registration.language;
  const e = getMessages(lang).email.cancellation;
  const notReceived = registration.releaseReason === "not_received";
  const wasPaid = Boolean(registration.verifiedAt);
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const weeks = registration.allWeekIds.map((id) => labelForWeekId(id, lang));
  const subject = notReceived ? e.subjectNotReceived(childNames, registration.reference) : e.subjectCancelled(childNames, registration.reference);
  const heading = notReceived ? e.headingNotReceived : e.headingCancelled;
  const body = notReceived ? e.notReceived : wasPaid ? e.cancelledPaid : e.cancelledUnpaid;
  const paragraphs = [e.weeksReleased(weeks.join("; ")), body, e.register, e.contact(business.phone)];
  const reference = e.reference(registration.reference, childNames);
  const html = emailShell(
    `
    <p style="margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(heading)}</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(reference)}</p>
    ${paragraphs.map((p) => `<p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(p)}</p>`).join("\n    ")}
  `,
    lang
  );
  const text = `${heading}\n\n${renderRichText(reference)}\n\n${paragraphs.map(renderRichText).join("\n\n")}`;
  return { subject, html, text };
}

// The gentle nudge a parent gets a few hours before an UNREPORTED reservation is released. It
// is for the family that paid but never came back to tap the button, or meant to pay and
// forgot. It changes nothing by itself: the only link goes to the private reservation page.
export function buildParentReminderEmail(
  registration: RegistrationDetail,
  opts: { statusUrl: string; payByAt: string }
): { subject: string; html: string; text: string } {
  const lang = registration.language;
  const m = getMessages(lang);
  const e = m.email.reminder;
  const amount = formatMoney(registration.amountDueCents, lang);
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const payBy = formatMontreal(opts.payByAt, lang);
  const firstName = registration.parentName.split(" ")[0] || registration.parentName;
  const address = etransferAddress();
  const subject = e.subject(childNames, payBy);
  const button = m.report.button;
  const paragraphs = [
    e.intro(firstName, childNames, registration.reference, payBy),
    e.alreadySent(button),
    e.notYetSent(amount, address, registration.reference),
  ];

  const html = emailShell(
    `
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(e.heading)}</p>
    ${paragraphs.map((p, i) => `<p style="margin:0 0 ${i === paragraphs.length - 1 ? 20 : 12}px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(p)}</p>`).join("\n    ")}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.statusUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">${escapeHtml(e.button)}</a>
    </td></tr></table>
    <p style="margin:0; font-size:12px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(e.footer)}</p>
  `,
    lang
  );
  const text = `${e.heading}

${paragraphs.map(renderRichText).join("\n\n")}

${e.textLink}
${opts.statusUrl}

${e.footer}`;
  return { subject, html, text };
}

// One summary instead of one email per registration, so a busy opening day cannot use up the
// mailbox's daily sending allowance. Names and amounts only: nothing sensitive.
export function buildCoachDigestEmail(
  registrations: RegistrationDetail[],
  opts: { dashboardUrl: string; omitted: number }
): { subject: string; html: string; text: string } {
  const total = registrations.length + opts.omitted;
  const subject = `${total} new camp registration${total === 1 ? "" : "s"}`;
  const rows = registrations.map((r) => ({
    reference: r.reference,
    who: `${r.parentName}${r.language === "fr" ? " [Français]" : ""} (${r.children.length} child${r.children.length === 1 ? "" : "ren"}: ${r.children.map((c) => c.fullName).join(", ")})`,
    weeks: r.weekIds.map(weekLabel).join("; "),
    amount: `$${formatCents(r.amountDueCents)}`,
  }));
  const html = emailShell(`
    <p style="margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${total} new Junior Camp registration${total === 1 ? "" : "s"}</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">Each family is sent its payment instructions, and its spots are held for 12 hours. Nothing is confirmed until you see the deposit in your bank account.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      ${rows
        .map(
          (r) => `<tr><td style="padding:8px 0; border-top:1px solid ${BORDER}; font-size:13px; color:#1b1b16; line-height:1.5;"><strong>${escapeHtml(r.reference)}</strong> &middot; ${escapeHtml(r.amount)}<br><span style="color:${INK_SOFT};">${escapeHtml(r.who)}<br>${escapeHtml(r.weeks)}</span></td></tr>`
        )
        .join("\n      ")}
    </table>
    ${opts.omitted > 0 ? `<p style="margin:0 0 16px; font-size:13px; color:${INK_SOFT};">&hellip;and ${opts.omitted} more. They are all on the dashboard.</p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.dashboardUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">Open the admin dashboard</a>
    </td></tr></table>
  `);
  const text = `${total} new Junior Camp registration${total === 1 ? "" : "s"}

${rows.map((r) => `${r.reference} - ${r.amount}\n  ${r.who}\n  ${r.weeks}`).join("\n\n")}
${opts.omitted > 0 ? `\n...and ${opts.omitted} more (all on the dashboard).\n` : ""}
Nothing is confirmed until you see the deposit in your bank account.
Dashboard (login required): ${opts.dashboardUrl}`;
  return { subject, html, text };
}

// --- the waiting list ----------------------------------------------------------------------
// Two emails, neither of which promises or holds anything.

export type WaitlistEmailInput = { parentName: string; language: Lang; weekIds: string[] };

export function buildWaitlistAckEmail(entry: WaitlistEmailInput): { subject: string; html: string; text: string } {
  const lang = entry.language;
  const e = getMessages(lang).email.waitlistAck;
  const weeks = entry.weekIds.map((id) => labelForWeekId(id, lang)).join("; ");
  const first = entry.parentName.split(" ")[0] || entry.parentName;
  const intro = e.intro(first, weeks);
  const html = emailShell(
    `
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(e.heading)}</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(intro)}</p>
    <p style="margin:0 0 12px; font-size:14px; color:#1b1b16; line-height:1.6; font-weight:bold;">${escapeHtml(e.notRegistration)}</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(e.whatNext)}</p>
    <p style="margin:0; font-size:12px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(e.remove(business.phone))}</p>
  `,
    lang
  );
  const text = `${e.heading}\n\n${renderRichText(intro)}\n\n${e.notRegistration}\n\n${e.whatNext}\n\n${e.remove(business.phone)}`;
  return { subject: e.subject(weeks), html, text };
}

export function buildWaitlistNotifyEmail(entry: WaitlistEmailInput, opts: { registerUrl: string }): { subject: string; html: string; text: string } {
  const lang = entry.language;
  const e = getMessages(lang).email.waitlistNotify;
  const week = labelForWeekId(entry.weekIds[0], lang);
  const first = entry.parentName.split(" ")[0] || entry.parentName;
  const intro = e.intro(first, week);
  const html = emailShell(
    `
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">${escapeHtml(e.heading)}</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${renderRichHtml(intro)}</p>
    <p style="margin:0 0 16px; font-size:14px; color:#1b1b16; line-height:1.6; font-weight:bold;">${escapeHtml(e.notHeld)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.registerUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">${escapeHtml(e.button)}</a>
    </td></tr></table>
    <p style="margin:0; font-size:12px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(e.remove(business.phone))}</p>
  `,
    lang
  );
  const text = `${e.heading}\n\n${renderRichText(intro)}\n\n${e.notHeld}\n\n${e.textLink}\n${opts.registerUrl}\n\n${e.remove(business.phone)}`;
  return { subject: e.subject(week), html, text };
}
