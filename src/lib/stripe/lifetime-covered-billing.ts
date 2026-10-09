import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "./config";
import { expireCheckoutSession } from "./checkout";
import { isPlanCoveredByGrants } from "./plan-types";
import { readGrantedPlans } from "@/lib/billing/effective-plan";

/**
 * s82, Devin Review on PR #81 (finding 1): a lifetime owner is never billed by
 * a subscription Checkout they opened before the lifetime landed.
 *
 * Checkout refuses a covered plan from the moment a grant exists, but a
 * subscription Checkout Session opened BEFORE it stays payable until it
 * expires (an hour after it opened, `SUBSCRIPTION_CHECKOUT_TTL_MS`): open Pro
 * Checkout, buy Lifetime Pro in another tab, then pay the old Pro session, and
 * the account is billed $19 a month for a plan it owns. The Stripe
 * webhook only ever cancelled subscriptions that were already live when the
 * lifetime landed (`stopBillingForLifetimeOwner`), and recorded later ones
 * without asking. Two guards, belt and braces (plan decision 17):
 *
 *  - when the grant lands, the open subscription Checkouts it covers are
 *    expired (`expireCheckoutsCoveredByGrant`) — the door is shut;
 *  - a subscription that starts anyway, while an undated grant covers its plan,
 *    is cancelled at once and what it collected refunded
 *    (`refuseSubscriptionCoveredByLifetime`) — the money comes back.
 */

/**
 * Written on everything this refusal touches in Stripe — the subscription's
 * `cancellation_details.comment` and the refund's `metadata.reason_code` — so
 * a retried delivery can tell its own half-finished refusal from a
 * subscription cancelled for any other reason, and find the refund it already
 * made instead of making a second one.
 */
export const COVERED_BY_LIFETIME = "covered_by_lifetime";

/**
 * Plans the account holds for life: live, non-trial, non-revoked grants with no
 * end date — the same read as every s82 guard (`readGrantedPlans`), keeping only
 * the undated ones.
 *
 * Dated grants are deliberately left out (CTO decision, plan 17): a dated grant
 * ends, and the subscription is what keeps the plan after it, so a
 * subscription started beside one is not money taken for nothing. Checkout and
 * the plan change still refuse a plan a live dated grant covers.
 */
export async function readLifetimePlanIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  return (await readGrantedPlans(supabase, userId))
    .filter((granted) => granted.expiresAt === null)
    .map((granted) => granted.planId);
}

/** Subscription statuses that are already over — nothing left to stop. */
const TERMINAL_STATUSES: readonly Stripe.Subscription.Status[] = [
  "canceled",
  "incomplete_expired",
];

/** Has this refusal already cancelled this subscription (a retry's view)? */
export function isRefusedAsCoveredByLifetime(
  subscription: Stripe.Subscription,
): boolean {
  return subscription.cancellation_details?.comment === COVERED_BY_LIFETIME;
}

/** What a refusal took back, for the ops report. */
export interface CoveredSubscriptionRefusal {
  /** The subscription as Stripe holds it after the refusal: cancelled. */
  subscription: Stripe.Subscription;
  /** Refunds made or found, one per payment the latest invoice collected. */
  refundIds: string[];
  /**
   * Payments on that invoice still in flight (a bank debit `open`), which the
   * cancellation cannot stop and nothing here can refund yet.
   */
  pendingPaymentIds: string[];
}

/**
 * Stop a subscription a lifetime grant already covers: cancel it now and
 * refund, in full, what its latest invoice collected — for a subscription this
 * new, the first one.
 *
 * Cancelled now, not at period end: unlike the subscriptions a lifetime
 * purchase replaces (which ran on a plan paid for before the grant), this one
 * was bought with the plan already owned, so there is no paid-for period to
 * honour. `prorate: false` and `invoice_now: false` keep Stripe from issuing a
 * proration credit or a final invoice beside the refund; cancelling also stops
 * automatic collection of any invoice still open.
 *
 * Idempotent, so the caller can let a failure throw and retry: an already
 * cancelled subscription is not cancelled again, and a refund already made for
 * this subscription (found by its metadata — Stripe's idempotency keys expire,
 * the metadata does not) is not made again.
 *
 * Throws on any Stripe failure. Callers decide: the subscription webhook
 * rethrows into a retryable 500, the lifetime webhook reports and moves on.
 */
