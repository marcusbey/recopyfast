/**
 * Plan + pricing configuration.
 *
 * This module is deliberately free of any `stripe` server-SDK import so that
 * client components (UpgradeDialog, SubscriptionCard, UsageCard) can read plan
 * metadata without pulling the Node Stripe SDK into the browser bundle.
 * `./config` re-exports everything here for existing server-side callers.
 *
 * Note: the `*PriceId` fields read server-only env vars, so they resolve to
 * `undefined` in the browser. Never rely on them client-side — the server
 * resolves the price when it creates a Checkout Session.
 */

export type BillingPeriod = "monthly" | "yearly";

export type PaidPlanId = "starter" | "pro" | "enterprise";

export const PAID_PLAN_IDS: readonly PaidPlanId[] = [
  "starter",
  "pro",
  "enterprise",
] as const;

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return (
    typeof value === "string" &&
    (PAID_PLAN_IDS as readonly string[]).includes(value)
  );
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "monthly" || value === "yearly";
}

// Subscription plans configuration
export const SUBSCRIPTION_PLANS = {
  // Hidden fallback for users with no active subscription
  FREE: {
    id: "free",
    name: "Free",
    description: "No active subscription",
    price: 0,
    yearlyPrice: 0,
    priceId: null,
    yearlyPriceId: null,
    features: [] as readonly string[],
    limits: {
      websites: 0,
      collaborators: 0,
      aiFeatures: false,
      translations: 0,
      abTesting: false,
    },
  },
  STARTER: {
    id: "starter",
    name: "Starter",
    description: "1 website, instant copy testing, basic features",
    price: 9,
    yearlyPrice: 7.47,
    priceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_STARTER_PRICE_ID_LIVE!
        : process.env.STRIPE_STARTER_PRICE_ID!,
    yearlyPriceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_STARTER_YEARLY_PRICE_ID_LIVE!
        : process.env.STRIPE_STARTER_YEARLY_PRICE_ID!,
    features: [
      "1 website",
      "Instant copy testing",
      "Click-to-edit interface",
      "Basic version history",
      "Community support",
    ],
    limits: {
      websites: 1,
      collaborators: 0,
      aiFeatures: false,
      translations: 0,
      abTesting: false,
    },
  },
  PRO: {
    id: "pro",
    name: "Pro",
    description: "Up to 3 websites, all features, +$6 per additional website",
    price: 19,
    yearlyPrice: 15.77,
    priceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_PRO_PRICE_ID_LIVE!
        : process.env.STRIPE_PRO_PRICE_ID!,
    yearlyPriceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_PRO_YEARLY_PRICE_ID_LIVE!
        : process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
    features: [
      "Up to 3 websites",
      "+$6 per additional website",
      "Instant copy testing",
      "Click-to-edit interface",
      "Full version history",
      "Priority support",
      "AI A/B copy testing",
    ],
    limits: {
      websites: 3,
      collaborators: 5,
      aiFeatures: true,
      translations: -1, // unlimited
      abTesting: true,
    },
  },
  ENTERPRISE: {
    id: "enterprise",
    name: "Enterprise",
    description: "Unlimited websites, team collaboration, multiple users",
    price: 39,
    yearlyPrice: 32.37,
    priceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_ENTERPRISE_PRICE_ID_LIVE!
        : process.env.STRIPE_ENTERPRISE_PRICE_ID!,
    yearlyPriceId:
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID_LIVE!
        : process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID!,
    features: [
      "Unlimited websites",
      "Team collaboration",
      "Multiple users",
      "Full version history",
      "Dedicated support",
      "Custom integrations",
      "AI A/B copy testing",
    ],
    limits: {
      websites: -1, // unlimited
      collaborators: -1, // unlimited
      aiFeatures: true,
      translations: -1, // unlimited
      abTesting: true,
    },
  },
} as const;

// Ticket system configuration
export const TICKET_CONFIG = {
  PRICE_PER_TICKET: 0.5, // $0.50 per ticket
  TICKETS_PER_PURCHASE: 10, // $5 for 10 tickets
  MAX_PACKS_PER_PURCHASE: 100,
  PRICE_ID:
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_TICKETS_PRICE_ID_LIVE!
      : process.env.STRIPE_TICKETS_PRICE_ID!,
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;
export type SubscriptionPlanData =
  (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan];

/**
 * Plan config for a paid plan id. Throws on unknown ids so callers never
 * silently fall through to the FREE plan.
 */
export function getPaidPlan(planId: PaidPlanId) {
  const plan =
    SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
  if (!plan || plan.id === "free") {
    throw new Error(`Unknown plan: ${planId}`);
  }
  return plan;
}

/**
 * Monthly-equivalent display price for a plan/period pair.
 */
export function getPlanDisplayPrice(
  planId: PaidPlanId,
  billingPeriod: BillingPeriod,
): number {
  const plan = getPaidPlan(planId);
  return billingPeriod === "yearly" ? plan.yearlyPrice : plan.price;
}

/**
 * Total charged per billing cycle (yearly plans bill 12x the monthly-equivalent
 * price once per year).
 */
export function getPlanCyclePrice(
  planId: PaidPlanId,
  billingPeriod: BillingPeriod,
): number {
  const plan = getPaidPlan(planId);
  return billingPeriod === "yearly"
    ? Math.round(plan.yearlyPrice * 12 * 100) / 100
    : plan.price;
}
