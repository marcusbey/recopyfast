/**
 * The scan route's same-origin guard (s96, plan decision 2.1 [A]).
 *
 * WHY. `POST /api/tools/scan` spends shared caps: 500 scans a day across all
 * callers, 20 an hour per scanned site. Without this guard any third-party
 * page could spend them from every visitor's browser — a cross-site
 * `fetch(..., { mode: "no-cors", body: "{...}" })` with `text/plain` needs no
 * preflight — and burn the day's scans before lunch.
 *
 * - `Content-Type` must be `application/json` (415). That alone forces a CORS
 *   preflight on any cross-site browser request, which this route never
 *   answers (no CORS header, ever).
 * - `Sec-Fetch-Site`, when sent, must be `same-origin` (403).
 * - `Origin`, when sent, must be this site's (403): the configured site origin
 *   or the origin the request was addressed to, so a preview deployment works.
 *
 * A browser always sends one of the last two on a cross-site POST. A
 * non-browser client sends neither, scans from its own address and is metered
 * like anyone else. Stateless, so it runs before any store is touched.
 */

import { NextResponse, type NextRequest } from "next/server";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import { SCAN_MESSAGES } from "./messages";

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function refuseCrossSiteScan(request: NextRequest): NextResponse | null {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: SCAN_MESSAGES.notJson }, { status: 415 });
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return NextResponse.json(
      { error: SCAN_MESSAGES.crossSite },
      { status: 403 },
    );
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    const allowed = new Set(
      [originOf(resolveSiteUrl()), request.nextUrl.origin].filter(Boolean),
    );
    const sent = originOf(origin);
    if (!sent || !allowed.has(sent)) {
      return NextResponse.json(
        { error: SCAN_MESSAGES.crossSite },
        { status: 403 },
      );
    }
  }
  return null;
}
