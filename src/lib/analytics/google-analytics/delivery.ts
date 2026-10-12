import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendSignupMeasurement } from "./measurement-protocol";

/** A tick owns at most five 5-second HTTP calls, within the route's 60s budget. */
export async function dispatchAnalytics() {
  const counts = {
    disabled: false,
    claimed: 0,
    accepted_http: 0,
    uncertain: 0,
    invalid: 0,
    finalize_failed: 0,
  };
  const db = createServiceRoleClient();
  const { error: reconcileError } = await db
    .rpc("reconcile_analytics_delivery", { p_limit: 100 })
    .abortSignal(AbortSignal.timeout(1500));
  if (reconcileError) throw new Error("analytics reconciliation unavailable");
  // Maintenance still expires claims when dispatch is disabled. Check before claiming: turning a disabled transport into an uncertain claim
  // would strand every pending event during the staged migration/code rollout.
  if (
    process.env.GA4_MP_ENABLED !== "1" ||
    process.env.VERCEL_ENV !== "production" ||
    process.env.GA4_MP_MEASUREMENT_ID !== "G-DQ00NEM3WE" ||
    !process.env.GA4_MP_API_SECRET?.trim()
  )
    return { ...counts, disabled: true };
  const deadline = Date.now() + 40000;
  for (let i = 0; i < 5 && Date.now() < deadline; i++) {
    const { data, error } = await db
      .rpc("claim_analytics_delivery")
      .abortSignal(AbortSignal.timeout(1500));
    if (error) throw new Error("analytics claim unavailable");
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) break;
    counts.claimed++;
    // Claim commit is the in-flight boundary. Later withdrawal cannot promise
    // to recall an HTTP request; never hold a database lock during this call.
    const result = await sendSignupMeasurement({
      clientId: row.client_id,
      occurredAt: Date.parse(row.occurred_at),
    });
    const state =
      result.state === "accepted_http"
        ? "accepted_http"
        : result.state === "invalid"
          ? "invalid"
          : "uncertain";
    const code =
      result.state === "disabled"
        ? "dispatch_disabled"
        : "code" in result
          ? result.code
          : "transport_error";
    counts[state]++;
    try {
      const { data: finalized, error: finalizeError } = await db
        .rpc("finalize_analytics_delivery", {
          p_id: row.id,
          p_token: row.claim_token,
          p_state: state,
          p_code: code,
        })
        .abortSignal(AbortSignal.timeout(1500));
      if (finalizeError || finalized !== true) throw new Error("finalize");
    } catch {
      counts.finalize_failed++;
      console.warn("[analytics/delivery] result persistence unavailable");
      // The claim remains sending and will become uncertain; no resend, even
      // if Google accepted HTTP before this acknowledgement was lost.
    }
  }
  return counts;
}
