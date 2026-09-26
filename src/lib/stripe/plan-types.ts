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
export type PaidPlanId = "starter" | "pro" | "agency";
export type SubscriptionPlanId = "free" | PaidPlanId;
export type OneTimeProductId = "credits" | "lifetime_pro" | "lifetime_agency";

/** Ascending entitlement priority; later plans must include earlier access. */
export const PAID_PLAN_IDS: readonly PaidPlanId[] = [
  "starter",
  "pro",
  "agency",
] as const;

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

export function isLifetimeProductId(
  value: unknown,
): value is Extract<OneTimeProductId, "lifetime_pro" | "lifetime_agency"> {
  return value === "lifetime_pro" || value === "lifetime_agency";
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
  /** Exact amount Stripe charges once per annual billing cycle. */
  yearlyTotal?: number;
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
  /**
   * Limits this purchase overrides on the plan it grants, read from the
   * product row's own `limits` (ADR 038). Absent or empty: the purchase confers
   * the granted plan exactly. Founding Agency carries `{ monthlyCredits: 250 }`
   * — everything in Agency, with 250 AI credits a month.
   */
  grantLimits?: Readonly<Partial<PlanLimits>>;
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
 * The plan a subscriber is on, or undefined when the catalogue holds no active
 * row for that id — including when there is no id at all, which is what an
 * account that has not paid resolves to.
 *
 * The client-side mirror of `findPlanById` in ./plans, and it dropped the same
 * `free` fallback for the same reason: "no plan" is a state the caller has to
 * render, not one to paper over with a plan object.
 */
export function findSubscriptionPlan(
  catalogue: PlanCatalogue,
  planId: string | null | undefined,
): SubscriptionPlan | undefined {
  if (!planId) {
    return undefined;
  }
  return catalogue.subscriptions.find((plan) => plan.id === planId);
}

/**
 * The plan as an account holding it *through a purchase* gets it: the catalogue
 * row with the granting product's `grantLimits` laid over its limits.
 *
 * s45: a lifetime Founding Agency owner holds `agency` — the plan id the grant
 * function writes and every Agency check compares against — but with 250
 * monthly AI credits instead of the subscription's 1,000. Only the limits
 * differ, so every gate (they all read limits) sees Agency except the credit
 * allowance. Who counts as holding a plan through a purchase is decided in
 * `src/lib/billing/effective-plan.ts`, not here.
 *
 * Returns the catalogue object itself when the purchase overrides nothing, so
 * Lifetime Pro — and Founding Agency before migration 20260926120000 — resolve
 * exactly as before. `loadPlanCatalogue` guarantees at most one active product
 * grants a given plan, which is what makes `find` an answer rather than a
 * guess.
 */
export function findPlanHeldByPurchase(
  catalogue: PlanCatalogue,
  planId: string | null | undefined,
): SubscriptionPlan | undefined {
  const plan = findSubscriptionPlan(catalogue, planId);
  if (!plan) {
    return undefined;
  }

  const overrides = catalogue.oneTimeProducts.find(
    (product) => product.grantsPlanId === plan.id,
  )?.grantLimits;
  if (!overrides || Object.keys(overrides).length === 0) {
    return plan;
  }

  return { ...plan, limits: { ...plan.limits, ...overrides } };
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
    ? (plan.yearlyTotal ?? roundToCents(plan.yearlyPrice * 12))
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
