import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getPool } from "./db";

// Server-only. The database side of admin authentication: sessions, login attempts and the
// lockout. (Cookie handling lives in adminAuth.ts, which wraps this for Next.js.)
//
// What this replaces: the old login set a cookie holding a fixed hash of the password,
// valid for 30 days, with no limit on guesses and no way to end a session.
//
// Now:
//   * Every login creates a RANDOM session token; only its hash is stored, so a database
//     leak cannot be turned into a working cookie, and sessions can be revoked.
//   * A session ends after 4 hours idle or 24 hours in all.
//   * 5 wrong passwords from one address within 15 minutes lock that address out for the
//     rest of the window (even a correct password is refused while locked).
//   * Payment actions (confirm, release, extend, reinstate, authorize capacity) also need a
//     password check within the last 15 minutes ("fresh" authentication), so a session left
//     open on a shared device cannot move money state by itself.

export const SESSION_IDLE_HOURS = 4;
export const SESSION_MAX_HOURS = 24;
export const FRESH_AUTH_MINUTES = 15;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

// Compares digests, so the comparison takes the same time whatever the lengths.
export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  const a = createHash("sha256").update(password).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AdminSession = { id: string; lastAuthAt: Date; expiresAt: Date };

export type LockStatus = { locked: boolean; retryAfterSeconds: number };

// Locked when there have been LOGIN_FAILURE_LIMIT failures from this address inside the
// window. The lock lifts when the oldest of those failures ages out of the window.
export async function checkLoginLock(ip: string, now?: Date): Promise<LockStatus> {
  const { rows } = await getPool().query(
    `SELECT created_at, COALESCE($2::timestamptz, now()) AS now_ts
       FROM admin_login_attempts
      WHERE ip = $1 AND succeeded = false
        AND created_at > COALESCE($2::timestamptz, now()) - make_interval(mins => $3)
      ORDER BY created_at DESC LIMIT $4`,
    [ip, now ?? null, LOGIN_WINDOW_MINUTES, LOGIN_FAILURE_LIMIT]
  );
  if (rows.length < LOGIN_FAILURE_LIMIT) return { locked: false, retryAfterSeconds: 0 };
  const oldest = new Date(rows[rows.length - 1].created_at as string).getTime();
  const nowMs = new Date(rows[0].now_ts as string).getTime();
  const retryAfterSeconds = Math.max(Math.ceil((oldest + LOGIN_WINDOW_MINUTES * 60_000 - nowMs) / 1000), 1);
  return { locked: true, retryAfterSeconds };
}

async function recordAttempt(ip: string, succeeded: boolean): Promise<void> {
  await getPool().query(`INSERT INTO admin_login_attempts (ip, succeeded) VALUES ($1, $2)`, [ip, succeeded]);
}

