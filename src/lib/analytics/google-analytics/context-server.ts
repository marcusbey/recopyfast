import {
  CONSENT_RECEIPT_COOKIE_NAME,
  verifyConsentReceipt,
} from "./consent-receipt";
import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isConsentRequiredCountry, readConsentChoice } from "./consent";

export const CONTEXT_COOKIE_NAME = "__Host-rcf_analytics_context";
export const CONTEXT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function cookieValue(request: Request, name: string): string | null {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const at = item.indexOf("=");
    if (item.slice(0, at).trim() === name) return item.slice(at + 1).trim();
  }
  return null;
}
export function contextCapabilityHash(request: Request): string | null {
  const value = cookieValue(request, CONTEXT_COOKIE_NAME);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? createHash("sha256").update(value).digest("hex")
    : null;
}
export function contextConsent(
  request: Request,
): { basis: "explicit" | "regional"; expiresAt: number } | null {
  const now = Date.now();
  const choice = readConsentChoice(request.headers.get("cookie"));
  if (choice === "denied" || cookieValue(request, "rcf_analytics_pending"))
    return null;
  if (choice === "granted") {
    const receipt = verifyConsentReceipt(
      cookieValue(request, CONSENT_RECEIPT_COOKIE_NAME),
      now,
    );
    return receipt ? { basis: "explicit", expiresAt: receipt.expiresAt } : null;
  }
  // Headers are trusted only at Vercel's edge, as in the existing init route.
  return isConsentRequiredCountry(
    request.headers.get("x-vercel-ip-country"),
    request.headers.get("x-vercel-ip-country-region"),
  )
    ? null
    : { basis: "regional", expiresAt: now + CONTEXT_MAX_AGE_SECONDS * 1000 };
}

/** Caller supplies only a getUser/verified auth identity; no browser user ID. */
export async function bindAnalyticsContext(
  request: Request,
  userId: string,
): Promise<void> {
  if (process.env.ANALYTICS_CONTEXT_DISABLED === "1") return;
  try {
    const hash = contextCapabilityHash(request);
    // Withdrawal on a private route retries the account-wide revocation without
    // loading Google or renewing a capture. Unknown geography cannot grant consent.
    const denied =
      readConsentChoice(request.headers.get("cookie")) === "denied";
    if (!denied && (!hash || !contextConsent(request))) return;
    const { error } = await createServiceRoleClient()
      .rpc(denied ? "revoke_analytics_context" : "bind_analytics_context", {
        p_hash: hash,
        p_user_id: userId,
      })
      .abortSignal(AbortSignal.timeout(1500));
    if (error) console.warn("[analytics/context] binding unavailable");
  } catch {
    console.warn("[analytics/context] binding unavailable");
  }
}

/** Server logout has no browser helper; retain a retry marker if erasure fails. */
export async function revokeAnalyticsCapability(
  request: Request,
): Promise<boolean> {
  try {
    const hash = contextCapabilityHash(request);
    if (!hash) return true;
    const { error } = await createServiceRoleClient()
      .rpc("revoke_analytics_context", { p_hash: hash, p_user_id: null })
      .abortSignal(AbortSignal.timeout(1500));
    if (error) {
      console.warn("[analytics/context] logout revoke unavailable");
      return false;
    }
    return true;
  } catch {
    console.warn("[analytics/context] logout revoke unavailable");
    return false;
  }
}
