import { createHash } from "crypto";
import { getPool } from "./db";

// Server-only. Fixed-window rate limiting backed by Postgres, so it holds across
// serverless instances (an in-memory counter would reset on every cold start).
//
// Identifiers (IP addresses, emails, phones) are hashed before they become part of a
// bucket name, so the counters table holds no personal data.

export type RateLimitResult = { allowed: boolean; hits: number; retryAfterSeconds: number };

function hashed(identifier: string): string {
  return createHash("sha256").update(identifier.toLowerCase().trim()).digest("hex").slice(0, 32);
}

// Counts one hit against `name` for `identifier` in the current window and reports
// whether it is still within `limit`. `now` is for tests; production uses the database clock.
export async function rateLimit(
  name: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
  now?: Date
): Promise<RateLimitResult> {
  const pool = getPool();
  const bucket = `${name}:${hashed(identifier)}`;
  const { rows } = await pool.query(
    `WITH t AS (SELECT COALESCE($3::timestamptz, now()) AS now_ts),
          w AS (SELECT to_timestamp(floor(extract(epoch FROM now_ts) / $2::int) * $2::int) AS start_ts FROM t)
     INSERT INTO rate_limit_counters (bucket, window_start, hits)
     SELECT $1, w.start_ts, 1 FROM w
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limit_counters.hits + 1
     RETURNING hits,
               EXTRACT(epoch FROM (window_start + make_interval(secs => $2::int) - COALESCE($3::timestamptz, now())))::int AS remaining`,
    [bucket, windowSeconds, now ?? null]
  );
  const hits = rows[0].hits as number;
  if (Math.random() < 0.01) {
    // Housekeeping: counters older than two days are useless.
    pool.query(`DELETE FROM rate_limit_counters WHERE window_start < now() - interval '2 days'`).catch(() => {});
  }
  return { allowed: hits <= limit, hits, retryAfterSeconds: Math.max(Number(rows[0].remaining) || 1, 1) };
}

// The caller's IP address as reported by the hosting platform (Vercel sets x-forwarded-for).
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
