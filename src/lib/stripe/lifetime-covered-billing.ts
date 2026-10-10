import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "./config";
import { expireCheckoutSession } from "./checkout";
import { isPlanCoveredByGrants } from "./plan-types";
import {
  CANCELLED_REASON,
  isTerminalSubscriptionStatus,
} from "./subscription-status";
import {
  readLifetimeGrants,
  type LifetimeGrant,
} from "@/lib/billing/effective-plan";

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

/** When the lifetime covering a plan was paid for, and by which payment. */
export interface LifetimeCover {
  /** Unix seconds, comparable with a Stripe object's `created`. */
  readonly paidAt: number;
  /** That grant's payment intent; null for a comp nobody paid for. */
  readonly paymentIntentId: string | null;
}

/**
 * The earliest undated grant that covers `planId` — the same rank rule as
 * every s82 guard (`isPlanCoveredByGrants`), so Lifetime Pro covers Pro and
 * Starter, never Agency — or null when none does.
 *
 * Only undated, non-trial, non-revoked grants count (`readLifetimeGrants`).
 * Dated grants are deliberately left out (CTO decision, plan 17): a dated
 * grant ends, and the subscription is what keeps the plan after it, so a
 * subscription started beside one is not money taken for nothing. Checkout and
 * the plan change still refuse a plan a live dated grant covers.
 *
 * Paid-at is the grant's payment intent's `created` — what
 * `stopBillingForLifetimeOwner` compares with in the other event ordering — or,
 * for a grant nobody paid for (a support comp), when it was granted. Throws on
 * a read failure, database or Stripe: never decide without knowing.
 */
export async function readLifetimeCover(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
): Promise<LifetimeCover | null> {
  const covering = (await readLifetimeGrants(supabase, userId)).filter(
    (grant) => isPlanCoveredByGrants(planId, [grant.planId]),
  );

  let earliest: LifetimeCover | null = null;
  for (const grant of covering) {
    const paidAt = await paidAtOf(grant);
    if (!earliest || paidAt < earliest.paidAt) {
      earliest = { paidAt, paymentIntentId: grant.paymentIntentId };
    }
  }
  return earliest;
}

/** When a lifetime purchase was paid: its payment intent's `created`. */
export async function lifetimePaymentTime(
  paymentIntentId: string,
): Promise<number> {
  return (await stripe.paymentIntents.retrieve(paymentIntentId)).created;
}

async function paidAtOf(grant: LifetimeGrant): Promise<number> {
  if (grant.paymentIntentId) {
    try {
      return await lifetimePaymentTime(grant.paymentIntentId);
    } catch (error) {
      // s82 verification (mi-2): a payment Stripe says does not exist — a
      // seeded QA grant (`pi_qa_*`), one written in the other Stripe mode —
      // can never be read, and a retry would fail the same way for three
      // days while the subscription goes unrecorded. Date the grant from when
      // it was written instead. Any other failure is transient: thrown, so
      // the caller alerts and Stripe redelivers.
      if (!isStripeResourceMissing(error)) throw error;
    }
  }
  // A comp: nobody paid, it covers the plan from when it was written. An
  // unreadable date counts as "always" — the customer-favourable reading,
  // which refunds rather than bills.
  const grantedAtMs = grant.grantedAt ? Date.parse(grant.grantedAt) : NaN;
  return Number.isFinite(grantedAtMs) ? Math.floor(grantedAtMs / 1000) : 0;
}

/** Stripe's answer for an id it does not have. */
function isStripeResourceMissing(error: unknown): boolean {
  return stripeErrorCode(error) === "resource_missing";
}

function stripeErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

/**
 * The one rule both event orderings apply (s82 review, m-1): a subscription
 * Stripe created at or after the lifetime covering its plan was paid was
 * bought with that plan already owned — refuse it, cancel now and refund. One
 * created before ran on a period paid for before the grant, and runs it out
 * (`endAtPeriodEndForLifetime`).
 *
 * At or after, not strictly after: both are whole seconds, and a Checkout paid
 * in the same second as the lifetime was still bought with it.
 */
export function wasBoughtWithPlanAlreadyOwned(
  subscriptionCreated: number,
  lifetimePaidAt: number,
): boolean {
  return subscriptionCreated >= lifetimePaidAt;
}

/**
 * Set a subscription a new lifetime grant covers to end at period end — the
 * period it paid for before the grant — with the reason on its metadata, so
 * the subscription webhook leaves it to end and a plan change knows what it
 * clears. Both event orderings call this (s82 review, m-1). Throws on failure.
 */
