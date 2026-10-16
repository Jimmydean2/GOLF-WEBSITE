import { getPool } from "./db";
import {
  getCampSettings,
  getPaymentQueue,
    releaseExpiredReservations,
  type QueueItem,
} from "./campDb";
import type { CampSettings } from "./campSettings";
import { business } from "./content";
import { isEmailConfigured, sendEmail } from "./email";
import { buildAdminAlertEmail, type AdminAlertSubject, type AdminAlertTier } from "./campEmailTemplates";
import { logError } from "./safeLog";

// Server-only. The administrators' alerts. (The parents' emails, including the notice that an
// unreported reservation was released, go through the outbox: see outbox.ts.)
//
// Nothing here changes a registration, except that dispatchDueAlerts first runs the
// automatic 12-hour release. An overdue reported payment is NEVER released by this code:
// it only tells the administrators, louder and more often the longer it waits.
//
// Every alert is written to alert_ledger BEFORE it is sent (a unique key per alert), so two
// runs at once, a retry, or a cron overlap can never send the same alert twice. If sending
// fails, the ledger row is removed so the next run tries again.

export type Mailer = (message: { to: string; subject: string; html: string; text: string }) => Promise<void>;

export function adminAlertRecipients(): string[] {
  const configured = (process.env.ADMIN_ALERT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [business.email];
}

const HOUR = 3_600_000;
const SEVERITY: Record<AdminAlertTier, number> = { reported: 0, due_soon: 1, overdue: 2, reminder: 3, escalated: 4, critical: 5 };

export type PlannedAlert = { key: string; tier: AdminAlertTier };

// The alerts that should exist by now for one reported payment, as ledger keys. Pure, so
// the schedule can be tested exactly. Keys include the review time, so an extension starts
// a fresh set. Keys already in the ledger are skipped by the dispatcher.
//
//   before the review time:   due_soon (once, in the last few hours)
//   at the review time:       overdue (once)
//   every 6 hours overdue:    reminder (the current bucket only; a long gap does not flood)
//   24 hours overdue:         escalated (once)
//   72 hours overdue:         critical, repeating every 6 hours instead of reminders
export function planAlerts(registrationId: string, reviewDueAtMs: number, nowMs: number, s: CampSettings): PlannedAlert[] {
  const planned: PlannedAlert[] = [];
  const dueEpoch = Math.floor(reviewDueAtMs / 1000);
  if (nowMs < reviewDueAtMs) {
    if (nowMs >= reviewDueAtMs - s.alertDueSoonHours * HOUR) {
      planned.push({ tier: "due_soon", key: `due_soon:${registrationId}:${dueEpoch}` });
    }
    return planned;
  }
  const over = nowMs - reviewDueAtMs;
  planned.push({ tier: "overdue", key: `overdue:${registrationId}:${dueEpoch}` });
  if (over >= s.alertEscalatedAfterHours * HOUR) {
    planned.push({ tier: "escalated", key: `escalated:${registrationId}:${dueEpoch}` });
  }
  if (over >= s.alertCriticalAfterHours * HOUR) {
    const bucket = Math.floor((over - s.alertCriticalAfterHours * HOUR) / (s.alertReminderHours * HOUR));
    planned.push({ tier: "critical", key: `critical:${registrationId}:${dueEpoch}:${bucket}` });
  } else {
    const bucket = Math.floor(over / (s.alertReminderHours * HOUR));
    if (bucket >= 1) planned.push({ tier: "reminder", key: `reminder:${registrationId}:${dueEpoch}:${bucket}` });
  }
  return planned;
}

// Claims a ledger key. True means this caller owns sending it.
async function claim(key: string, kind: string, registrationId: string, recipients: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `INSERT INTO alert_ledger (alert_key, kind, registration_id, recipients)
     VALUES ($1, $2, $3, $4) ON CONFLICT (alert_key) DO NOTHING`,
    [key, kind, registrationId, recipients]
  );
  return (rowCount ?? 0) > 0;
}

async function markSent(keys: string[], error?: string): Promise<void> {
  if (keys.length === 0) return;
  await getPool().query(`UPDATE alert_ledger SET sent_at = now(), error = $2 WHERE alert_key = ANY($1::text[])`, [keys, error ?? null]);
}

async function unclaim(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await getPool().query(`DELETE FROM alert_ledger WHERE alert_key = ANY($1::text[])`, [keys]);
}

function subjectOf(item: QueueItem): AdminAlertSubject {
  return {
    reference: item.reference,
    parentName: item.parentName,
    email: item.email,
    primaryPhone: item.primaryPhone,
    childNames: item.childNames,
    weekIds: item.weekIds,
    heldSpots: item.heldSpots,
    amountDueCents: item.amountDueCents,
    paymentReportedAt: item.paymentReportedAt,
    reviewDueAt: item.reviewDueAt,
  };
}

