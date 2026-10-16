import { business, juniorCamps, locations } from "./content";
import type { RegistrationDetail } from "./campDb";
import { calculateTotal, formatCents } from "./pricing";

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

// Short, human-friendly reference derived from the registration's real
// unique id — easier for a parent to quote over the phone than a full UUID.
export function confirmationNumber(registrationId: string): string {
  return registrationId.replace(/-/g, "").slice(0, 8).toUpperCase();
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

  const parentRows: [string, string][] = [
    ["Camp week" + (weekCount === 1 ? "" : "s"), weeksDisplay],
    ["Parent/guardian", registration.parentName],
    ["Parent email", registration.email],
    ["Primary phone", registration.primaryPhone],
    ["Secondary phone", registration.secondaryPhone || "—"],
    [
      "Emergency contact",
      `${registration.emergencyName} (${registration.emergencyRelationship}) — ${registration.emergencyPhone}`,
    ],
  ];

  const childRows = registration.children
    .map(
      (child, i) => `
    <tr><td colspan="2" style="padding:12px 0 4px; font-size:13px; font-weight:700; color:${FOREST};">Child ${i + 1}</td></tr>
    <tr><td style="padding:4px 0; font-size:13px; color:${INK_SOFT}; width:40%; vertical-align:top;">${escapeHtml("Full name")}</td><td style="padding:4px 0; font-size:13px; color:#1b1b16; font-weight:600;">${escapeHtml(child.fullName)}</td></tr>
    <tr><td style="padding:4px 0; font-size:13px; color:${INK_SOFT}; vertical-align:top;">${escapeHtml("Date of birth")}</td><td style="padding:4px 0; font-size:13px; color:#1b1b16; font-weight:600;">${escapeHtml(child.dateOfBirth)}</td></tr>
    <tr><td style="padding:4px 0; font-size:13px; color:${INK_SOFT}; vertical-align:top;">${escapeHtml("Age")}</td><td style="padding:4px 0; font-size:13px; color:#1b1b16; font-weight:600;">${escapeHtml(child.age)}</td></tr>
    <tr><td style="padding:4px 0; font-size:13px; color:${INK_SOFT}; vertical-align:top;">${escapeHtml("Health/medical info")}</td><td style="padding:4px 0; font-size:13px; color:#1b1b16; font-weight:600;">${escapeHtml(child.healthInfo || "—")}</td></tr>`
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
    <p style="margin:0 0 20px; font-size:12px; color:${INK_SOFT};">Confirmation #${confirmationNumber(registration.id)}</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">A new registration came in for <strong>${weeksDisplay}</strong> (${registration.children.length} child${registration.children.length === 1 ? "" : "ren"}). Review the details below. Once you can see the e-transfer for the full amount in your bank account, open the dashboard, find this registration, and confirm payment — that confirms ${weekCount === 1 ? "the spot" : "all spots"} and sends the parent their full confirmation email.</p>
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
Confirmation #${confirmationNumber(registration.id)}

${parentRows.map(([label, value]) => `${label}: ${value}`).join("\n")}

${registration.children
  .map(
    (c, i) =>
      `Child ${i + 1}: ${c.fullName} (DOB ${c.dateOfBirth}, age ${c.age}) — Health/medical: ${c.healthInfo || "—"}`
  )
  .join("\n")}

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
  const confNumber = confirmationNumber(registration.id);

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
          <p style="margin:0 0 10px; font-size:14px; color:#1b1b16; font-weight:700;">#${confNumber}</p>
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

CONFIRMATION NUMBER: #${confNumber}

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
