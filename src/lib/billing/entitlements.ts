import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { findPlanById } from "@/lib/stripe/plans";
import type { SubscriptionPlan } from "@/lib/stripe/plans";
import { readEffectivePlanId } from "./effective-plan";

/**
 * Which plan's entitlements a user actually has — or that they have none.
 *
 * There is no free plan. An account that has never paid is *unentitled*, which
 * is a state of its own and not a plan whose limits happen to be zero. Every
 * feature gate resolves through here rather than reading
 * `billing_subscriptions.plan` directly, because a lifetime customer has no
 * subscription row at all and reading only that table would strand them the
 * moment they finished paying $199.
 */

/**
 * The plan in force for a user, or the explicit absence of one.
 *
 * Modelled as a discriminated union rather than as a zero-limit plan object,
 * because at a call site those two are indistinguishable. `getEffectivePlan`
 * used to end in a `?? "free"` fallback that handed every gate a real
 * `SubscriptionPlan` whose limits were all zero, so "has not paid" and "is on a
 * plan that includes nothing" read identically — a gate that forgot to check
 * entitlement worked anyway, by accident, and would have started granting
 * access the day someone edited the free row's limits.
 *
 * `plan` and `planId` are `null` on the unentitled branch, so
 * `entitlement.plan.limits` does not compile until the caller has narrowed on
 * `entitled`. That is the point: the compiler finds the call sites, not grep.
 */
export type Entitlement =
  | {
      readonly entitled: true;
      readonly planId: string;
      readonly plan: SubscriptionPlan;
    }
  | { readonly entitled: false; readonly planId: null; readonly plan: null };

/** The single unentitled value, so callers can compare against it directly. */
export const UNENTITLED: Entitlement = {
  entitled: false,
  planId: null,
  plan: null,
};

/**
 * The raw plan id recorded for a user, or `null` when there is none.
 *
 * The query lives in ./effective-plan so `src/middleware.ts` can ask the same
 * question with its own request-scoped client.
 */
export async function getEffectivePlanId(
  userId: string,
): Promise<string | null> {
  return readEffectivePlanId(await createClient(), userId);
}

/**
 * The full plan config in force for a user, or `UNENTITLED`.
 *
 * A plan id with no active catalogue row — one retired years ago, or one
 * switched off — is unentitled too. It used to fall back to `free`, which is
 * how a plan that no longer exists kept conferring access.
 */
export async function getEffectivePlan(userId: string): Promise<Entitlement> {
  const planId = await getEffectivePlanId(userId);
  if (planId === null) {
    return UNENTITLED;
  }

  const plan = await findPlanById(planId);
  if (!plan) {
    return UNENTITLED;
  }

  return { entitled: true, planId, plan };
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
