import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading which plan id a user has, independent of how the Supabase client was
 * built.
 *
 * Split out of ./entitlements so `src/middleware.ts` can ask the same question:
 * that module reaches `@/lib/supabase/server`, which calls `next/headers`, and
 * middleware has no headers store — it builds its own request-scoped client and
 * passes it in here. One query, one place, so the routing gate and the feature
 * gates cannot disagree about who has paid.
 */

/** Statuses that count as "the user currently has this plan". */
export const LIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;

/**
 * The plan id in force for a user, or `null` when there is none.
 *
 * Two things can grant a plan and they are stored separately:
 *
 *   * `billing_subscriptions` — a recurring Stripe subscription with a period
 *     and a renewal date.
 *   * `plan_entitlements` — a permanent grant from a one-time purchase
 *     (Lifetime Pro) or a support comp. No period, never renews, never lapses.
 *
 * An entitlement wins over a subscription: someone who bought Lifetime Pro and
 * later starts a Starter subscription should keep Pro, and a lifetime grant can
 * never be downgraded by a lapsed card.
 *
 * `null` is the honest answer for an account that has neither, and it is the
 * whole point of this function. It used to end `?? "free"`, which handed every
 * caller a plan id that resolved to a real catalogue row — so "has not paid"
 * and "is on a plan" were the same value.
 */
export async function readEffectivePlanId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: entitlement, error: entitlementError } = await supabase
    .from("plan_entitlements")
    .select("plan_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan_id: string }>();

  // A read failure here must not silently downgrade a paying customer, so it is
  // surfaced rather than swallowed.
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

  return subscription?.plan ?? null;
}