export async function refuseSubscriptionCoveredByLifetime(
  subscription: Stripe.Subscription,
): Promise<CoveredSubscriptionRefusal> {
  const stopped = TERMINAL_STATUSES.includes(subscription.status)
    ? subscription
    : await stripe.subscriptions.cancel(subscription.id, {
        prorate: false,
        invoice_now: false,
        cancellation_details: { comment: COVERED_BY_LIFETIME },
      });

  const invoiceId = idOf(stopped.latest_invoice);
  if (!invoiceId) {
    return { subscription: stopped, refundIds: [], pendingPaymentIds: [] };
  }

  const payments = await stripe.invoicePayments.list({
    invoice: invoiceId,
    limit: INVOICE_PAYMENT_LOOKUP_LIMIT,
  });

  const refundIds: string[] = [];
  const pendingPaymentIds: string[] = [];
  for (const payment of payments.data) {
    if (payment.status === "open") {
      pendingPaymentIds.push(payment.id);
      continue;
    }
    if (payment.status !== "paid") continue;

    refundIds.push(await refundOnce(payment.payment, stopped.id));
  }

  return { subscription: stopped, refundIds, pendingPaymentIds };
}

/**
 * How many payments to read off one invoice. A subscription's first invoice is
 * paid by one payment, or a few after declines; the cap bounds an unexpected
 * list rather than paging through it.
 */
const INVOICE_PAYMENT_LOOKUP_LIMIT = 10;

/** Refund one invoice payment in full, unless this refusal already did. */
async function refundOnce(
  payment: Stripe.InvoicePayment.Payment,
  subscriptionId: string,
): Promise<string> {
  const target =
    payment.type === "payment_intent"
      ? { payment_intent: idOf(payment.payment_intent) ?? undefined }
      : { charge: idOf(payment.charge) ?? undefined };
  const targetId = target.payment_intent ?? target.charge;
  if (!targetId) {
    throw new Error(
      `a paid invoice payment of subscription ${subscriptionId} names no ` +
        `payment intent or charge to refund`,
    );
  }

  const existing = await stripe.refunds.list({ ...target, limit: 100 });
  const previous = existing.data.find(
    (refund) =>
      refund.metadata?.reason_code === COVERED_BY_LIFETIME &&
      refund.metadata?.subscription_id === subscriptionId,
  );
  if (
    previous &&
    previous.status !== "failed" &&
    previous.status !== "canceled"
  ) {
    return previous.id;
  }

  const baseKey = `${COVERED_BY_LIFETIME}-refund-${subscriptionId}-${targetId}`;
  const refund = await stripe.refunds.create(
    {
      ...target,
      metadata: {
        reason_code: COVERED_BY_LIFETIME,
        subscription_id: subscriptionId,
      },
    },
    {
      idempotencyKey: previous ? `${baseKey}-after-${previous.id}` : baseKey,
    },
  );
  if (refund.status === "failed" || refund.status === "canceled") {
    throw new Error(
      `refund ${refund.id} for subscription ${subscriptionId} is ${refund.status}`,
    );
  }
  return refund.id;
}

/** What closing the covered Checkouts did, for the ops report. */
export interface CoveredCheckoutExpiry {
  expiredSessionIds: string[];
  /** Sessions Stripe would not expire, each with its error. */
  failures: Array<{ sessionId: string; error: unknown }>;
}

/**
 * Expire the customer's open subscription Checkout Sessions whose plan a new
 * grant of `grantsPlanId` covers — the same rank rule as every s82 guard, so an
 * Agency Checkout beside Lifetime Pro stays open.
 *
 * The plan is the session's own `metadata.plan_id`, which `createCheckoutSession`
 * writes beside the price it sells. A subscription session without it was not
 * opened by this app and is left open; if it is paid, the refusal above is the
 * backstop.
 *
 * Expiring a session fires `checkout.session.expired`, whose handler releases
 * the session's checkout reservation as for any abandoned Checkout. A session
 * that cannot be expired is collected in `failures` rather than thrown, so one
 * failure does not leave the others open; the listing itself throws.
 */
export async function expireCheckoutsCoveredByGrant(
  stripeCustomerId: string,
  grantsPlanId: string,
): Promise<CoveredCheckoutExpiry> {
  const expiredSessionIds: string[] = [];
  const failures: CoveredCheckoutExpiry["failures"] = [];

  let startingAfter: string | undefined;
  do {
    const page = await stripe.checkout.sessions.list({
      customer: stripeCustomerId,
      status: "open",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const session of page.data) {
      const planId = session.metadata?.plan_id;
      if (
        session.mode !== "subscription" ||
        !planId ||
        !isPlanCoveredByGrants(planId, [grantsPlanId])
      ) {
        continue;
      }
      try {
        await expireCheckoutSession(session.id);
        expiredSessionIds.push(session.id);
      } catch (error) {
        failures.push({ sessionId: session.id, error });
      }
    }

    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return { expiredSessionIds, failures };
}

/** Stripe expands references inconsistently; normalise to an id. */
function idOf(
  value: string | { id?: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}
