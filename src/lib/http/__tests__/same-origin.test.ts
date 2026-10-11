/**
 * @jest-environment node
 */

/**
 * s89 — a cookie-authenticated POST is accepted only from the app's own
 * origin.
 *
 * Supabase's session cookies are `SameSite=Lax`: kept off cross-site
 * subrequests, but sent on cross-origin requests from the same site — and
 * every branded `*.recopyfa.st` host is the same site as the app (ADR 021).
 * So the Origin header is the check. An absent or `null` Origin is refused:
 * every current browser sends Origin on a fetch POST, and the publish route
 * has no caller that would omit it (stricter than editor/sign-out, which only
 * clears a cookie).
 */

import { NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/http/same-origin";

const URL = "https://www.recopyfa.st/api/admin/blog/posts";

function post(origin?: string) {
  return new NextRequest(URL, {
    method: "POST",
    headers: origin === undefined ? {} : { origin },
  });
}

describe("isSameOriginRequest", () => {
  it("accepts the app's own origin, default port spelled or not", () => {
    expect(isSameOriginRequest(post("https://www.recopyfa.st"))).toBe(true);
    expect(isSameOriginRequest(post("https://WWW.recopyfa.st:443"))).toBe(true);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["a branded subdomain of the same site", "https://acme.recopyfa.st"],
    ["the apex host", "https://recopyfa.st"],
    ["the same host over http", "http://www.recopyfa.st"],
    ["an opaque origin", "null"],
    ["garbage", "not a url"],
  ])("refuses %s", (_, origin) => {
    expect(isSameOriginRequest(post(origin))).toBe(false);
  });

  it("refuses a request with no Origin header", () => {
    expect(isSameOriginRequest(post())).toBe(false);
  });
});
