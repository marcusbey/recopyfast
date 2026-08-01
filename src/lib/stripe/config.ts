import Stripe from "stripe";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = STRIPE_CONFIG.SECRET_KEY;
    if (!key) {
      throw new Error("Stripe secret key is not set in environment variables");
    }
    _stripe = new Stripe(key, {
      apiVersion: STRIPE_CONFIG.API_VERSION,
      typescript: true,
    });
  }
  return _stripe;
}

// Lazy proxy: defers client construction (and the missing-key throw) until first
// use. Constructing at module scope crashed Vercel's "Collecting page data" phase
// for any route importing this file when STRIPE_SECRET_KEY is unset at build time.
// All existing `stripe.x.y(...)` call sites keep working unchanged.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Plan/ticket configuration lives in ./plans so client components can import it
// without pulling the Node Stripe SDK into the browser bundle. Re-exported here
// to keep existing `@/lib/stripe/config` imports working.
export {
  SUBSCRIPTION_PLANS,
  TICKET_CONFIG,
  PAID_PLAN_IDS,
  isPaidPlanId,
  isBillingPeriod,
  getPaidPlan,
  getPlanDisplayPrice,
  getPlanCyclePrice,
} from "./plans";
export type {
  BillingPeriod,
  PaidPlanId,
  SubscriptionPlan,
  SubscriptionPlanData,
} from "./plans";

export const STRIPE_CONFIG = {
  PUBLISHABLE_KEY:
    process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE!
      : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
  SECRET_KEY:
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_SECRET_KEY_LIVE!
      : process.env.STRIPE_SECRET_KEY!,
  WEBHOOK_SECRET:
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_WEBHOOK_SECRET_LIVE!
      : process.env.STRIPE_WEBHOOK_SECRET!,
  CURRENCY: "usd",
  API_VERSION: "2025-07-30.basil" as const,
} as const;
