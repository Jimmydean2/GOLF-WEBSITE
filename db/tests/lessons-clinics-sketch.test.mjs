// The lessons-and-clinics DESIGN SKETCH (docs/design/lessons-clinics-schema-sketch.sql), attacked
// on a real throwaway PostgreSQL with real parallel connections. Nothing here is a migration:
// the sketch is applied on top of the camp's migrations to prove, before any real migration is
// written, that
//   * the sketch is purely additive (the camp's tables, constraints, triggers and indexes are
//     byte-for-byte the same afterwards) and can be applied twice;
//   * two customers cannot hold overlapping times, however fast they click, and a weekly series is
//     all or nothing;
//   * a clinic can never exceed its capacity, a party is all or nothing, and the counter cannot be
//     faked from raw SQL;
//   * a booking's status, its occupied time and its spots always agree (commit-time check);
//   * money (tax mode, totals), the payment states, and the Google Calendar fail-safe are enforced by
//     the data itself;
//   * packages can never spend a credit twice;
//   * weekly series computed from the wall-clock time survive both daylight-saving changes.
//
// Run with: DATABASE_URL=postgres://user:pass@localhost:5432/anydb npx tsx db/tests/lessons-clinics-sketch.test.mjs
// Only ever runs against a local server (see helpers/testdb.mjs).

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createTestDatabase } from "./helpers/testdb.mjs";

const testDb = await createTestDatabase();
const SKETCH = readFileSync(process.env.SKETCH_FILE || "docs/design/lessons-clinics-schema-sketch.sql", "utf8");
const pool = new pg.Pool({ connectionString: testDb.url, max: 80 });

let checks = 0;
let failures = 0;
function check(label, condition, detail) {
  const ok = Boolean(condition);
  checks++;
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail !== undefined && detail !== "" ? " — " + detail : ""}`);
}
async function refused(label, fn, { code, constraint } = {}) {
  try {
    await fn();
    check(label, false, "the database ACCEPTED it");
  } catch (e) {
    const ok = (!code || e.code === code) && (!constraint || e.constraint === constraint);
    check(label, ok, `${e.code} ${e.constraint ?? ""} — ${String(e.message).slice(0, 100)}`);
  }
}

// ---- helpers ---------------------------------------------------------------------------------
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ref = (p) => p + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join("");
const MIN = 60_000;
const iso = (d) => new Date(d).toISOString();
// An instant on a far-away Monday, so nothing depends on today's date. 2027-03-01 is a Monday.
const BASE = Date.parse("2027-03-01T14:00:00Z"); // 9:00 a.m. Toronto (EST, UTC-5)
const at = (minutesFromBase) => BASE + minutesFromBase * MIN;

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function insertBooking(client, o = {}) {
  const id = o.id ?? randomUUID();
  const kind = o.kind ?? "lesson";
  const total = o.total ?? 11000;
  const checkedAt = o.checkedAt === undefined ? Date.now() - 500 : o.checkedAt;
  await client.query(
    `INSERT INTO bookings (id, kind, created_by, idempotency_key, reference_code, customer_name, email, phone,
        privacy_consent_at, privacy_notice_version, status, tax_mode, gst_rate, qst_rate,
        subtotal_cents, gst_cents, qst_cents, total_cents, hold_expires_at, hold_ends_at_initial,
        payment_reported_at, review_due_at, calendar_checked_at, calendar_check_result)
     VALUES ($1,$2,$3,$4,$5,'Test Person','p@example.test','514-555-0100', now(), 'v1', $6, $7, 0.05, 0.09975,
        $8,$9,$10,$11, $12, $12, $13, $14, $15, $16)`,
    [
      id, kind, o.createdBy ?? "customer", o.idempotencyKey ?? `k-${id}`, ref(kind === "lesson" ? "GL-" : "GC-"),
      o.status ?? "reserved", o.taxMode ?? "added",
      o.subtotal ?? total, o.gst ?? 0, o.qst ?? 0, total,
      o.status === "payment_reported" ? null : iso(Date.now() + 3 * 60 * MIN),
      o.status === "payment_reported" ? iso(Date.now()) : null,
      o.status === "payment_reported" ? iso(Date.now() + 48 * 60 * MIN) : null,
      kind === "lesson" ? (checkedAt === null ? null : iso(checkedAt)) : null,
      kind === "lesson" ? (o.checkResult === undefined ? "clear" : o.checkResult) : null,
    ]
  );
  return id;
}

async function addAppointment(client, bookingId, startMs, { slot = 60, buffer = 0, index = 1, product, location, localDate, localStart } = {}) {
  const apptId = randomUUID();
  const ends = startMs + slot * MIN;
  const until = ends + buffer * MIN;
  const startIso = iso(startMs);
  const { rows } = await client.query(
    `SELECT (($1::timestamptz AT TIME ZONE 'America/Toronto')::date) AS d, (($1::timestamptz AT TIME ZONE 'America/Toronto')::time) AS t`,
    [startIso]
  );
  await client.query(
    `INSERT INTO lesson_appointments (id, booking_id, product_id, location_id, series_index, starts_at, ends_at, occupied_until, local_date, local_start)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [apptId, bookingId, product, location, index, startIso, iso(ends), iso(until), localDate ?? rows[0].d, localStart ?? rows[0].t]
  );
  await client.query(
    `INSERT INTO schedule_occupancy (kind, span, lesson_appointment_id) VALUES ('lesson', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`,
    [startIso, iso(until), apptId]
  );
  return apptId;
}

