// Starts the REAL production server (`next start`, after `next build`) against a throwaway
// database and, optionally, the local test mail server, so tests can talk to the site the way
// browsers and the platform do: over HTTP, through the framework's routing, headers and caching.
//
//   const app = await startApp({ env: { SMTP_HOST: ..., DB_POOL_MAX: "1" } });
//   const r = await fetch(`${app.url}/api/camp-capacity`);
//   await app.stop();
//
// Needs DATABASE_URL to point at a database that already has the migrations (createTestDatabase
// does that). Builds the site first if there is no build or the sources are newer than it.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

function newestSourceTime(dir) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    newest = Math.max(newest, s.isDirectory() ? newestSourceTime(p) : s.mtimeMs);
  }
  return newest;
}

export function ensureBuilt({ force = false } = {}) {
  const buildId = ".next/BUILD_ID";
  const stale = !existsSync(buildId) || statSync(buildId).mtimeMs < Math.max(newestSourceTime("src"), statSync("package.json").mtimeMs, statSync("next.config.ts").mtimeMs);
  if (!force && !stale) return false;
  console.log("(building the site for the HTTP tests; this takes about a minute)");
  const build = spawnSync("node", ["node_modules/next/dist/bin/next", "build"], { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  if (build.status !== 0) throw new Error("next build failed");
  return true;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function startApp({ env = {}, build = true } = {}) {
  if (build) ensureBuilt();
  const port = await freePort();
  const logs = [];
  const child = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      REGISTRATION_LINK_SECRET: "test-only-registration-link-secret-0123456789",
      ADMIN_PASSWORD: "Local-QA-Only-Admin-Passphrase-2026",
      CRON_SECRET: "test-only-cron-secret-0123456789",
      SITE_URL: `http://127.0.0.1:${port}`,
      // Never reach a real service from a test, whatever the shell holds.
      GMAIL_USER: "",
      GMAIL_APP_PASSWORD: "",
      GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: "",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "",
      GOOGLE_SHEETS_SHEET_ID: "",
      GOOGLE_CALENDAR_ID: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  let exited = false;
  child.on("exit", () => { exited = true; });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`the server exited early:\n${logs.join("")}`);
    try {
      const r = await fetch(`${url}/api/camp-capacity`);
      if (r.status < 500 || r.status === 502) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (Date.now() >= deadline) throw new Error(`the server did not start in time:\n${logs.join("")}`);

  return {
    url,
    port,
    logs,
    async stop() {
      if (exited) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
        child.on("exit", () => { clearTimeout(t); resolve(); });
      });
    },
  };
}

// A minimal cookie-aware fetch for the admin login.
export async function adminSession(app, password = "Local-QA-Only-Admin-Passphrase-2026") {
  const response = await fetch(`${app.url}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: app.url },
    body: JSON.stringify({ password }),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return { ok: response.ok, status: response.status, cookie };
}
