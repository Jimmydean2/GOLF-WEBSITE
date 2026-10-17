// The lessons-and-clinics DESIGN SKETCH, revision 2 (docs/design/lessons-clinics-schema-sketch.sql),
// attacked on a real throwaway PostgreSQL with real parallel connections. Nothing here is a migration:
// the sketch is applied on top of the camp's migrations to prove, before any real migration is written, that
//
//   PRIVATE LESSONS (book now, pay at the lesson: cash or Interac e-Transfer)
//   * a lesson is confirmed the moment it is booked and can never expire for lack of payment: there is no
//     hold column, no 'expired' status, and the system can never cancel a lesson by itself;
//   * two customers cannot hold overlapping times, however fast they click; a time freed by a cancellation
//     can be booked again; a lesson moved by the owner is checked by the same rule;
//   * the owner closes a lesson out (Completed / No-show) and records Unpaid / Paid - Cash / Paid - Interac,
//     only for a lesson that has happened, and every change is written to an append-only trail by the
//     database itself (even raw SQL leaves a record);
//   * cancellation rules are frozen into each booking; fees never exceed the price; a free cancellation
//     owes nothing; an online customer cannot hold more than a few lessons or keep leaving them unpaid;
//   * reminders are queued exactly once, however many workers run and however late;
//   * no customer lesson exists without a live Google Calendar check recorded seconds before.
//
//   GROUP CLINICS (advance payment, as the camp)
//   * capacity can never be exceeded, a party is all or nothing, a reported payment is never expired, Paid needs
//     the exact amount verified, and a late payment re-takes spots only if they are still free;
//
//   EVERYTHING
//   * the sketch only ADDS (the camp is byte-identical before and after), can be applied twice, money is frozen and
//     adds up, packages cannot be spent twice, weekly series survive both daylight-saving changes.
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
const HOUR = 60 * MIN;
const iso = (d) => new Date(d).toISOString();
// An instant on a far-away Monday, so nothing depends on today's date. 2027-03-01 is a Monday.
const BASE = Date.parse("2027-03-01T14:00:00Z"); // 9:00 a.m. Toronto (EST, UTC-5)
const at = (minutesFromBase) => BASE + minutesFromBase * MIN;
let seq = 0;
const newContact = () => {
  const n = ++seq;
  return { name: `Test Person ${n}`, email: `person${n}@example.test`, phone: `514-555-${String(1000 + n).padStart(4, "0")}` };
};

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
const actAs = (client, actor, note) => client.query(`SELECT set_config('app.actor', $1, true), set_config('app.note', $2, true)`, [actor, note ?? ""]);
let pastN = 0;
// A distinct start time in the past for each lesson that has "already happened" (they must not overlap each other).
const pastSlot = () => Date.now() - (6 + 2 * ++pastN) * HOUR;
const asOwner = (fn, note) => tx(async (c) => { await actAs(c, "owner", note); return fn(c); });

async function insertLesson(client, startMs, o = {}) {
  const id = o.id ?? randomUUID();
  const c = o.contact ?? newContact();
  const slot = o.slot ?? 60;
  const buffer = o.buffer ?? 0;
  const total = o.total ?? 11000;
  const ends = startMs + slot * MIN;
  const until = ends + buffer * MIN;
  const createdAtMs = o.createdAt ? new Date(o.createdAt).getTime() : null;
  const checkedAt = o.checkedAt === undefined ? (createdAtMs ?? Date.now()) - 500 : o.checkedAt;
  const { rows } = await client.query(
    `SELECT (($1::timestamptz AT TIME ZONE 'America/Toronto')::date)::text AS d, (($1::timestamptz AT TIME ZONE 'America/Toronto')::time)::text AS t`,
    [iso(startMs)]
  );
  const row = {
    id, status: o.status ?? "confirmed", created_by: o.createdBy ?? "customer", series_id: o.seriesId ?? null, series_index: o.seriesIndex ?? 1,
    idempotency_key: o.idempotencyKey ?? `k-${id}`, reference_code: ref("GL-"),
    customer_name: c.name, email: c.email, phone: c.phone, language: o.language ?? "en",
    privacy_consent_at: iso(Date.now()), privacy_notice_version: "v1",
    policy_version: o.policyVersion ?? "policy-test-1", cancel_notice_hours: 24, late_cancel_fee_percent: 50, no_show_fee_percent: 100,
    product_id: o.product, location_id: o.location, participants: o.participants ?? 1,
    starts_at: iso(startMs), ends_at: iso(ends), occupied_until: iso(until), local_date: rows[0].d, local_start: rows[0].t,
    tax_mode: o.taxMode ?? "added", gst_rate: 0.05, qst_rate: 0.09975,
    subtotal_cents: o.subtotal ?? total, gst_cents: o.gst ?? 0, qst_cents: o.qst ?? 0, total_cents: total, amount_owed_cents: total,
    calendar_checked_at: checkedAt === null ? null : iso(checkedAt), calendar_check_result: o.checkResult === undefined ? "clear" : o.checkResult,
  };
  if (createdAtMs) row.created_at = iso(createdAtMs);
  const keys = Object.keys(row);
  await client.query(`INSERT INTO lesson_bookings (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((k) => row[k]));
  await client.query(`INSERT INTO schedule_occupancy (kind, span, lesson_booking_id) VALUES ('lesson', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(startMs), iso(until), id]);
  return id;
}