export async function endAtPeriodEndForLifetime(
  subscriptionId: string,
  paymentIntentId: string | null,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
    metadata: {
      cancelled_reason: CANCELLED_REASON.lifetimePurchase,
      ...(paymentIntentId ? { paymentIntentId } : {}),
    },
  });
}

/** Has this refusal already cancelled this subscription (a retry's view)? */
export function isRefusedAsCoveredByLifetime(
  subscription: Stripe.Subscription,
): boolean {
  return subscription.cancellation_details?.comment === COVERED_BY_LIFETIME;
}

/** What refunding a refused subscription's invoice did, for the ops report. */
export interface CoveredInvoiceRefund {
  /** Refunds made or found, one per payment the invoice collected. */
  refundIds: string[];
  /**
   * Payments on that invoice still in flight (a bank debit `open`), which the
   * cancellation cannot stop. Each is refunded when it settles: its
   * `invoice.payment_succeeded` runs `refundCoveredInvoice` (s82 review, m-2).
   */
  pendingPaymentIds: string[];
  /**
   * Paid payments whose refund another delivery of the same refusal is making
   * at this very moment — Stripe refused ours as `idempotency_key_in_use`
   * (s82 verification, mi-3). That delivery owns the refund and reports its
   * own failure; this one neither alerts nor retries for it.
   */
  inFlightPaymentIds: string[];
}

/** What a refusal took back, for the ops report. */
export interface CoveredSubscriptionRefusal extends CoveredInvoiceRefund {
  /** The subscription as Stripe holds it after the refusal: cancelled. */
  subscription: Stripe.Subscription;
}

/**
 * The subscription is cancelled, but what it collected could not be refunded
 * (s82 review, m-3). A caller must not treat it as "could not be cancelled":
 * there is nothing left to cancel or set to end, only money to give back.
 */
export class CoveredRefundFailed extends Error {
  readonly subscription: Stripe.Subscription;
  readonly refundError: unknown;

