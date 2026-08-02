import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getPlanForSubscriber } from "@/lib/stripe/plans";
import type { SubscriptionPlan, SubscriptionPlanId } from "@/lib/stripe/plans";

/**
 * Which plan's entitlements a user actually has.
 *
 * Two things can grant a plan and they are stored separately:
 *
 *   * `billing_subscriptions` — a recurring Stripe subscription with a period
 *     and a renewal date.
 *   * `plan_entitlements` — a permanent grant from a one-time purchase
 *     (Lifetime Pro) or a support comp. No period, never renews, never lapses.
 *
 * Every feature gate needs the union of the two, so it resolves through here
 * instead of reading `billing_subscriptions.plan` directly. A lifetime customer
 * has no subscription row at all; reading only that table would gate them to
 * free the moment they finished paying $199.
 */

/** Statuses that count as "the user currently has this plan". */
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/**
 * The plan id in force for a user, or "free".
 *
 * An entitlement wins over a subscription: someone who bought Lifetime Pro and
 * later starts a Starter subscription should keep Pro, and a lifetime grant can
 * never be downgraded by a lapsed card.
 */
export async function getEffectivePlanId(
  userId: string,
): Promise<SubscriptionPlanId | string> {
  const supabase = await createClient();

  const { data: entitlement, error: entitlementError } = await supabase
    .from("plan_entitlements")
    .select("plan_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan_id: string }>();

  // A read failure here must not silently downgrade a paying customer to free,
  // so it is surfaced rather than swallowed.
  if (entitlementError) {
    throw new Error(
      `Failed to read plan entitlements: ${entitlementError.message}`,
    );
  }

  if (entitlement) {
    return entitlement.plan_id;
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("billing_subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .in("status", LIVE_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan: string }>();

  if (subscriptionError) {
    throw new Error(
      `Failed to read billing subscriptions: ${subscriptionError.message}`,
    );
  }

  return subscription?.plan ?? "free";
}

/**
 * The full plan config in force for a user. Unknown ids resolve to `free`.
 */
export async function getEffectivePlan(
  userId: string,
): Promise<SubscriptionPlan> {
  return getPlanForSubscriber(await getEffectivePlanId(userId));
}

export interface GrantEntitlementResult {
  granted: boolean;
  /** True when this payment had already been granted (redelivered webhook). */
  duplicate: boolean;
}

/**
 * Record a permanent plan grant.
 *
 * Called from the Stripe webhook with the service-role client, because
 * `plan_entitlements` deliberately has no INSERT policy for authenticated
 * users — the row is worth $199.
 *
 * `stripe_payment_intent_id` is UNIQUE, so a redelivered event collides instead
 * of granting twice. That collision is the expected path, not an error, and is
 * reported as `duplicate` rather than thrown so the webhook can answer 200 and
 * stop Stripe retrying.
 */
export async function grantPlanEntitlement(
  userId: string,
  planId: string,
  stripePaymentIntentId: string,
  source: string = "lifetime_purchase",
): Promise<GrantEntitlementResult> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("plan_entitlements").insert({
    user_id: userId,
    plan_id: planId,
    source,
    stripe_payment_intent_id: stripePaymentIntentId,
  });

  if (error) {
    if (error.code === "23505") {
      return { granted: false, duplicate: true };
    }
    throw new Error(
      `Failed to grant "${planId}" entitlement to ${userId}: ${error.message}`,
    );
  }

  return { granted: true, duplicate: false };
}

/**
 * Revoke the entitlement a payment granted, after a refund or a chargeback.
 *
 * Soft-revoked (`revoked_at` set) rather than deleted so the audit trail
 * survives: "this user had lifetime and lost it on this date" is a question
 * support will ask, and a deleted row cannot answer it.
 */
export async function revokeEntitlementForPayment(
  stripePaymentIntentId: string,
  reason: string,
): Promise<{ revoked: boolean }> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("plan_entitlements")
    .update({
      revoked_at: new Date().toISOString(),
      source: `revoked:${reason}`,
    })
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to revoke entitlement for ${stripePaymentIntentId}: ${error.message}`,
    );
  }

  return { revoked: (data?.length ?? 0) > 0 };
}
