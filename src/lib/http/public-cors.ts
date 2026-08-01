import { NextRequest, NextResponse } from "next/server";

/**
 * CORS for endpoints the embed script calls from a customer's website.
 *
 * Every call the widget makes is cross-origin by definition, so without these
 * headers the browser blocks the request before it ever reaches the route. Such
 * an endpoint looks perfectly healthy to curl while being unreachable from the
 * only place that actually calls it.
 *
 * These endpoints authenticate with a bearer site token or a staging token
 * carried in a header or the request body — never with cookies — and each one
 * independently verifies that token and pins it to the site's registered domain
 * server-side. So `*` grants a browser nothing that a plain server-to-server
 * request could not already do.
 *
 * It deliberately does NOT reflect the caller's origin together with
 * `Access-Control-Allow-Credentials: true`. That combination lets ANY website
 * issue credentialed requests to these endpoints using the visitor's cookies.
 * Browsers forbid `*` alongside credentials for precisely that reason, and
 * reflecting an arbitrary origin re-opens the hole the rule exists to close.
 * If an endpoint ever genuinely needs cookies cross-origin, reflect only
 * origins matched against the site's registered domain — never whatever the
 * caller happened to send.
 */
const ALLOW_HEADERS = "Authorization, Content-Type, X-Site-Token";

export function withPublicCors(
  response: NextResponse,
  _requestOrOrigin?: NextRequest | string | null,
  methods = "GET,POST,PUT,OPTIONS",
) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  response.headers.set("Access-Control-Allow-Methods", methods);
  // Spare the widget an OPTIONS round trip on every single call.
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.set("Vary", "Origin");
  return response;
}

export function publicOptions(
  request?: NextRequest,
  methods = "GET,POST,PUT,OPTIONS",
) {
  // 204 means "no content" and the Response constructor rejects a body with
  // that status: `NextResponse.json({}, { status: 204 })` throws
  // "Invalid response status code 204". That made every preflight return 500,
  // so CORS stayed broken even on the routes where these headers were wired up.
  return withPublicCors(
    new NextResponse(null, { status: 204 }),
    request,
    methods,
  );
}
