import { business, juniorCamps, locations } from "./content";
import type { RegistrationDetail } from "./campDb";
import { calculateTotal, formatCents } from "./pricing";
import { etransferAddress, etransferInstructionLines, formatMontreal } from "./payment";

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

function weekLabel(weekId: string): string {
  return juniorCamps.weeks.find((w) => w.id === weekId)?.label ?? weekId;
}

function emailShell(bodyHtml: string): string {
  return `<!doctype html>
<html>
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

export function buildParentConfirmationEmail(registration: RegistrationDetail): {
  subject: string;
  html: string;
  text: string;
} {
  const weekLabels = registration.weekIds.map(weekLabel);
  const weekCount = weekLabels.length;
  const datesHtml = weekLabels.map((l) => `<span style="display:block;">${l}</span>`).join("");
  const datesText = weekLabels.join("\n");
  const venue = locations[juniorCamps.venue];
  const firstName = registration.parentName.split(" ")[0] || registration.parentName;
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const subject = `You're confirmed! ${childNames}'s spot at ${business.name} Junior Camp`;
  const safeFirstName = escapeHtml(firstName);
  const safeChildNames = escapeHtml(childNames);
  const confNumber = registration.reference;

  const priceRowsHtml = priceBreakdownRows(registration.totalPriceCents)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 0; font-size:13px; color:${INK_SOFT};">${label}</td><td style="padding:3px 0; font-size:13px; color:#1b1b16; font-weight:700; text-align:right;">${value}</td></tr>`
    )
    .join("\n");

  const html = emailShell(`
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:22px; font-weight:bold; color:${FOREST};">Thank you — you're all set!</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">Hi ${safeFirstName},</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">
      Payment has been received and <strong>${safeChildNames}'s</strong> spot${weekCount === 1 && registration.children.length === 1 ? " is" : "s are"} now confirmed for Junior Camp at Golf Dorval. We can't wait to see ${registration.children.length === 1 ? "them" : "everyone"} on the course! Here's everything you need for camp day.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid ${BORDER}; border-radius:12px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Confirmation Number</p>
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16; font-weight:700;">${confNumber}</p>
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Children</p>
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16;">${safeChildNames}</p>
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Confirmed Week${weekCount === 1 ? "" : "s"}</p>
          <div style="margin:0 0 10px; font-size:16px; font-weight:bold; color:${FOREST};">${datesHtml}</div>
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Amount Paid</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">${priceRowsHtml}</table>
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Hours</p>
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16;">${juniorCamps.hours}</p>
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Location</p>
          <p style="margin:0; font-size:14px; color:#1b1b16;">${venue.name}, ${venue.address}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 4px; font-size:15px; font-weight:bold; color:${FOREST};">Drop-off &amp; Pick-up</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.7;">
      Drop-off: <strong>${juniorCamps.dropOffTime}</strong><br>
      Pick-up: <strong>${juniorCamps.pickUpTime}</strong><br>
      ${juniorCamps.scheduleNote}
    </p>

    <p style="margin:0 0 4px; font-size:15px; font-weight:bold; color:${FOREST};">What to Bring</p>
    ${listHtml(juniorCamps.whatToBring)}

    <p style="margin:20px 0 4px; font-size:15px; font-weight:bold; color:${FOREST};">Safety &amp; Responsibility</p>
    ${listHtml(juniorCamps.safetyInfo)}

    <p style="margin:24px 0 0; font-size:14px; color:${INK_SOFT}; line-height:1.6;">
      Questions before camp day? Just reply to this email or reach us at
      <a href="${business.phoneHref}" style="color:${FOREST}; font-weight:600;">${business.phone}</a>.
      We're looking forward to a great week!
    </p>
  `);

  const text = `Thank you — you're all set!

Hi ${firstName},

Payment has been received and ${childNames}'s spot${weekCount === 1 && registration.children.length === 1 ? " is" : "s are"} confirmed for Junior Camp at Golf Dorval.

CONFIRMATION NUMBER: ${confNumber}

CONFIRMED WEEK${weekCount === 1 ? "" : "S"}:
${datesText}

${priceBreakdownRows(registration.totalPriceCents)
  .map(([label, value]) => `${label}: ${value}`)
  .join("\n")}

HOURS: ${juniorCamps.hours}
LOCATION: ${venue.name}, ${venue.address}

DROP-OFF: ${juniorCamps.dropOffTime}
PICK-UP: ${juniorCamps.pickUpTime}
${juniorCamps.scheduleNote}

WHAT TO BRING:
${juniorCamps.whatToBring.map((i) => `- ${i}`).join("\n")}

SAFETY & RESPONSIBILITY:
${juniorCamps.safetyInfo.map((i) => `- ${i}`).join("\n")}

Questions? Reply to this email or call ${business.phone}.
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
  const amount = `$${formatCents(registration.amountDueCents)}`;
  const lines = etransferInstructionLines(registration.reference, amount);
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const weeks = registration.weekIds.map(weekLabel);
  const subject = `Send your payment to hold ${childNames}'s camp spot (${registration.reference})`;
  const payBy = formatMontreal(opts.payByAt);

  const html = emailShell(`
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">Your spot is reserved &mdash; send your payment</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">Hi ${escapeHtml(registration.parentName.split(" ")[0] || registration.parentName)}, we're holding a spot for <strong>${escapeHtml(childNames)}</strong> for ${weeks.map(escapeHtml).join(", ")}. It stays held until <strong>${escapeHtml(payBy)}</strong> (Montreal time).</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px; border:1px solid ${BORDER}; border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Your reference</p>
        <p style="margin:0 0 12px; font-size:22px; color:#1b1b16; font-weight:700; letter-spacing:0.05em;">${escapeHtml(registration.reference)}</p>
        <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Amount to send</p>
        <p style="margin:0; font-size:18px; color:#1b1b16; font-weight:700;">${escapeHtml(amount)} <span style="font-size:12px; font-weight:400; color:${INK_SOFT};">(tax included)</span></p>
      </td></tr>
    </table>
    <ol style="margin:0 0 16px; padding-left:20px; color:${INK_SOFT}; font-size:14px; line-height:1.7;">
      ${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n      ")}
    </ol>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.statusUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">Open my reservation page</a>
    </td></tr></table>
    <p style="margin:0; font-size:12px; color:${INK_SOFT}; line-height:1.6;">Your spot is confirmed only once the payment is verified in our bank account. Keep this email: the button above is your private link, so please don't forward it.</p>
  `);

  const text = `Your spot is reserved - send your payment

We're holding a spot for ${childNames} for ${weeks.join(", ")}. It stays held until ${payBy} (Montreal time).

Reference: ${registration.reference}
Amount to send: ${amount} (tax included)

${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

Your private reservation page (please don't forward it):
${opts.statusUrl}

Your spot is confirmed only once the payment is verified in our bank account.`;
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
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const subject = `Your camp reservation for ${childNames} was released (${registration.reference})`;
  const body =
    "Your reservation was released because we didn't see a payment report in time. " +
    "If you already sent your e-Transfer, your money isn't lost: reply to this email with your reference, " +
    "and we'll check and reinstate you if a spot is still free, or refund you. " +
    "If you still want a spot, you're welcome to register again.";
  const html = emailShell(`
    <p style="margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">Your reservation was released</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">Reference <strong>${escapeHtml(registration.reference)}</strong> &middot; ${escapeHtml(childNames)}</p>
    <p style="margin:0; font-size:14px; color:${INK_SOFT}; line-height:1.6;">${escapeHtml(body)}</p>
  `);
  const text = `Your reservation was released\n\nReference ${registration.reference} - ${childNames}\n\n${body}`;
  return { subject, html, text };
}