// One customer's (or the owner's) lesson, as the application would make it: one transaction.
async function reserveLesson(f, startMs, opts = {}) {
  try {
    const id = await tx(async (c) => {
      await actAs(c, opts.createdBy ?? "customer");
      if (opts.series) {
        const sid = randomUUID();
        const contact = opts.contact ?? newContact();
        let first = null;
        for (let i = 0; i < opts.series; i++) {
          // A weekly series is built from the wall-clock time, week by week.
          const { rows } = await c.query(
            `SELECT ((((($1::timestamptz AT TIME ZONE 'America/Toronto')::date + $2::int) + (($1::timestamptz AT TIME ZONE 'America/Toronto')::time)) AT TIME ZONE 'America/Toronto')) AS ts`,
            [iso(startMs), i * 7]
          );
          const bid = await insertLesson(c, new Date(rows[0].ts).getTime(), { ...opts, contact, seriesId: sid, seriesIndex: i + 1, product: f.product, location: f.location, idempotencyKey: `${opts.idempotencyKey ?? randomUUID()}#${i + 1}` });
          first ??= bid;
        }
        return first;
      }
      return insertLesson(c, startMs, { ...opts, product: f.product, location: f.location });
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, code: e.code, constraint: e.constraint, message: e.message };
  }
}

const lesson = async (id) => (await pool.query(`SELECT * FROM lesson_bookings WHERE id = $1`, [id])).rows[0];
const eventsOf = async (id) => (await pool.query(`SELECT * FROM lesson_events WHERE booking_id = $1 ORDER BY id`, [id])).rows;
const activeOccupancy = async (id) => (await pool.query(`SELECT count(*)::int AS n FROM schedule_occupancy WHERE lesson_booking_id = $1 AND active`, [id])).rows[0].n;

// Owner actions, each one transaction that says who is acting.
const closeOut = (id, { status = "completed", payment = "unpaid", amount = null, note = null, reference = null, owed = null } = {}) =>
  asOwner(async (c) => {
    const paid = payment !== "unpaid";
    await c.query(
      `UPDATE lesson_bookings SET status = $2, closed_at = now(),
              amount_owed_cents = COALESCE($3, amount_owed_cents),
              payment_status = $4, paid_at = CASE WHEN $5 THEN now() END,
              paid_amount_cents = CASE WHEN $5 THEN COALESCE($6, COALESCE($3, amount_owed_cents)) END,
              payment_reference = $7, payment_note = $8
        WHERE id = $1`,
      [id, status, owed, payment, paid, amount, reference, note]
    );
  }, note);
const setPayment = (id, payment, { amount = null, note = null, reference = null } = {}) =>
  asOwner(async (c) => {
    const paid = payment !== "unpaid";
    await c.query(
      `UPDATE lesson_bookings SET payment_status = $2, paid_at = CASE WHEN $3 THEN now() END,
              paid_amount_cents = CASE WHEN $3 THEN COALESCE($4, amount_owed_cents) END, payment_reference = $5, payment_note = $6
        WHERE id = $1`,
      [id, payment, paid, amount, reference, note]
    );
  }, note);
const cancelLesson = (id, { by = "owner", late = false, owed = 0, reason = "test", actor = by } = {}) =>
  tx(async (c) => {
    await actAs(c, actor, reason);
    await c.query(
      `UPDATE lesson_bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, late_cancelled = $4, amount_owed_cents = $5 WHERE id = $1`,
      [id, by, reason, late, owed]
    );
    await c.query(`UPDATE schedule_occupancy SET active = false WHERE lesson_booking_id = $1`, [id]);
  });
const moveLesson = (id, startMs, { slot = 60, buffer = 0, actor = "owner" } = {}) =>
  tx(async (c) => {
    await actAs(c, actor, "moved");
    const ends = startMs + slot * MIN;
    const until = ends + buffer * MIN;
    const { rows } = await c.query(
      `SELECT (($1::timestamptz AT TIME ZONE 'America/Toronto')::date)::text AS d, (($1::timestamptz AT TIME ZONE 'America/Toronto')::time)::text AS t`,
      [iso(startMs)]
    );
    await c.query(`UPDATE lesson_bookings SET starts_at = $2, ends_at = $3, occupied_until = $4, local_date = $5, local_start = $6 WHERE id = $1`, [id, iso(startMs), iso(ends), iso(until), rows[0].d, rows[0].t]);
    await c.query(`UPDATE schedule_occupancy SET span = tstzrange($2::timestamptz, $3::timestamptz, '[)') WHERE lesson_booking_id = $1`, [id, iso(startMs), iso(until)]);
  });

// ---- clinic helpers (advance payment) --------------------------------------------------------
async function insertClinicBooking(client, o = {}) {
  const id = o.id ?? randomUUID();
  const total = o.total ?? 20000;
  const status = o.status ?? "reserved";
  await client.query(
    `INSERT INTO clinic_bookings (id, created_by, idempotency_key, reference_code, customer_name, email, phone, privacy_consent_at, privacy_notice_version,
        status, tax_mode, gst_rate, qst_rate, subtotal_cents, gst_cents, qst_cents, total_cents, hold_expires_at, hold_ends_at_initial,
        payment_reported_at, review_due_at)
     VALUES ($1,'customer',$2,$3,'Test Person','p@example.test','514-555-0100', now(), 'v1', $4, 'added', 0.05, 0.09975,
        $5,0,0,$5, $6, $6, $7, $8)`,
    [
      id, o.idempotencyKey ?? `k-${id}`, ref("GC-"), status, total,
      status === "payment_reported" ? null : iso(Date.now() + 12 * HOUR),
      status === "payment_reported" ? iso(Date.now()) : null,
      status === "payment_reported" ? iso(Date.now() + 48 * HOUR) : null,
    ]
  );
  return id;
}
async function reserveClinicParty(offeringId, names, opts = {}) {
  try {
    const id = await tx(async (c) => {
      const b = await insertClinicBooking(c, opts);
      for (const n of names) await c.query(`INSERT INTO clinic_spots (booking_id, offering_id, participant_name) VALUES ($1,$2,$3)`, [b, offeringId, n]);
      return b;
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, code: e.code, constraint: e.constraint, message: e.message };
  }
}
const markClinicPaid = (client, id, total) =>
  client.query(
    `UPDATE clinic_bookings SET status = 'paid', hold_expires_at = NULL, payment_reported_at = NULL, review_due_at = NULL, verified_at = now(),
        verification_method = 'reference_matched', deposit_at = now(), amount_received_cents = $2 WHERE id = $1`,
    [id, total]
  );

async function reset() {
  // Deleting a booking removes its occupied time, spots and reminders together (the database frees the capacity
  // itself); owner blocks and clinic sessions are removed separately. The audit trail has no link to bookings and stays.
  await pool.query(`DELETE FROM lesson_bookings`);
  await pool.query(`DELETE FROM clinic_bookings`);
  await pool.query(`DELETE FROM schedule_occupancy`);
  await pool.query(`DELETE FROM clinic_sessions`);
}
const resetSettings = () =>
  pool.query(`UPDATE booking_settings SET max_upcoming_lessons_per_contact = 2, block_after_unpaid_lessons = 2, unpaid_grace_days = 7, reminder_first_hours = 24, reminder_second_hours = 2`);

// The rules that must hold after EVERY section (they are the invariant checker of the test plan).
async function invariants(label) {
  const q = async (sql) => (await pool.query(sql)).rows[0].n;
  const overlaps = await q(`SELECT count(*)::int AS n FROM schedule_occupancy a JOIN schedule_occupancy b ON a.id < b.id AND a.active AND b.active AND a.span && b.span`);
  const liveWithoutTime = await q(`SELECT count(*)::int AS n FROM lesson_bookings l WHERE l.status IN ('confirmed','completed','no_show') AND (SELECT count(*) FROM schedule_occupancy o WHERE o.lesson_booking_id = l.id AND o.active) <> 1`);
  const cancelledWithTime = await q(`SELECT count(*)::int AS n FROM lesson_bookings l WHERE l.status = 'cancelled' AND EXISTS (SELECT 1 FROM schedule_occupancy o WHERE o.lesson_booking_id = l.id AND o.active)`);
  const counters = await q(`SELECT count(*)::int AS n FROM clinic_offerings o WHERE o.taken_count <> (SELECT count(*) FROM clinic_spots s WHERE s.offering_id = o.id AND s.status = 'active') OR o.taken_count > o.capacity`);
  const noTrail = await q(`SELECT count(*)::int AS n FROM lesson_bookings l WHERE NOT EXISTS (SELECT 1 FROM lesson_events e WHERE e.booking_id = l.id AND e.event = 'created')`);
  const expired = await q(`SELECT count(*)::int AS n FROM lesson_bookings WHERE status NOT IN ('confirmed','completed','cancelled','no_show')`);
  const bad = { overlaps, liveWithoutTime, cancelledWithTime, counters, noTrail, expired };
  check(`invariants after ${label}: no overlaps, every live lesson holds its time, nothing cancelled holds time, counters true, every lesson has a trail`, Object.values(bad).every((n) => n === 0), JSON.stringify(bad));
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
  check("a fresh install is 'tax unset' and 'cancellation policy unset': nothing can open to the public until James confirms both", s.tax_mode === "unset" && s.cancellation_policy_version === "unset" && s.cancellation_policy_confirmed_at === null);
  check("the proposed rules: 24-hour cancellation notice, no online reschedule, contact-only inside the notice, no fees until approved", s.cancel_notice_hours === 24 && s.reschedule_notice_hours === 24 && s.customer_can_cancel === true && s.customer_can_reschedule === false && s.inside_notice_online_action === "contact_only" && s.late_cancel_fee_percent === 0 && s.no_show_fee_percent === 0);
  check("reminders default to 24 hours and 2 hours before; at most 2 upcoming lessons per contact", s.reminder_first_hours === 24 && s.reminder_second_hours === 2 && s.max_upcoming_lessons_per_contact === 2);
  check("clinics keep the 12-hour hold (3 hours when close); packages are off", s.clinic_hold_minutes === 720 && s.clinic_hold_near_minutes === 180 && s.packages_approved_at === null);
  const settingsCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'booking_settings'`)).rows.map((r) => r.column_name);
  check("there is no lesson hold setting at all (lessons have no hold)", !settingsCols.some((c) => /lesson.*hold|series.*hold/.test(c)));
  const p = (await pool.query(`SELECT slot_minutes, lesson_minutes, buffer_after_minutes FROM lesson_products WHERE id = $1`, [f.product])).rows[0];
  check("a new lesson product defaults to a 60-minute slot, 55-minute lesson, no extra buffer", p.slot_minutes === 60 && p.lesson_minutes === 55 && p.buffer_after_minutes === 0);
  await refused("choosing a tax mode without recording the confirmation is refused", () => pool.query(`UPDATE booking_settings SET tax_mode = 'added'`), { constraint: "tax_confirmed_when_set" });
  await refused("naming a cancellation policy without recording James's confirmation is refused", () => pool.query(`UPDATE booking_settings SET cancellation_policy_version = 'v1'`), { constraint: "policy_confirmed_when_set" });
  await pool.query(`UPDATE booking_settings SET tax_mode = 'included', tax_confirmed_at = now(), cancellation_policy_version = 'v1', cancellation_policy_confirmed_at = now()`);
  check("recording the confirmations with the choices works", (await pool.query(`SELECT tax_mode FROM booking_settings`)).rows[0].tax_mode === "included");
  await pool.query(`UPDATE booking_settings SET tax_mode = 'unset', tax_confirmed_at = NULL, cancellation_policy_version = 'unset', cancellation_policy_confirmed_at = NULL`);
  await refused("a stale-calendar threshold not above the refresh interval is refused", () => pool.query(`UPDATE booking_settings SET calendar_stale_after_minutes = 5`), { constraint: "calendar_stale_after_refresh" });
  await refused("a second reminder not earlier than the first is refused", () => pool.query(`UPDATE booking_settings SET reminder_first_hours = 2, reminder_second_hours = 24`), { constraint: "reminders_in_order" });
  await refused("a second settings row cannot exist", () => pool.query(`INSERT INTO booking_settings (id) VALUES (2)`), { code: "23514" });
  await refused("a lesson longer than its slot is refused", () => pool.query(`INSERT INTO lesson_products (slug, name_en, name_fr, slot_minutes, lesson_minutes) VALUES ('x','x','x',45,60)`), { code: "23514" });
  await pool.query(`INSERT INTO price_periods (product_id, valid_from, valid_to, price_cents) VALUES ($1,'2027-05-01','2027-10-31',11000)`, [f.product]);
  await pool.query(`INSERT INTO price_periods (product_id, valid_from, valid_to, price_cents) VALUES ($1,'2027-11-01','2028-04-30',11500)`, [f.product]);
  check("two back-to-back price periods (summer, winter) are fine", true);
  await refused("two prices for one product on the same day are refused", () => pool.query(`INSERT INTO price_periods (product_id, valid_from, valid_to, price_cents) VALUES ($1,'2027-10-15','2027-11-15',12000)`, [f.product]), { code: "23P01", constraint: "price_periods_no_overlap" });
}

console.log("\n=== 3. Lessons: the database refuses overlapping times, even for 50 simultaneous clicks ===");
{
  await reset();
  const results = await Promise.all(Array.from({ length: 50 }, () => reserveLesson(f, at(0))));
  const wins = results.filter((r) => r.ok);
  const lost = results.filter((r) => !r.ok);
  check("50 customers click the same 9:00 slot at the same instant: exactly one wins", wins.length === 1, `${wins.length} won`);
  check("the other 49 are refused by the no-overlap rule (23P01), nothing else went wrong", lost.length === 49 && lost.every((r) => r.code === "23P01" && r.constraint === "schedule_no_overlap"), [...new Set(lost.map((r) => r.code + ":" + r.constraint))].join(","));
  const n = (await pool.query(`SELECT (SELECT count(*) FROM lesson_bookings)::int AS b, (SELECT count(*) FROM schedule_occupancy WHERE active)::int AS o`)).rows[0];
  check("exactly one lesson and one occupied range remain (the 49 rolled back whole)", n.b === 1 && n.o === 1, JSON.stringify(n));
  const winner = await lesson(wins[0].id);
  check("the winner is CONFIRMED at once, unpaid, and owes the full price", winner.status === "confirmed" && winner.payment_status === "unpaid" && winner.amount_owed_cents === winner.total_cents);
  await invariants("the 50-click race");

  let wrong = [];
  for (let off = -55; off <= 55; off += 5) {
    if (off === 0) continue;
    const r = await reserveLesson(f, at(off));
    const overlaps = off > -60 && off < 60;
    if (overlaps && r.ok) wrong.push(`accepted overlap at ${off}`);
    if (!overlaps && !r.ok) wrong.push(`refused non-overlap at ${off}`);
    if (r.ok) await cancelLesson(r.id);
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

  await reset();
  const blk = randomUUID();
  await pool.query(`INSERT INTO schedule_occupancy (kind, span, time_block_id, reason) VALUES ('block', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3, 'vacation')`, [iso(at(0)), iso(at(240)), blk]);
  const onBlock = await reserveLesson(f, at(60));
  check("a lesson cannot be booked inside a time James has blocked", !onBlock.ok && onBlock.code === "23P01");
  await reset();
  const lessonFirst = await reserveLesson(f, at(60));
  await refused("James cannot block a time that already holds a lesson (he must move or cancel the lesson first)", () => pool.query(`INSERT INTO schedule_occupancy (kind, span, time_block_id) VALUES ('block', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(at(0)), iso(at(240)), randomUUID()]), { code: "23P01", constraint: "schedule_no_overlap" });
  check("(the lesson is still there)", lessonFirst.ok && (await pool.query(`SELECT count(*)::int AS n FROM schedule_occupancy WHERE active`)).rows[0].n === 1);

  await reset();
  const raceBlock = [];
  for (let i = 0; i < 20; i++) {
    raceBlock.push(reserveLesson(f, at(i * 15 - 60)));
    raceBlock.push(pool.query(`INSERT INTO schedule_occupancy (kind, span, time_block_id) VALUES ('block', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(at(0)), iso(at(60)), randomUUID()]).then(() => ({ ok: true }), (e) => ({ ok: false, code: e.code })));
  }
  await Promise.allSettled(raceBlock);
  const both = (await pool.query(`SELECT count(*)::int AS n FROM schedule_occupancy a JOIN schedule_occupancy b ON a.id < b.id AND a.active AND b.active AND a.span && b.span`)).rows[0].n;
  check("20 lessons racing 20 blocks over the same hour: never two overlapping active ranges", both === 0, `${both} overlaps`);

  await reset();
  const sessionId = randomUUID();
  await pool.query(`INSERT INTO clinic_sessions (id, offering_id, starts_at, ends_at) VALUES ($1,$2,$3,$4)`, [sessionId, f.offering, iso(at(1440 * 5 + 90)), iso(at(1440 * 5 + 180))]);
  await pool.query(`INSERT INTO schedule_occupancy (kind, span, clinic_session_id) VALUES ('clinic_session', tstzrange($1::timestamptz, $2::timestamptz, '[)'), $3)`, [iso(at(1440 * 5 + 90)), iso(at(1440 * 5 + 180)), sessionId]);
  const onClinic = await reserveLesson(f, at(1440 * 5 + 120));
  check("a private lesson cannot be sold on top of a clinic session", !onClinic.ok && onClinic.code === "23P01");
  await reset();
}

console.log("\n=== 4. A confirmed lesson NEVER expires for lack of payment ===");
{
  await reset();
  const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'lesson_bookings'`)).rows.map((r) => r.column_name);
  check("the lesson table has no hold, deadline, expiry or review-due column at all", !cols.some((c) => /hold|expire|deadline|review_due|reported/.test(c)), cols.filter((c) => /hold|expire|deadline|due/.test(c)).join(","));
  const old = await reserveLesson(f, at(1440 * 30), { createdAt: Date.now() - 90 * 24 * HOUR });
  check("a lesson booked 90 days ago and never paid is accepted as confirmed", old.ok, old.message);
  await pool.query(`UPDATE clinic_bookings SET status = 'expired' WHERE status = 'reserved' AND hold_expires_at <= now()`); // the clinic hold sweep: it touches clinic bookings only
  const still = await lesson(old.id);
  check("after the hold sweep and 90 days, the unpaid lesson is still confirmed, still owed, still holding its time", still.status === "confirmed" && still.payment_status === "unpaid" && still.amount_owed_cents === still.total_cents && (await activeOccupancy(old.id)) === 1);
  await refused("a lesson cannot be created with the status 'expired'", () => tx((c) => insertLesson(c, at(1440 * 31), { product: f.product, location: f.location, status: "expired" })), { constraint: "lesson_bookings_status_check" });
  await refused("a lesson cannot be moved to 'expired' (not a legal move)", () => pool.query(`UPDATE lesson_bookings SET status = 'expired' WHERE id = $1`, [old.id]), { constraint: "lesson_legal_move" });
  await refused("the system can never cancel a lesson: cancelled_by only accepts the customer or the owner", () => tx(async (c) => { await actAs(c, "system"); await c.query(`UPDATE lesson_bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'system' WHERE id = $1`, [old.id]); await c.query(`UPDATE schedule_occupancy SET active = false WHERE lesson_booking_id = $1`, [old.id]); }), { constraint: "lesson_bookings_cancelled_by_check" });
  check("(the lesson is untouched by every refused attempt)", (await lesson(old.id)).status === "confirmed");
  const past = await reserveLesson(f, Date.now() - 5 * 24 * HOUR, { createdBy: "owner" });
  check("a past lesson nobody has closed out stays 'confirmed' (nothing closes it automatically; it waits in the owner's queue)", past.ok && (await lesson(past.id)).status === "confirmed");
  await invariants("the never-expires checks");
  await reset();
}

console.log("\n=== 5. After the lesson: Completed or No-show, then Unpaid / Paid - Cash / Paid - Interac, with a trail ===");
{
  await reset();
  const mk = async () => (await reserveLesson(f, pastSlot(), { createdBy: "owner" })).id;
  let id = await mk();
  const future = await reserveLesson(f, at(1440 * 3), { createdBy: "owner" });
  await refused("a lesson that has not started cannot be marked completed", () => closeOut(future.id), { constraint: "lesson_not_started" });
  await refused("a lesson that has not started cannot be marked no-show", () => closeOut(future.id, { status: "no_show" }), { constraint: "lesson_not_started" });
  await refused("a lesson that has not happened cannot be marked paid (Cash)", () => setPayment(future.id, "paid_cash"), { constraint: "lesson_payment_shape" });
  await refused("a lesson that has not happened cannot be marked paid (Interac)", () => setPayment(future.id, "paid_interac"), { constraint: "lesson_payment_shape" });

  await closeOut(id, { payment: "paid_cash" });
  let r = await lesson(id);
  check("Completed + Paid - Cash in one step: recorded with the amount owed and the time", r.status === "completed" && r.payment_status === "paid_cash" && r.paid_amount_cents === r.amount_owed_cents && r.paid_at && r.closed_at);
  let ev = await eventsOf(id);
  check("the trail has the booking, the completion and the payment, each by 'owner'", ev.map((e) => e.event).join() === "created,status,payment" && ev.slice(1).every((e) => e.actor === "owner"), ev.map((e) => `${e.event}/${e.actor}`).join(" "));
  check("the payment event says from Unpaid to Paid - Cash, with the amount", ev[2].old_values.payment_status === "unpaid" && ev[2].new_values.payment_status === "paid_cash" && ev[2].new_values.paid_amount_cents === 11000);

  await setPayment(id, "paid_interac", { reference: "CAxyz123", note: "customer switched to e-Transfer; first payment was recorded by mistake" });
  r = await lesson(id);
  check("a correction from Cash to Interac is allowed and recorded with a reference and a reason", r.payment_status === "paid_interac" && r.payment_reference === "CAxyz123" && (await eventsOf(id)).filter((e) => e.event === "payment").length === 2);
  await refused("taking a payment back (Unpaid) without a written reason is refused", () => setPayment(id, "unpaid"), { constraint: "lesson_unpay_needs_note" });
  await setPayment(id, "unpaid", { note: "e-Transfer was returned by the bank" });
  r = await lesson(id);
  check("with a reason it goes back to Unpaid and the money fields are cleared", r.payment_status === "unpaid" && r.paid_at === null && r.paid_amount_cents === null && r.payment_note === "e-Transfer was returned by the bank");
  check("the whole history stays: created, completion, three payment changes", (await eventsOf(id)).map((e) => e.event).join() === "created,status,payment,payment,payment");

  const id2 = await mk();
  await closeOut(id2, { payment: "unpaid" });
  r = await lesson(id2);
  check("Completed - Unpaid: the owner can close the lesson now and record payment later", r.status === "completed" && r.payment_status === "unpaid" && r.amount_owed_cents === 11000);
  await refused("paying a different amount than owed needs an explanation", () => setPayment(id2, "paid_cash", { amount: 10000 }), { constraint: "lesson_paid_difference_explained" });
  await setPayment(id2, "paid_cash", { amount: 10000, note: "regular customer discount, agreed" });
  check("with an explanation a different amount is recorded", (await lesson(id2)).paid_amount_cents === 10000);

  const id3 = await mk();
  await refused("a lesson already completed cannot be set back to confirmed", () => closeOut(id3).then(() => pool.query(`UPDATE lesson_bookings SET status = 'confirmed', closed_at = NULL WHERE id = $1`, [id3])), { constraint: "lesson_legal_move" });
  await refused("a completed lesson cannot be cancelled afterwards", () => cancelLesson(id3), { constraint: "lesson_legal_move" });
  await refused("a completed lesson's time can no longer be changed", () => moveLesson(id3, Date.now() - 2 * HOUR), { constraint: "lesson_closed_time" });
  await refused("its price cannot be edited afterwards", () => pool.query(`UPDATE lesson_bookings SET total_cents = 100, subtotal_cents = 100, amount_owed_cents = 100 WHERE id = $1`, [id3]), { constraint: "lesson_fixed_fields" });
  await refused("the cancellation terms it was booked under cannot be edited afterwards", () => pool.query(`UPDATE lesson_bookings SET late_cancel_fee_percent = 0 WHERE id = $1`, [id3]), { constraint: "lesson_fixed_fields" });

  const id4 = await mk();
  await closeOut(id4, { status: "no_show", owed: 11000 });
  r = await lesson(id4);
  check("No-show with the full price owed (James's decision at the time) is recorded as owing", r.status === "no_show" && r.amount_owed_cents === 11000 && r.payment_status === "unpaid");
  const id5 = await mk();
  await closeOut(id5, { status: "no_show", owed: 0 });
  await refused("a no-show where nothing is owed cannot be marked paid", () => setPayment(id5, "paid_cash"), { constraint: "lesson_payment_shape" });
  const id6 = await mk();
  await refused("an amount owed above the price is refused", () => closeOut(id6, { status: "no_show", owed: 11001 }), { constraint: "lesson_owed_within_total" });

  console.log("  -- the trail is written by the database, even for raw SQL");
  const id7 = await mk();
  await pool.query(`UPDATE lesson_bookings SET status = 'completed', closed_at = now() WHERE id = $1`, [id7]);
  ev = await eventsOf(id7);
  check("a raw SQL change with nobody identified is still recorded, as 'unknown' (so it is visible, not silent)", ev.length === 2 && ev[1].event === "status" && ev[1].actor === "unknown", ev.map((e) => `${e.event}/${e.actor}`).join(" "));
  await refused("the trail cannot be edited", () => pool.query(`UPDATE lesson_events SET actor = 'owner' WHERE booking_id = $1`, [id7]), { constraint: "lesson_events_append_only" });
  await refused("the trail cannot be deleted from", () => pool.query(`DELETE FROM lesson_events WHERE booking_id = $1`, [id7]), { constraint: "lesson_events_append_only" });
  await refused("the trail cannot be truncated", () => pool.query(`TRUNCATE lesson_events`), { constraint: "lesson_events_append_only" });
  const c8 = newContact();
  const id8 = (await reserveLesson(f, pastSlot(), { createdBy: "owner", contact: c8 })).id;
  await asOwner((c) => c.query(`UPDATE lesson_bookings SET phone = '514-555-9999', email = 'new@example.test' WHERE id = $1`, [id8]), "corrected after a call");
  ev = await eventsOf(id8);
  const contactEv = ev.find((e) => e.event === "contact_edit");
  check("changing a customer's contact details records WHICH fields changed and why, never the values", contactEv && JSON.stringify(contactEv.new_values.fields) === '["email","phone"]' && contactEv.note === "corrected after a call");
  const allText = JSON.stringify((await pool.query(`SELECT old_values, new_values, note FROM lesson_events`)).rows);
  check("no name, email or phone number of any lesson appears anywhere in the trail", !/example\.test|514-555|Test Person/.test(allText));
  await invariants("the close-out and payment checks");
  await reset();
}

console.log("\n=== 6. Cancelling: free, late with a fee, by the customer or the owner ===");
{
  await reset();
  const a = await reserveLesson(f, at(1440 * 3));
  await cancelLesson(a.id, { by: "customer", actor: "customer", reason: "can't make it" });
  let r = await lesson(a.id);
  check("a free cancellation by the customer owes nothing and frees the time at once", r.status === "cancelled" && r.cancelled_by === "customer" && r.amount_owed_cents === 0 && r.late_cancelled === false && (await activeOccupancy(a.id)) === 0);
  const again = await reserveLesson(f, at(1440 * 3));
  check("the freed time can be booked again immediately", again.ok);
  await cancelLesson(again.id, { by: "owner" });
  const before2 = (await eventsOf(again.id)).length;
  await cancelLesson(again.id, { by: "owner" }).catch(() => {});
  check("cancelling twice changes nothing and adds nothing to the trail", (await eventsOf(again.id)).length === before2);

  const c = await reserveLesson(f, at(1440 * 4));
  await cancelLesson(c.id, { by: "owner", late: true, owed: 5500, reason: "inside 24 hours" });
  r = await lesson(c.id);
  check("a late cancellation with a 50% fee: late flag set, $55.00 owed, time freed", r.status === "cancelled" && r.late_cancelled && r.amount_owed_cents === 5500 && (await activeOccupancy(c.id)) === 0);
  await setPayment(c.id, "paid_cash", { note: "late fee paid" });
  check("the late fee can then be recorded as Paid - Cash", (await lesson(c.id)).payment_status === "paid_cash" && (await lesson(c.id)).paid_amount_cents === 5500);
  const d = await reserveLesson(f, at(1440 * 5));
  await refused("owing money after a free (not late) cancellation is refused", () => cancelLesson(d.id, { by: "owner", late: false, owed: 5500 }), { constraint: "lesson_owed_matches_status" });
  await refused("a fee larger than the price is refused", () => cancelLesson(d.id, { by: "owner", late: true, owed: 11001 }), { constraint: "lesson_owed_within_total" });
  await cancelLesson(d.id, { by: "owner", late: true, owed: 0, reason: "late, fee waived" });
  check("a late cancellation with the fee waived is recorded as late and owing nothing", (await lesson(d.id)).late_cancelled && (await lesson(d.id)).amount_owed_cents === 0);

  console.log("  -- cancel racing a new booking for the same time");
  await reset();
  const pairs = [];
  const firsts = [];
  for (let i = 0; i < 12; i++) firsts.push(await reserveLesson(f, at(1440 * 10 + i * 60)));
  for (let i = 0; i < 12; i++) {
    pairs.push(cancelLesson(firsts[i].id, { by: "owner" }).then(() => "cancelled"));
    pairs.push(reserveLesson(f, at(1440 * 10 + i * 60)));
  }
  const out = await Promise.all(pairs);
  const rebooks = out.filter((x) => typeof x === "object");
  check("12 cancellations racing 12 new bookings for the same times: every rebooking either succeeded after the cancel or was refused as taken", rebooks.every((x) => x.ok || x.code === "23P01"), [...new Set(rebooks.map((x) => x.ok ? "ok" : x.code))].join(","));
  await invariants("the cancel-versus-rebook race");
  await reset();
}

console.log("\n=== 7. Moving a lesson (reschedule) is atomic and checked by the same rule ===");
{
  await reset();
  const a = await reserveLesson(f, at(0));
  const blocker = await reserveLesson(f, at(120));
  await moveLesson(a.id, at(300));
  let r = await lesson(a.id);
  check("moving a lesson to a free time works, counts the move and records old and new time", r.reschedule_count === 1 && new Date(r.starts_at).getTime() === at(300) && (await eventsOf(a.id)).some((e) => e.event === "reschedule" && new Date(e.old_values.starts_at).getTime() === at(0) && new Date(e.new_values.starts_at).getTime() === at(300)));
  await refused("moving a lesson onto another lesson is refused (23P01)", () => moveLesson(a.id, at(120)), { code: "23P01", constraint: "schedule_no_overlap" });
  r = await lesson(a.id);
  check("the refused move changed nothing (still at 14:00 Toronto + 5 hours)", new Date(r.starts_at).getTime() === at(300) && r.reschedule_count === 1 && (await activeOccupancy(a.id)) === 1);
  await refused("changing a lesson's time without moving its occupied range is refused at commit", () => pool.query(`UPDATE lesson_bookings SET starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day', occupied_until = occupied_until + interval '1 day', local_date = local_date + 1 WHERE id = $1`, [a.id]), { constraint: "lesson_status_matches_time" });
  await refused("moving only the occupied range without the lesson is refused at commit", () => pool.query(`UPDATE schedule_occupancy SET span = tstzrange(lower(span) + interval '1 day', upper(span) + interval '1 day', '[)') WHERE lesson_booking_id = $1`, [a.id]), { constraint: "lesson_status_matches_time" });
  check("the blocker was never disturbed", (await lesson(blocker.id)).status === "confirmed");

  const racers = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveLesson(f, at(1440 * 2 + i * 120))));
  const dest = at(1440 * 9);
  const moves = await Promise.all(racers.map((x) => moveLesson(x.id, dest).then(() => "moved", (e) => e.code)));
  check("10 lessons racing to move into the same free time: exactly one gets it", moves.filter((m) => m === "moved").length === 1 && moves.filter((m) => m === "23P01").length === 9, moves.join(","));
  const mvId = (await reserveLesson(f, at(1440 * 20))).id;
  const [bk, mover] = await Promise.all([reserveLesson(f, at(1440 * 21)), moveLesson(mvId, at(1440 * 21)).then(() => "moved", (e) => e.code)]);
  check("a customer booking racing an owner move into the same time: exactly one wins", (bk.ok ? 1 : 0) + (mover === "moved" ? 1 : 0) === 1, `${bk.ok}/${mover}`);
  await invariants("the reschedule races");
  await reset();
}

