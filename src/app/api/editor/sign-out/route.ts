/**
 * POST /api/editor/sign-out
 *
 * Hub-only. Ends the hub session by expiring its cookie.
 *
 * s39: "Use a different address" on `/edit` used to reset only the page's own
 * state. That was enough while the hub never resumed a session — nothing read
 * the cookie on load. Now `/edit` resumes whatever session this browser holds,
 * for up to 7 days when Remember was ticked, so a client-side reset would put
 * the previous address's site list straight back at the next visit. The cookie
 * is httpOnly by design, so only the server can clear it.
 *
 * Same-origin by design, like `handoff/create`: no CORS headers, POST only.
 * When the browser sends an `Origin` and it is not this app's own, the request
 * is refused — a cross-site form post here would sign an editor out of the hub
 * behind their back (logout CSRF). A nuisance rather than a breach, since this
 * route reads nothing and returns nothing, but there is no reason to allow it.
 * An absent `Origin` is let through: current browsers send one on every POST,
 * so its absence means a non-browser caller, which holds no editor's cookie to
 * clear — and SameSite=Lax already keeps the cookie off cross-site subrequests.
 *
 * No rate limiter, deliberately. The "limit before authorization" rule exists
 * because authorization costs a database lookup; this route touches no data at
 * all — it answers with a `Set-Cookie` and nothing else — so there is nothing
 * for a flood to reach.
 */

import { NextRequest, NextResponse } from "next/server";
import { normalizeOrigin } from "@/lib/auth/editor-crypto";
import {
  HUB_SESSION_COOKIE,
  hubSessionCookieOptions,
} from "@/lib/auth/editor-hub-session";

function isCrossOrigin(request: NextRequest): boolean {
  const sent = request.headers.get("origin");
  if (sent === null) return false;

  // `Origin: null` (sandboxed frame, opaque redirect) normalises to null and
  // is refused: it is never what the hub page itself sends.
  const own = normalizeOrigin(request.nextUrl.origin);
  return !own || normalizeOrigin(sent) !== own;
}

export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  // Same name, path and flags as the live cookie, or the browser keeps the
  // session and stores an empty second cookie beside it.
  response.cookies.set(HUB_SESSION_COOKIE, "", {
    ...hubSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