// One customer's lesson reservation, as the application would make it: one transaction.
async function reserveLesson(f, startMs, opts = {}) {
  try {
    const id = await tx(async (c) => {
      const b = await insertBooking(c, { id: opts.id, idempotencyKey: opts.idempotencyKey, checkedAt: opts.checkedAt, createdBy: opts.createdBy, checkResult: opts.checkResult });
      const weeks = opts.weeks ?? 1;
      for (let i = 0; i < weeks; i++) {
        // A weekly series is built from the wall-clock time, week by week.
        const { rows } = await c.query(
          `SELECT (($1::timestamptz AT TIME ZONE 'America/Toronto')::date + $2::int) AS d, (($1::timestamptz AT TIME ZONE 'America/Toronto')::time) AS t`,
          [iso(startMs), i * 7]
        );
        const instant = (await c.query(`SELECT (($1::date + $2::time) AT TIME ZONE 'America/Toronto') AS ts`, [rows[0].d, rows[0].t])).rows[0].ts;
        await addAppointment(c, b, new Date(instant).getTime(), { slot: opts.slot, buffer: opts.buffer, index: i + 1, product: f.product, location: f.location });
      }
      return b;
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, code: e.code, constraint: e.constraint, message: e.message };
  }
}

async function reserveClinicParty(f, offeringId, names, opts = {}) {
  try {
    const id = await tx(async (c) => {
      const b = await insertBooking(c, { kind: "clinic", total: 20000, ...opts });
      for (const n of names) {
        await c.query(`INSERT INTO clinic_spots (booking_id, offering_id, participant_name) VALUES ($1,$2,$3)`, [b, offeringId, n]);
      }
      return b;
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, code: e.code, constraint: e.constraint, message: e.message };
  }
}

async function markPaid(client, id, total) {
  await client.query(
    `UPDATE bookings SET status = 'paid', hold_expires_at = NULL, payment_reported_at = NULL, review_due_at = NULL, verified_at = now(),
        verification_method = 'reference_matched', deposit_at = now(), amount_received_cents = $2 WHERE id = $1`,
    [id, total]
  );
}

async function cancelLesson(client, id) {
  await client.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner', hold_expires_at = NULL WHERE id = $1`, [id]);
  await client.query(`UPDATE lesson_appointments SET status = 'cancelled' WHERE booking_id = $1`, [id]);
  await client.query(`UPDATE schedule_occupancy SET active = false WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [id]);
}

async function reset() {
  // Deleting a booking removes its lessons, occupied time and spots together (the database frees the
  // capacity itself); owner blocks and clinic sessions are removed separately.
  await pool.query(`DELETE FROM bookings`);
  await pool.query(`DELETE FROM schedule_occupancy`);
  await pool.query(`DELETE FROM clinic_sessions`);
}

async function snapshotCamp() {
  const tables = ["camp_weeks", "registrations", "children", "registration_spots", "admin_audit_log", "email_outbox", "job_runs", "alert_ledger", "camp_settings", "capacity_authorizations", "waitlist_entries", "admin_notes", "admin_sessions", "rate_limit_counters"];
  const out = {};
  for (const t of tables) {
    const cols = await pool.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`, [t]);
    const cons = await pool.query(`SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relname = $1 ORDER BY conname`, [t]);
    const trg = await pool.query(`SELECT tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid WHERE r.relname = $1 AND NOT tgisinternal ORDER BY tgname`, [t]);
    const idx = await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1 ORDER BY indexname`, [t]);
    out[t] = { cols: cols.rows, cons: cons.rows, trg: trg.rows, idx: idx.rows };
  }
  const fns = await pool.query(`SELECT proname, md5(prosrc) AS h FROM pg_proc WHERE proname LIKE 'camp\\_%' ORDER BY proname`);
  out.functions = fns.rows;
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------------------------
console.log("=== 1. The sketch only ADDS: the camp is untouched, and it can be applied twice ===");
const before = await snapshotCamp();
await pool.query(SKETCH);
const after = await snapshotCamp();
check("the camp's tables, constraints, triggers, indexes and functions are identical after the sketch", before === after, `${before.length} chars compared`);
let second = null;
try { await pool.query(SKETCH); } catch (e) { second = e; }
check("applying the sketch a second time is harmless", second === null, second ? second.message : "");
const camp = await pool.query(`SELECT count(*)::int AS n FROM camp_weeks`);
check("the camp's weeks are still there", camp.rows[0].n > 0, `${camp.rows[0].n} weeks`);

// Fixtures
const f = {};
f.location = (await pool.query(`INSERT INTO booking_locations (name) VALUES ('Golf Dorval') RETURNING id`)).rows[0].id;
f.product = (await pool.query(`INSERT INTO lesson_products (slug, name_en, name_fr) VALUES ('private-60', 'Private lesson', 'Leçon privée') RETURNING id`)).rows[0].id;
f.offering = (await pool.query(`INSERT INTO clinic_offerings (slug, title_en, title_fr, price_cents) VALUES ('may', 'May clinic', 'Clinique de mai', 20000) RETURNING id`)).rows[0].id;

console.log("\n=== 2. Settings, products and prices cannot be nonsense ===");
{
  const s = (await pool.query(`SELECT * FROM booking_settings`)).rows[0];
  check("a fresh install is 'tax unset' with a 60-minute slot, 3-hour lesson hold, 12-hour clinic hold", s.tax_mode === "unset" && s.lesson_hold_minutes === 180 && s.clinic_hold_minutes === 720 && s.series_hold_minutes === 360 && s.packages_approved_at === null);
  const p = (await pool.query(`SELECT slot_minutes, lesson_minutes, buffer_after_minutes FROM lesson_products WHERE id = $1`, [f.product])).rows[0];
  check("a new lesson product defaults to a 60-minute slot, 55-minute lesson, no extra buffer", p.slot_minutes === 60 && p.lesson_minutes === 55 && p.buffer_after_minutes === 0);
  await refused("choosing a tax mode without recording the confirmation is refused", () => pool.query(`UPDATE booking_settings SET tax_mode = 'added'`), { constraint: "tax_confirmed_when_set" });
  await pool.query(`UPDATE booking_settings SET tax_mode = 'included', tax_confirmed_at = now()`);
  check("recording the confirmation with the mode works", (await pool.query(`SELECT tax_mode FROM booking_settings`)).rows[0].tax_mode === "included");
  await pool.query(`UPDATE booking_settings SET tax_mode = 'unset', tax_confirmed_at = NULL`);
  await refused("a stale-calendar threshold not above the refresh interval is refused", () => pool.query(`UPDATE booking_settings SET calendar_stale_after_minutes = 5`), { constraint: "calendar_stale_after_refresh" });
  await refused("a second settings row cannot exist", () => pool.query(`INSERT INTO booking_settings (id) VALUES (2)`), { code: "23514" });
  await refused("a lesson longer than its slot is refused", () => pool.query(`INSERT INTO lesson_products (slug, name_en, name_fr, slot_minutes, lesson_minutes) VALUES ('x','x','x',45,60)`), { code: "23514" });
  await pool.query(`INSERT INTO price_periods (product_id, valid_from, valid_to, price_cents) VALUES ($1,'2027-05-01','2027-10-31',11000)`, [f.product]);
  await pool.query(`INSERT INTO price_periods (product_id, valid_from, valid_to, price_cents) VALUES ($1,'2027-11-01','2028-04-30',11500)`, [f.product]);
  check("two back-to-back price periods (summer, winter) are fine", true);
  await refused("two prices for one product on the same day are refused", () => pool.query(`INSERT INTO price_periods (product_id, valid_from, valid_to, price_cents) VALUES ($1,'2027-10-15','2027-11-15',12000)`, [f.product]), { code: "23P01", constraint: "price_periods_no_overlap" });
}

console.log("\n=== 3. Lessons: the database refuses overlapping times ===");
{
  await reset();
  const results = await Promise.all(Array.from({ length: 50 }, () => reserveLesson(f, at(0))));
  const wins = results.filter((r) => r.ok);
  const refusedNow = results.filter((r) => !r.ok);
  check("50 customers click the same 9:00 slot at the same instant: exactly one wins", wins.length === 1, `${wins.length} won`);
  check("the other 49 are refused by the no-overlap rule (23P01), nothing else went wrong", refusedNow.length === 49 && refusedNow.every((r) => r.code === "23P01" && r.constraint === "schedule_no_overlap"), [...new Set(refusedNow.map((r) => r.code + ":" + r.constraint))].join(","));
  const n = (await pool.query(`SELECT (SELECT count(*) FROM bookings)::int AS b, (SELECT count(*) FROM lesson_appointments)::int AS a, (SELECT count(*) FROM schedule_occupancy WHERE active)::int AS o`)).rows[0];
  check("exactly one booking, one appointment and one occupied range remain (the 49 rolled back whole)", n.b === 1 && n.a === 1 && n.o === 1, JSON.stringify(n));

  // Overlap by every offset: a 60-minute lesson at 9:00 against a start every 5 minutes from 8:05 to 9:55.
  let wrong = [];
  for (let off = -55; off <= 55; off += 5) {
    const r = await reserveLesson(f, at(off));
    const overlaps = off > -60 && off < 60;
    if (off === 0) continue;
    if (overlaps && r.ok) wrong.push(`accepted overlap at ${off}`);
    if (!overlaps && !r.ok) wrong.push(`refused non-overlap at ${off}`);
    if (r.ok) await tx((c) => cancelLesson(c, r.id));
  }
  check("every start from 55 minutes before to 55 minutes after is refused (partial overlap of any size)", wrong.length === 0, wrong.join("; "));
  const touchAfter = await reserveLesson(f, at(60));
  const touchBefore = await reserveLesson(f, at(-60));
  check("a lesson that starts the instant another ends (and one that ends the instant another starts) is allowed", touchAfter.ok && touchBefore.ok, `${touchBefore.ok}/${touchAfter.ok}`);

  await reset();
  const withBuffer = await reserveLesson(f, at(0), { buffer: 10 });
  const tooSoon = await reserveLesson(f, at(60));
  const clearOfBuffer = await reserveLesson(f, at(70));
  check("with a 10-minute buffer after a lesson, the next lesson cannot start until 10 minutes after it ends", withBuffer.ok && !tooSoon.ok && tooSoon.code === "23P01" && clearOfBuffer.ok);

  await reset();
  const [a, b] = await Promise.all([reserveLesson(f, at(0)), reserveLesson(f, at(30))]);
  check("two overlapping but different starts (9:00 and 9:30) racing: exactly one wins", [a, b].filter((r) => r.ok).length === 1);

  await reset();
  const many = await Promise.all(Array.from({ length: 30 }, (_, i) => reserveLesson(f, at(i * 60))));
  check("30 different, non-overlapping slots at the same instant all succeed (no false conflicts)", many.every((r) => r.ok), `${many.filter((r) => r.ok).length}/30`);

  // A released time can be taken again; a time held by a paid booking cannot.
  await reset();
  const first = await reserveLesson(f, at(0));
  await tx((c) => cancelLesson(c, first.id));
  const again = await reserveLesson(f, at(0));
  check("after a booking is cancelled its time is free to be booked again", first.ok && again.ok);
  await tx(async (c) => markPaid(c, again.id, 11000));
  const onPaid = await reserveLesson(f, at(0));
  check("a paid booking's time can never be taken", !onPaid.ok && onPaid.code === "23P01");

  // The coach's own blocks and clinics use the same rule.
  await reset();
  const blk = randomUUID();
  await pool.query(`INSERT INTO schedule_occupancy (kind, span, time_block_id, reason) VALUES ('block', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3, 'vacation')`, [iso(at(0)), iso(at(240)), blk]);
  const onBlock = await reserveLesson(f, at(60));
  check("a lesson cannot be booked inside a time James has blocked", !onBlock.ok && onBlock.code === "23P01");
  await reset();
  const lessonFirst = await reserveLesson(f, at(60));
  await refused("James cannot block a time that already holds a booking (he must deal with the booking first)", () => pool.query(`INSERT INTO schedule_occupancy (kind, span, time_block_id) VALUES ('block', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(at(0)), iso(at(240)), randomUUID()]), { code: "23P01", constraint: "schedule_no_overlap" });
  check("(the booking is still there)", lessonFirst.ok && (await pool.query(`SELECT count(*)::int AS n FROM schedule_occupancy WHERE active`)).rows[0].n === 1);

  await reset();
  const raceBlock = [];
  for (let i = 0; i < 20; i++) {
    raceBlock.push(reserveLesson(f, at(i * 15 - 60)));
    raceBlock.push(pool.query(`INSERT INTO schedule_occupancy (kind, span, time_block_id) VALUES ('block', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(at(0)), iso(at(60)), randomUUID()]).then(() => ({ ok: true, block: true }), (e) => ({ ok: false, code: e.code })));
  }
  await Promise.allSettled(raceBlock);
  const both = (await pool.query(`SELECT count(*)::int AS n FROM schedule_occupancy a JOIN schedule_occupancy b ON a.id < b.id AND a.active AND b.active AND a.span && b.span`)).rows[0].n;
  check("20 bookings racing 20 blocks over the same hour: never two overlapping active ranges", both === 0, `${both} overlaps`);

  await reset();
  const clinicSessionId = randomUUID();
  await pool.query(`INSERT INTO clinic_sessions (id, offering_id, starts_at, ends_at) VALUES ($1,$2,$3,$4)`, [clinicSessionId, f.offering, iso(at(1440 * 5 + 90)), iso(at(1440 * 5 + 180))]);
  await pool.query(`INSERT INTO schedule_occupancy (kind, span, clinic_session_id) VALUES ('clinic_session', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(at(1440 * 5 + 90)), iso(at(1440 * 5 + 180)), clinicSessionId]);
  const onClinic = await reserveLesson(f, at(1440 * 5 + 120));
  check("a private lesson cannot be sold on top of a clinic session", !onClinic.ok && onClinic.code === "23P01");
}

console.log("\n=== 4. A weekly series is all or nothing, and a double click is one booking ===");
{
  await reset();
  // Week 3 of a series that starts Monday Mar 1, 2027 at 9:00 is Mar 15 at 9:00 local, which is
  // 13:00 UTC (the clocks changed on Mar 14), not 14:00 UTC: exactly the daylight-saving trap.
  const third = await reserveLesson(f, Date.parse("2027-03-15T13:00:00Z")); // someone holds week 3's slot
  check("setup: week 3's time is already taken", third.ok);
  const series = await reserveLesson(f, at(0), { weeks: 4 });
  check("a 4-week series whose 3rd week is taken is refused whole", !series.ok && series.code === "23P01");
  const left = (await pool.query(`SELECT (SELECT count(*) FROM bookings)::int AS b, (SELECT count(*) FROM lesson_appointments)::int AS a, (SELECT count(*) FROM schedule_occupancy WHERE active)::int AS o`)).rows[0];
  check("no part of the series was kept (only the other customer's single lesson remains)", left.b === 1 && left.a === 1 && left.o === 1, JSON.stringify(left));
  await tx((c) => cancelLesson(c, third.id));
  const ok = await reserveLesson(f, at(0), { weeks: 4 });
  const cnt = (await pool.query(`SELECT count(*)::int AS n FROM schedule_occupancy WHERE active`)).rows[0].n;
  check("with the clash gone the same series books all 4 weeks at once", ok.ok && cnt === 4);

  await reset();
  const same = await Promise.all(Array.from({ length: 100 }, () => reserveLesson(f, at(0), { idempotencyKey: "double-click-key-0001" })));
  check("100 repeats of one request (same idempotency key) create exactly one booking", same.filter((r) => r.ok).length === 1 && (await pool.query(`SELECT count(*)::int AS n FROM bookings`)).rows[0].n === 1);
  check("the repeats were refused by the unique key or the no-overlap rule, never anything else", same.filter((r) => !r.ok).every((r) => (r.code === "23505" && /idempotency/.test(r.constraint)) || r.code === "23P01"), [...new Set(same.filter((r) => !r.ok).map((r) => r.code + ":" + r.constraint))].join(","));
}

console.log("\n=== 5. Daylight saving: weekly series are built from the wall-clock time ===");
{
  // Fall back: Sunday 2026-11-01. A Thursday 9:00 a.m. series from Oct 29.
  const fall = await pool.query(
    `SELECT n, ((('2026-10-29'::date + n*7) + '09:00'::time) AT TIME ZONE 'America/Toronto') AS wall,
            ('2026-10-29 09:00-04'::timestamptz + n * interval '168 hours') AS naive
       FROM generate_series(0, 3) n ORDER BY n`
  );
  const hhmm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
  check("wall-clock series: Oct 29, Nov 5, Nov 12, Nov 19 are all 09:00 Toronto", fall.rows.every((r) => hhmm(r.wall) === "09:00"), fall.rows.map((r) => hhmm(r.wall)).join(" "));
  check("(the old '+7 x 24 hours' arithmetic lands on 08:00 after the clock change)", hhmm(fall.rows[1].naive) === "08:00", fall.rows.map((r) => hhmm(r.naive)).join(" "));
  const spring = await pool.query(
    `SELECT n, ((('2027-03-04'::date + n*7) + '09:00'::time) AT TIME ZONE 'America/Toronto') AS wall,
            ('2027-03-04 09:00-05'::timestamptz + n * interval '168 hours') AS naive
       FROM generate_series(0, 3) n ORDER BY n`
  );
  check("spring forward (Mar 14, 2027): Mar 4, 11, 18, 25 are all 09:00 Toronto", spring.rows.every((r) => hhmm(r.wall) === "09:00"), spring.rows.map((r) => hhmm(r.wall)).join(" "));
  check("(the old arithmetic lands on 10:00 after the clock change)", hhmm(spring.rows[2].naive) === "10:00", spring.rows.map((r) => hhmm(r.naive)).join(" "));

  await reset();
  const series = await reserveLesson(f, Date.parse("2026-10-29T13:00:00Z"), { weeks: 4 }); // 09:00 EDT
  const stored = await pool.query(`SELECT starts_at, local_date, local_start FROM lesson_appointments ORDER BY series_index`);
  check("a stored 4-week series across the fall change keeps 09:00 local on every date", series.ok && stored.rows.every((r) => String(r.local_start).startsWith("09:00") && hhmm(r.starts_at) === "09:00"), stored.rows.map((r) => hhmm(r.starts_at)).join(" "));
  await refused("an appointment whose instant disagrees with its recorded wall-clock time is refused", () => tx(async (c) => {
    const b = await insertBooking(c);
    await addAppointment(c, b, Date.parse("2026-11-05T13:00:00Z"), { product: f.product, location: f.location, localDate: "2026-11-05", localStart: "09:00" });
  }), { constraint: "appointment_wall_clock_matches" });
}

console.log("\n=== 6. Status, time and spots always agree (attacked with raw SQL) ===");
{
  await reset();
  const r = await reserveLesson(f, at(0));
  await refused("cancelling a booking but leaving its time occupied is refused at commit", () => pool.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner', hold_expires_at = NULL WHERE id = $1`, [r.id]), { constraint: "booking_status_matches_time" });
  await refused("freeing a live booking's time without cancelling the booking is refused", () => pool.query(`UPDATE schedule_occupancy SET active = false WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [r.id]), { constraint: "booking_status_matches_time" });
  await refused("deleting a live booking's occupied time is refused", () => pool.query(`DELETE FROM schedule_occupancy WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [r.id]), { constraint: "booking_status_matches_time" });
  await refused("stretching a live booking's occupied range so it no longer matches its lesson is refused", () => pool.query(`UPDATE schedule_occupancy SET span = tstzrange(lower(span), upper(span) + interval '1 hour', '[)') WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [r.id]), { constraint: "booking_status_matches_time" });
  await refused("a live booking with no lesson at all is refused", () => tx((c) => insertBooking(c)), { constraint: "booking_status_matches_time" });
  await tx((c) => cancelLesson(c, r.id));
  await refused("re-activating a cancelled booking's time without reviving the booking is refused", () => pool.query(`UPDATE schedule_occupancy SET active = true WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [r.id]), { constraint: "booking_status_matches_time" });
  const state = (await pool.query(`SELECT status FROM bookings WHERE id = $1`, [r.id])).rows[0].status;
  check("every refused attempt left the cancelled booking exactly as it was", state === "cancelled");

  console.log("  -- the payment states");
  await reset();
  const p = await reserveLesson(f, at(0));
  await refused("a booking cannot be marked paid without a verification record", () => pool.query(`UPDATE bookings SET status = 'paid', hold_expires_at = NULL WHERE id = $1`, [p.id]), { constraint: "bookings_paid_verified" });
  await refused("paid with a different amount received than the amount due is refused", () => tx((c) => markPaid(c, p.id, 10999)), { constraint: "bookings_paid_verified" });
  await refused("a reported payment can never be expired by the system (not a legal move)", async () => {
    await pool.query(`UPDATE bookings SET status = 'payment_reported', hold_expires_at = NULL, payment_reported_at = now(), review_due_at = now() + interval '48 hours' WHERE id = $1`, [p.id]);
    await pool.query(`UPDATE bookings SET status = 'expired', hold_expires_at = NULL WHERE id = $1`, [p.id]);
  }, { constraint: "booking_legal_move" });
  const stillReported = (await pool.query(`SELECT status FROM bookings WHERE id = $1`, [p.id])).rows[0].status;
  check("the reported payment is still reported", stillReported === "payment_reported");
  await tx((c) => markPaid(c, p.id, 11000));
  check("the owner confirming the exact amount makes it paid", (await pool.query(`SELECT status FROM bookings WHERE id = $1`, [p.id])).rows[0].status === "paid");
  await refused("a paid booking's price cannot be edited afterwards", () => pool.query(`UPDATE bookings SET total_cents = 100, subtotal_cents = 100 WHERE id = $1`, [p.id]), { constraint: "booking_fixed_fields" });
  await refused("a paid booking cannot go back to reserved", () => pool.query(`UPDATE bookings SET status = 'reserved' WHERE id = $1`, [p.id]), { constraint: "booking_legal_move" });

  console.log("  -- a late payment after the hold expired");
  await reset();
  const late = await reserveLesson(f, at(0));
  await tx(async (c) => {
    await c.query(`UPDATE bookings SET status = 'expired', hold_expires_at = NULL, cancelled_at = now(), cancelled_by = 'system' WHERE id = $1`, [late.id]);
    await c.query(`UPDATE lesson_appointments SET status = 'scheduled' WHERE booking_id = $1`, [late.id]);
    await c.query(`UPDATE schedule_occupancy SET active = false WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [late.id]);
  });
  const stranger = await reserveLesson(f, at(0));
  check("setup: the expired hold's time was taken by someone else", stranger.ok);
  const lateConfirm = async (id) => tx(async (c) => {
    await c.query(`UPDATE schedule_occupancy SET active = true WHERE lesson_appointment_id IN (SELECT id FROM lesson_appointments WHERE booking_id = $1)`, [id]);
    await markPaid(c, id, 11000);
  });
  await refused("confirming the late payment is refused because the time is gone (23P01)", () => lateConfirm(late.id), { code: "23P01", constraint: "schedule_no_overlap" });
  const after = (await pool.query(`SELECT b.status, (SELECT count(*) FROM schedule_occupancy o JOIN lesson_appointments a ON a.id = o.lesson_appointment_id WHERE a.booking_id = b.id AND o.active)::int AS occ FROM bookings b WHERE b.id = $1`, [late.id])).rows[0];
  check("the late booking is unchanged (still expired, holds nothing) and the stranger is untouched", after.status === "expired" && after.occ === 0 && (await pool.query(`SELECT status FROM bookings WHERE id = $1`, [stranger.id])).rows[0].status === "reserved");
  await tx((c) => cancelLesson(c, stranger.id));
  await lateConfirm(late.id);
  check("once the time is free again the same late payment can be confirmed, atomically", (await pool.query(`SELECT status FROM bookings WHERE id = $1`, [late.id])).rows[0].status === "paid");

  console.log("  -- money");
  await refused("a booking cannot be created while the tax mode is still unset", () => tx((c) => insertBooking(c, { taxMode: "unset" })), { code: "23514" });
  await refused("totals that do not add up are refused", () => tx((c) => insertBooking(c, { total: 12000, subtotal: 11000, gst: 500, qst: 400 })), { constraint: "bookings_total_is_sum" });
  await refused("'no tax' with a tax amount is refused", () => tx((c) => insertBooking(c, { taxMode: "none", total: 11550, subtotal: 11000, gst: 550 })), { constraint: "bookings_no_tax_when_none" });
}

console.log("\n=== 7. The Google Calendar fail-safe is in the data ===");
{
  await reset();
  await refused("a lesson with no calendar check recorded cannot be reserved", () => tx(async (c) => insertBooking(c, { checkedAt: null, checkResult: null })), { constraint: "bookings_lesson_calendar_checked" });
  await refused("a lesson whose calendar check is older than 30 seconds cannot be reserved", () => tx(async (c) => insertBooking(c, { checkedAt: Date.now() - 31_000 })), { constraint: "bookings_lesson_calendar_checked" });
  await refused("a lesson with a check dated in the future cannot be reserved", () => tx(async (c) => insertBooking(c, { checkedAt: Date.now() + 10 * MIN })), { constraint: "bookings_lesson_calendar_checked" });
  const fresh = await reserveLesson(f, at(0), { checkedAt: Date.now() - 2_000 });
  check("a lesson checked 2 seconds before reserving is accepted", fresh.ok);
  await refused("a customer's booking cannot use the owner override", () => tx(async (c) => insertBooking(c, { checkResult: "manual_override", createdBy: "customer" })), { constraint: "bookings_override_is_owner_only" });
  const phoneBooking = await reserveLesson(f, at(120), { checkedAt: Date.now() - 1_000, checkResult: "manual_override", createdBy: "owner" });
  check("James can book a customer by phone with the explicit override (recorded as such)", phoneBooking.ok && (await pool.query(`SELECT calendar_check_result FROM bookings WHERE id = $1`, [phoneBooking.id])).rows[0].calendar_check_result === "manual_override");
  const clinicNoCal = await reserveClinicParty(f, f.offering, ["A. Participant"]);
  check("a clinic does not need a calendar check (Google is not involved in clinics)", clinicNoCal.ok);
  await reset();
}

console.log("\n=== 8. Clinics: capacity can never be exceeded ===");
{
  await reset();
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => reserveClinicParty(f, f.offering, [`Player ${i}`])));
  const won = results.filter((r) => r.ok).length;
  check("100 people race for 10 spots: exactly 10 get one", won === 10, `${won} won`);
  check("everyone else was refused by the capacity rule", results.filter((r) => !r.ok).every((r) => r.code === "23514" && r.constraint === "clinic_capacity"), [...new Set(results.filter((r) => !r.ok).map((r) => r.code + ":" + r.constraint))].join(","));
  const o = (await pool.query(`SELECT taken_count, (SELECT count(*) FROM clinic_spots WHERE offering_id = o.id AND status = 'active')::int AS active FROM clinic_offerings o WHERE id = $1`, [f.offering])).rows[0];
  check("the counter equals the active spots equals the capacity", o.taken_count === 10 && o.active === 10, JSON.stringify(o));

  await reset();
  await Promise.all(Array.from({ length: 8 }, (_, i) => reserveClinicParty(f, f.offering, [`Seed ${i}`])));
  const party3 = await reserveClinicParty(f, f.offering, ["Trio A", "Trio B", "Trio C"]);
  check("a party of 3 when only 2 spots remain is refused whole", !party3.ok && party3.constraint === "clinic_capacity");
  const rows = (await pool.query(`SELECT taken_count FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0];
  check("none of the trio was kept (still 8 taken)", rows.taken_count === 8);

  const mixed = await Promise.all([reserveClinicParty(f, f.offering, ["Pair A", "Pair B"]), reserveClinicParty(f, f.offering, ["Solo A"]), reserveClinicParty(f, f.offering, ["Pair C", "Pair D"]), reserveClinicParty(f, f.offering, ["Solo B"])]);
  const final = (await pool.query(`SELECT taken_count FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0].taken_count;
  const partial = (await pool.query(`SELECT count(*)::int AS n FROM bookings b WHERE b.kind = 'clinic' AND b.status = 'reserved' AND EXISTS (SELECT 1 FROM clinic_spots s WHERE s.booking_id = b.id AND s.status <> 'active')`)).rows[0].n;
  check("two pairs and two solos racing for the last 2 spots: never above capacity, no partial party", final <= 10 && partial === 0, `${final}/10 taken, wins=${mixed.filter((r) => r.ok).length}`);

  // Release racing a reservation.
  await reset();
  const filled = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveClinicParty(f, f.offering, [`Fill ${i}`])));
  const releaseId = filled.find((r) => r.ok).id;
  const [rel, newcomer] = await Promise.all([
    tx(async (c) => {
      await c.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner', hold_expires_at = NULL WHERE id = $1`, [releaseId]);
      await c.query(`UPDATE clinic_spots SET status = 'cancelled' WHERE booking_id = $1`, [releaseId]);
    }).then(() => true, () => false),
    reserveClinicParty(f, f.offering, ["Newcomer"]),
  ]);
  const t = (await pool.query(`SELECT taken_count FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0].taken_count;
  check("a spot released while someone reserves: counter stays between 9 and 10 and matches the active spots", rel === true && t === (newcomer.ok ? 10 : 9), `released=${rel} newcomer=${newcomer.ok} taken=${t}`);

  console.log("  -- raw SQL attacks on the counter");
  await reset();
  await reserveClinicParty(f, f.offering, ["Real A", "Real B"]);
  await refused("zeroing the counter while spots are active is refused at commit", () => pool.query(`UPDATE clinic_offerings SET taken_count = 0 WHERE id = $1`, [f.offering]), { constraint: "clinic_counter" });
  await refused("lowering the capacity below the spots already taken is refused", () => pool.query(`UPDATE clinic_offerings SET capacity = 1 WHERE id = $1`, [f.offering]), { constraint: "clinic_taken_within_capacity" });
  await refused("raising the capacity above the standard 10 without a recorded authorization is refused", () => pool.query(`UPDATE clinic_offerings SET capacity = 12 WHERE id = $1`, [f.offering]), { constraint: "clinic_capacity_authorization" });
  await refused("an authorization needs a real written note", () => pool.query(`INSERT INTO booking_capacity_authorizations (offering_id, capacity, note) VALUES ($1, 12, 'ok')`, [f.offering]), { code: "23514" });
  await pool.query(`INSERT INTO booking_capacity_authorizations (offering_id, capacity, note) VALUES ($1, 12, 'James approved two extra: coach assistant available')`, [f.offering]);
  await pool.query(`UPDATE clinic_offerings SET capacity = 12 WHERE id = $1`, [f.offering]);
  check("with a recorded authorization the capacity can be raised to the authorized number", (await pool.query(`SELECT capacity FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0].capacity === 12);
  await refused("a cancelled clinic booking that still holds a spot is refused", () => pool.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner', hold_expires_at = NULL WHERE kind = 'clinic'`), { constraint: "booking_status_matches_spots" });
  await pool.query(`UPDATE clinic_offerings SET capacity = 10 WHERE id = $1`, [f.offering]);
  await reset();
}

console.log("\n=== 9. Lesson packages (built, off until approved): a credit can never be spent twice ===");
{
  await pool.query(`DELETE FROM package_purchases`).catch(() => {});
  const mk = async (credits, { paid = true, expires = "now() + interval '1 year'" } = {}) =>
    (await pool.query(`INSERT INTO package_purchases (customer_email, credits_total, credits_remaining, expires_at, rules_version, paid_at) VALUES ('c@example.test', $1, $1, ${expires}, 'draft-1', ${paid ? "now()" : "NULL"}) RETURNING id`, [credits])).rows[0].id;
  // "ok", "credit_balance" (the rule's own refusal), or the name of whatever else refused it.
  const spend = (id, delta = -1) => pool.query(`INSERT INTO credit_ledger (purchase_id, delta, reason) VALUES ($1,$2,'test')`, [id, delta]).then(() => "ok", (e) => e.constraint ?? e.code);
  const one = await mk(1);
  const race = await Promise.all(Array.from({ length: 20 }, () => spend(one)));
  check("20 simultaneous attempts to spend the last credit: exactly one succeeds", race.filter((r) => r === "ok").length === 1);
  check("everyone else is told 'no credits left' by the rule itself", race.filter((r) => r !== "ok").every((r) => r === "credit_balance"), [...new Set(race)].join(","));
  check("the balance is exactly 0, never negative", (await pool.query(`SELECT credits_remaining FROM package_purchases WHERE id = $1`, [one])).rows[0].credits_remaining === 0);
  const five = await mk(5);
  const race5 = await Promise.all(Array.from({ length: 30 }, () => spend(five)));
  check("30 attempts against a 5-credit package: exactly 5 succeed", race5.filter((r) => r === "ok").length === 5 && race5.filter((r) => r !== "ok").every((r) => r === "credit_balance"));
  const unpaid = await mk(3, { paid: false });
  check("credits of an unpaid package cannot be spent", (await spend(unpaid)) === "credit_balance");
  const expired = await mk(3, { expires: "now() - interval '1 day'" });
  check("credits of an expired package cannot be spent", (await spend(expired)) === "credit_balance");
  const giveBack = await mk(2);
  check("giving back a credit that was never spent (above the total) is refused", (await spend(giveBack, +1)) === "credit_balance");
  await spend(giveBack);
  check("a credit given back after a spend is accepted", (await spend(giveBack, +1)) === "ok");
  await refused("the credit ledger cannot be edited", () => pool.query(`UPDATE credit_ledger SET delta = -5`), { constraint: "credit_ledger_append_only" });
  await refused("the credit ledger cannot be deleted from", () => pool.query(`DELETE FROM credit_ledger`), { constraint: "credit_ledger_append_only" });
}

// ---------------------------------------------------------------------------------------------
console.log("\n=== 10. The money arithmetic (reference implementation for the real module) ===");
{
  // Basis points would lose 9.975%, so rates are NUMERIC(6,5) in the database and exact thousandths-of-a-cent
  // integers here: rate * 1e5 (5000 and 9975) and every product is rounded half up to the cent.
  const GST = 5000, QST = 9975; // per 100,000
  const roundDiv = (num, den) => Math.floor((2 * num + den) / (2 * den)); // half up, integers only
  const tax = (cents, rate) => roundDiv(cents * rate, 100_000);

  function price(mode, base, { exempt = false, gst = GST, qst = QST } = {}) {
    if (mode === "none" || exempt) return { subtotal: base, gst: 0, qst: 0, total: base };
    if (mode === "added") { const g = tax(base, gst), q = tax(base, qst); return { subtotal: base, gst: g, qst: q, total: base + g + q }; }
    if (mode === "included") {
      // The advertised price IS the total. Find the pre-tax amount whose own taxes add back to it.
      const guess = roundDiv(base * 100_000, 100_000 + gst + qst);
      for (const d of [0, -1, 1, -2, 2]) {
        const sub = guess + d, g = tax(sub, gst), q = tax(sub, qst);
        if (sub + g + q === base) return { subtotal: sub, gst: g, qst: q, total: base, exact: true };
      }
      // No pre-tax amount reproduces the total exactly: keep the total, put the odd cent on the QST line.
      const g = tax(guess, gst);
      return { subtotal: guess, gst: g, qst: base - guess - g, total: base, exact: false };
    }
    throw new Error("unset: no price may be computed");
  }

  const camp = (sub) => ({ g: Math.round(sub * 0.05), q: Math.round(sub * 0.09975) });
  let diffFromCamp = 0, identityBreaks = 0, maxQstOff = 0, inexact = 0;
  for (let base = 0; base <= 200_000; base += 1) {
    const a = price("added", base);
    const c = camp(base);
    if (a.gst !== c.g || a.qst !== c.q) diffFromCamp++;
    if (a.subtotal + a.gst + a.qst !== a.total) identityBreaks++;
    const inc = price("included", base);
    if (inc.subtotal + inc.gst + inc.qst !== inc.total || inc.total !== base) identityBreaks++;
    if (!inc.exact && base > 0) inexact++;
    maxQstOff = Math.max(maxQstOff, Math.abs(inc.qst - tax(inc.subtotal, QST)));
  }
  check("'added' gives the same cents as the camp's existing calculation for every price from $0.00 to $2,000.00", diffFromCamp === 0, `${diffFromCamp} differences`);
  check("subtotal + GST + QST equals the total in every mode for every price from $0.00 to $2,000.00", identityBreaks === 0, `${identityBreaks} breaks`);
  check("'included': the QST line is never more than 1 cent from 9.975% of the pre-tax amount", maxQstOff <= 1, `max off by ${maxQstOff} cent(s); ${inexact} of 200,000 prices needed the odd-cent rule`);
  const ex = (m, b) => { const r = price(m, b); return `${m} $${(b / 100).toFixed(2)} -> ${(r.subtotal / 100).toFixed(2)} + ${(r.gst / 100).toFixed(2)} + ${(r.qst / 100).toFixed(2)} = ${(r.total / 100).toFixed(2)}`; };
  console.log("    " + [ex("added", 11000), ex("included", 11000), ex("added", 20000), ex("included", 20000), ex("none", 11000)].join("\n    "));
  check("an exempt product never has tax whatever the mode", price("added", 20000, { exempt: true }).gst === 0 && price("included", 20000, { exempt: true }).total === 20000);
  let threw = false; try { price("unset", 100); } catch { threw = true; }
  check("with the mode unset no price can be computed at all", threw);
}

// ---------------------------------------------------------------------------------------------
console.log("\n=== 11. At the end the camp is still exactly as it was ===");
{
  const end = await snapshotCamp();
  check("camp tables, constraints, triggers, indexes and functions are still identical to the start", end === before);
}

await reset();
await pool.end();
await testDb.drop();
console.log(`\n\n${failures === 0 ? `ALL TESTS PASS (${checks - failures} pass, 0 fail)` : `${failures} OF ${checks} CHECK(S) FAILED`} — lessons-clinics-sketch`);
process.exit(failures === 0 ? 0 : 1);