console.log("\n=== 8. Lessons the owner adds by hand: no conflicts, series all or nothing, one at a time afterwards ===");
{
  await reset();
  const taken = await reserveLesson(f, at(60), { contact: newContact() });
  const clash = await reserveLesson(f, at(60), { createdBy: "owner" });
  check("the owner cannot add a lesson on top of an existing one either", !clash.ok && clash.code === "23P01");
  const phone = await reserveLesson(f, at(1440 * 2), { createdBy: "owner", checkedAt: Date.now() - 1_000, checkResult: "manual_override" });
  check("James can add a lesson by phone while the calendar cannot be reached, recorded as a manual override", phone.ok && (await lesson(phone.id)).calendar_check_result === "manual_override");
  const cust = await reserveLesson(f, at(1440 * 3), { createdBy: "customer", checkedAt: Date.now() - 1_000, checkResult: "manual_override" });
  check("a customer's booking can never use the owner override", !cust.ok && cust.constraint === "lesson_override_is_owner_only");

  // Week 3 of a series that starts Monday Mar 1, 2027 at 9:00 is Mar 15 at 9:00 local = 13:00 UTC (the clocks changed on Mar 14).
  const marchHolder = await reserveLesson(f, Date.parse("2027-03-15T13:00:00Z"));
  check("setup: week 3's time is already taken", marchHolder.ok);
  const series = await reserveLesson(f, at(0), { createdBy: "owner", series: 4 });
  check("a 4-week series by the owner whose 3rd week is taken is refused whole", !series.ok && series.code === "23P01");
  const left = (await pool.query(`SELECT count(*)::int AS n FROM lesson_bookings WHERE series_id IS NOT NULL`)).rows[0].n;
  check("no part of the series was kept", left === 0);
  await cancelLesson(marchHolder.id);
  const ok = await reserveLesson(f, at(0), { createdBy: "owner", series: 4 });
  const rows = (await pool.query(`SELECT id, series_index, status, starts_at FROM lesson_bookings WHERE series_id = (SELECT series_id FROM lesson_bookings WHERE id = $1) ORDER BY series_index`, [ok.id])).rows;
  check("with the clash gone the same series books all 4 lessons at once, each its own lesson", ok.ok && rows.length === 4 && rows.every((x) => x.status === "confirmed"));
  await cancelLesson(rows[1].id, { by: "owner" });
  await closeOut(rows[0].id).catch(() => {});
  const after2 = (await pool.query(`SELECT status FROM lesson_bookings WHERE series_id = (SELECT series_id FROM lesson_bookings WHERE id = $1) ORDER BY series_index`, [ok.id])).rows.map((x) => x.status);
  check("cancelling one lesson of a series leaves the others confirmed", after2.join() === "confirmed,cancelled,confirmed,confirmed", after2.join());

  const same = await Promise.all(Array.from({ length: 100 }, () => reserveLesson(f, at(1440 * 30), { idempotencyKey: "double-click-key-0001" })));
  check("100 repeats of one request (same idempotency key) create exactly one lesson", same.filter((r) => r.ok).length === 1 && (await pool.query(`SELECT count(*)::int AS n FROM lesson_bookings WHERE idempotency_key = 'double-click-key-0001'`)).rows[0].n === 1);
  check("the repeats were refused by the unique key or the no-overlap rule, never anything else", same.filter((r) => !r.ok).every((r) => (r.code === "23505" && /idempotency/.test(r.constraint)) || r.code === "23P01"), [...new Set(same.filter((r) => !r.ok).map((r) => r.code + ":" + r.constraint))].join(","));
  check("(the lesson that was there first is untouched)", (await lesson(taken.id)).status === "confirmed");
  await invariants("the owner's manual lessons");
  await reset();
}

