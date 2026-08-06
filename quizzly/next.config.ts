import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * The Content-Security-Policy is set per-request in `src/middleware.ts` so it can
 * carry a fresh nonce. Everything here is static and safe to send on every response.
 *
 * Note: middleware can be bypassed in some edge/proxy configurations, so these
 * headers are applied at the Next.js layer as well — defence in depth. Auth is
 * always re-verified at the data boundary (see `src/lib/auth.ts`), never in
 * middleware alone.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // No `output: "standalone"`. This app is served by a custom server
  // (server/index.ts) rather than Next's own, so the standalone bundle was
  // never executed — and its dependency tracing omitted the runtime binaries
  // the container needs. See the Dockerfile.

  experimental: {
    // Cap the size of Server Action payloads — quiz imports go through a
    // dedicated, separately-limited route instead.
    serverActions: { bodySizeLimit: "1mb" },
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