export type DispatchSummary = {
  skipped?: "email_not_configured";
  released: string[]; // registrations released by the 12-hour rule in this run
  alerts: { key: string; tier: AdminAlertTier; registrationId: string }[];
  failures: number;
};

// Runs the automatic 12-hour release, then sends whatever administrator alerts are due and
// have not been sent. Safe to call as often as you like, from a
// scheduled job, from site traffic, or by hand.
export async function dispatchDueAlerts(opts: {
  dashboardUrl: string;
  now?: Date;
  send?: Mailer;
  adminEmails?: string[];
}): Promise<DispatchSummary> {
  const now = opts.now;
  const summary: DispatchSummary = { released: [], alerts: [], failures: 0 };
  summary.released = (await releaseExpiredReservations(now)).releasedRegistrationIds;

  const send: Mailer | null = opts.send ?? (isEmailConfigured() ? sendEmail : null);
  if (!send) {
    summary.skipped = "email_not_configured";
    return summary;
  }

  // A claim that was never marked sent and is more than 10 minutes old means the run that made
  // it died between claiming and sending (a serverless timeout, say). Release it so it is
  // retried instead of being lost. (Always the database clock: this is about real elapsed time.)
  await getPool().query(`DELETE FROM alert_ledger WHERE sent_at IS NULL AND created_at < now() - interval '10 minutes'`);

  const settings = await getCampSettings();
  const recipients = opts.adminEmails ?? adminAlertRecipients();
  const to = recipients.join(", ");
  const queue = await getPaymentQueue(now);
  const nowMs = new Date(queue.generatedAt).getTime();

  const alreadyAlerted = new Set<string>(
    (
      await getPool().query(`SELECT DISTINCT registration_id FROM alert_ledger WHERE registration_id = ANY($1::uuid[])`, [
        queue.reported.map((i) => i.id),
      ])
    ).rows.map((r) => r.registration_id as string)
  );

  // 1. Administrator alerts for reported payments.
  for (const item of queue.reported) {
    if (!item.reviewDueAt) continue;
    const dueMs = new Date(item.reviewDueAt).getTime();
    const planned = planAlerts(item.id, dueMs, nowMs, settings);
    // The immediate "payment reported" email is sent when the parent taps the button. If the mail
    // server was unreachable at that moment, the administrators were never told about this payment
    // at all (no alert of any kind is on record), so the next check tells them.
    if (planned.length === 0 && !alreadyAlerted.has(item.id)) planned.push({ tier: "reported", key: `reported:${item.id}` });
    const claimed: PlannedAlert[] = [];
    for (const p of planned) {
      if (await claim(p.key, p.tier, item.id, to)) claimed.push(p);
    }
    if (claimed.length === 0) continue;
    // One email for the most serious newly-due alert; the others are recorded as superseded.
    const top = claimed.reduce((a, b) => (SEVERITY[b.tier] > SEVERITY[a.tier] ? b : a));
    const lower = claimed.filter((c) => c.key !== top.key).map((c) => c.key);
    try {
      const email = buildAdminAlertEmail(top.tier, subjectOf(item), {
        hoursOverdue: Math.max(Math.floor((nowMs - dueMs) / HOUR), 0),
        hoursUntilDue: Math.max(Math.ceil((dueMs - nowMs) / HOUR), 0),
        dashboardUrl: opts.dashboardUrl,
      });
      await send({ to, ...email });
      await markSent([top.key]);
      await markSent(lower, "superseded");
      summary.alerts.push({ key: top.key, tier: top.tier, registrationId: item.id });
    } catch (err) {
      logError("Sending an administrator alert failed:", err);
      await unclaim(claimed.map((c) => c.key));
      summary.failures++;
    }
  }

  return summary;
}

// The immediate "a parent reported payment" email to the administrators (sent from the
// report route). Recorded in the same ledger, so it is never sent twice.
export async function notifyPaymentReported(
  registrationId: string,
  opts: { dashboardUrl: string; send?: Mailer; adminEmails?: string[] }
): Promise<boolean> {
  const send: Mailer | null = opts.send ?? (isEmailConfigured() ? sendEmail : null);
  if (!send) return false;
  const queue = await getPaymentQueue();
  const item = queue.reported.find((i) => i.id === registrationId);
  if (!item) return false;
  const to = (opts.adminEmails ?? adminAlertRecipients()).join(", ");
  const key = `reported:${registrationId}`;
  if (!(await claim(key, "reported", registrationId, to))) return false;
  try {
    const email = buildAdminAlertEmail("reported", subjectOf(item), {
      hoursOverdue: 0,
      hoursUntilDue: 0,
      dashboardUrl: opts.dashboardUrl,
    });
    await send({ to, ...email });
    await markSent([key]);
    return true;
  } catch (err) {
    logError("Sending the payment-reported alert failed:", err);
    await unclaim([key]);
    return false;
  }
}