console.log("\n=== 9. Booking without prepayment: limits on what one contact can hold or leave unpaid ===");
{
  await reset();
  await resetSettings();
  const person = newContact();
  const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveLesson(f, at(1440 * 3 + i * 60), { contact: person })));
  check("10 simultaneous bookings by one person (10 different times, 2 allowed): exactly 2 succeed", burst.filter((r) => r.ok).length === 2, `${burst.filter((r) => r.ok).length}`);
  check("the rest are refused by the contact limit and nothing else", burst.filter((r) => !r.ok).every((r) => r.constraint === "lesson_contact_cap"), [...new Set(burst.filter((r) => !r.ok).map((r) => r.constraint))].join(","));
  const other = await reserveLesson(f, at(1440 * 3 + 12 * 60));
  check("a different person is not affected by that limit", other.ok);
  const disguised = await reserveLesson(f, at(1440 * 3 + 14 * 60), { contact: { name: "X", email: ` ${person.email.toUpperCase()} `, phone: "(999) 000-0000" } });
  check("the same email in other capitals and spacing counts as the same person", !disguised.ok && disguised.constraint === "lesson_contact_cap");
  const phoneOnly = await reserveLesson(f, at(1440 * 3 + 16 * 60), { contact: { name: "X", email: "someone.else@example.test", phone: `+1 ${person.phone.replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}` } });
  check("the same phone number written another way counts as the same person", !phoneOnly.ok && phoneOnly.constraint === "lesson_contact_cap");
  const firstOk = burst.find((r) => r.ok);
  await cancelLesson(firstOk.id, { by: "customer", actor: "customer" });
  const freed = await reserveLesson(f, at(1440 * 3 + 20 * 60), { contact: person });
  check("cancelling one frees a place under the limit", freed.ok);
  const byOwner = await Promise.all([0, 1, 2, 3].map((i) => reserveLesson(f, at(1440 * 4 + i * 60), { contact: person, createdBy: "owner" })));
  check("the owner can add as many lessons as he likes for the same person (the limit is for online booking)", byOwner.every((r) => r.ok));

  console.log("  -- leaving lessons unpaid");
  await reset();
  const debtor = newContact();
  const old1 = await reserveLesson(f, Date.now() - 12 * 24 * HOUR, { createdBy: "owner", contact: debtor });
  const old2 = await reserveLesson(f, Date.now() - 11 * 24 * HOUR, { createdBy: "owner", contact: debtor });
  for (const x of [old1, old2]) { await closeOut(x.id); await pool.query(`UPDATE lesson_bookings SET closed_at = now() - interval '10 days' WHERE id = $1`, [x.id]); }
  const blocked = await reserveLesson(f, at(1440 * 3), { contact: debtor });
  check("a contact with 2 lessons left unpaid for more than 7 days cannot book more online", !blocked.ok && blocked.constraint === "lesson_unpaid_block");
  const stillOwner = await reserveLesson(f, at(1440 * 3), { contact: debtor, createdBy: "owner" });
  check("the owner can still add a lesson for that person", stillOwner.ok);
  await setPayment(old1.id, "paid_cash");
  const after3 = await reserveLesson(f, at(1440 * 5), { contact: debtor });
  check("once one is paid the person is under the threshold and can book online again", after3.ok);
  await pool.query(`UPDATE booking_settings SET block_after_unpaid_lessons = 0`);
  await cancelLesson(after3.id, { by: "customer", actor: "customer" });
  await pool.query(`UPDATE lesson_bookings SET payment_status = 'unpaid', paid_at = NULL, paid_amount_cents = NULL, payment_note = 'test reset' WHERE id = $1`, [old1.id]);
  const off = await reserveLesson(f, at(1440 * 6), { contact: debtor });
  check("with the block switched off (0) unpaid history no longer stops online booking", off.ok);
  await resetSettings();
  await invariants("the contact limits");
  await reset();
}

