import { Pool } from "pg";

// Server-only. Connection to the authoritative camp-registration database.
// In production this must be a Neon/Vercel Postgres *pooled* connection
// string (the "-pooler" hostname variant, not the direct one) — Vercel
// serverless functions can spin up many instances under load, and each
// would otherwise open its own real TCP connection. We also cap each
// instance's own pool to a single connection so the fan-out is handled
// upstream by the pooler, not by us.

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
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 1,
    });
  }
  return pool;
}

// Postgres error code for a unique-constraint violation.
export function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505");
}
