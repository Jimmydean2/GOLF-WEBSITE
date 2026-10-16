// Small request checks shared by the admin routes. No Next.js imports, so they are
// testable directly.

// True when a state-changing request comes from this site's own pages. Browsers send an
// Origin header on cross-site and same-site POSTs; when it is missing, Sec-Fetch-Site must
// say same-origin (or none, for a direct navigation). Anything else (a form on another
// site, a script without those headers) is refused.
export function isSameOriginRequest(request: Request): boolean {
  const ownHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === ownHost;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

// Only ever redirect to a path inside the admin area. Anything else (another site, a
// protocol-relative URL, a backslash trick) falls back to the default.
export function safeAdminNextPath(next: string | null | undefined, fallback = "/admin/camp-rosters"): string {
  if (!next) return fallback;
  const insideAdmin = next === "/admin" || next.startsWith("/admin/") || next.startsWith("/admin?") || next.startsWith("/admin#");
  if (!insideAdmin) return fallback;
  if (next.includes("\\") || next.includes("://") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  // A ".." segment (plain or percent-encoded) would let a path climb out of /admin.
  if (next.split(/[?#]/)[0].split("/").some((segment) => /^(\.|%2e){2}$/i.test(segment))) return fallback;
  return next;
}