console.log("\n=== 10. Reminders are queued once, only when due, only for lessons still on ===");
{
  await reset();
  await resetSettings();
  const l = await reserveLesson(f, at(1440 * 3));
  const start = at(1440 * 3);
  const run = async (nowMs) => (await pool.query(`SELECT * FROM lesson_queue_reminders($1::timestamptz)`, [iso(nowMs)])).rows;
  check("26 hours before: nothing is due", (await run(start - 26 * HOUR)).length === 0);
  const r1 = await run(start - 23 * HOUR);
  check("23 hours before: the 24-hour reminder is queued", r1.length === 1 && r1[0].r_hours === 24 && r1[0].r_booking === l.id);
  check("running it again (a second worker, a retry) queues nothing new", (await run(start - 22 * HOUR)).length === 0);
  const r2 = await run(start - 1 * HOUR);
  check("1 hour before: the 2-hour reminder is queued", r2.length === 1 && r2[0].r_hours === 2);
  check("after the lesson started nothing is queued", (await run(start + 5 * MIN)).length === 0);
  check("each reminder exists once in the table", (await pool.query(`SELECT count(*)::int AS n FROM lesson_reminders WHERE booking_id = $1`, [l.id])).rows[0].n === 2);

  await reserveLesson(f, at(1440 * 5));
  const mstart = at(1440 * 5);
  const workers = await Promise.all(Array.from({ length: 8 }, () => run(mstart - 23 * HOUR)));
  check("8 workers running at the same moment queue the reminder exactly once between them", workers.flat().length === 1, `${workers.flat().length}`);

  const c = await reserveLesson(f, at(1440 * 7));
  await cancelLesson(c.id);
  check("a cancelled lesson is never reminded", (await run(at(1440 * 7) - 23 * HOUR)).every((x) => x.r_booking !== c.id));

  const late = await reserveLesson(f, at(1440 * 9), { createdAt: at(1440 * 9) - 10 * HOUR });
  check("a lesson booked only 10 hours ahead gets no 24-hour reminder (the confirmation was the reminder)…", (await run(at(1440 * 9) - 9 * HOUR)).every((x) => x.r_booking !== late.id));
  check("…but does get the 2-hour one", (await run(at(1440 * 9) - 90 * MIN)).some((x) => x.r_booking === late.id && x.r_hours === 2));

  const mv = await reserveLesson(f, at(1440 * 11));
  await run(at(1440 * 11) - 23 * HOUR);
  await moveLesson(mv.id, at(1440 * 12));
  const moved = await run(at(1440 * 12) - 23 * HOUR);
  check("a lesson moved to a new time earns new reminders for the new time", moved.some((x) => x.r_booking === mv.id && x.r_hours === 24));
  await pool.query(`UPDATE booking_settings SET reminder_second_hours = NULL`);
  const only = await reserveLesson(f, at(1440 * 13));
  check("with the second reminder switched off only the first is ever queued", (await run(at(1440 * 13) - 1 * HOUR)).filter((x) => x.r_booking === only.id).every((x) => x.r_hours === 24));
  await resetSettings();
  await reset();
}

