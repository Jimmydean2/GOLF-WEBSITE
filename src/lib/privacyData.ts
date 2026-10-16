import type { PoolClient } from "pg";
import { getPool } from "./db";
import { cancelRegistration, getRegistrationSnapshot } from "./campDb";
import { RETENTION_DAYS } from "./privacy";
import { labelForWeekId } from "./season";
import { purgeFinishedWaitlist, waitlistEntriesForEmail } from "./waitlist";

// Server-only. A family's rights over their own information, and the clean-up after the season
// (Quebec's Law 25). Three things:
//
//   exportFamilyData  everything the system holds about one registration, for a family that asks
//   eraseFamily       erase one family's personal details now, at their request
//   previewRetention / applyRetention
//                     the clean-up of families whose camp weeks ended long enough ago
//
// What "erasing" means. The child's name, date of birth, age and health information, the
// emergency contact, the parent's phone numbers and email address are overwritten, and so are the
// owner's free-text notes on the payment. What stays is the accounting record the tax rules
// require: the reference, the amounts, the dates, the bank confirmation number, and (unless the
// owner chooses otherwise) the parent's name as payer. Weeks and spots stay, so past capacity
// counts remain true. Nothing here ever changes a registration's status, except that erasing a
// family that still holds spots releases them first (so nobody keeps a place for an erased family).
// Every erasure is written to the audit log; the log holds no personal details of its own.

export const ERASED_CHILD = "Erased";
export const ERASED_PARENT = "Erased family";


// --- exporting ---------------------------------------------------------------------------

export type FamilyExport = {
  exportedAt: string;
  note: string;
  registration: {
    reference: string;
    language: string;
    status: string;
    parentName: string;
    email: string;
    primaryPhone: string;
    secondaryPhone: string;
    emergencyContact: { name: string; relationship: string; phone: string };
    weeks: string[];
    totalBeforeTaxCents: number;
    amountDueCents: number;
    createdAt: string;
    paymentReportedAt: string | null;
    paidAt: string | null;
    depositAt: string | null;
    personalDetailsErasedAt: string | null;
  };
  consent: { privacyNoticeVersion: string | null; privacyConsent: boolean; healthInformationConsent: boolean; recordedAt: string | null };
  children: { name: string; dateOfBirth: string; age: string; healthInformation: string }[];
  emailsSent: { kind: string; status: string; sentAt: string | null }[];
  /** Waiting-list requests made with the same email address (they hold no place). */
  waitingList: { week: string; joinedAt: string; placesWanted: number; status: string }[];
  activity: { action: string; at: string }[];
};

export async function exportFamilyData(registrationId: string): Promise<FamilyExport | null> {
  const registration = await getRegistrationSnapshot(registrationId);
  if (!registration) return null;
  const pool = getPool();
  const meta = (
    await pool.query(
      `SELECT total_price_cents, health_consent_accepted, consent_accepted FROM registrations WHERE id = $1`,
      [registrationId]
    )
  ).rows[0];
  const emails = await pool.query(`SELECT kind, status, sent_at FROM email_outbox WHERE registration_id = $1 AND kind <> 'coach_notice' ORDER BY id`, [registrationId]);
  // Only what happened and when. The owner's free-text notes are internal and are not exported.
  const audit = await pool.query(`SELECT action, created_at FROM admin_audit_log WHERE target_id = $1 ORDER BY created_at, id`, [registrationId]);
  const waiting = await waitlistEntriesForEmail(pool, registration.email);
  return {
    exportedAt: new Date().toISOString(),
    note: "Everything this system holds about this registration. Internal notes the owner wrote are not included.",
    registration: {
      reference: registration.reference,
      language: registration.language,
      status: registration.status,
      parentName: registration.parentName,
      email: registration.email,
      primaryPhone: registration.primaryPhone,
      secondaryPhone: registration.secondaryPhone,
      emergencyContact: { name: registration.emergencyName, relationship: registration.emergencyRelationship, phone: registration.emergencyPhone },
      weeks: registration.allWeekIds.map((id) => labelForWeekId(id, registration.language)),
      totalBeforeTaxCents: meta.total_price_cents as number,
      amountDueCents: registration.amountDueCents,
      createdAt: registration.createdAt,
      paymentReportedAt: registration.paymentReportedAt,
      paidAt: registration.paidAt,
      depositAt: registration.depositAt,
      personalDetailsErasedAt: registration.anonymizedAt,
    },
    consent: {
      privacyNoticeVersion: registration.consentVersion,
      privacyConsent: Boolean(meta.consent_accepted),
      healthInformationConsent: Boolean(meta.health_consent_accepted),
      recordedAt: registration.consentRecordedAt,
    },
    children: registration.children.map((c) => ({ name: c.fullName, dateOfBirth: c.dateOfBirth, age: c.age, healthInformation: c.healthInfo })),
    waitingList: waiting.map((w) => ({ week: labelForWeekId(w.weekId, registration.language), joinedAt: w.joinedAt, placesWanted: w.placesWanted, status: w.status })),
    emailsSent: emails.rows.map((r) => ({ kind: r.kind as string, status: r.status as string, sentAt: r.sent_at ? new Date(r.sent_at as string).toISOString() : null })),
    activity: audit.rows.map((r) => ({ action: r.action as string, at: new Date(r.created_at as string).toISOString() })),
  };
}