async function audit(action: string, details: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details, actor)
     VALUES ($1, 'admin_session', 'login', $2, 'owner')`,
    [action, JSON.stringify(details)]
  );
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "locked" | "invalid"; retryAfterSeconds: number };

export async function attemptLogin(input: {
  password: string;
  ip: string;
  userAgent?: string;
  now?: Date;
}): Promise<LoginResult> {
  if (!isAdminConfigured()) return { ok: false, reason: "not_configured" };
  const lock = await checkLoginLock(input.ip, input.now);
  if (lock.locked) return { ok: false, reason: "locked", retryAfterSeconds: lock.retryAfterSeconds };

  if (!verifyAdminPassword(input.password)) {
    await recordAttempt(input.ip, false);
    const after = await checkLoginLock(input.ip, input.now);
    if (after.locked) await audit("admin_login_locked", { ip: input.ip });
    // Guessing from many addresses at once: slow every failure down while it is going on.
    const recent = await getPool().query(
      `SELECT count(*)::int AS n FROM admin_login_attempts
        WHERE succeeded = false AND created_at > now() - make_interval(mins => $1)`,
      [LOGIN_WINDOW_MINUTES]
    );
    if ((recent.rows[0].n as number) >= LOGIN_FAILURE_LIMIT * 6) await new Promise((r) => setTimeout(r, 1500));
    return after.locked
      ? { ok: false, reason: "locked", retryAfterSeconds: after.retryAfterSeconds }
      : { ok: false, reason: "invalid", retryAfterSeconds: 0 };
  }

  const token = randomBytes(32).toString("hex");
  const { rows } = await getPool().query(
    `INSERT INTO admin_sessions (token_hash, expires_at, ip, user_agent)
     VALUES ($1, now() + make_interval(hours => $2), $3, $4) RETURNING expires_at`,
    [hashToken(token), SESSION_MAX_HOURS, input.ip, (input.userAgent ?? "").slice(0, 300)]
  );
  await getPool().query(`DELETE FROM admin_login_attempts WHERE ip = $1 AND succeeded = false`, [input.ip]);
  await recordAttempt(input.ip, true);
  await audit("admin_login", { ip: input.ip });
  return { ok: true, token, expiresAt: new Date(rows[0].expires_at as string) };
}

// Returns the live session for this token, or null if it is unknown, revoked, past its
// 24-hour limit, or idle for more than 4 hours. Touches last_seen_at (at most once a minute).
export async function getSessionByToken(token: string, now?: Date): Promise<AdminSession | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, last_auth_at, expires_at FROM admin_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL
        AND expires_at > COALESCE($2::timestamptz, now())
        AND last_seen_at > COALESCE($2::timestamptz, now()) - make_interval(hours => $3)`,
    [hashToken(token), now ?? null, SESSION_IDLE_HOURS]
  );
  if (rows.length === 0) return null;
  await pool.query(
    `UPDATE admin_sessions SET last_seen_at = COALESCE($2::timestamptz, now())
      WHERE id = $1 AND last_seen_at < COALESCE($2::timestamptz, now()) - interval '1 minute'`,
    [rows[0].id, now ?? null]
  );
  return { id: rows[0].id as string, lastAuthAt: new Date(rows[0].last_auth_at as string), expiresAt: new Date(rows[0].expires_at as string) };
}

export function isFresh(session: AdminSession, now: Date = new Date()): boolean {
  return now.getTime() - session.lastAuthAt.getTime() <= FRESH_AUTH_MINUTES * 60_000;
}

export async function revokeSession(token: string): Promise<void> {
  await getPool().query(`UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(token)]);
}

export async function revokeAllSessions(): Promise<number> {
  const result = await getPool().query(`UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL`);
  await audit("admin_sessions_revoked", { count: result.rowCount });
  return result.rowCount ?? 0;
}

// The password check behind "confirm your password to continue". Shares the lockout with
// login, so it cannot be used to guess the password either.
export async function reauthenticate(input: {
  sessionId: string;
  password: string;
  ip: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: "locked" | "invalid"; retryAfterSeconds: number }> {
  const lock = await checkLoginLock(input.ip, input.now);
  if (lock.locked) return { ok: false, reason: "locked", retryAfterSeconds: lock.retryAfterSeconds };
  if (!verifyAdminPassword(input.password)) {
    await recordAttempt(input.ip, false);
    const after = await checkLoginLock(input.ip, input.now);
    if (after.locked) await audit("admin_login_locked", { ip: input.ip, during: "reauth" });
    return after.locked
      ? { ok: false, reason: "locked", retryAfterSeconds: after.retryAfterSeconds }
      : { ok: false, reason: "invalid", retryAfterSeconds: 0 };
  }
  await getPool().query(`UPDATE admin_sessions SET last_auth_at = COALESCE($2::timestamptz, now()) WHERE id = $1`, [
    input.sessionId,
    input.now ?? null,
  ]);
  await getPool().query(`DELETE FROM admin_login_attempts WHERE ip = $1 AND succeeded = false`, [input.ip]);
  return { ok: true };
}