console.log("\n=== 11. The Google Calendar fail-safe is in the data ===");
{
  await reset();
  await refused("a lesson with no calendar check recorded cannot be booked", () => tx((c) => insertLesson(c, at(0), { product: f.product, location: f.location, checkedAt: null, checkResult: null })), { constraint: "lesson_calendar_checked" });
  await refused("a lesson whose calendar check is older than 30 seconds cannot be booked", () => tx((c) => insertLesson(c, at(0), { product: f.product, location: f.location, checkedAt: Date.now() - 31_000 })), { constraint: "lesson_calendar_checked" });
  await refused("a lesson with a check dated in the future cannot be booked", () => tx((c) => insertLesson(c, at(0), { product: f.product, location: f.location, checkedAt: Date.now() + 10 * MIN })), { constraint: "lesson_calendar_checked" });
  const fresh = await reserveLesson(f, at(0), { checkedAt: Date.now() - 2_000 });
  check("a lesson checked 2 seconds before booking is accepted", fresh.ok);
  const nobody = await reserveLesson(f, at(0 + 600), { policyVersion: "unset" });
  check("a lesson cannot be booked under the placeholder 'unset' cancellation policy", !nobody.ok && nobody.constraint === "lesson_bookings_policy_version_check");
  await refused("a lesson cannot be booked while the tax mode is unset", () => tx((c) => insertLesson(c, at(900), { product: f.product, location: f.location, taxMode: "unset" })), { code: "23514" });
  await refused("totals that do not add up are refused", () => tx((c) => insertLesson(c, at(900), { product: f.product, location: f.location, total: 12000, subtotal: 11000, gst: 500, qst: 400 })), { constraint: "lesson_total_is_sum" });
  await refused("'no tax' with a tax amount is refused", () => tx((c) => insertLesson(c, at(900), { product: f.product, location: f.location, taxMode: "none", total: 11550, subtotal: 11000, gst: 550 })), { constraint: "lesson_no_tax_when_none" });
  await reset();
}

