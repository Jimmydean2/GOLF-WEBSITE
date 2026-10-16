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
