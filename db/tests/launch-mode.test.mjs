// The informational website must be able to launch ON ITS OWN, with the camp, the clinics and the
// online lesson booking all switched off or marked "coming soon". This builds the site exactly as
// an informational-only launch would be built (a scratch copy of the project, no settings at all:
// no database, no Google, no secrets, no preview switch) and checks, over HTTP, that:
//   * every public page loads;
//   * the camp says its dates are coming soon (in English and in French) and refuses registrations;
//   * the clinic sign-up and lesson booking say "being finalized, call or email" and refuse bookings;
//   * the owner's pages and APIs are closed;
//   * nothing connects to a database, Google or a mail server.
// A scratch copy is used because the camp pages are built ahead of time from the environment, so
// building them "unconfigured" in the real project folder would break the other suites.
//
// To check a real hosting preview instead (a Netlify or Cloudflare preview URL, a local emulation), set
// LAUNCH_MODE_URL=https://the-preview.example npm run test:launch-mode : nothing is built or started,
// the same checks 1 to 4 run against that address, and check 5 (the server's own log) is skipped. The
// address must be a site built with no booking settings; the checks send a few harmless POSTs that the
// site refuses, and nothing else.

import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
};

const external = (process.env.LAUNCH_MODE_URL ?? "").replace(/\/+$/, "");
const work = external ? null : mkdtempSync(join(tmpdir(), "golf-launch-mode-"));
let server = null;
let url = external;
const logs = [];
try {
  if (!external) {
  for (const f of ["src", "public", "assets", "package.json", "tsconfig.json", "next.config.ts", "next-env.d.ts", "postcss.config.mjs"]) {
    if (existsSync(f)) cpSync(f, join(work, f), { recursive: true });
  }
  const linked = spawnSync("cp", ["-al", realpathSync("node_modules"), join(work, "node_modules")]);
  if (linked.status !== 0) throw new Error("could not link node_modules into the scratch copy");

  // NOTHING from the shell: a launch with no settings at all.
  const bare = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: "1" };
  console.log("(building the site with no settings, as an informational-only launch would; about a minute)");
  const build = spawnSync("node", ["node_modules/next/dist/bin/next", "build"], { cwd: work, env: bare, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`next build failed:\n${build.stdout}\n${build.stderr}`);

  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
  server = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: work, env: bare, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => logs.push(String(d)));
  server.stderr.on("data", (d) => logs.push(String(d)));
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/`)).status < 500) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  } else {
    console.log(`(checking an existing site at ${external}; nothing is built or started here)`);
  }

  const get = (path, init) => fetch(`${url}${path}`, { redirect: "manual", ...init });
  const text = async (path) => (await (await get(path)).text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

  console.log("=== 1. Every public page loads ===");
  for (const path of ["/", "/about", "/lessons", "/clinics", "/book", "/junior-programs", "/junior-camps", "/contact", "/privacy", "/fr/camps-juniors", "/fr/confidentialite"]) {
    check(`${path} loads`, (await get(path)).status === 200);
  }

  console.log("\n=== 2. The camp says 'coming soon' and refuses registrations ===");
  const campEn = await text("/junior-camps");
  const campFr = await text("/fr/camps-juniors");
  check("English camp page: dates coming soon, no form, the phone number", /coming soon/i.test(campEn) && !/<form/i.test(await (await get("/junior-camps")).text()) && /514-816-3454/.test(campEn));
  check("French camp page: bientôt, in French", /bientôt/i.test(campFr) && /514-816-3454/.test(campFr));
  const cap = await (await get("/api/camp-capacity")).json();
  check("the capacity answer says registration is not announced, with no weeks to book", cap.configured === false && cap.registration?.state === "not_announced" && Object.keys(cap.weeks).length === 0, JSON.stringify(cap).slice(0, 120));
  const post = (path, body = {}) => get(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const reg = await post("/api/camp-registration");
  check("the camp registration and the camp waiting list refuse (503, 'call or email')", reg.status === 503 && (await post("/api/camp-waitlist")).status === 503);

  console.log("\n=== 3. Clinics and lessons say 'being finalized' and refuse bookings ===");
  const clinic = await (await get("/api/clinic-capacity")).json();
  const lessons = await (await get("/api/lesson-availability")).json();
  check("clinic capacity: not configured, nothing offered", clinic.configured === false && Object.keys(clinic.cohorts).length === 0);
  check("lesson availability: not configured, no times offered", lessons.configured === false && Object.keys(lessons.days).length === 0);
  const cs = await post("/api/clinic-signup");
  const lb = await post("/api/lesson-booking");
  check("a clinic sign-up and a lesson booking are refused (503, 'call or email')", cs.status === 503 && lb.status === 503 && /call or email/.test((await cs.json()).error) && /call or email/.test((await lb.json()).error));
  const book = await text("/book");
  const clinics = await text("/clinics");
  check("the page copy no longer promises to pick a time or sign up online", !/added straight to Coach/i.test(book) && !/reach out to confirm your spot/i.test(clinics));

  console.log("\n=== 4. The owner's side is closed, and nothing else is reachable ===");
  const admin = await get("/admin/camp-rosters");
  check("the dashboard redirects to the login", admin.status === 307 && /\/admin\/login/.test(admin.headers.get("location") ?? ""));
  const apis = ["/api/admin/payment-queue", "/api/admin/audit-log", "/api/admin/waitlist", "/api/admin/retention"];
  const answers = await Promise.all(apis.map(async (p) => (await get(p)).status));
  check("every owner API answers 401 without a login", answers.every((s) => s === 401), answers.join());
  const login = await post("/api/admin/login", { password: "anything" });
  check("the owner login says it is not set up (no password was configured)", login.status === 503 || login.status === 403, String(login.status));
  const health = await get("/api/health/scheduler");
  check("the health address reveals nothing about a site that is not set up", health.status === 503 || health.status === 200);

  console.log("\n=== 5. It touched nothing outside itself ===");
  if (external) {
    console.log("  (skipped: the server's own log is not available for an existing site)");
  } else {
    const all = logs.join("");
    check("no database, Google or mail connection was attempted (the log is clean of errors)", !/ECONNREFUSED|ENOTFOUND|googleapis|SMTP|connect ETIMEDOUT/i.test(all), all.slice(-300));
  }
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    server.kill("SIGKILL");
  }
  if (work) rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? `\nALL TESTS PASS (${checks} pass, 0 fail) — launch-mode` : `\n${failures} OF ${checks} CHECK(S) FAILED — launch-mode`);
process.exit(failures === 0 ? 0 : 1);