console.log("\n=== 12. Clinics keep ADVANCE payment: capacity, parties, reported payments, late payment ===");
{
  await reset();
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => reserveClinicParty(f.offering, [`Player ${i}`])));
  const won = results.filter((r) => r.ok).length;
  check("100 people race for 10 spots: exactly 10 get one", won === 10, `${won} won`);
  check("everyone else was refused by the capacity rule", results.filter((r) => !r.ok).every((r) => r.code === "23514" && r.constraint === "clinic_capacity"), [...new Set(results.filter((r) => !r.ok).map((r) => r.code + ":" + r.constraint))].join(","));
  const o = (await pool.query(`SELECT taken_count, (SELECT count(*) FROM clinic_spots WHERE offering_id = o.id AND status = 'active')::int AS active FROM clinic_offerings o WHERE id = $1`, [f.offering])).rows[0];
  check("the counter equals the active spots equals the capacity", o.taken_count === 10 && o.active === 10, JSON.stringify(o));

  await reset();
  await Promise.all(Array.from({ length: 8 }, (_, i) => reserveClinicParty(f.offering, [`Seed ${i}`])));
  const party3 = await reserveClinicParty(f.offering, ["Trio A", "Trio B", "Trio C"]);
  check("a party of 3 when only 2 spots remain is refused whole", !party3.ok && party3.constraint === "clinic_capacity");
  check("none of the trio was kept (still 8 taken)", (await pool.query(`SELECT taken_count FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0].taken_count === 8);
  const mixed = await Promise.all([reserveClinicParty(f.offering, ["Pair A", "Pair B"]), reserveClinicParty(f.offering, ["Solo A"]), reserveClinicParty(f.offering, ["Pair C", "Pair D"]), reserveClinicParty(f.offering, ["Solo B"])]);
  const final = (await pool.query(`SELECT taken_count FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0].taken_count;
  const partial = (await pool.query(`SELECT count(*)::int AS n FROM clinic_bookings b WHERE b.status = 'reserved' AND EXISTS (SELECT 1 FROM clinic_spots s WHERE s.booking_id = b.id AND s.status <> 'active')`)).rows[0].n;
  check("two pairs and two solos racing for the last 2 spots: never above capacity, no partial party", final <= 10 && partial === 0, `${final}/10 taken, wins=${mixed.filter((r) => r.ok).length}`);

  console.log("  -- payment rules (advance payment, as the camp)");
  await reset();
  const cb = await reserveClinicParty(f.offering, ["Pay Person"]);
  await refused("a clinic booking cannot be marked paid without a verification record", () => pool.query(`UPDATE clinic_bookings SET status = 'paid', hold_expires_at = NULL WHERE id = $1`, [cb.id]), { constraint: "clinic_paid_verified" });
  await refused("paid with a different amount received than the amount due is refused", () => tx((c) => markClinicPaid(c, cb.id, 19999)), { constraint: "clinic_paid_verified" });
  await refused("a reported payment can never be expired by the system", async () => {
    await pool.query(`UPDATE clinic_bookings SET status = 'payment_reported', hold_expires_at = NULL, payment_reported_at = now(), review_due_at = now() + interval '48 hours' WHERE id = $1`, [cb.id]);
    await pool.query(`UPDATE clinic_bookings SET status = 'expired', hold_expires_at = NULL WHERE id = $1`, [cb.id]);
  }, { constraint: "clinic_booking_legal_move" });
  check("the reported payment is still reported", (await pool.query(`SELECT status FROM clinic_bookings WHERE id = $1`, [cb.id])).rows[0].status === "payment_reported");
  await tx((c) => markClinicPaid(c, cb.id, 20000));
  check("the owner confirming the exact amount makes it paid", (await pool.query(`SELECT status FROM clinic_bookings WHERE id = $1`, [cb.id])).rows[0].status === "paid");
  await refused("a paid clinic booking's price cannot be edited", () => pool.query(`UPDATE clinic_bookings SET total_cents = 100, subtotal_cents = 100 WHERE id = $1`, [cb.id]), { constraint: "clinic_booking_fixed_fields" });
  await refused("a cancelled clinic booking that still holds a spot is refused", () => pool.query(`UPDATE clinic_bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner' WHERE id = $1`, [cb.id]), { constraint: "clinic_booking_status_matches_spots" });

  console.log("  -- a late payment after the hold expired (clinics only)");
  await reset();
  await Promise.all(Array.from({ length: 9 }, (_, i) => reserveClinicParty(f.offering, [`Filler ${i}`])));
  const lateB = await reserveClinicParty(f.offering, ["Late Person"]);
  await tx(async (c) => {
    await c.query(`UPDATE clinic_bookings SET status = 'expired', hold_expires_at = NULL, cancelled_at = now(), cancelled_by = 'system' WHERE id = $1`, [lateB.id]);
    await c.query(`UPDATE clinic_spots SET status = 'cancelled' WHERE booking_id = $1`, [lateB.id]);
  });
  const stranger = await reserveClinicParty(f.offering, ["Stranger"]);
  check("setup: the expired hold's spot was taken by someone else (10 of 10)", stranger.ok);
  const lateConfirm = (id) => tx(async (c) => { await c.query(`UPDATE clinic_spots SET status = 'active' WHERE booking_id = $1`, [id]); await markClinicPaid(c, id, 20000); });
  await refused("confirming the late payment is refused because the spot is gone", () => lateConfirm(lateB.id), { constraint: "clinic_capacity" });
  const afterLate = (await pool.query(`SELECT status, (SELECT count(*) FROM clinic_spots WHERE booking_id = b.id AND status = 'active')::int AS n FROM clinic_bookings b WHERE id = $1`, [lateB.id])).rows[0];
  check("the late booking is unchanged (still expired, holds nothing) and the stranger is untouched", afterLate.status === "expired" && afterLate.n === 0 && (await pool.query(`SELECT status FROM clinic_bookings WHERE id = $1`, [stranger.id])).rows[0].status === "reserved");
  await tx(async (c) => { await c.query(`UPDATE clinic_bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner', hold_expires_at = NULL WHERE id = $1`, [stranger.id]); await c.query(`UPDATE clinic_spots SET status = 'cancelled' WHERE booking_id = $1`, [stranger.id]); });
  await lateConfirm(lateB.id);
  check("once a spot is free again the same late payment can be confirmed, atomically", (await pool.query(`SELECT status FROM clinic_bookings WHERE id = $1`, [lateB.id])).rows[0].status === "paid");

  console.log("  -- raw SQL attacks on the counter");
  await reset();
  await reserveClinicParty(f.offering, ["Real A", "Real B"]);
  await refused("zeroing the counter while spots are active is refused at commit", () => pool.query(`UPDATE clinic_offerings SET taken_count = 0 WHERE id = $1`, [f.offering]), { constraint: "clinic_counter" });
  await refused("lowering the capacity below the spots already taken is refused", () => pool.query(`UPDATE clinic_offerings SET capacity = 1 WHERE id = $1`, [f.offering]), { constraint: "clinic_taken_within_capacity" });
  await refused("raising the capacity above the standard 10 without a recorded authorization is refused", () => pool.query(`UPDATE clinic_offerings SET capacity = 12 WHERE id = $1`, [f.offering]), { constraint: "clinic_capacity_authorization" });
  await refused("an authorization needs a real written note", () => pool.query(`INSERT INTO booking_capacity_authorizations (offering_id, capacity, note) VALUES ($1, 12, 'ok')`, [f.offering]), { code: "23514" });
  await pool.query(`INSERT INTO booking_capacity_authorizations (offering_id, capacity, note) VALUES ($1, 12, 'James approved two extra: coach assistant available')`, [f.offering]);
  await pool.query(`UPDATE clinic_offerings SET capacity = 12 WHERE id = $1`, [f.offering]);
  check("with a recorded authorization the capacity can be raised to the authorized number", (await pool.query(`SELECT capacity FROM clinic_offerings WHERE id = $1`, [f.offering])).rows[0].capacity === 12);
  await pool.query(`UPDATE clinic_offerings SET capacity = 10 WHERE id = $1`, [f.offering]);
  await invariants("the clinic checks");
  await reset();
}

console.log("\n=== 13. Lesson packages (built, off until approved): a credit can never be spent twice ===");
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

console.log("\n=== 14. Daylight saving: weekly series are built from the wall-clock time ===");
{
  const hhmm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
  const fall = await pool.query(
    `SELECT n, ((('2026-10-29'::date + n*7) + '09:00'::time) AT TIME ZONE 'America/Toronto') AS wall,
            ('2026-10-29 09:00-04'::timestamptz + n * interval '168 hours') AS naive
       FROM generate_series(0, 3) n ORDER BY n`
  );
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
  const series = await reserveLesson(f, Date.parse("2026-10-29T13:00:00Z"), { createdBy: "owner", series: 4 });
  const stored = await pool.query(`SELECT starts_at, local_start::text AS t FROM lesson_bookings WHERE series_id IS NOT NULL ORDER BY series_index`);
  check("a stored 4-week series across the fall change keeps 09:00 local on every date", series.ok && stored.rows.every((r) => r.t.startsWith("09:00") && hhmm(r.starts_at) === "09:00"), stored.rows.map((r) => hhmm(r.starts_at)).join(" "));
  await refused("a lesson whose instant disagrees with its recorded wall-clock time is refused", () => tx(async (c) => {
    const id = await insertLesson(c, Date.parse("2026-11-05T13:00:00Z"), { product: f.product, location: f.location });
    await c.query(`UPDATE lesson_bookings SET local_start = '10:00' WHERE id = $1`, [id]);
  }), { constraint: "lesson_wall_clock_matches" });
  await reset();
}

console.log("\n=== 15. Cancellation rules and fees (reference implementation for the real module) ===");
{
  const roundHalfUp = (num, den) => Math.floor((2 * num + den) / (2 * den));
  const fee = (totalCents, percent) => roundHalfUp(totalCents * percent, 100);
  // rules: { noticeHours, customerCanCancel, insideAction, lateFeePercent }
  function cancelDecision({ now, startsAt, actor, rules, totalCents }) {
    if (startsAt <= now) return { allowed: false, reason: "started" };
    const hoursLeft = (startsAt - now) / HOUR;
    const late = hoursLeft < rules.noticeHours; // exactly at the notice limit is still free
    if (actor === "owner") return { allowed: true, late, feeCents: late ? fee(totalCents, rules.lateFeePercent) : 0, waivable: true };
    if (!rules.customerCanCancel) return { allowed: false, reason: "contact" };
    if (!late) return { allowed: true, late: false, feeCents: 0 };
    if (rules.insideAction === "contact_only") return { allowed: false, reason: "inside_notice" };
    return { allowed: true, late: true, feeCents: fee(totalCents, rules.lateFeePercent), waivable: false };
  }
  const rules = { noticeHours: 24, customerCanCancel: true, insideAction: "contact_only", lateFeePercent: 50 };
  const T = BASE;
  const d = (hoursBefore, extra = {}) => cancelDecision({ now: T - hoursBefore * HOUR, startsAt: T, actor: "customer", rules, totalCents: 12647, ...extra });
  check("48 hours ahead: a customer may cancel free", d(48).allowed && !d(48).late && d(48).feeCents === 0);
  check("exactly 24 hours ahead: still free", d(24).allowed && !d(24).late);
  check("one second inside 24 hours: online cancelling is closed, 'please call or text'", !d(24 - 1 / 3600).allowed && d(24 - 1 / 3600).reason === "inside_notice");
  check("with 'allow and flag' a customer can cancel inside 24 hours and the 50% fee is $63.24 (half-up of 6323.5)", (() => { const x = d(10, { rules: { ...rules, insideAction: "allow_and_flag" } }); return x.allowed && x.late && x.feeCents === 6324; })());
  check("the owner may always cancel (even 2 hours before) and may waive the fee", (() => { const x = d(2, { actor: "owner" }); return x.allowed && x.late && x.waivable && x.feeCents === 6324; })());
  check("with online cancelling switched off a customer is always told to contact James", !d(100, { rules: { ...rules, customerCanCancel: false } }).allowed);
  check("a lesson that has started cannot be cancelled by anyone (it is closed out instead)", !d(-1, { actor: "owner" }).allowed);
  check("fee arithmetic: 0% of anything is 0; 100% is the price; 50% never exceeds it", fee(12647, 0) === 0 && fee(12647, 100) === 12647 && fee(12647, 50) <= 12647 && fee(1, 50) === 1);
  // Sunday Mar 14, 2027 at 10:00 (EDT) is 14:00 UTC; "the same clock time yesterday" (Saturday 10:00 EST) is 15:00 UTC: only 23 hours earlier.
  const springDay = cancelDecision({ now: Date.parse("2027-03-13T15:00:00Z"), startsAt: Date.parse("2027-03-14T14:00:00Z"), actor: "customer", rules, totalCents: 11000 });
  check("'24 hours' means 24 elapsed hours, not 'the same clock time yesterday' (the page says so; the two clock-change days differ by one hour)", springDay.allowed === false && springDay.reason === "inside_notice");
}

console.log("\n=== 16. The money arithmetic (reference implementation for the real module) ===");
{
  // Basis points would lose 9.975%, so rates are NUMERIC(6,5) in the database and exact integers here: rate * 1e5
  // (5000 and 9975), and every product is rounded half up to the cent.
  const GST = 5000, QST = 9975; // per 100,000
  const roundDiv = (num, den) => Math.floor((2 * num + den) / (2 * den)); // half up, integers only
  const tax = (cents, rate) => roundDiv(cents * rate, 100_000);

  function price(mode, base, { exempt = false, gst = GST, qst = QST } = {}) {
    if (mode === "none" || exempt) return { subtotal: base, gst: 0, qst: 0, total: base };
    if (mode === "added") { const g = tax(base, gst), q = tax(base, qst); return { subtotal: base, gst: g, qst: q, total: base + g + q }; }
    if (mode === "included") {
      // The advertised price IS the total. Find the pre-tax amount whose own taxes add back to it.
      const guess = roundDiv(base * 100_000, 100_000 + gst + qst);
      for (const dd of [0, -1, 1, -2, 2]) {
        const sub = guess + dd, g = tax(sub, gst), q = tax(sub, qst);
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
console.log("\n=== 17. At the end the camp is still exactly as it was ===");
{
  const end = await snapshotCamp();
  check("camp tables, constraints, triggers, indexes and functions are still identical to the start", end === before);
}

await reset();
await pool.end();
await testDb.drop();
console.log(`\n\n${failures === 0 ? `ALL TESTS PASS (${checks - failures} pass, 0 fail)` : `${failures} OF ${checks} CHECK(S) FAILED`} — lessons-clinics-sketch`);
process.exit(failures === 0 ? 0 : 1);
