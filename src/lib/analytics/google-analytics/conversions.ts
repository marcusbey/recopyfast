import { createServiceRoleClient } from "@/lib/supabase/service";
import { contextCapabilityHash, contextConsent } from "./context-server";
import { readConsentChoice } from "./consent-choice";

/** A successful verifyOtp of this exact type is required; a query alone is not proof. */
export type SignupProof =
  | "signup"
  | "invite"
  | "magiclink"
  | "email_change"
  | "email"
  | "pkce";

export async function freezeVerifiedSignup(
  request: Request,
  userId: string,
  proof: SignupProof,
): Promise<{ state: string }> {
  try {
    const denied =
      readConsentChoice(request.headers.get("cookie")) === "denied";
    const eligible =
      process.env.ANALYTICS_CONTEXT_DISABLED !== "1" &&
      !denied &&
      !!contextConsent(request);
    const { data, error } = await createServiceRoleClient()
      .rpc("freeze_analytics_signup", {
        p_user_id: userId,
        p_hash: eligible || denied ? contextCapabilityHash(request) : null,
        p_proven: proof === "signup" || proof === "invite",
        p_consent: denied ? "denied" : eligible ? "eligible" : "ineligible",
      })
      .abortSignal(AbortSignal.timeout(1500));
    if (error || !Array.isArray(data) || typeof data[0]?.state !== "string")
      throw new Error("freeze");
    return { state: data[0].state };
  } catch {
    // No raw auth/profile, capability, RPC response or exception is telemetry.
    // An unavailable transaction may have committed; never enqueue a replacement
    // from a later device. The private unique source key recovers lost ACKs only.
    console.warn("[analytics/signup] source freeze unavailable");
    return { state: "unknown" };
  }
}
