import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce.
 *
 * A nonce-based CSP is the single most effective defence against XSS: even if
 * an attacker gets a `<script>` tag into the page, the browser refuses to run
 * it without the current request's nonce, which they cannot predict.
 *
 * Next.js reads the `x-nonce` request header and stamps the nonce onto its own
 * script tags automatically, so nothing in the app has to thread it manually.
 *
 * Two deliberate concessions:
 *
 *  - `'strict-dynamic'` lets Next's bootstrap script load the chunks it needs.
 *    Without it a nonce CSP and Next's chunk loading are incompatible.
 *  - `'unsafe-inline'` appears in `style-src`. React inlines the style
 *    attributes that carry the theme's CSS custom properties, and there is no
 *    nonce mechanism for style *attributes*. Since a style attribute cannot
 *    execute script, the residual risk is limited to appearance, and every
 *    value that reaches one is a hex colour validated by `themeSchema`.
 *
 * This middleware also handles auth *redirects* — a UX nicety only. It is not
 * an access control boundary: middleware can be skipped by a misconfigured
 * proxy, so every protected read re-checks the session at the data layer.
 */

const PROTECTED_PREFIXES = ["/dashboard", "/quiz", "/collab", "/settings", "/host"];

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    `default-src 'self'`,
    // `unsafe-eval` is required by React Fast Refresh in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    // Quiz cover art and question media can be hosted anywhere the author likes,
    // but only over HTTPS, and never as an executable type.
    `img-src 'self' blob: data: https:`,
    `font-src 'self' data:`,
    // The WebSocket connection back to our own origin.
    `connect-src 'self' ${isDev ? "ws: wss:" : "wss:"}`,
    `media-src 'self' https:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const { pathname } = request.nextUrl;

  // Redirect signed-out users away from app pages so they land on the login
  // form rather than an error. The pages themselves still verify the session.
  const needsAuth = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (needsAuth && !request.cookies.has("quizzly_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the Socket.IO endpoint. Static files
     * don't need a per-request nonce, and running middleware on them would add
     * latency to every asset. The socket path is excluded because the upgrade
     * request must reach the Socket.IO server untouched.
     */
    {
      source: "/((?!api/socket|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
