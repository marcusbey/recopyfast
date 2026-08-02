/**
 * Plan shapes and the pure helpers that operate on them.
 *
 * Split out of `./plans` because that module talks to Supabase and must never
 * reach a browser bundle. Everything here is types plus arithmetic, so client
 * components can import it and apply the same rules to plan data they received
 * as props or from `/api/pricing`.
 *
 * No prices, limits or feature lists live here — those come from the `plans`
 * table (supabase/migrations/20260802000000_plans_catalog.sql).
 */

export type BillingPeriod = "monthly" | "yearly";

/**
 * Plan identifiers are a closed TypeScript union rather than `string`, even
 * though the rows themselves are database-driven.
 *
 * They are an identity contract, not configuration: `billing_subscriptions.plan`,
 * Stripe subscription metadata, the checkout request body and the feature gates
 * all key off these exact strings, and every one of those boundaries wants a
 * compile-time guarantee that a typo cannot reach it. Adding a plan is a code
 * change *and* a seed change; changing what a plan costs or includes is a seed
 * change alone, which is the split this refactor is about.
 *
 * `loadPlanCatalogue` verifies the database actually contains these ids, so the
 * union cannot silently drift from the seed.
 */
export type PaidPlanId = "starter" | "pro";
export type SubscriptionPlanId = "free" | PaidPlanId;
export type OneTimeProductId = "credits" | "lifetime_pro";

export const PAID_PLAN_IDS: readonly PaidPlanId[] = ["starter", "pro"] as const;

export const SUBSCRIPTION_PLAN_IDS: readonly SubscriptionPlanId[] = [
  "free",
  ...PAID_PLAN_IDS,
] as const;

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return (
    typeof value === "string" &&
    (PAID_PLAN_IDS as readonly string[]).includes(value)
  );
}

export function isSubscriptionPlanId(
  value: unknown,
): value is SubscriptionPlanId {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_PLAN_IDS as readonly string[]).includes(value)
  );
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "monthly" || value === "yearly";
}

/** `-1` means unlimited, matching the gates in src/lib/feature-gating. */
export interface PlanLimits {
  websites: number;
  collaborators: number;
  aiFeatures: boolean;
  translations: number;
  abTesting: boolean;
  /** Credits granted afresh each billing period; 0 means pay-per-use only. */
  monthlyCredits: number;
}

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  description: string;
  /** Monthly price when billed monthly. */
  price: number;
  /** Monthly-equivalent price when billed annually. */
  yearlyPrice: number;
  features: readonly string[];
  limits: PlanLimits;
  /** Per-month cost of each site beyond `limits.websites`; null if not sold. */
  additionalSitePrice: number | null;
  sortOrder: number;
}

export interface OneTimeProduct {
  id: OneTimeProductId;
  name: string;
  description: string;
  price: number;
  features: readonly string[];
  /** Subscription plan this purchase grants permanently, if any. */
  grantsPlanId: SubscriptionPlanId | null;
  sortOrder: number;
}

/** Credit-pack sizing, read from the `credits` product's `limits` JSON. */
export interface CreditPackConfig {
  creditsPerPack: number;
  maxPacksPerPurchase: number;
  pricePerPack: number;
}

export interface PlanCatalogue {
  subscriptions: readonly SubscriptionPlan[];
  oneTimeProducts: readonly OneTimeProduct[];
  /**
   * Credit-pack sizing, lifted out of the `credits` product's `limits` JSON so
   * client components get it without having to know the JSON shape.
   */
  creditPack: CreditPackConfig;
}

/**
 * The plan a subscriber is on, falling back to `free` for unknown ids — an id
 * retired years ago can still be sitting in an old subscription row.
 */
export function findSubscriptionPlan(
  catalogue: PlanCatalogue,
  planId: string | null | undefined,
): SubscriptionPlan | undefined {
  return (
    catalogue.subscriptions.find((plan) => plan.id === planId) ??
    catalogue.subscriptions.find((plan) => plan.id === "free")
  );
}

export function findOneTimeProduct(
  catalogue: PlanCatalogue,
  productId: OneTimeProductId,
): OneTimeProduct | undefined {
  return catalogue.oneTimeProducts.find((product) => product.id === productId);
}

/** Plans a customer can actually buy; `free` is the absence of a subscription. */
export function sellablePlans(
  catalogue: PlanCatalogue,
): readonly SubscriptionPlan[] {
  return catalogue.subscriptions.filter((plan) => plan.id !== "free");
}

/**
 * Monthly-equivalent display price for a plan/period pair.
 */
export function planDisplayPrice(
  plan: SubscriptionPlan,
  billingPeriod: BillingPeriod,
): number {
  return billingPeriod === "yearly" ? plan.yearlyPrice : plan.price;
}

/**
 * Total charged per billing cycle. Annual plans bill twelve times the
 * monthly-equivalent price once a year.
 */
export function planCyclePrice(
  plan: SubscriptionPlan,
  billingPeriod: BillingPeriod,
): number {
  return billingPeriod === "yearly"
    ? roundToCents(plan.yearlyPrice * 12)
    : plan.price;
}

/**
 * Annual saving from paying yearly instead of monthly.
 *
 * The rounding is load-bearing, not cosmetic: the prices are binary-inexact
 * decimals, so (9 - 7.47) * 12 evaluates to 18.359999999999996 and was
 * rendering to customers verbatim on the Starter card.
 */
export function planYearlySaving(plan: SubscriptionPlan): number {
  return roundToCents((plan.price - plan.yearlyPrice) * 12);
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