  constructor(subscription: Stripe.Subscription, refundError: unknown) {
    super(
      `subscription ${subscription.id} is cancelled as covered by a lifetime ` +
        `grant, but its payment could not be refunded: ` +
        (refundError instanceof Error
          ? refundError.message
          : String(refundError)),
    );
    this.name = "CoveredRefundFailed";
    this.subscription = subscription;
    this.refundError = refundError;
  }
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
 * Throws on any Stripe failure — `CoveredRefundFailed` when the subscription
 * is stopped and only the refund failed. Callers decide: the subscription
 * webhook rethrows into a retryable 500, the lifetime webhook reports and
 * moves on.
 */
export async function refuseSubscriptionCoveredByLifetime(
  subscription: Stripe.Subscription,
): Promise<CoveredSubscriptionRefusal> {
  const stopped = await cancelCovered(subscription);

  const invoiceId = idOf(stopped.latest_invoice);
  if (!invoiceId) {
    return {
      subscription: stopped,
      refundIds: [],
      pendingPaymentIds: [],
      inFlightPaymentIds: [],
    };
  }

  try {
    return {
      subscription: stopped,
      ...(await refundCoveredInvoice(invoiceId, stopped.id)),
    };
  } catch (error) {
    throw new CoveredRefundFailed(stopped, error);
  }
}

/**
 * Cancel now, unless it is already over.
 *
 * s82 review (m-6): two deliveries can refuse the same subscription at once —
 * `checkout.session.completed` and `customer.subscription.created` both
 * record a Checkout subscription. Both read it live; one cancels; Stripe
 * refuses the other's cancel, since the subscription is already over. That
 * refusal is not a failure: re-read, and if the subscription carries this
 * refusal's marker, carry on to the refund — never a false "could not be
 * cancelled" alarm. A failed cancel the re-read does not explain is thrown.
 */
async function cancelCovered(
  subscription: Stripe.Subscription,
): Promise<Stripe.Subscription> {
  if (isTerminalSubscriptionStatus(subscription.status)) {
    return subscription;
  }
  try {
    return await stripe.subscriptions.cancel(subscription.id, {
      prorate: false,
      invoice_now: false,
      cancellation_details: { comment: COVERED_BY_LIFETIME },
    });
  } catch (error) {
    const current = await stripe.subscriptions
      .retrieve(subscription.id)
      .catch(() => null);
    if (
      current &&
      isRefusedAsCoveredByLifetime(current) &&
      isTerminalSubscriptionStatus(current.status)
    ) {
      return current;
    }
    throw error;
  }
}

/**
 * Refund, in full, every payment an invoice of a refused subscription
 * collected, once; report the ones still in flight.
 *
 * Run by the refusal for the subscription's latest invoice, and again by
 * `invoice.payment_succeeded` when a payment that was in flight at the refusal
 * settles (s82 review, m-2). Both go through `refundOnce`, so a payment
 * already refunded is found by its metadata, and two concurrent calls send the
 * same idempotency key: one refund either way.
 */
export async function refundCoveredInvoice(
  invoiceId: string,
  subscriptionId: string,
): Promise<CoveredInvoiceRefund> {
  const refundIds: string[] = [];
  const pendingPaymentIds: string[] = [];
  const inFlightPaymentIds: string[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();

  for (;;) {
    const payments = await stripe.invoicePayments.list({
      invoice: invoiceId,
      limit: INVOICE_PAYMENT_LOOKUP_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const nextCursor = nextStripePageCursor(
      payments.data,
      payments.has_more,
      startingAfter,
      seenCursors,
      `invoice-payment lookup for invoice ${invoiceId}`,
    );

    for (const payment of payments.data) {
      if (payment.status === "open") {
        pendingPaymentIds.push(payment.id);
        continue;
      }
      if (payment.status !== "paid") continue;

      const refundId = await refundOnce(payment.payment, subscriptionId);
      if (refundId === REFUND_IN_FLIGHT) {
        inFlightPaymentIds.push(payment.id);
      } else {
        refundIds.push(refundId);
      }
    }

    if (!nextCursor) break;
    startingAfter = nextCursor;
  }

  return { refundIds, pendingPaymentIds, inFlightPaymentIds };
}

/** `refundOnce`'s answer when another request is making the same refund. */
const REFUND_IN_FLIGHT = Symbol("refund in flight");

/**
 * Invoice-payment page size. A subscription's first invoice is normally paid
 * by one payment, or a few after declines, but s82 refunds every collected
 * payment and therefore follows every page rather than treating ten as a cap.
 */
const INVOICE_PAYMENT_LOOKUP_LIMIT = 10;

/**
 * Refund one invoice payment in full, unless this refusal already did.
 *
 * The idempotency key is derived from the subscription and the payment, never
 * random (s82 review, M01): two deliveries that both miss the metadata lookup
 * — the refund not made yet — send the same key with the same parameters, and
 * Stripe answers the second with the first refund. After a failed or cancelled
 * refund the key names it, so the retry is a new request.
 */
async function refundOnce(
  payment: Stripe.InvoicePayment.Payment,
  subscriptionId: string,
): Promise<string | typeof REFUND_IN_FLIGHT> {
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

  const found = await findCoveredRefund(target, subscriptionId);
  if (found.live) {
    return found.live.id;
  }
  const previous = found.retryable;

  const baseKey = `${COVERED_BY_LIFETIME}-refund-${subscriptionId}-${targetId}`;
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
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
  } catch (error) {
    // s82 verification (mi-3): another delivery is creating this very refund
    // — same key — and Stripe answered ours 409 (after the SDK's own retries
    // of a 409). It is in flight, not failed: re-check once, and if it has not
    // landed yet leave it to the request that owns it, which reports its own
    // failure.
    if (stripeErrorCode(error) !== "idempotency_key_in_use") throw error;
    const landed = await findCoveredRefund(target, subscriptionId);
    return landed.live ? landed.live.id : REFUND_IN_FLIGHT;
  }
  if (refundDisposition(refund, subscriptionId) === "retryable") {
    throw new Error(
      `refund ${refund.id} for subscription ${subscriptionId} is ${refund.status}`,
    );
  }
  return refund.id;
}

interface RefundTarget {
  payment_intent?: string;
  charge?: string;
}

interface CoveredRefundMatch {
  /** A refund that stands: succeeded, pending, or awaiting customer action. */
  live: Stripe.Refund | null;
  /** The newest failed/cancelled attempt, whose id makes the retry key new. */
  retryable: Stripe.Refund | null;
}

/**
 * Find this refusal's refund across every page Stripe returns for a payment.
 *
 * s82 recovery, Stripe reference audit: the idempotency key expires but the
 * refund metadata does not, so metadata is the durable duplicate-refund guard.
 * Reading only Stripe's first page could infer "none" after 100 attempts and
 * send the money twice. Walk the API's stable order with `starting_after` until
 * exhausted. A failed page or a broken cursor throws: absence is safe to infer
 * only after every page was read.
 */
async function findCoveredRefund(
  target: RefundTarget,
  subscriptionId: string,
): Promise<CoveredRefundMatch> {
  let startingAfter: string | undefined;
  let retryable: Stripe.Refund | null = null;
  const seenCursors = new Set<string>();

  for (;;) {
    const page = await stripe.refunds.list({
      ...target,
      limit: REFUND_LOOKUP_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const refund of page.data) {
      if (
        refund.metadata?.reason_code !== COVERED_BY_LIFETIME ||
        refund.metadata?.subscription_id !== subscriptionId
      ) {
        continue;
      }

      if (refundDisposition(refund, subscriptionId) === "live") {
        return { live: refund, retryable };
      }
      retryable ??= refund;
    }

    if (!page.has_more) {
      return { live: null, retryable };
    }

    startingAfter = nextStripePageCursor(
      page.data,
      page.has_more,
      startingAfter,
      seenCursors,
      `refund lookup for subscription ${subscriptionId}`,
    );
  }
}

/** Stripe's maximum page size for refund listing. */
const REFUND_LOOKUP_LIMIT = 100;

type RefundDisposition = "live" | "retryable";

/**
 * Classify only the five statuses documented by the pinned Stripe API.
 * Unknown or null is neither success nor permission to try another refund:
 * fail closed so the webhook alerts and Stripe retries after the object has a
 * status this code understands.
 */
function refundDisposition(
  refund: Stripe.Refund,
  subscriptionId: string,
): RefundDisposition {
  switch (refund.status) {
    case "pending":
    case "requires_action":
    case "succeeded":
      return "live";
    case "failed":
    case "canceled":
      return "retryable";
    default:
      throw new Error(
        `refund ${refund.id} for subscription ${subscriptionId} has ` +
          `unsupported status ${String(refund.status)}; refusing to create ` +
          `another refund`,
      );
  }
}

/** `billing_events.event_type` of the once-only refusal report marker. */
const REFUSAL_REPORT_EVENT_TYPE = "internal.covered_subscription_refused";

const UNIQUE_VIOLATION = "23505";

/**
 * Claim the one report of a subscription's refusal; true for the caller that
 * should make it.
 *
 * s82 verification (mi-4, with review m-6): the report must be made once per
 * subscription — not by every delivery that reaches the refusal — yet still be
 * made when the refusal is completed by a retry (the first delivery cancelled,
 * then failed to refund, and alerted that failure instead). Neither "whoever
 * cancelled" nor "whoever refunded" decides it: concurrent deliveries share
 * both. A write-once row does. Same pattern as `credit-revocations.ts`: a
 * synthetic `stripe_event_id` (prefixed, so it can never match a Stripe event
 * id) whose UNIQUE constraint lets exactly one insert succeed.
 *
 * A claim that cannot be written (the database, not a duplicate) answers true:
 * a second alert is better than a refusal nobody hears of.
 */
export async function claimRefusalReport(
  supabase: SupabaseClient,
  refusal: CoveredSubscriptionRefusal,
  userId: string,
  planId: string,
): Promise<boolean> {
  const { error } = await supabase.from("billing_events").insert({
    user_id: userId,
    event_type: REFUSAL_REPORT_EVENT_TYPE,
    stripe_event_id: `${COVERED_BY_LIFETIME}:${refusal.subscription.id}`,
    data: {
      subscription_id: refusal.subscription.id,
      plan_id: planId,
      refund_ids: refusal.refundIds,
      pending_payment_ids: refusal.pendingPaymentIds,
      in_flight_payment_ids: refusal.inFlightPaymentIds,
    },
    processed: true,
  });

  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  console.error(
    `Could not record the refusal report of subscription ` +
      `${refusal.subscription.id}; reporting it anyway: ${error.message}`,
  );
  return true;
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
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await stripe.checkout.sessions.list({
      customer: stripeCustomerId,
      status: "open",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const nextCursor = nextStripePageCursor(
      page.data,
      page.has_more,
      startingAfter,
      seenCursors,
      `open Checkout lookup for customer ${stripeCustomerId}`,
    );

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

    if (!nextCursor) break;
    startingAfter = nextCursor;
  }

  return { expiredSessionIds, failures };
}

/**
 * Advance a Stripe list cursor, or prove the list is complete.
 *
 * `has_more` without a new last id is not completion. Treating an empty page
 * as done left covered Checkouts or collected invoice payments unseen; blindly
 * reusing the cursor loops forever. Every money-moving scan in this module
 * fails closed on either shape instead.
 */
function nextStripePageCursor(
  items: readonly { id: string }[],
  hasMore: boolean,
  currentCursor: string | undefined,
  seenCursors: Set<string>,
  subject: string,
): string | undefined {
  if (!hasMore) return undefined;

  const nextCursor = items.at(-1)?.id;
  if (
    !nextCursor ||
    nextCursor === currentCursor ||
    seenCursors.has(nextCursor)
  ) {
    throw new Error(
      `${subject} said another page exists but did not advance its cursor`,
    );
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

/** Stripe expands references inconsistently; normalise to an id. */
function idOf(
  value: string | { id?: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}
