import { createHmac, timingSafeEqual } from "crypto";

// Server-only. The private link a parent uses to see their payment instructions and
// tap "I've Sent My Payment" — no account, no password. The token is the registration's
// id plus an HMAC of it under a server secret, so it can't be guessed or forged, can be
// rebuilt on a retried submission (nothing secret needs storing), and a leaked database
// alone cannot produce a working link.
//
// A token can do exactly two things: show that registration's status and report payment.
// It can never confirm, release, extend, or change anything else.
//
// Production needs REGISTRATION_LINK_SECRET (16+ characters). Outside production a fixed
// development value is used so local work needs no setup.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRegistrationLinkConfigured(): boolean {
  const configured = process.env.REGISTRATION_LINK_SECRET;
  if (configured && configured.length >= 16) return true;
  return process.env.NODE_ENV !== "production";
}

function secret(): string {
  const configured = process.env.REGISTRATION_LINK_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REGISTRATION_LINK_SECRET must be set (16+ characters).");
  }
  return "development-only-registration-link-secret";
}

function mac(registrationId: string): string {
  return createHmac("sha256", secret()).update(`registration-access:${registrationId.toLowerCase()}`).digest("base64url");
}

export function makeAccessToken(registrationId: string): string {
  return `${registrationId.toLowerCase()}.${mac(registrationId)}`;
}

// Returns the registration id if the token is genuine, otherwise null.
export function registrationIdFromToken(token: string): string | null {
  // Without a usable secret no link can be genuine (and the registration route refuses to
  // take reservations in that state), so show the visitor the ordinary "not found".
  if (!isRegistrationLinkConfigured()) return null;
  const dot = token.indexOf(".");
  if (dot !== 36) return null;
  const id = token.slice(0, dot);
  if (!UUID.test(id)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(id));
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id.toLowerCase() : null;
}