// --- erasing -----------------------------------------------------------------------------

type Actor = "owner" | "system";

// Overwrites the personal details of one registration. The caller holds the transaction.
async function anonymizeTx(client: PoolClient, registrationId: string, opts: { removePayerName: boolean; actor: Actor; why: string }): Promise<boolean> {
  const locked = await client.query(`SELECT status, anonymized_at, email FROM registrations WHERE id = $1 FOR UPDATE`, [registrationId]);
  if (locked.rows.length === 0 || locked.rows[0].anonymized_at) return false;
  const previousStatus = locked.rows[0].status as string;
  // A waiting-list request made with the same email address goes too (it is theirs as well).
  await client.query(`DELETE FROM waitlist_entries WHERE email_key = lower(btrim($1))`, [locked.rows[0].email]);

  await client.query(
    `UPDATE registrations
        SET email = 'erased+' || id::text || '@invalid.example',
            primary_phone = '', secondary_phone = '',
            emergency_name = '', emergency_relationship = '', emergency_phone = '',
            parent_name = CASE WHEN $2 THEN $3 ELSE parent_name END,
            verification_note = NULL, cancelled_reason = NULL,
            anonymized_at = now()
      WHERE id = $1`,
    [registrationId, opts.removePayerName, ERASED_PARENT]
  );
  await client.query(`UPDATE children SET full_name = $2, date_of_birth = NULL, age = '', health_info = '' WHERE registration_id = $1`, [registrationId, ERASED_CHILD]);
  // Nothing may be sent to an erased family, and nothing of theirs is kept in the queues.
  await client.query(`DELETE FROM email_outbox WHERE registration_id = $1`, [registrationId]);
  await client.query(`DELETE FROM contact_strikes WHERE registration_id = $1`, [registrationId]);
  await client.query(`DELETE FROM admin_notes WHERE registration_id = $1`, [registrationId]);
  await client.query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details, actor) VALUES ('erase_registration', 'registration', $1, $2, $3)`,
    [registrationId, JSON.stringify({ why: opts.why, previousStatus, payerNameRemoved: opts.removePayerName }), opts.actor]
  );
  return true;
}

export type EraseResult =
  | { ok: true; alreadyErased: boolean; releasedWeekIds: string[] }
  | { ok: false; reason: "not_found" };

// The owner erases one family's personal details now (a family asked, or a duplicate or test
// registration should go). A registration that still holds spots is cancelled first, so the
// places go back to other families; the family is NOT emailed (their contact details are about to
// be erased).
export async function eraseFamily(registrationId: string, opts: { removePayerName?: boolean; why?: string } = {}): Promise<EraseResult> {
  const registration = await getRegistrationSnapshot(registrationId);
  if (!registration) return { ok: false, reason: "not_found" };
  if (registration.anonymizedAt) return { ok: true, alreadyErased: true, releasedWeekIds: [] };

  let releasedWeekIds: string[] = [];
  if (registration.status === "pending_payment" || registration.status === "payment_reported" || registration.status === "paid") {
    const cancelled = await cancelRegistration(registrationId, "Personal details erased", { releaseReason: "owner_cancelled", notifyParent: false });
    releasedWeekIds = cancelled.releasedWeekIds;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await anonymizeTx(client, registrationId, { removePayerName: opts.removePayerName === true, actor: "owner", why: opts.why?.trim() || "erased on request" });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, alreadyErased: false, releasedWeekIds };
}

// --- the clean-up after the season ---------------------------------------------------------

export type RetentionPlan = {
  retentionDays: number;
  today: string;
  /** Registrations whose last camp week ended at least retentionDays ago and that can be cleaned up now. */
  due: { id: string; reference: string; status: string; lastWeekEnded: string }[];
  /** Past the date, but a payment is still unresolved: the owner must decide first. Never erased automatically. */
  blocked: { id: string; reference: string; status: string; lastWeekEnded: string }[];
};

function montrealToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function previewRetention(now: Date = new Date(), retentionDays: number = RETENTION_DAYS): Promise<RetentionPlan> {
  const today = montrealToday(now);
  const { rows } = await getPool().query(
    `SELECT r.id, r.reference_code, r.status, to_char(max(w.end_date), 'YYYY-MM-DD') AS last_end
       FROM registrations r
       JOIN registration_spots s ON s.registration_id = r.id
       JOIN camp_weeks w ON w.id = s.week_id
      WHERE r.anonymized_at IS NULL
      GROUP BY r.id
     HAVING max(w.end_date) + $1::int <= $2::date
      ORDER BY max(w.end_date), r.created_at`,
    [retentionDays, today]
  );
  const plan: RetentionPlan = { retentionDays, today, due: [], blocked: [] };
  for (const r of rows) {
    const item = { id: r.id as string, reference: r.reference_code as string, status: r.status as string, lastWeekEnded: r.last_end as string };
    (item.status === "pending_payment" || item.status === "payment_reported" ? plan.blocked : plan.due).push(item);
  }
  return plan;
}

export type RetentionResult = { anonymized: number; blocked: number; purgedLoginRecords: number; purgedSessions: number; purgedWaitlist: number };

// Cleans up every family that is due. The parent's name is kept as payer (the accounting
// record); everything else personal is overwritten. Also forgets old administrator sign-in
// attempts and expired sessions (they hold internet addresses). Safe to run again.
export async function applyRetention(now: Date = new Date(), opts: { retentionDays?: number; limit?: number } = {}): Promise<RetentionResult> {
  const plan = await previewRetention(now, opts.retentionDays ?? RETENTION_DAYS);
  const pool = getPool();
  let anonymized = 0;
  for (const item of plan.due.slice(0, opts.limit ?? 500)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (await anonymizeTx(client, item.id, { removePayerName: false, actor: "system", why: `retention: last camp week ended ${item.lastWeekEnded}` })) anonymized++;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  const logins = await pool.query(`DELETE FROM admin_login_attempts WHERE created_at < $1::timestamptz - interval '30 days'`, [now.toISOString()]);
  const sessions = await pool.query(
    `DELETE FROM admin_sessions WHERE COALESCE(revoked_at, expires_at) < $1::timestamptz - interval '30 days'`,
    [now.toISOString()]
  );
  // Waiting-list requests are erased once their camp week has passed (as the privacy notice says).
  const purgedWaitlist = await purgeFinishedWaitlist(plan.today);
  return { anonymized, blocked: plan.blocked.length, purgedLoginRecords: logins.rowCount ?? 0, purgedSessions: sessions.rowCount ?? 0, purgedWaitlist };
}

// How many families are waiting for the clean-up, for the dashboard.
export async function retentionDueCount(now: Date = new Date()): Promise<{ due: number; blocked: number }> {
  const plan = await previewRetention(now);
  return { due: plan.due.length, blocked: plan.blocked.length };
}

