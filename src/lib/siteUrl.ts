// Server-only. The public address of the website, used to build the links inside emails.
//
// SITE_URL (for example https://www.jamesdeangolf.example) is the reliable source: an email
// sent by a scheduled run, or sent again hours later, has no visitor's request to take the
// address from. When it is not set, the address of the request being served is used, which
// is right whenever a visitor triggers the work but cannot be relied on for background runs.
export function siteOrigin(requestUrl?: string): string {
  const configured = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (!requestUrl) return "";
  try {
    return new URL(requestUrl).origin;
  } catch {
    return "";
  }
}

// The same, for a server component, which has request headers instead of a request.
export function siteOriginFromHeaders(headers: { get(name: string): string | null }): string {
  const configured = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return "";
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host}`;
}

// "pat.parent@gmail.com" -> "p***@gmail.com": enough for a parent to spot a typo, not enough
// to be of use to anyone else.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your email address";
  return `${email[0]}***${email.slice(at)}`;
}
