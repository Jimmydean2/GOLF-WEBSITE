// Builds a throwaway Postgres database for one test run: creates it, applies every
// migration in db/migrations from nothing (so the migrations are tested too), points
// DATABASE_URL at it, and drops it afterwards. The audit log is append-only, so tests
// cannot clean up after themselves; a fresh database per run is the clean answer.
//
// Safety: only ever runs against a LOCAL server. It refuses any other DATABASE_URL, so a
// test can never create (or drop) databases on a real host.
//
// Usage (top of a test file, before anything calls getPool()):
//   const testDb = await createTestDatabase();
//   ... tests ...
//   await getPool().end(); await testDb.drop();

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

function assertLocal(url) {
  if (!/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
    throw new Error("Refusing to run: the test database helper only works against a local Postgres.");
  }
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

// Tests must never reach a real outside service, whatever the shell environment holds: no
// real email can be sent and no Google Sheet / Calendar can be touched. (Tests that exercise
// the email code inject a fake mailer instead.)
for (const name of [
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_SHEETS_SHEET_ID",
  "GOOGLE_CALENDAR_ID",
]) {
  delete process.env[name];
}

// The camp calendar is a proposal until the owner confirms it, and an unconfirmed calendar keeps
// registration closed (src/lib/registrationWindow.ts). Tests exercise registration, so they run
// as a rehearsal site. The season suite tests the closed states explicitly.
process.env.SEASON_PREVIEW = "true";
delete process.env.REGISTRATION_OPENS_AT;

export async function createTestDatabase({ migrationsUpTo } = {}) {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL is not set (it must point at a local Postgres).");
  assertLocal(adminUrl);

  const name = `golf_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = withDatabase(adminUrl, name);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const files = readdirSync("db/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => !migrationsUpTo || f <= migrationsUpTo);
    for (const file of files) {
      await client.query(readFileSync(join("db/migrations", file), "utf8"));
    }
  } finally {
    await client.end();
  }

  process.env.DATABASE_URL = url;
  return {
    name,
    url,
    async drop() {
      // Wait for the test's own connections to finish closing (a polite DROP), and only force
      // it if something is still holding on: forcing straight away makes the server kill
      // connections the client library is still closing, which surfaces as a stray error.
      const dropper = new pg.Client({ connectionString: adminUrl });
      await dropper.connect();
      try {
        for (let attempt = 0; attempt < 25; attempt++) {
          try {
            await dropper.query(`DROP DATABASE IF EXISTS "${name}"`);
            return;
          } catch (e) {
            if (e.code !== "55006") throw e; // "database is being accessed by other users"
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