// The gentle nudge a parent gets a few hours before an UNREPORTED reservation is released. It
// is for the family that paid but never came back to tap the button, or meant to pay and
// forgot. It changes nothing by itself: the only link goes to the private reservation page.
export function buildParentReminderEmail(
  registration: RegistrationDetail,
  opts: { statusUrl: string; payByAt: string }
): { subject: string; html: string; text: string } {
  const amount = `$${formatCents(registration.amountDueCents)}`;
  const childNames = registration.children.map((c) => c.fullName).join(", ");
  const payBy = formatMontreal(opts.payByAt);
  const firstName = registration.parentName.split(" ")[0] || registration.parentName;
  const address = etransferAddress();
  const subject = `Reminder: ${childNames}'s camp spot is held until ${payBy}`;

  const html = emailShell(`
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">Your camp spot is still being held</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">Hi ${escapeHtml(firstName)}, we haven't heard that payment was sent for <strong>${escapeHtml(childNames)}</strong> (reference <strong>${escapeHtml(registration.reference)}</strong>). The spot will be released automatically at <strong>${escapeHtml(payBy)}</strong> (Montreal time) so another family can have it.</p>
    <p style="margin:0 0 12px; font-size:14px; color:${INK_SOFT}; line-height:1.6;"><strong>Already sent your e-Transfer?</strong> Open your reservation page below and tap <strong>&ldquo;I&rsquo;ve Sent My Payment&rdquo;</strong>. That&rsquo;s all we need to keep your spot while we check our bank account.</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;"><strong>Haven&rsquo;t sent it yet?</strong> Send ${escapeHtml(amount)} (tax included) by Interac e-Transfer to ${escapeHtml(address)} with the reference ${escapeHtml(registration.reference)} in the message, then tap the same button.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="border-radius:999px; background:${GOLD};">
      <a href="${escapeHtml(opts.statusUrl)}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">Open my reservation page</a>
    </td></tr></table>
    <p style="margin:0; font-size:12px; color:${INK_SOFT}; line-height:1.6;">Need more time or have a question? Call ${business.phone}. This button is your private link, so please don&rsquo;t forward this email.</p>
  `);
  const text = `Your camp spot is still being held

Hi ${firstName}, we haven't heard that payment was sent for ${childNames} (reference ${registration.reference}). The spot will be released automatically at ${payBy} (Montreal time) so another family can have it.

ALREADY SENT YOUR E-TRANSFER? Open your reservation page and tap "I've Sent My Payment". That's all we need to keep your spot while we check our bank account.

HAVEN'T SENT IT YET? Send ${amount} (tax included) by Interac e-Transfer to ${address} with the reference ${registration.reference} in the message, then tap the same button.

Your private reservation page (please don't forward this email):
${opts.statusUrl}

Need more time or have a question? Call ${business.phone}.`;
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
    who: `${r.parentName} (${r.children.length} child${r.children.length === 1 ? "" : "ren"}: ${r.children.map((c) => c.fullName).join(", ")})`,
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
