import type Stripe from "stripe";

/**
 * Subscription statuses that are already over: nothing left to stop, nothing
 * that can bill again. Stripe issues a new id for a resubscribe, so neither
 * comes back.
 *
 * s82 review (m-7): the Stripe webhook, the lifetime backstop and checkout's
 * recovery each kept their own copy of this list. One list, so they cannot
 * disagree about which subscriptions are finished.
 */
export const TERMINAL_SUBSCRIPTION_STATUSES = [
  "canceled",
  "incomplete_expired",
] as const satisfies readonly Stripe.Subscription.Status[];

/** Is a subscription in this status over for good? */
export function isTerminalSubscriptionStatus(status: string): boolean {
  return (TERMINAL_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Why the Stripe webhook set a subscription to cancel at period end, written
 * to its `metadata.cancelled_reason`.
 *
 * Read back in two places: the subscription webhook leaves a subscription the
 * lifetime purchase set to end alone, and a plan change refuses to undo a
 * chargeback's cancellation (s82 review, m-5).
 */
export const CANCELLED_REASON = {
  lifetimePurchase: "lifetime_purchase",
  chargeback: "chargeback",
} as const;
