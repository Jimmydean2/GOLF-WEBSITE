import { getPool } from "./db";
import { releaseExpiredReservations } from "./campDb";
import { dispatchDueAlerts, type Mailer } from "./alerts";
import { enqueueDueReminders, processOutbox } from "./outbox";
import { logError } from "./safeLog";

// Server-only. The scheduled check: the one thing that has to happen on a clock rather than
// when someone clicks.
//
// What it does, in order:
//   1. Releases reservations whose 12-hour hold ended with NO payment report. (Capacity is
//      already correct without this, because every page that shows or uses capacity releases
//      those first. Running it here makes the release notice go out on time.)
//   2. Queues the "your spot is released soon" reminder for families who still have to act.
//   3. Sends the administrators' alerts for reported payments awaiting verification, and the
//      parents' release notices.
//   4. Sends every email waiting in the outbox (retries included).
//
// What it NEVER does: release, confirm or change a payment that a parent has reported. An
// overdue reported payment only produces louder alerts.
//
// It can be started by a scheduler (source "cron"), by site traffic when no scheduler is
// running (source "traffic"), or by the administrator opening the dashboard ("manual"). It is
// safe to run any number of times, even at once: every step claims its work in the database
// first, so nothing is done or sent twice.

export type RunSource = "cron" | "traffic" | "manual";

export type ScheduledCheckSummary = {
  ok: boolean;
  source: RunSource;
  skipped?: "already_running";
  released: number;
  remindersQueued: number;
  alertsSent: number;
  parentNotices: number;
  emails: { sent: number; skipped: number; retried: number; failed: number; deferred: number; digests: number; stoppedEarly: string | null };
  failures: number;
  noEmailConfigured: boolean;
  error?: string;
  durationMs: number;
};

const LEASE_SECONDS = 150;
const LEASE_KEY = "scheduled_check_lease";
const TRAFFIC_MIN_GAP_MINUTES = 5;

const emptySummary = (source: RunSource): ScheduledCheckSummary => ({
  ok: true,
  source,
  released: 0,
  remindersQueued: 0,
  alertsSent: 0,
  parentNotices: 0,
  emails: { sent: 0, skipped: 0, retried: 0, failed: 0, deferred: 0, digests: 0, stoppedEarly: null },
  failures: 0,
  noEmailConfigured: false,
  durationMs: 0,
});

// Only one run at a time does the work. The lease is a row, not a database session lock, so it
// also works through a connection pooler; if a run dies, the lease simply runs out.
async function claimLease(): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `INSERT INTO camp_settings (key, value) VALUES ($1, (now() + make_interval(secs => $2))::text)
     ON CONFLICT (key) DO UPDATE SET value = (now() + make_interval(secs => $2))::text, updated_at = now()
       WHERE camp_settings.value::timestamptz < now()`,
    [LEASE_KEY, LEASE_SECONDS]
  );
  return (rowCount ?? 0) > 0;
}
const releaseLease = () =>
  getPool().query(`UPDATE camp_settings SET value = now()::text, updated_at = now() WHERE key = $1`, [LEASE_KEY]).catch(() => {});

export type ScheduledCheckOptions = {
  source: RunSource;
  origin: string;
  now?: Date; // tests: simulated time
  send?: Mailer;
  adminEmails?: string[];
  timeBudgetMs?: number;
  maxEmails?: number;
};

