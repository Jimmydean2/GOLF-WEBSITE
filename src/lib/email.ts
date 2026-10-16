import nodemailer from "nodemailer";

// Server-only. Sends transactional email (payment instructions, confirmations, alerts).
//
// Production uses the business Gmail account through an App Password: no new paid service.
// See BOOKING_SETUP.md. For rehearsals and tests the same code can talk to any other SMTP
// server instead (SMTP_HOST ...), for instance a local sink that records what would have
// been sent; nothing else in the application knows the difference.
//
// Every connection has timeouts. A mail server that stops answering must cost a few seconds,
// never a hung request.

export type EmailMessage = { to: string; subject: string; html: string; text: string };

function smtpOverride(): { host: string; port: number } | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  return { host, port: Number(process.env.SMTP_PORT) || 587 };
}

export function isEmailConfigured(): boolean {
  if (smtpOverride()) return true;
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

// The address mail is sent from, and the account that receives replies and bounces.
export function senderAddress(): string | null {
  return process.env.EMAIL_FROM?.trim() || process.env.GMAIL_USER?.trim() || (smtpOverride() ? "camp@localhost" : null);
}

const TIMEOUTS = { connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000, dnsTimeout: 5_000 };

function getTransport() {
  const override = smtpOverride();
  if (override) {
    const user = process.env.SMTP_USER?.trim();
    return nodemailer.createTransport({
      host: override.host,
      port: override.port,
      secure: override.port === 465,
      // A local test sink speaks plain SMTP; a real server must prove its certificate.
      ignoreTLS: process.env.SMTP_INSECURE === "true",
      auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
      ...TIMEOUTS,
    });
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    ...TIMEOUTS,
  });
}

export async function sendEmail({ to, subject, html, text }: EmailMessage): Promise<void> {
  const from = senderAddress();
  if (!isEmailConfigured() || !from) {
    throw new Error("Email is not configured.");
  }
  await getTransport().sendMail({
    from: `"James Dean Golf" <${from}>`,
    to,
    subject,
    html,
    text,
  });
}

export type SendFailure = {
  // True when retrying cannot help: the receiving server said the address does not exist.
  // Everything else (timeouts, a full daily quota, a wrong password, a busy server) is
  // transient from the family's point of view and is retried.
  permanent: boolean;
  summary: string;
};

const BAD_ADDRESS = /(user unknown|no such user|does not exist|doesn'?t exist|invalid (recipient|address|mailbox)|recipient (address )?rejected|mailbox (unavailable|not found)|unknown (user|recipient)|address rejected|not a valid)/i;

export function classifySendError(err: unknown): SendFailure {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string } | null;
  const detail = String(e?.response ?? e?.message ?? err ?? "unknown error").replace(/\s+/g, " ").slice(0, 300);
  const code = e?.responseCode;
  const permanent =
    e?.code === "EENVELOPE" ||
    ((code === 550 || code === 551 || code === 553 || code === 554) && BAD_ADDRESS.test(detail)) ||
    (code === 550 && /5\.1\.[1-3]/.test(detail));
  return { permanent: Boolean(permanent), summary: detail };
}
