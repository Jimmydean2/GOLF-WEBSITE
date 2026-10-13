import nodemailer from "nodemailer";

// Server-only. Sends transactional email (camp payment confirmations) via
// Gmail SMTP using an App Password on the business Gmail account — no new
// paid service required. See BOOKING_SETUP.md for setup.

export function isEmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const user = process.env.GMAIL_USER;
  if (!user || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Email is not configured.");
  }

  const transport = getTransport();
  await transport.sendMail({
    from: `"James Dean Golf" <${user}>`,
    to,
    subject,
    html,
    text,
  });
}
