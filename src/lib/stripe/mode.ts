/**
 * Live vs test mode — the single place this decision is made.
 *
 * WHY THIS EXISTS: NODE_ENV IS NOT THE DISCRIMINATOR
 * --------------------------------------------------
 * Every Stripe key and price id used to be selected with
 * `process.env.NODE_ENV === "production"`. Vercel sets NODE_ENV=production on
 * PREVIEW builds as well as production ones — that is what `next build` means,
 * not what environment it is deployed to. So every pull-request preview
 * resolved the LIVE secret key and the LIVE price ids, and any checkout opened
 * from a preview took real money off a real card.
 *
 * `VERCEL_ENV` is the discriminator that actually distinguishes deployments:
 * it is "production", "preview" or "development". Only "production" is live.
 *
 * FAILING SAFE
 * ------------
 * When VERCEL_ENV is absent (local dev, CI, `next build` on a laptop, any
 * non-Vercel host) this returns TEST. The asymmetry is deliberate: being wrongly
 * in test mode means a payment is not collected and someone notices within a
 * day, while being wrongly in live mode means charging real cards from a
 * throwaway environment, which is not reversible by a redeploy.
 *
 * That leaves non-Vercel production hosts unable to take real payments, so
 * `STRIPE_LIVE_MODE=true` forces live explicitly. An explicit opt-in cannot be
 * triggered by accident; an inferred default can.
 */

/** Values Vercel assigns to VERCEL_ENV. */
const VERCEL_PRODUCTION = "production";

/**
 * True when this process should transact against the LIVE Stripe account.
 *
 * Read through `stripeEnvVar` / `selectByMode` rather than called directly at
 * call sites, so that adding a new keyed secret cannot reintroduce the bug.
 */
export function isLiveMode(): boolean {
  // Explicit override first: a non-Vercel production host has no VERCEL_ENV and
  // must be able to opt in on purpose.
  if (process.env.STRIPE_LIVE_MODE === "true") {
    return true;
  }

  return process.env.VERCEL_ENV === VERCEL_PRODUCTION;
}

export type StripeMode = "live" | "test";

export function stripeMode(): StripeMode {
  return isLiveMode() ? "live" : "test";
}

/**
 * Pick the live or test member of a pair.
 *
 * Used for values already in hand (a database column, a literal). For values
 * that live in the environment use `stripeEnvVar`, which also reports the
 * variable name when it is missing.
 */
export function selectByMode<T>(pair: { test: T; live: T }): T {
  return isLiveMode() ? pair.live : pair.test;
}

/**
 * Read the environment variable holding this mode's copy of a secret.
 *
 * Returns the resolved value alongside the variable name that was consulted,
 * so callers can say "set STRIPE_PRO_PRICE_ID_LIVE" instead of "no price
 * configured" — the difference between a two-minute fix and a support ticket.
 */
export function stripeEnvVar(pair: { test: string; live: string }): {
  name: string;
  value: string | undefined;
} {
  const name = selectByMode(pair);
  return { name, value: process.env[name] };
}

/**
 * Human-readable description of the current mode, for startup logs and error
 * messages. Never includes a key or a price id.
 */
export function describeStripeMode(): string {
  const reason =
    process.env.STRIPE_LIVE_MODE === "true"
      ? "STRIPE_LIVE_MODE=true"
      : `VERCEL_ENV=${process.env.VERCEL_ENV ?? "<unset>"}`;
  return `${stripeMode()} (${reason})`;
}
