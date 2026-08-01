/**
 * Authorization for public telemetry ingest endpoints.
 *
 * These endpoints are public *by design* — the embed script running on a
 * customer's site posts anonymous visitor events, so requiring a logged-in
 * Supabase session would break the widget. "Public" must not mean "unauthenticated":
 * without a credential binding the write to a site, anyone can forge rows against
 * any tenant's siteId.
 *
 * Two credentials are accepted, and one of them is always required:
 *
 *  1. Site token — the HMAC token minted at site registration and embedded in the
 *     widget snippet. Proves the caller holds the site's API key and that the
 *     request originates from the site's registered domain. The visitor stays
 *     anonymous (no user_id on the row); the *site* is what gets authenticated.
 *
 *  2. Supabase session — a logged-in user with a site_permissions row for the
 *     target site. Covers first-party dashboard/app tracking.
 *
 * Anything else is rejected with 401.
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeSiteRequest } from "@/lib/security/site-auth";

export type IngestAuthMode = "site-token" | "session";

export type IngestAuthResult =
  | { ok: true; mode: IngestAuthMode; userId?: string }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Read the site token from the request.
 * Accepts `Authorization: Bearer <token>` (matches the A/B-test embed endpoints)
 * or the explicit `X-Site-Token` header.
 */
export function extractSiteToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7).trim() || null;
  }
  return request.headers.get("x-site-token")?.trim() || null;
}

/**
 * Authorize a write against `siteId`. Never throws — every failure is returned
 * as a status the caller maps straight onto a response.
 */
export async function authorizeIngestRequest(
  request: NextRequest,
  siteId: string,
): Promise<IngestAuthResult> {
  const siteToken = extractSiteToken(request);

  if (siteToken) {
    try {
      await authorizeSiteRequest({
        siteId,
        token: siteToken,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      });
      return { ok: true, mode: "site-token" };
    } catch (error) {
      // A token was presented and it did not check out. Do not fall through to
      // the session path: that would let a bad token be masked by an unrelated
      // logged-in cookie and make the failure impossible to diagnose.
      return {
        ok: false,
        status: 401,
        error: error instanceof Error ? error.message : "Invalid site token",
      };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Authentication required: provide a site token or sign in",
    };
  }

  const { data: permission } = await supabase
    .from("site_permissions")
    .select("id")
    .eq("site_id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!permission) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this site",
    };
  }

  return { ok: true, mode: "session", userId: user.id };
}

/** Verify the caller holds a valid Supabase session, without a site scope. */
export async function requireAuthenticatedUser(): Promise<IngestAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true, mode: "session", userId: user.id };
}

/**
 * Verify the caller is a signed-in user with a permission row on `siteId`.
 * For read paths, which are never called by the embed script.
 */
export async function authorizeSiteReadAccess(
  siteId: string,
): Promise<IngestAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const { data: permission } = await supabase
    .from("site_permissions")
    .select("id")
    .eq("site_id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!permission) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, mode: "session", userId: user.id };
}
