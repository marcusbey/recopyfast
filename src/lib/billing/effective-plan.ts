import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlanById } from "@/lib/stripe/plans";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";
import {
  readPurchasedCreditBalance,
  spendableFilter,
} from "@/lib/credits/spendable";

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
 * `plan_entitlements.source` for the 14-day Pro trial (ADR 014).
 *
 * A third value in a vocabulary that was two: `lifetime_purchase` on grant,
 * `revoked:<reason>` on revocation (see ./entitlements). It deliberately does
 * not collide with the `revoked:` prefix, and it is the tag both the expiry
 * mechanism and the "this was never paid for" exclusion below key off — so it
 * is declared once, here, beside the two reads that care.
 */
export const TRIAL_SOURCE = "trial";

/** A trial grant, whether or not it is still running. */
export interface TrialGrant {
  readonly grantedAt: string;
  readonly expiresAt: string;
  /** False once the window has closed, or if the grant was revoked. */
  readonly isActive: boolean;
}

/**
 * The one trial row an account can ever have, expired or not.
 *
 * At most one exists: `plan_entitlements_one_trial_per_user`
 * (20260817000000_trial_entitlements.sql) is a partial unique index on
 * `(user_id) WHERE source = 'trial'`, so "one trial per account, ever" is a
 * database constraint rather than something two concurrent sign-ins can race
 * past.
 *
 * Deliberately NOT filtered on expiry, unlike `readEffectivePlanId` below.
 * Three callers need the row after it has lapsed: the credit period (which
 * keys off `granted_at`), the dashboard's days-remaining countdown, and the
 * "has this account ever trialled" signal that picks the expired-state copy.
 * One read, one answer, rather than three questions about the same row.
 *
 * Presentation and metering only — never authorisation. What an account may do
 * is decided by `resolveEntitlement`, which does not consult this.
 */
export async function readTrialGrant(
  supabase: SupabaseClient,
  userId: string,
): Promise<TrialGrant | null> {
  const { data, error } = await supabase
    .from("plan_entitlements")
    .select("granted_at, expires_at, revoked_at")
    .eq("user_id", userId)
    .eq("source", TRIAL_SOURCE)
    .limit(1)
    .maybeSingle<{
      granted_at: string | null;
      expires_at: string | null;
      revoked_at: string | null;
    }>();

  if (error) {
    throw new Error(`Failed to read the trial entitlement: ${error.message}`);
  }

  // A row missing either timestamp cannot say when the window opened or closed,
  // and guessing at an authorization-adjacent boundary is worse than reporting
  // no trial at all.
  if (
    !data ||
    typeof data.granted_at !== "string" ||
    typeof data.expires_at !== "string"
  ) {
    return null;
  }

  return {
    grantedAt: data.granted_at,
    expiresAt: data.expires_at,
    isActive:
      (data.revoked_at ?? null) === null &&
      new Date(data.expires_at).getTime() > Date.now(),
  };
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
 *   * `plan_entitlements` — a grant that is not a subscription: a one-time
 *     purchase (Lifetime Pro), a support comp, or the 14-day trial. It never
 *     renews. `expires_at IS NULL` is the permanent kind and is what every
 *     purchase and comp writes; a trial is the same row with a date on it
 *     (ADR 014), and lapses by simply not being selected any more.
 *
 * An entitlement wins over a subscription: someone who bought Lifetime Pro and
 * later starts a Starter subscription should keep Pro, and a lifetime grant can
 * never be downgraded by a lapsed card.
 *
 * Retired ids are normalised to `null` here, at the one point both the router
 * and the gates read through, so a `free` row cannot mean one thing to
 * middleware and another to a feature gate.
 */
/**
 * Every plan a user holds a PERMANENT grant for. Not their effective plan.
 *
 * The difference is the whole point, and getting it wrong cost a sale: the
 * lifetime duplicate guard first asked `readEffectivePlanId`, which falls back
 * to a live subscription when there is no grant — so a Pro *monthly subscriber*
 * resolved to `pro`, matched the plan Lifetime Pro confers, and was refused
 * with "You already have lifetime access" for something they had never bought.
 * That refused exactly the customer most likely to buy it.
 *
 * "What is in force" and "what have they already paid for outright" are
 * different questions. This answers the second, and both the checkout guard and
 * the billing page read it, so the server and the UI cannot disagree about who
 * is allowed to see — or complete — the offer.
 *
 * Returns every granted plan id rather than the newest: an account can hold
 * several live grants, and holding the one in question is what matters,
 * regardless of what was granted most recently.
 *
 * Trial rows are excluded, and that exclusion is load-bearing. A 14-day trial
 * writes `{plan_id: 'pro'}` into this same table (ADR 014), and without the
 * filter it would answer "yes, this account already holds Pro outright" — so
 * every trialling account would be refused the $199 Lifetime purchase with a
 * 409 that reads as intentional, and have the offer card hidden from them.
 * That is the defect the comment above documents having already shipped once,
 * arriving through a second door. A trial is not a purchase.
 */
export async function readGrantedPlanIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("plan_entitlements")
    .select("plan_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .neq("source", TRIAL_SOURCE)
    .returns<Array<{ plan_id: string }>>();

  if (error) {
    throw new Error(`Failed to read plan entitlements: ${error.message}`);
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => row.plan_id)
        .filter((planId) => !isRetired(planId)),
    ),
  );
}

export async function readEffectivePlanId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: entitlement, error: entitlementError } = await supabase
    .from("plan_entitlements")
    .select("plan_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    // Expiry is a predicate INSIDE the query, never a check on the row after
    // it comes back, and the difference is a paying customer's access.
    //
    // The branch below is `if (entitlement && ...) return entitlement.plan_id`
    // with nothing under it but the subscription fallback. Selecting an expired
    // trial and then discarding it here would return null and skip that
    // fallback entirely — so somebody who converted mid-trial, is being billed,
    // and whose earlier trial has since lapsed would be shown the paywall. Not
    // selecting the row instead lets `.limit(1)` find the next live grant, or
    // fall through to their subscription, which is what makes conversion free.
    //
    // Same shape and same function as the credit wallet's "not expired yet"
    // filter, reused rather than restated: NULL means never expires, which is
    // what every pre-trial grant row holds and why none of them need a backfill.
    .or(spendableFilter())
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
