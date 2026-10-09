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
 *   3. the session the code names is validated as any stored session is
 *      (ADR 047), WITHOUT recording a use;
 *   4. the spend: one conditional UPDATE — and only now is the token answered.
 *
 * CHECK, THEN SPEND (review minor 3). This spent the code first and validated
 * after, so a database blip during the validation answered 503 over a code
 * that was already burnt: the widget kept it (a 5xx is transient), retried,
 * and was told the link was spent. Now nothing is spent until the session is
 * confirmed valid, and a 503 at any step leaves the link unopened for the
 * retry. Never the other way round — answering the token on a 503 would hand
 * out a session nobody had confirmed was still its holder's (ADR 047).
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  EDITOR_ACCESS_UNAVAILABLE,
  validateEditorAccess,
  type EditorAccessValidation,
} from "@/lib/auth/editor-access";
import { normalizeOrigin } from "@/lib/auth/editor-crypto";
import { originBelongsToSite } from "@/lib/auth/editor-request";
import { readEditLinkCode } from "@/lib/auth/edit-link";

/** One sentence for every refusal: no oracle for "spent" versus "forged". */
export const EDIT_LINK_REFUSED = "Invalid or expired edit link";

export type EditLinkRedemption =
  | { ok: true; token: string; validation: EditorAccessValidation }
  | { ok: false; status: 401 | 403 | 503; error: string };

const UNAVAILABLE: EditLinkRedemption = {
  ok: false,
  status: 503,
  error: EDITOR_ACCESS_UNAVAILABLE,
};

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
  // "Not unexpired", not "expired": an expiry that is no date (NaN) compares
  // false both ways and must refuse (review minor 1).
  if (!(claim.expiresAt.getTime() > Date.now())) {
    return refuse(401, "expired");
  }

  const origin = normalizeOrigin(params.origin);
  const belongs = origin
    ? await originBelongsToSite(params.siteId, origin)
    : false;
  if (belongs === null) return UNAVAILABLE;
  if (!belongs) return refuse(403, "origin_mismatch");

  const supabase = createServiceRoleClient();

  // The token of the session, if its link has never been opened. A replay
  // stops here, before the validation's reads.
  const { data: unopened, error: readError } = await supabase
    .from("edit_sessions")
    .select("token")
    .eq("id", claim.sessionId)
    .eq("site_id", params.siteId)
    .is("last_used_at", null)
    .maybeSingle<{ token: string }>();

  if (readError) {
    console.error("[edit-link] session lookup failed:", readError.message);
    return UNAVAILABLE;
  }
  const token = unopened?.token;
  if (typeof token !== "string" || !token) return refuse(401, "spent");

  const validation = await validateEditorAccess({
    siteId: params.siteId,
    token: { kind: "edit-session", token },
    recordUse: false,
  });
  if (validation.status === 503) return UNAVAILABLE;
  if (!validation.valid) return refuse(401, "session_refused");

  // THE SPEND. `last_used_at IS NULL` is "this link has never been opened":
  // the column has no default, issuance never sets it, and every validation of
  // the token does (validateEditSessionAccess) — so the first open, or any use
  // of the token at all, closes the link. Atomic: a second UPDATE racing this
  // one re-checks the predicate after it commits and matches nothing. The
  // other filters repeat what the validation above just confirmed, here, at
  // the moment of the write: a session that expired, was deactivated or was
  // opened elsewhere in between is not spent.
  const now = new Date().toISOString();
  const { data, error } = await supabase
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
    return UNAVAILABLE;
  }

  const spent = (data as Array<{ token?: unknown }> | null)?.[0]?.token;
  if (spent !== token) return refuse(401, "spent");

  return { ok: true, token, validation };
}