export async function runScheduledCheck(opts: ScheduledCheckOptions): Promise<ScheduledCheckSummary> {
  const started = Date.now();
  const summary = emptySummary(opts.source);
  if (!(await claimLease())) {
    return { ...summary, skipped: "already_running", durationMs: Date.now() - started };
  }
  const pool = getPool();
  let runId: number | null = null;
  try {
    runId = Number((await pool.query(`INSERT INTO job_runs (source) VALUES ($1) RETURNING id`, [opts.source])).rows[0].id);
    const dashboardUrl = `${opts.origin.replace(/\/+$/, "")}/admin/camp-rosters`;

    summary.released = (await releaseExpiredReservations(opts.now)).releasedRegistrationIds.length;
    summary.remindersQueued = await enqueueDueReminders(opts.now);
    const alerts = await dispatchDueAlerts({ dashboardUrl, now: opts.now, send: opts.send, adminEmails: opts.adminEmails });
    summary.alertsSent = alerts.alerts.length;
    summary.failures += alerts.failures;
    summary.noEmailConfigured = alerts.skipped === "email_not_configured";

    const left = Math.max((opts.timeBudgetMs ?? 25_000) - (Date.now() - started), 2_000);
    const sent = await processOutbox({
      origin: opts.origin,
      now: opts.now,
      send: opts.send,
      adminEmails: opts.adminEmails,
      timeBudgetMs: left,
      limit: opts.maxEmails ?? 100,
    });
    summary.emails = {
      sent: sent.sent, skipped: sent.skipped, retried: sent.retried, failed: sent.failed,
      deferred: sent.deferred, digests: sent.digests, stoppedEarly: sent.stoppedEarly,
    };
    summary.parentNotices = sent.sentByKind.parent_release ?? 0;
    summary.failures += sent.retried + sent.failed;
    summary.durationMs = Date.now() - started;

    await pool.query(`UPDATE job_runs SET finished_at = now(), ok = true, summary = $2 WHERE id = $1`, [runId, JSON.stringify(summary)]);
    // Housekeeping: a month of history is plenty.
    await pool.query(`DELETE FROM job_runs WHERE started_at < now() - interval '30 days'`).catch(() => {});
    return summary;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    logError("Scheduled check failed:", err);
    summary.ok = false;
    summary.error = message;
    summary.durationMs = Date.now() - started;
    if (runId !== null) {
      await pool.query(`UPDATE job_runs SET finished_at = now(), ok = false, error = $2, summary = $3 WHERE id = $1`, [runId, message, JSON.stringify(summary)]).catch(() => {});
    }
    return summary;
  } finally {
    await releaseLease();
  }
}

// The fallback for when no scheduler is running: any visit that calls this starts a check, but
// only if none has started in the last five minutes. Many visitors at once start one.
export async function maybeRunFromTraffic(
  origin: string,
  opts: Omit<ScheduledCheckOptions, "source" | "origin"> & { source?: Exclude<RunSource, "cron"> } = {}
): Promise<ScheduledCheckSummary | null> {
  const recent = await getPool().query(
    `SELECT 1 FROM job_runs WHERE started_at > now() - make_interval(mins => $1) LIMIT 1`,
    [TRAFFIC_MIN_GAP_MINUTES]
  );
  if ((recent.rowCount ?? 0) > 0) return null;
  const summary = await runScheduledCheck({ ...opts, source: opts.source ?? "traffic", origin });
  return summary.skipped ? null : summary;
}

// --- watching -------------------------------------------------------------------------

export type SchedulerHealth = {
  status: "never" | "ok" | "stale";
  lastRunAt: string | null;
  lastRunSource: RunSource | null;
  lastRunOk: boolean | null;
  lastRunError: string | null;
  minutesSinceLastRun: number | null;
  // A real scheduler (not just site visits) has been running.
  lastCronAt: string | null;
  minutesSinceLastCron: number | null;
  runsLastHour: number;
};

export const STALE_AFTER_MINUTES = 20;

export async function getSchedulerHealth(now: Date = new Date()): Promise<SchedulerHealth> {
  const pool = getPool();
  const last = await pool.query(`SELECT source, started_at, ok, error FROM job_runs ORDER BY started_at DESC LIMIT 1`);
  const cron = await pool.query(`SELECT max(started_at) AS at FROM job_runs WHERE source = 'cron' AND ok IS TRUE`);
  const hour = await pool.query(`SELECT count(*)::int AS n FROM job_runs WHERE started_at > $1::timestamptz - interval '1 hour'`, [now.toISOString()]);
  const minutesSince = (at: unknown) => (at ? Math.max(Math.floor((now.getTime() - new Date(at as string).getTime()) / 60_000), 0) : null);
  const lastRow = last.rows[0];
  const sinceLast = minutesSince(lastRow?.started_at);
  return {
    status: !lastRow ? "never" : (sinceLast as number) > STALE_AFTER_MINUTES ? "stale" : "ok",
    lastRunAt: lastRow ? new Date(lastRow.started_at as string).toISOString() : null,
    lastRunSource: (lastRow?.source as RunSource | undefined) ?? null,
    lastRunOk: lastRow ? (lastRow.ok as boolean | null) : null,
    lastRunError: (lastRow?.error as string | null | undefined) ?? null,
    minutesSinceLastRun: sinceLast,
    lastCronAt: cron.rows[0].at ? new Date(cron.rows[0].at as string).toISOString() : null,
    minutesSinceLastCron: minutesSince(cron.rows[0].at),
    runsLastHour: Number(hour.rows[0].n),
  };
}
