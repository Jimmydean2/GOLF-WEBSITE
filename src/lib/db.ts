import { Pool, types } from "pg";

// Server-only. Connection to the authoritative camp-registration database.
// In production this must be a Neon/Vercel Postgres *pooled* connection
// string (the "-pooler" hostname variant, not the direct one) — Vercel
// serverless functions can spin up many instances under load, and each
// would otherwise open its own real TCP connection. We also cap each
// instance's own pool to a single connection so the fan-out is handled
// upstream by the pooler, not by us.

// A DATE column (a birth date, the first day of a camp week) is a calendar date, not a moment.
// The driver would turn it into a JavaScript Date in the server's time zone, which prints as
// "Wed Mar 09 2016 00:00:00 GMT-0500 (Eastern Standard Time)"; keep the plain "2016-03-09".
types.setTypeParser(types.builtins.DATE, (value: string) => value);

let pool: Pool | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    // Always 1 in production (see above). DB_POOL_MAX exists only so the
    // concurrency tests can open many real connections at once — with a pool of
    // 1, "simultaneous" requests are actually run one after another.
    const max = Number(process.env.DB_POOL_MAX) || 1;
    pool = new Pool({
      connectionString,
      // A remote database must prove its certificate. DB_SSL_INSECURE=true turns that off for
      // a host whose certificate cannot be verified; scripts/preflight.mjs says which you have.
      ssl: isLocal ? false : { rejectUnauthorized: process.env.DB_SSL_INSECURE !== "true" },
      max,
      // A request must never hang waiting for the database: fail in seconds, not minutes.
      connectionTimeoutMillis: 10_000,
      statement_timeout: 25_000,
      keepAlive: true,
    });
    // A pooled connection that the server drops while idle (Neon suspends idle databases)
    // reports an error on the pool. Unhandled, that would stop the whole server process.
    pool.on("error", (err) => {
      console.error("An idle database connection was closed; the pool will open a new one:", err.message);
    });
  }
  return pool;
}

// Postgres error code for a unique-constraint violation.
export function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505");
}

// db/migrations/003_capacity_integrity.sql makes the database itself refuse to
// put more active spots in a week than its capacity (error code 23514,
// constraint "camp_week_capacity", DETAIL "week_id=<id>"). Returns that week's
// id when `err` is such a refusal, otherwise null.
export function capacityViolationWeek(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e.code !== "23514" || e.constraint !== "camp_week_capacity") return null;
  return /week_id=([\w-]+)/.exec(e.detail ?? "")?.[1] ?? "unknown";
}
