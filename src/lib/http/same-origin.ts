/**
 * Is this cookie-authenticated request from the app's own origin? (s89)
 *
 * Supabase's session cookies are `SameSite=Lax` (@supabase/ssr defaults). That
 * keeps them off cross-SITE subrequests, not off cross-ORIGIN requests from the
 * same site — and every branded `*.recopyfa.st` host is the same site as the
 * app (ADR 021). For a POST that changes what the public sees (publishing a
 * blog post), the Origin header is therefore the check.
 *
 * Stricter than src/app/api/editor/sign-out/route.ts, which lets an absent
 * Origin through because the worst it can do is sign an editor out. Here an
 * absent or `null` Origin is refused: every current browser sends Origin on a
 * fetch POST, and the only intended caller is the admin's own browser
 * (docs/operations/blog.md).
 */

import type { NextRequest } from "next/server";
import { normalizeOrigin } from "@/lib/auth/editor-crypto";

export function isSameOriginRequest(request: NextRequest): boolean {
  const sent = request.headers.get("origin");
  if (sent === null) return false;

  const own = normalizeOrigin(request.nextUrl.origin);
  return own !== null && normalizeOrigin(sent) === own;
}
