import { business, juniorCamps, locations } from "./content";
import type { CampRegistrationRow } from "./googleSheets";

const FOREST = "#1f4a34";
const GOLD = "#c89b3c";
const INK_SOFT = "#4a463c";
const CREAM = "#fbf6ea";
const BORDER = "#e4d9b8";

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

export function buildCoachNotificationEmail(
  entry: CampRegistrationRow & { id: string; confirmToken: string },
  confirmUrl: string
): { subject: string; html: string; text: string } {
  const week = weekLabel(entry.week);
  const subject = `New camp registration — ${entry.childName} (${week})`;

  const detailsRows: [string, string][] = [
    ["Camp week", week],
    ["Parent/guardian", entry.parentName],
    ["Parent email", entry.email],
    ["Primary phone", entry.primaryPhone],
    ["Secondary phone", entry.secondaryPhone || "—"],
    ["Child's name", entry.childName],
    ["Date of birth", entry.dateOfBirth],
    ["Child's age", entry.childAge],
    ["Health/medical info", entry.healthInfo || "—"],
    ["Emergency contact", `${entry.emergencyName} (${entry.emergencyRelationship}) — ${entry.emergencyPhone}`],
  ];

  const detailsHtml = detailsRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0; font-size:13px; color:${INK_SOFT}; width:40%; vertical-align:top;">${label}</td><td style="padding:6px 0; font-size:13px; color:#1b1b16; font-weight:600; vertical-align:top;">${value}</td></tr>`
    )
    .join("\n");

  const html = emailShell(`
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:bold; color:${FOREST};">New Junior Camp registration</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">A new registration came in for <strong>${week}</strong>. Review the details below, and once you've received the e-transfer, click the button to confirm the spot and automatically send the parent their full confirmation email.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${detailsHtml}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="border-radius:999px; background:${GOLD};">
          <a href="${confirmUrl}" style="display:inline-block; padding:14px 28px; font-size:14px; font-weight:bold; color:#1b1b16; text-decoration:none;">Mark as Paid &amp; Send Confirmation</a>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0; font-size:12px; color:${INK_SOFT}; text-align:center;">Only click this once you've confirmed payment was received in full.</p>
  `);

  const text = `New Junior Camp registration — ${week}

${detailsRows.map(([label, value]) => `${label}: ${value}`).join("\n")}

Once payment is received, confirm it here:
${confirmUrl}`;

  return { subject, html, text };
}

export function buildParentConfirmationEmail(entry: CampRegistrationRow): {
  subject: string;
  html: string;
  text: string;
} {
  const week = weekLabel(entry.week);
  const venue = locations[juniorCamps.venue];
  const firstName = entry.parentName.split(" ")[0] || entry.parentName;
  const subject = `You're confirmed! ${entry.childName}'s spot at ${business.name} Junior Camp`;

  const html = emailShell(`
    <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:22px; font-weight:bold; color:${FOREST};">Thank you — you're all set!</p>
    <p style="margin:0 0 16px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">Hi ${firstName},</p>
    <p style="margin:0 0 20px; font-size:14px; color:${INK_SOFT}; line-height:1.6;">
      Payment has been received and <strong>${entry.childName}'s</strong> spot is now confirmed for Junior Camp. We can't wait to see them on the course! Here's everything you need for camp day.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid ${BORDER}; border-radius:12px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${GOLD}; font-weight:bold;">Confirmed Dates</p>
          <p style="margin:0 0 10px; font-size:16px; font-weight:bold; color:${FOREST};">${week}</p>
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

Payment has been received and ${entry.childName}'s spot is confirmed for Junior Camp.

CONFIRMED DATES: ${week}
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
