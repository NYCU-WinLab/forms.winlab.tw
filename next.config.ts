import type { NextConfig } from "next";

// Baseline hardening headers applied to every route. We intentionally do NOT
// ship a full script-src/style-src CSP here: Next's hydration inline scripts
// and the inline styles used by the chat UI (ProgressiveBlur) would require
// nonce plumbing to allow safely, and getting it wrong silently breaks the app.
// `frame-ancestors 'none'` + X-Frame-Options fully cover the clickjacking
// surface, which is the concrete risk for these pages.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
