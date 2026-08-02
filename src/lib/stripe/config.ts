import Stripe from "stripe";
import { describeStripeMode, isLiveMode, stripeEnvVar } from "./mode";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const { name, value: key } = stripeEnvVar(STRIPE_ENV_VARS.SECRET_KEY);
    if (!key) {
      throw new Error(
        `${name} is not set (Stripe mode: ${describeStripeMode()})`,
      );
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

// Plans are loaded from the database by ./plans. Re-exported here to keep
// existing `@/lib/stripe/config` imports working. Server-side callers only —
// ./plans opens a Supabase client, so a client component that needs plan shapes
// or price arithmetic imports ./plan-types instead.
export { isLiveMode, stripeMode, describeStripeMode } from "./mode";
export {
  PAID_PLAN_IDS,
  isPaidPlanId,
  isBillingPeriod,
  getPaidPlan,
  getPlanCatalogue,
  getSubscriptionPlans,
  getSubscriptionPlan,
  findPlanById,
  getPlanDisplayPrice,
  getPlanCyclePrice,
  getOneTimeProduct,
  getOneTimeProducts,
  getCreditPackConfig,
  resolveStripePriceId,
  resolveOneTimePriceId,
} from "./plans";
export type {
  BillingPeriod,
  PaidPlanId,
  OneTimeProduct,
  OneTimeProductId,
  PlanCatalogue,
  PlanLimits,
  SubscriptionPlan,
  SubscriptionPlanId,
} from "./plans";

/**
 * Environment variable names per mode. Which one is read is decided once, in
 * ./mode — never by NODE_ENV, which is "production" on Vercel preview builds
 * too and therefore pointed every PR preview at the live Stripe account.
 */
const STRIPE_ENV_VARS = {
  PUBLISHABLE_KEY: {
    test: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    live: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE",
  },
  SECRET_KEY: {
    test: "STRIPE_SECRET_KEY",
    live: "STRIPE_SECRET_KEY_LIVE",
  },
  WEBHOOK_SECRET: {
    test: "STRIPE_WEBHOOK_SECRET",
    live: "STRIPE_WEBHOOK_SECRET_LIVE",
  },
} as const;

export const STRIPE_CONFIG = {
  // NEXT_PUBLIC_* is inlined at build time, so these two are read as literal
  // property accesses rather than through a computed name — a computed lookup
  // would resolve to undefined in the browser bundle.
  get PUBLISHABLE_KEY(): string | undefined {
    return isLiveMode()
      ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE
      : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  },
  get SECRET_KEY(): string | undefined {
    return stripeEnvVar(STRIPE_ENV_VARS.SECRET_KEY).value;
  },
  get WEBHOOK_SECRET(): string | undefined {
    return stripeEnvVar(STRIPE_ENV_VARS.WEBHOOK_SECRET).value;
  },
  CURRENCY: "usd",
  API_VERSION: "2025-07-30.basil" as const,
} as const;

/**
 * The webhook signing secret, or a throw if it is not configured.
 *
 * WHY THIS EXISTS — an empty secret authenticates every caller.
 *
 * `stripe.webhooks.constructEvent` does not reject an empty-string key. It
 * computes HMAC-SHA256("", payload) and compares that to the supplied
 * signature, so anyone who can reach the endpoint can produce a signature that
 * verifies. Confirmed against this route: a request signed with "" was accepted
 * and reached the handler, while the same request signed with a wrong non-empty
 * secret was correctly rejected with 400.
 *
 * The exposure is not theoretical. `payment_intent.succeeded` carrying
 * `metadata.type=credit_purchase` credits a wallet, and
 * `customer.subscription.created` provisions a plan — both forgeable for free
 * with no secret at all.
 *
 * `STRIPE_CONFIG.WEBHOOK_SECRET` is declared with a `!` non-null assertion, so
 * TypeScript believes it is a string and nothing fails at build time when the
 * variable is unset. Failing closed here is what turns a silent hole into a
 * loud misconfiguration.
 */
export function requireWebhookSecret(): string {
  const { name, value } = stripeEnvVar(STRIPE_ENV_VARS.WEBHOOK_SECRET);

  if (!value || value.trim() === "") {
    throw new Error(
      `${name} is not set (Stripe mode: ${describeStripeMode()}). Refusing to ` +
        `verify Stripe webhooks: an empty signing secret makes every forged ` +
        `request verify successfully.`,
    );
  }

  return value;
}
