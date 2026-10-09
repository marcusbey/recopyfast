/**
 * Spending an edit-link code (s76, ADR 055) — the one place it happens.
 *
 * Called by the widget's boot check, POST /api/staging/validate, when the
 * `editToken` it is handed is a link code rather than a session token. Every
 * other route treats a code as the unknown token it is: one spender is what
 * makes "single use" checkable. The code format is src/lib/auth/edit-link.ts.
 *
 * Order, cheapest refusal first, nothing a forgery can make expensive:
 *   1. signature, site and expiry — offline, so a flood of garbage codes on
 *      this public route never reaches the database;
 *   2. `Origin` is the site's exact registered host (`originBelongsToSite`,
 *      the rule grant minting uses) — a browser page elsewhere that saw the
 *      fragment cannot spend it; a non-browser caller can forge the header,
 *      which is what the 60 s life and the single use bound;
 *   3. the spend: one conditional UPDATE.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { EDITOR_ACCESS_UNAVAILABLE } from "@/lib/auth/editor-access";
import { normalizeOrigin } from "@/lib/auth/editor-crypto";
import { originBelongsToSite } from "@/lib/auth/editor-request";
import { readEditLinkCode } from "@/lib/auth/edit-link";

/** One sentence for every refusal: no oracle for "spent" versus "forged". */
export const EDIT_LINK_REFUSED = "Invalid or expired edit link";

export type EditLinkRedemption =
  | { ok: true; token: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export async function redeemEditLink(params: {
  code: string;
  siteId: string;
  origin: string | null;
}): Promise<EditLinkRedemption> {
  const refuse = (status: 401 | 403, reason: string): EditLinkRedemption => {
    console.warn(
      `[edit-link] code refused (${reason}) for site ${params.siteId}`,
    );
    return { ok: false, status, error: EDIT_LINK_REFUSED };
  };

  const claim = readEditLinkCode(params.code);
  if (!claim) return refuse(401, "unreadable");
  if (claim.siteId !== params.siteId) return refuse(401, "site_mismatch");
  if (claim.expiresAt.getTime() <= Date.now()) return refuse(401, "expired");

  const origin = normalizeOrigin(params.origin);
  if (!origin || !(await originBelongsToSite(params.siteId, origin))) {
    return refuse(403, "origin_mismatch");
  }

  // THE SPEND. `last_used_at IS NULL` is "this link has never been opened":
  // the column has no default, issuance never sets it, and every validation of
  // the token does (validateEditSessionAccess) — so the first open, or any use
  // of the token at all, closes the link. Atomic: a second UPDATE racing this
  // one re-checks the predicate after it commits and matches nothing.
  const now = new Date().toISOString();
  const { data, error } = await createServiceRoleClient()
    .from("edit_sessions")
    .update({ last_used_at: now })
    .eq("id", claim.sessionId)
    .eq("site_id", params.siteId)
    .eq("is_active", true)
    .is("last_used_at", null)
    .gt("expires_at", now)
    .select("token");

  if (error) {
    console.error("[edit-link] spend failed:", error.message);
    return { ok: false, status: 503, error: EDITOR_ACCESS_UNAVAILABLE };
  }

  const token = (data as Array<{ token?: unknown }> | null)?.[0]?.token;
  if (typeof token !== "string" || !token) return refuse(401, "spent");

  return { ok: true, token };
}
