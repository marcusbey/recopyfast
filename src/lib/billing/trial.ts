import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { TRIAL_SOURCE, resolveEntitlement } from "./effective-plan";

/**
 * Starting the 14-day Pro trial.
 *
 * The trial is a row in `plan_entitlements` — the same table a $199 Lifetime
 * purchase writes into — tagged `source = 'trial'` and carrying an `expires_at`
 * (ADR 014). It confers `pro` for fourteen days and then simply stops being
 * selected by `readEffectivePlanId`. Nothing revokes it, nothing sweeps it, and
 * there is no cron: expiry is a predicate inside a query, so it is exact rather
 * than eventually consistent — which is what an authorization boundary has to
 * be.
 *
 * Kept beside `./entitlements` rather than inside it because that module's
 * `grantPlanEntitlement` is the Stripe webhook's money path: its signature
 * requires a non-nullable payment intent, and a trial has neither a payment nor
 * that shape. A sibling function keeps the purchase path's diff empty.
 */

/** How long the trial runs. The number the marketing copy promises. */
export const TRIAL_DURATION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days a customer would say they have left.
 *
 * Rounded UP, and that is the point: with eight and a half days to run, "8 days
 * left" reads as a day already taken away. The countdown reaches 1 for the
 * whole of the final day and 0 only once the trial is genuinely over.
 *
 * Presentation only. Both surfaces that show this resolve whether the trial
 * still entitles anyone separately, server-side — a number on a page has never
 * been allowed to decide what an account may do.
 */
export function trialDaysRemaining(expiresAt: string): number {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

/** PostgreSQL unique violation — here, the one-trial-per-user index firing. */
const UNIQUE_VIOLATION = "23505";

export interface StartTrialResult {
  granted: boolean;
  /** True when this account had already used its one trial. */
  duplicate: boolean;
}

/**
 * When the trial being started right now ends.
 *
 * Computed server-side from the server's own clock and stored, never taken from
 * a request: expiry decides what an account may do, so a client-supplied end
 * date would be a client-supplied entitlement.
 */
function trialExpiry(): string {
  return new Date(Date.now() + TRIAL_DURATION_DAYS * DAY_MS).toISOString();
}

/**
 * Write the trial grant.
 *
 * Service-role, because `plan_entitlements` deliberately has no INSERT policy
 * for `authenticated` — the same reason the lifetime grant is written that way.
 * An account must never be able to hand itself a plan.
 *
 * `stripe_payment_intent_id` stays NULL. `refundCredits` fabricates a synthetic
 * key for `credit_purchases`, and copying that habit here would put a
 * payment-shaped id on a row nobody paid for. The uniqueness that makes "one
 * trial per account, ever" true comes from the partial unique index on
 * `(user_id) WHERE source = 'trial'`
 * (20260817000000_trial_entitlements.sql), which is also the only thing that
 * can settle two concurrent sign-ins.
 *
 * A collision on that index is the guarantee working, not a failure, so it is
 * reported as `duplicate` — the same shape `grantPlanEntitlement` uses for a
 * redelivered webhook.
 */
export async function grantTrialEntitlement(
  userId: string,
): Promise<StartTrialResult> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("plan_entitlements").insert({
    user_id: userId,
    plan_id: "pro",
    source: TRIAL_SOURCE,
    stripe_payment_intent_id: null,
    expires_at: trialExpiry(),
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { granted: false, duplicate: true };
    }
    throw new Error(`Failed to start a trial for ${userId}: ${error.message}`);
  }

  return { granted: true, duplicate: false };
}

/**
 * Give this account a trial if it has never had anything.
 *
 * Called from `/auth/callback` and `/auth/confirm`, which are the only two
 * places the server sees a user establish a session — and both fire on EVERY
 * sign-in, not just the first. There is no signup route and no "email
 * confirmed" event to hang a one-shot on: sign-up is passwordless
 * `signInWithOtp`, so the first sign-in and the tenth are the same code path.
 *
 * `resolveEntitlement` is what makes the tenth cheap: a subscriber, a lifetime
 * holder, a credit holder, and an account still inside its own trial all
 * resolve to something, and none of them attempt a write. Only `kind === "none"`
 * reaches the insert — which is also, deliberately, the state an EXPIRED trial
 * resolves to. That is why the check alone cannot enforce AC 6 and the database
 * index has to: a lapsed trial looks exactly like a fresh account from here.
 *
 * Nothing here throws. This runs between "the session is valid" and "redirect
 * to the dashboard", so a failure to hand out a free trial must never be able
 * to fail a sign-in.
 */
export async function ensureTrialStarted(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const entitlement = await resolveEntitlement(supabase, userId);

    if (entitlement.kind !== "none") {
      return;
    }

    await grantTrialEntitlement(userId);
  } catch (error) {
    console.error(`[trial] could not start a trial for ${userId}:`, error);
  }
}
