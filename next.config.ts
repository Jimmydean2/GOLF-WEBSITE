import type { NextConfig } from "next";

// Pages and endpoints that show personal data or can move a payment's state: another website
// may not put them in a frame (clickjacking), the browser and shared devices may not keep a
// copy, and nothing may be sniffed into another type. A parent's private reservation page
// also sends no referrer, so its link never leaks to another site.
const privateHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/admin/:path*", headers: privateHeaders },
      { source: "/api/admin/:path*", headers: privateHeaders },
      { source: "/camp-registration/:path*", headers: privateHeaders },
      { source: "/api/camp-registration/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
