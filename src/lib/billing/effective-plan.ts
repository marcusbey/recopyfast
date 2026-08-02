import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlanById } from "@/lib/stripe/plans";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";
import { readPurchasedCreditBalance } from "@/lib/credits/spendable";

/**
 * What an account is entitled to, resolved in one place.
 *
 * Client-agnostic on purpose. `src/middleware.ts` decides whether a session may
 * reach the dashboard and the feature gates decide whether it may do a given
 * thing, and both go through `resolveEntitlement` with their own Supabase
 * client — middleware builds a request-scoped one and cannot use
 * `@/lib/supabase/server`, which reaches `next/headers`. Two computations of
 * the same idea is exactly how a control comes to look like it works and does
 * not, so there is only one.
 */

/** Statuses that count as "the user currently has this plan". */
export const LIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;

/**
 * Plan ids that no longer entitle anyone, whatever the row says.
 *
 * `free` is retired. Rows still holding it — subscriptions and grants alike —
 * resolve to no plan at all: current free users meet the paywall on next
 * sign-in rather than being grandfathered.
 *
 * Doing it here rather than in the database is deliberate and load-bearing.
 * Deactivating the catalogue row or dropping `'free'` from the `plan` CHECK
 * ahead of this code would strand those accounts the instant it deployed, which
 * is the code-before-schema inversion that already broke credits once. The row
 * stays seeded and inert; this is what makes it mean nothing.
 */
const RETIRED_PLAN_IDS: readonly string[] = ["free"];

function isRetired(planId: string): boolean {
  return RETIRED_PLAN_IDS.includes(planId);
}

/**
 * What an account may do.
 *
 * Three states, discriminated on `kind`, because there are genuinely three:
 *
 *   plan    — a live subscription or a permanent grant. Capabilities and
 *             quotas come from here and only from here.
 *   credits — no plan, but purchased credits left to spend. They paid for a
 *             delivered good, so it stays spendable; it confers no plan.
 *   none    — nothing. The paywall.
 *
 * Modelled as a union rather than a boolean beside one, so a caller reaching
 * for `.plan` has to say what it does in the other two cases. Being entitled by
 * credits is emphatically not the same as being on a plan, and a boolean would
 * have let the two blur at exactly the call sites where the difference decides
 * whether someone gets a site they did not buy.
 */
export type Entitlement =
  | {
      readonly kind: "plan";
      readonly planId: string;
      readonly plan: SubscriptionPlan;
    }
  | { readonly kind: "credits"; readonly planId: null; readonly plan: null }
  | { readonly kind: "none"; readonly planId: null; readonly plan: null };

/** The single unentitled value. */
export const UNENTITLED: Entitlement = {
  kind: "none",
  planId: null,
  plan: null,
};

/**
 * Can this account do anything at all?
 *
 * THE shared predicate. `src/middleware.ts` uses it to decide whether a session
 * may leave the checkout page, and the credit-metered gates use it as their
 * floor. Both consume this one function over the one `Entitlement`, so the
 * router does not get its own opinion about who is let in.
 *
 * It deliberately does not answer "may they do X". Quota- and capability-shaped
 * questions narrow on `kind === "plan"` instead, because credits buy metered
 * usage and never a plan.
 */
export function hasAnyEntitlement(entitlement: Entitlement): boolean {
  return entitlement.kind !== "none";
}

/**
 * The raw plan id recorded for a user, or `null` when there is none.
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
 * Retired ids are normalised to `null` here, at the one point both the router
 * and the gates read through, so a `free` row cannot mean one thing to
 * middleware and another to a feature gate.
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

  if (entitlement && !isRetired(entitlement.plan_id)) {
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

  if (!subscription || isRetired(subscription.plan)) {
    return null;
  }

  return subscription.plan;
}

/**
 * The one entitlement computation.
 *
 * The wallet is only read once a plan has been ruled out, so a subscriber's
 * gate checks cost exactly what they cost before credits started entitling
 * anyone. A plan id with no active catalogue row — retired years ago, or
 * switched off — is not a plan, and falls through to the wallet like any other
 * unsubscribed account: someone holding a dead plan id and 500 credits is a
 * credit holder, not a lost cause.
 */
export async function resolveEntitlement(
  supabase: SupabaseClient,
  userId: string,
): Promise<Entitlement> {
  const planId = await readEffectivePlanId(supabase, userId);

  if (planId !== null) {
    const plan = await findPlanById(planId);
    if (plan) {
      return { kind: "plan", planId, plan };
    }
  }

  const purchasedCredits = await readPurchasedCreditBalance(supabase, userId);
  if (purchasedCredits > 0) {
    return { kind: "credits", planId: null, plan: null };
  }

  return UNENTITLED;
}
