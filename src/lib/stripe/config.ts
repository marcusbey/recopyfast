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
 * `metadata.type=ticket_purchase` credits tickets, and
 * `customer.subscription.created` provisions a plan — both forgeable for free
 * with no secret at all.
 *
 * `STRIPE_CONFIG.WEBHOOK_SECRET` is declared with a `!` non-null assertion, so
 * TypeScript believes it is a string and nothing fails at build time when the
 * variable is unset. Failing closed here is what turns a silent hole into a
 * loud misconfiguration.
 */
export function requireWebhookSecret(): string {
  const secret = STRIPE_CONFIG.WEBHOOK_SECRET;

  if (!secret || secret.trim() === "") {
    const variable =
      process.env.NODE_ENV === "production"
        ? "STRIPE_WEBHOOK_SECRET_LIVE"
        : "STRIPE_WEBHOOK_SECRET";
    throw new Error(
      `${variable} is not set. Refusing to verify Stripe webhooks: an empty ` +
        `signing secret makes every forged request verify successfully.`,
    );
  }

  return secret;
}
