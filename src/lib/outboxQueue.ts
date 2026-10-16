import type { Pool, PoolClient } from "pg";

// Server-only. The one write the rest of the application needs from the email outbox: record
// that an email is owed. Kept apart from outbox.ts (which builds and sends the emails and so
// depends on the registration code) so the registration code can call it without a cycle.

export type OutboxKind =
  | "parent_instructions"
  | "parent_confirmation"
  | "parent_reminder"
  | "parent_release"
  | "parent_cancellation"
  | "coach_notice";

// Idempotent: the same key is only ever stored once. Call it inside the transaction that
// creates the reason for the email, so the two succeed or fail together.
export async function enqueueEmail(
  client: Pool | PoolClient,
  kind: OutboxKind,
  registrationId: string,
  opts: { dedupeKey?: string } = {}
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO email_outbox (dedupe_key, kind, registration_id) VALUES ($1, $2, $3)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [opts.dedupeKey ?? `${kind}:${registrationId}`, kind, registrationId]
  );
  return (rowCount ?? 0) > 0;
}
