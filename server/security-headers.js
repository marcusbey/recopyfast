/**
 * Security headers for the realtime service's HTTP surface (s79, s69 L13).
 *
 * The surface is one JSON route, `/health`, plus Express's 404s. Production
 * answered it with `X-Powered-By: Express`, `Access-Control-Allow-Origin: *`
 * and no security header at all. This is the helmet-equivalent set for an API
 * that never serves HTML — written out rather than pulled in as a dependency,
 * because the whole of it is the list below and this package's dependency tree
 * is a CI gate (`.github/workflows/server-security.yml`).
 *
 * What is NOT here, on purpose:
 * - `Access-Control-Allow-Origin`. Nothing browser-side reads `/health` (Fly's
 *   check, the uptime workflow and the app's server-side probe all read it
 *   without CORS), so the answer to a cross-origin read is no header at all.
 *   The WebSocket handshake is engine.io's, answered before Express runs, and
 *   is authorised by the per-site token and domain pin, not by CORS.
 * - `X-Powered-By`, which is an Express app setting: `app.disable` in
 *   index.js, not a header to delete per response.
 *
 * Pinned by "the HTTP surface" in src/__tests__/websocket/server.integration.test.ts.
 */

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // Nothing here is a document: no script, style, frame or fetch is ever
  // legitimate on a response from this origin.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  // Same value as the app (next.config.ts). Fly terminates TLS and
  // `force_https` is on, so the host is HTTPS-only already; this makes the
  // browser hold it. No `preload`.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

function securityHeaders(_req, res, next) {
  res.set(SECURITY_HEADERS);
  next();
}

module.exports = {
  SECURITY_HEADERS,
  securityHeaders,
};
