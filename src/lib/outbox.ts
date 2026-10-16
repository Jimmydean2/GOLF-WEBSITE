import { getPool } from "./db";
import { enqueueEmail, type OutboxKind } from "./outboxQueue";
import { classifySendError, isEmailConfigured, sendEmail, type EmailMessage } from "./email";
import { getCampSettings, getPayByAt, getRegistrationSnapshot, type RegistrationDetail } from "./campDb";
import { makeAccessToken } from "./registrationLink";
import { adminAlertRecipients } from "./alerts";
import {
  buildCoachDigestEmail,
  buildCoachNotificationEmail,
  buildParentConfirmationEmail,
  buildParentInstructionsEmail,
  buildParentReleaseNoticeEmail,
  buildParentReminderEmail,
} from "./campEmailTemplates";

// Server-only. The email outbox.
//
// An email a family is owed (payment instructions, a reminder, the confirmation) is written to
// the outbox in the SAME database transaction that creates the reason for it. Sending happens
// afterwards, can fail, and is retried with a growing delay until it works or stops making
// sense, so a Gmail hiccup, a server restart or a timeout never loses one. Each email has a
// unique key, so it is sent once however many workers run at the same time.
//
// The outbox stores which email, for which registration. The email itself is built when it is
// SENT, from the registration as it is then: a late retry never tells a family to pay for a
// reservation that has since been released, and no second copy of anyone's details is kept.

export { enqueueEmail, type OutboxKind };
export type Mailer = (message: EmailMessage) => Promise<void>;

// priority 0 is what a family needs to pay or be reassured; 2 is the nice-to-have. When the
// mailbox is close to its daily sending allowance, only priority 0 keeps going.
const POLICY: Record<OutboxKind, { priority: 0 | 1 | 2; giveUpAfterHours: number }> = {
  parent_instructions: { priority: 0, giveUpAfterHours: 36 },
  parent_confirmation: { priority: 0, giveUpAfterHours: 24 * 14 },
  parent_release: { priority: 0, giveUpAfterHours: 72 },
  parent_reminder: { priority: 1, giveUpAfterHours: 12 },
  coach_notice: { priority: 2, giveUpAfterHours: 48 },
};

const MINUTE = 60_000;
const LEASE_MINUTES = 5;
const MAX_BACKOFF_MINUTES = 30;
// After this many failures in a row (not counting a recipient the mail server rejects), a run
// stops trying: the mail server is not answering, and every further attempt would only wait.
const BREAKER_FAILURES = 3;
const DIGEST_MAX_ROWS = 25;

// Mail servers like to repeat the recipient's address in their errors; keep it out of logs and summaries.
const redactAddresses = (text: string) => text.replace(/[^\s<>@,;]+@[^\s<>,;]+/g, "<address>");

export const backoffMinutes = (failures: number) => Math.min(2 ** Math.max(failures - 1, 0), MAX_BACKOFF_MINUTES);

export function coachNoticeMode(): "digest" | "each" | "off" {
  const mode = (process.env.COACH_NOTICE_MODE ?? "digest").trim().toLowerCase();
  return mode === "each" || mode === "off" ? mode : "digest";
}
export function coachDigestMinutes(): number {
  const n = Number(process.env.COACH_DIGEST_MINUTES);
  return Number.isInteger(n) && n >= 1 && n <= 1440 ? n : 60;
}
// Gmail allows roughly 500 recipients a day from an ordinary account (about 2,000 from Google
// Workspace). The budget is a little under that.
export function dailyEmailBudget(): number {
  const n = Number(process.env.EMAIL_DAILY_BUDGET);
  return Number.isInteger(n) && n >= 10 && n <= 100_000 ? n : 400;
}

// --- writing --------------------------------------------------------------------------

// A family submitted something already reserved: send the existing instructions again, at
// most once an hour per reservation (so the form cannot be used to flood anyone's inbox).
export async function enqueueInstructionsResend(registrationId: string, now: Date = new Date()): Promise<boolean> {
  const hour = Math.floor(now.getTime() / (60 * MINUTE));
  return enqueueEmail(getPool(), "parent_instructions", registrationId, { dedupeKey: `parent_instructions:${registrationId}:resend:${hour}` });
}

// Queues the reminder for every unreported reservation whose hold ends within the next
// `parentReminderHours`. Run by the scheduled check; harmless to run any time.
export async function enqueueDueReminders(now: Date = new Date()): Promise<number> {
  const settings = await getCampSettings();
  if (settings.parentReminderHours <= 0) return 0;
  // "Pay by" is the end of the hold before the short report allowance; the reminder goes out
  // that many hours before it. Only reservations nobody has reported yet, and still held.
  const { rowCount } = await getPool().query(
    `INSERT INTO email_outbox (dedupe_key, kind, registration_id)
     SELECT 'parent_reminder:' || r.id, 'parent_reminder', r.id
       FROM registrations r
      WHERE r.status = 'pending_payment' AND r.payment_reported_at IS NULL
        AND r.hold_ends_at_initial IS NOT NULL
        AND r.hold_ends_at_initial > $1::timestamptz
        AND r.hold_ends_at_initial - make_interval(mins => $2::int + $3::int * 60) <= $1::timestamptz
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [now.toISOString(), settings.reportAllowanceMinutes, settings.parentReminderHours]
  );
  return rowCount ?? 0;
}

// --- sending --------------------------------------------------------------------------

export type ProcessSummary = {
  skippedNoEmail?: true;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
  deferred: number; // held back to protect the mailbox's daily allowance
  digests: number;
  stoppedEarly: string | null;
  sentByKind: Partial<Record<OutboxKind, number>>;
  errors: string[]; // short, no personal data
};

export type ProcessOptions = {
  // The public address of the site, for the links in the emails. Falls back to SITE_URL.
  origin?: string;
  // Only this registration's emails (used right after a request, to send them at once).
  registrationId?: string;
  now?: Date;
  send?: Mailer;
  adminEmails?: string[];
  limit?: number;
  timeBudgetMs?: number;
  coachMode?: "digest" | "each" | "off";
  coachDigestMinutes?: number;
  dailyBudget?: number;
};

type OutboxRow = {
  id: number;
  dedupe_key: string;
  kind: OutboxKind;
  registration_id: string | null;
  attempts: number;
  created_at: string;
};

const PRIORITY_SQL = `CASE kind WHEN 'parent_instructions' THEN 0 WHEN 'parent_confirmation' THEN 0 WHEN 'parent_release' THEN 0 WHEN 'parent_reminder' THEN 1 ELSE 2 END`;

async function claimNext(now: Date, registrationId: string | undefined, exclude: number[]): Promise<OutboxRow | null> {
  const { rows } = await getPool().query(
    `UPDATE email_outbox SET status = 'sending', lease_until = $1::timestamptz + make_interval(mins => $2)
      WHERE id = (
        SELECT id FROM email_outbox
         WHERE ((status = 'pending' AND next_attempt_at <= $1::timestamptz + interval '5 milliseconds')
             OR (status = 'sending' AND lease_until < $1::timestamptz))
           AND ($3::uuid IS NULL OR registration_id = $3::uuid)
           AND id <> ALL($4::bigint[])
         ORDER BY ${PRIORITY_SQL}, next_attempt_at, id
         LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, dedupe_key, kind, registration_id, attempts, created_at`,
    [now.toISOString(), LEASE_MINUTES, registrationId ?? null, exclude]
  );
  // (The few milliseconds of tolerance cover the database stamping a row a fraction of a
  // millisecond after the millisecond-rounded time this process read from its own clock.)
  return (rows[0] as OutboxRow | undefined) ?? null;
}

const finish = (ids: number[], status: "sent" | "skipped" | "failed", now: Date, note?: string) =>
  getPool().query(
    `UPDATE email_outbox SET status = $2::text, sent_at = CASE WHEN $2::text = 'sent' THEN $3::timestamptz ELSE sent_at END,
            lease_until = NULL, last_error = $4::text
      WHERE id = ANY($1::bigint[])`,
    [ids, status, now.toISOString(), note ?? null]
  );

const reschedule = (ids: number[], now: Date, afterMinutes: number, failure?: string) =>
  getPool().query(
    `UPDATE email_outbox SET status = 'pending', lease_until = NULL,
            attempts = attempts + CASE WHEN $4::text IS NULL THEN 0 ELSE 1 END,
            next_attempt_at = $2::timestamptz + make_interval(mins => $3), last_error = COALESCE($4, last_error)
      WHERE id = ANY($1::bigint[])`,
    [ids, now.toISOString(), afterMinutes, failure ?? null]
  );

// The coach's summary goes out at most once per interval, however many workers are running at
// the same moment (on opening day, dozens). The slot is claimed atomically in the database; a
// worker that does not get it leaves its rows for the next summary.
const DIGEST_SLOT = "coach_digest_slot";

async function claimDigestSlot(now: Date, intervalMinutes: number): Promise<{ claimed: true } | { claimed: false; opensAt: Date }> {
  const { rowCount } = await getPool().query(
    `INSERT INTO camp_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
       WHERE camp_settings.value::timestamptz <= $2::timestamptz - make_interval(mins => $3)`,
    [DIGEST_SLOT, now.toISOString(), intervalMinutes]
  );
  if ((rowCount ?? 0) > 0) return { claimed: true };
  const { rows } = await getPool().query(`SELECT value FROM camp_settings WHERE key = $1`, [DIGEST_SLOT]);
  const last = rows[0] ? new Date(rows[0].value as string).getTime() : now.getTime();
  return { claimed: false, opensAt: new Date(last + intervalMinutes * MINUTE) };
}
// The summary could not be sent: give the slot back so the next attempt is not held off.
const releaseDigestSlot = () => getPool().query(`DELETE FROM camp_settings WHERE key = $1`, [DIGEST_SLOT]).catch(() => {});

async function emailsSentLast24h(now: Date): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT (SELECT count(DISTINCT CASE WHEN kind = 'coach_notice' THEN 'c' || sent_at::text ELSE id::text END)
               FROM email_outbox WHERE status = 'sent' AND sent_at > $1::timestamptz - interval '24 hours')
          + (SELECT COALESCE(sum(COALESCE(array_length(string_to_array(recipients, ','), 1), 1)), 0)
               FROM alert_ledger WHERE sent_at > $1::timestamptz - interval '24 hours' AND error IS DISTINCT FROM 'superseded') AS n`,
    [now.toISOString()]
  );
  return Number(rows[0].n);
}

function skipReason(kind: OutboxKind, reg: RegistrationDetail, now: Date): string | null {
  switch (kind) {
    case "parent_instructions":
      return reg.status === "pending_payment" ? null : `no longer awaiting payment (${reg.status})`;
    case "parent_confirmation":
      return reg.status === "paid" ? null : `not paid (${reg.status})`;
    case "parent_release":
      // Only while it is still a released-for-no-report reservation: if the owner has since
      // reinstated or confirmed it, telling the family it was released would be wrong.
      return reg.status === "cancelled" && reg.releaseReason === "expired_unpaid" ? null : `no longer released for lack of a report (${reg.status})`;
    case "parent_reminder":
      if (reg.status !== "pending_payment" || reg.paymentReportedAt) return `no longer awaiting a payment report (${reg.status})`;
      if (!reg.holdExpiresAt || new Date(reg.holdExpiresAt).getTime() <= now.getTime()) return "the hold has already ended";
      return null;
    case "coach_notice":
      return reg.status === "cancelled" || reg.status === "refunded" ? `released before the notice went out (${reg.status})` : null;
  }
}

export async function processOutbox(opts: ProcessOptions = {}): Promise<ProcessSummary> {
  const summary: ProcessSummary = { sent: 0, skipped: 0, retried: 0, failed: 0, deferred: 0, digests: 0, stoppedEarly: null, sentByKind: {}, errors: [] };
  const countSent = (kind: OutboxKind, n = 1) => { summary.sentByKind[kind] = (summary.sentByKind[kind] ?? 0) + n; };
  const send: Mailer | null = opts.send ?? (isEmailConfigured() ? sendEmail : null);
  if (!send) {
    summary.skippedNoEmail = true;
    return summary;
  }
  const now = opts.now ?? new Date();
  const origin = (opts.origin ?? process.env.SITE_URL ?? "").replace(/\/+$/, "");
  if (!origin) {
    // Every link in these emails starts with the site's address; without one they would be broken.
    summary.stoppedEarly = "SITE_URL is not set, so the emails would have no working links";
    return summary;
  }
  const limit = opts.limit ?? 25;
  const deadline = Date.now() + (opts.timeBudgetMs ?? 12_000);
  const mode = opts.coachMode ?? coachNoticeMode();
  const digestMinutes = opts.coachDigestMinutes ?? coachDigestMinutes();
  const budget = opts.dailyBudget ?? dailyEmailBudget();
  const lowPriorityCutoff = Math.floor(budget * 0.8);
  const recipients = opts.adminEmails ?? adminAlertRecipients();

  let sentToday = await emailsSentLast24h(now);
  let handled = 0;
  let consecutiveFailures = 0;
  const exclude: number[] = [];

  const dashboardUrl = () => `${origin}/admin/camp-rosters`;
  const statusUrl = (id: string) => `${origin}/camp-registration/${makeAccessToken(id)}`;

  const recordFailure = async (row: OutboxRow, err: unknown) => {
    const raw = classifySendError(err);
    const failure = { ...raw, summary: redactAddresses(raw.summary) };
    const ageHours = (now.getTime() - new Date(row.created_at).getTime()) / (60 * MINUTE);
    const giveUp = failure.permanent || ageHours >= POLICY[row.kind].giveUpAfterHours;
    const note = (failure.permanent ? "recipient rejected: " : "") + failure.summary;
    if (giveUp) {
      await finish([row.id], "failed", now, note);
      summary.failed++;
    } else {
      await reschedule([row.id], now, backoffMinutes(row.attempts + 1), note);
      summary.retried++;
    }
    if (summary.errors.length < 5) summary.errors.push(failure.summary.slice(0, 120));
    if (failure.permanent) return false;
    consecutiveFailures++;
    return true;
  };

  while (handled < limit && Date.now() < deadline) {
    if (consecutiveFailures >= BREAKER_FAILURES) {
      summary.stoppedEarly = "the mail server is not accepting messages";
      break;
    }
    const row = await claimNext(now, opts.registrationId, exclude);
    if (!row) break;
    const policy = POLICY[row.kind];

    // Hold back the nice-to-haves when the mailbox is nearly out of daily allowance.
    if (policy.priority > 0 && sentToday >= lowPriorityCutoff) {
      await reschedule([row.id], now, 30);
      exclude.push(row.id);
      summary.deferred++;
      continue;
    }

    const registration = row.registration_id ? await getRegistrationSnapshot(row.registration_id) : null;
    if (!registration) {
      await finish([row.id], "skipped", now, "registration not found");
      summary.skipped++;
      continue;
    }
    const why = skipReason(row.kind, registration, now);
    if (why) {
      await finish([row.id], "skipped", now, why);
      summary.skipped++;
      continue;
    }

    handled++;
    try {
      if (row.kind === "coach_notice") {
        if (mode === "off") {
          await finish([row.id], "skipped", now, "coach notices are switched off");
          summary.skipped++;
          handled--;
          continue;
        }
        if (mode === "each") {
          const email = buildCoachNotificationEmail(registration, dashboardUrl());
          await send({ to: recipients.join(", "), ...email });
          await finish([row.id], "sent", now);
          sentToday += recipients.length;
          summary.sent++;
          countSent("coach_notice");
          consecutiveFailures = 0;
          continue;
        }
        // Digest: one email for everything waiting, but no more often than the interval.
        const slot = await claimDigestSlot(now, digestMinutes);
        if (!slot.claimed) {
          await reschedule([row.id], now, Math.max(Math.ceil((slot.opensAt.getTime() - now.getTime()) / MINUTE), 1));
          exclude.push(row.id);
          handled--;
          summary.deferred++;
          continue;
        }
        const more = await getPool().query(
          `UPDATE email_outbox SET status = 'sending', lease_until = $1::timestamptz + make_interval(mins => $2)
            WHERE id IN (SELECT id FROM email_outbox WHERE kind = 'coach_notice' AND status = 'pending'
                           AND next_attempt_at <= $1::timestamptz AND id <> $3 ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED)
            RETURNING id, registration_id`,
          [now.toISOString(), LEASE_MINUTES, row.id]
        );
        const members = [{ id: row.id, registration_id: row.registration_id! }, ...(more.rows as { id: number; registration_id: string }[])];
        const details: RegistrationDetail[] = [];
        const ids: number[] = [];
        const stale: number[] = [];
        for (const member of members) {
          const detail = await getRegistrationSnapshot(member.registration_id);
          if (detail && detail.status !== "cancelled" && detail.status !== "refunded") {
            details.push(detail);
            ids.push(member.id);
          } else {
            stale.push(member.id);
          }
        }
        if (stale.length > 0) await finish(stale, "skipped", now, "released before the summary went out");
        if (details.length === 0) {
          await releaseDigestSlot();
          handled--;
          continue;
        }
        try {
          const shown = details.slice(0, DIGEST_MAX_ROWS);
          const email = buildCoachDigestEmail(shown, { dashboardUrl: dashboardUrl(), omitted: details.length - shown.length });
          await send({ to: recipients.join(", "), ...email });
        } catch (err) {
          await releaseDigestSlot();
          await reschedule(ids.filter((id) => id !== row.id), now, 1);
          await recordFailure(row, err);
          continue;
        }
        await finish(ids, "sent", now);
        sentToday += recipients.length;
        summary.sent += ids.length;
        countSent("coach_notice", ids.length);
        summary.digests++;
        consecutiveFailures = 0;
        continue;
      }

      // The parent's emails.
      let email: { subject: string; html: string; text: string };
      if (row.kind === "parent_confirmation") {
        email = buildParentConfirmationEmail(registration);
      } else if (row.kind === "parent_release") {
        email = buildParentReleaseNoticeEmail(registration);
      } else {
        const payByAt = (await getPayByAt(registration.id)) ?? now.toISOString();
        const build = row.kind === "parent_reminder" ? buildParentReminderEmail : buildParentInstructionsEmail;
        email = build(registration, { statusUrl: statusUrl(registration.id), payByAt });
      }
      await send({ to: registration.email, ...email });
      await finish([row.id], "sent", now);
      sentToday += 1;
      summary.sent++;
      countSent(row.kind);
      consecutiveFailures = 0;
    } catch (err) {
      await recordFailure(row, err);
    }
  }
  return summary;
}

// --- watching -------------------------------------------------------------------------

export type EmailHealth = {
  configured: boolean;
  waiting: number; // not sent yet and still being retried
  oldestWaitingMinutes: number | null;
  failed: number; // gave up in the last 14 days
  failedItems: { reference: string; parentName: string; primaryPhone: string; kind: OutboxKind; error: string; createdAt: string }[];
  sentLast24h: number;
  dailyBudget: number;
};

export async function getEmailHealth(now: Date = new Date()): Promise<EmailHealth> {
  const pool = getPool();
  // The coach's summary is held back on purpose, so it is not "waiting" in the sense that matters.
  const waiting = await pool.query(
    `SELECT count(*)::int AS n, min(created_at) AS oldest FROM email_outbox
      WHERE status IN ('pending', 'sending') AND kind <> 'coach_notice'`
  );
  const failed = await pool.query(
    `SELECT o.kind, o.last_error, o.created_at, r.reference_code, r.parent_name, r.primary_phone
       FROM email_outbox o JOIN registrations r ON r.id = o.registration_id
      WHERE o.status = 'failed' AND o.created_at > $1::timestamptz - interval '14 days'
      ORDER BY o.created_at DESC LIMIT 20`,
    [now.toISOString()]
  );
  const oldest = waiting.rows[0].oldest ? new Date(waiting.rows[0].oldest as string).getTime() : null;
  return {
    configured: isEmailConfigured(),
    waiting: Number(waiting.rows[0].n),
    oldestWaitingMinutes: oldest === null ? null : Math.max(Math.floor((now.getTime() - oldest) / MINUTE), 0),
    failed: failed.rows.length,
    failedItems: failed.rows.slice(0, 5).map((r) => ({
      reference: r.reference_code as string,
      parentName: r.parent_name as string,
      primaryPhone: r.primary_phone as string,
      kind: r.kind as OutboxKind,
      error: String(r.last_error ?? "").slice(0, 200),
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    sentLast24h: await emailsSentLast24h(now),
    dailyBudget: dailyEmailBudget(),
  };
}
