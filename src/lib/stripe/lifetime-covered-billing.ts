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
import { loadPaidPlanPriceIndex, type PaidPlanId } from "./plans";
import { logger } from "@/lib/monitoring/logger";
import {
  decideInvoiceRefund,
  type InvoiceCoverage,
  type InvoiceLineCharge,
  type InvoiceRefundDecision,
  type ManualReviewReason,
  type ProductPlanLookup,
} from "./covered-refund-decision";

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

/** A live, undated grant and when it was paid for. */
export interface DatedGrant {
  readonly planId: string;
  /** Unix seconds (`paidAtOf`). */
  readonly paidAt: number;
  readonly paymentIntentId: string | null;
}

/**
 * Every live, undated grant of the account with when it was paid for, read
 * once for a run that needs both a cover and an invoice coverage. Same grants
 * and dating as `readLifetimeCover`. Throws on a read failure.
 */
export async function readDatedLifetimeGrants(
  supabase: SupabaseClient,
  userId: string,
): Promise<DatedGrant[]> {
  const dated: DatedGrant[] = [];
  for (const grant of await readLifetimeGrants(supabase, userId)) {
    dated.push({
      planId: grant.planId,
      paidAt: await paidAtOf(grant),
      paymentIntentId: grant.paymentIntentId,
    });
  }
  return dated;
}

/** `readLifetimeCover`'s rule over grants already read: the earliest covering. */
export function coverFrom(
  grants: readonly DatedGrant[],
  planId: string,
): LifetimeCover | null {
  let earliest: LifetimeCover | null = null;
  for (const grant of grants) {
    if (!isPlanCoveredByGrants(planId, [grant.planId])) continue;
    if (!earliest || grant.paidAt < earliest.paidAt) {
      earliest = {
        paidAt: grant.paidAt,
        paymentIntentId: grant.paymentIntentId,
      };
    }
  }
  return earliest;
}

/**
 * The plans an invoice is judged against (Devin 4244837673): every grant paid
 * at or before `judgedAt`, by the same payment-order rule, not only the
 * earliest grant covering one plan. `judgedAt` is the subscription's purchase
 * for a refusal, the invoice's payment for a subscription stopped for a
 * lifetime.
 *
 * Grants paid after `judgedAt` but at or before the invoice was paid
 * (`invoicePaidAt`; until now for one not paid yet) come back apart (review of
 * 67c6caf): a charge only they cover goes to a person, never to a silent skip.
 */
export function coverageFor(
  grants: readonly DatedGrant[],
  judgedAt: number,
  invoicePaidAt: number | null,
): InvoiceCoverage {
  const paidBy = invoicePaidAt ?? Number.POSITIVE_INFINITY;
  return {
    grantPlanIds: grants
      .filter((grant) => wasBoughtWithPlanAlreadyOwned(judgedAt, grant.paidAt))
      .map((grant) => grant.planId),
    laterGrantPlanIds: grants
      .filter(
        (grant) =>
          !wasBoughtWithPlanAlreadyOwned(judgedAt, grant.paidAt) &&
          wasBoughtWithPlanAlreadyOwned(paidBy, grant.paidAt),
      )
      .map((grant) => grant.planId),
  };
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
  lifetimePaidAt?: number,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
    metadata: lifetimeStopMetadata(paymentIntentId, lifetimePaidAt),
  });
}

/**
 * Stripe metadata key holding when the lifetime that stopped a subscription
 * was paid (review of 67c6caf, MAJOR 2): every later payment of that
 * subscription is judged against it (`lifetimeStopOf`).
 */
const LIFETIME_PAID_AT_KEY = "lifetime_paid_at";

/** The stop's marker: why, by which lifetime, paid when. */
function lifetimeStopMetadata(
  paymentIntentId: string | null,
  lifetimePaidAt?: number,
): Record<string, string> {
  return {
    cancelled_reason: CANCELLED_REASON.lifetimePurchase,
    ...(paymentIntentId ? { paymentIntentId } : {}),
    ...(lifetimePaidAt !== undefined
      ? { [LIFETIME_PAID_AT_KEY]: String(lifetimePaidAt) }
      : {}),
  };
}

/**
 * The lifetime a subscription was stopped for, from its marker, or null when
 * it was not stopped for one. A stop written before its payment time was
 * recorded names the payment intent, whose time is read from Stripe.
 */
export async function lifetimeStopOf(
  subscription: Stripe.Subscription,
): Promise<LifetimeCover | null> {
  const metadata = subscription.metadata ?? {};
  if (metadata.cancelled_reason !== CANCELLED_REASON.lifetimePurchase) {
    return null;
  }
  const paymentIntentId = metadata.paymentIntentId || null;
  const recorded = Number(metadata[LIFETIME_PAID_AT_KEY]);
  if (Number.isFinite(recorded) && recorded > 0) {
    return { paidAt: recorded, paymentIntentId };
  }
  return paymentIntentId
    ? { paidAt: await lifetimePaymentTime(paymentIntentId), paymentIntentId }
    : null;
}

/** What became of a stopped subscription's latest invoice. */
export type LatestInvoiceHandling =
  /** A draft or open invoice voided before anything was collected. */
  | { handling: "voided"; invoiceId: string }
  /** Already void: nothing was or will be collected. */
  | { handling: "already_void"; invoiceId: string }
  /** A draft its credit balance would pay: held, never advancing. */
  | { handling: "held_draft"; invoiceId: string }
  /** Open with a payment processing: decided when it settles. */
  | { handling: "payment_in_flight"; invoiceId: string }
  /** Uncollectible: nothing collected now, but it could still be paid. */
  | { handling: "uncollectible"; invoiceId: string }
  /** Paid at or after the lifetime: the per-invoice decision. */
  | {
      handling: "decided";
      invoiceId: string;
      decision: InvoiceRefundDecision["kind"];
      refund: CoveredInvoiceRefund;
    };

/** What stopping a subscription bought before the lifetime did. */
export type PredatingStop =
  /**
   * Set to end at period end: its latest invoice was collected before the
   * lifetime (no `latestInvoice`), or it was neither refunded nor voided.
   */
  | {
      kind: "ends_at_period_end";
      subscription: Stripe.Subscription;
      latestInvoice?: LatestInvoiceHandling;
    }
  /** Cancelled now: its latest invoice was refunded or voided. */
  | {
      kind: "cancelled_now";
      subscription: Stripe.Subscription;
      latestInvoice: LatestInvoiceHandling;
    };

/**
 * The stop failed after its marker was written (re-review of 2928fcb): says
 * which subscription and which latest invoice, in which status, so the alert
 * can tell ops exactly what to look at.
 */
export class PredatingStopFailed extends Error {
  readonly subscriptionId: string;
  readonly latestInvoiceId: string | null;
  readonly latestStatus: string | null;
  readonly cause: unknown;

  constructor(
    subscriptionId: string,
    latest: { id: string | null; status: string | null },
    cause: unknown,
  ) {
    super(
      `subscription ${subscriptionId} could not be stopped (latest invoice ` +
        `${latest.id ?? "none"} ${latest.status ?? "unread"}): ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = "PredatingStopFailed";
    this.subscriptionId = subscriptionId;
    this.latestInvoiceId = latest.id;
    this.latestStatus = latest.status;
    this.cause = cause;
  }
}

/**
 * Stop a subscription bought BEFORE the lifetime that now covers it, without
 * ever keeping money collected at or after the lifetime's payment (review of
 * 67c6caf, MAJOR 2, layer a; re-review of 2928fcb).
 *
 * The marker (`cancelled_reason`, the lifetime's payment intent and payment
 * time) is written FIRST, before the latest invoice is read: a renewal
 * finalized between the read and the marker is then still judged at its
 * settlement (layer b). Then the latest invoice decides:
 *  - collected before the lifetime (or none): cancel at period end, as before;
 *  - a draft: `auto_advance: false` always. With something to collect, it is
 *    finalized with `auto_advance: false` (no payment attempted) and voided,
 *    since a subscription's draft cannot be deleted. One its credit balance
 *    would pay (`amount_due` 0) is held as a draft that never advances:
 *    finalized, it would be paid at once and could not be voided;
 *  - open: voided, unless a payment on it is processing (Stripe will not void
 *    an invoice with an open payment): decided when it settles;
 *  - paid at or after the lifetime: `decideInvoiceRefund` against the grants
 *    paid by then, refunded through `refundCoveredInvoice` (same keys) or left
 *    to a person;
 *  - void: nothing collected; uncollectible: nothing collected yet.
 * Cancelled now ONLY when the latest invoice was refunded or voided: there is
 * no paid-for period left. Otherwise set to end at period end, so a period the
 * customer paid for an uncovered or mixed plan is not cut short.
 *
 * A failure after the marker throws `PredatingStopFailed`, naming the latest
 * invoice; every step is idempotent for the caller's retry.
 */
export async function stopPredatingSubscription(
  subscription: Stripe.Subscription,
  lifetime: { paymentIntentId: string | null; paidAt: number },
  readGrants: () => Promise<readonly DatedGrant[]>,
  productIndex?: PlanProductIndex,
): Promise<PredatingStop> {
  await stripe.subscriptions.update(subscription.id, {
    metadata: lifetimeStopMetadata(lifetime.paymentIntentId, lifetime.paidAt),
  });

  const latestId = idOf(subscription.latest_invoice);
  let latest: Stripe.Invoice | null = null;
  try {
    latest = latestId ? await stripe.invoices.retrieve(latestId) : null;
    const latestPaidAt = latest?.status_transitions?.paid_at ?? null;
    const endAtPeriodEnd = () =>
      endAtPeriodEndForLifetime(
        subscription.id,
        lifetime.paymentIntentId,
        lifetime.paidAt,
      );

    if (
      !latest ||
      (latest.status === "paid" &&
        (latestPaidAt === null || latestPaidAt < lifetime.paidAt))
    ) {
      return {
        kind: "ends_at_period_end",
        subscription: await endAtPeriodEnd(),
      };
    }

    const latestInvoice = await settleLatestInvoice(
      latest,
      subscription.id,
      readGrants,
      productIndex,
    );
    if (!endsNow(latestInvoice)) {
      return {
        kind: "ends_at_period_end",
        subscription: await endAtPeriodEnd(),
        latestInvoice,
      };
    }
    const cancelled = await stripe.subscriptions.cancel(subscription.id, {
      prorate: false,
      invoice_now: false,
    });
    return { kind: "cancelled_now", subscription: cancelled, latestInvoice };
  } catch (error) {
    throw new PredatingStopFailed(
      subscription.id,
      { id: latestId, status: latest?.status ?? null },
      error,
    );
  }
}

/** Was the latest invoice refunded or voided: no paid-for period left? */
function endsNow(latestInvoice: LatestInvoiceHandling): boolean {
  switch (latestInvoice.handling) {
    case "voided":
    case "already_void":
      return true;
    case "decided":
      return latestInvoice.decision === "refund";
    default:
      return false;
  }
}

/** Make sure a stopped subscription's latest invoice keeps nothing it should not. */
async function settleLatestInvoice(
  latest: Stripe.Invoice,
  subscriptionId: string,
  readGrants: () => Promise<readonly DatedGrant[]>,
  productIndex: PlanProductIndex | undefined,
): Promise<LatestInvoiceHandling> {
  const invoiceId = latest.id as string;
  switch (latest.status) {
    case "draft":
      // Never advancing, whatever it would collect.
      await stripe.invoices.update(invoiceId, { auto_advance: false });
      if (latest.amount_due <= 0) {
        return { handling: "held_draft", invoiceId };
      }
      await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false });
      await stripe.invoices.voidInvoice(invoiceId);
      return { handling: "voided", invoiceId };
    case "open":
      if (await hasPaymentUnderWay(invoiceId)) {
        return { handling: "payment_in_flight", invoiceId };
      }
      await stripe.invoices.voidInvoice(invoiceId);
      return { handling: "voided", invoiceId };
    case "paid": {
      const paidAt = latest.status_transitions?.paid_at ?? null;
      const decision = await decideEndedInvoiceRefund(
        latest,
        { grants: await readGrants(), judgedAt: paidAt ?? 0 },
        productIndex ?? (await loadPlanProductIndex()),
      );
      const manual = manualReviewFor(latest, decision);
      const refund =
        decision.kind === "refund"
          ? await refundCoveredInvoice(
              invoiceId,
              subscriptionId,
              latest.post_payment_credit_notes_amount ?? 0,
            )
          : NO_REFUNDS;
      return {
        handling: "decided",
        invoiceId,
        decision: decision.kind,
        refund: {
          ...refund,
          manualReviewInvoices: [...refund.manualReviewInvoices, ...manual],
        },
      };
    }
    case "void":
      return { handling: "already_void", invoiceId };
    default:
      return { handling: "uncollectible", invoiceId };
  }
}

/**
 * The invoices a decision leaves to a person: a manual decision, or a refund
 * that does not return what the customer balance paid (re-review of 2928fcb).
 */
export function manualReviewFor(
  invoice: Stripe.Invoice,
  decision: InvoiceRefundDecision,
): ManualReviewInvoice[] {
  const invoiceStatus = invoice.status ?? null;
  const invoiceId = invoice.id as string;
  if (decision.kind === "manual") {
    return [{ invoiceId, reason: decision.reason, invoiceStatus }];
  }
  if (decision.kind === "refund" && decision.creditNotRefunded) {
    return [{ invoiceId, reason: "partly_paid_by_credit", invoiceStatus }];
  }
  return [];
}

/** Is a payment on this invoice still processing (an `open` invoice payment)? */
async function hasPaymentUnderWay(invoiceId: string): Promise<boolean> {
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await stripe.invoicePayments.list({
      invoice: invoiceId,
      limit: INVOICE_PAYMENT_LOOKUP_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (page.data.some((payment) => payment.status === "open")) return true;
    const nextCursor = nextStripePageCursor(
      page.data,
      page.has_more,
      startingAfter,
      seenCursors,
      `invoice-payment lookup for invoice ${invoiceId}`,
    );
    if (!nextCursor) return false;
    startingAfter = nextCursor;
  }
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
  /**
   * Charges already refunded in full outside this flow (support, the Stripe
   * dashboard) before this refusal reached them (s82 review, MAJOR 1). Settled:
   * nothing more is refunded, and nothing is retried for them.
   */
  refundedOutsideChargeIds: string[];
  /**
   * Charges the customer disputed. Not refunded here: Stripe refuses a refund
   * of a disputed charge, and the dispute decides where the money goes. Ops
   * resolve it in Stripe (s82 review, MAJOR 1).
   */
  disputedChargeIds: string[];
  /**
   * Invoices of an ended subscription refunded by nobody automatically, because
   * they mix covered and uncovered charges or one cannot be told (Devin round on
   * 8744bed). Ops are warned once per invoice to refund the covered lines.
   */
  manualReviewInvoices: ManualReviewInvoice[];
}

/** An invoice that needs a person, and why. */
export interface ManualReviewInvoice {
  invoiceId: string;
  reason: ManualReviewReason;
  /**
   * The invoice's status when decided. One still `open` (a payment
   * processing) is decided again, and alerted, when it settles (review of
   * 67c6caf): one alert, when it is actionable.
   */
  invoiceStatus: string | null;
}

/** What a refusal took back, for the ops report. */
export interface CoveredSubscriptionRefusal extends CoveredInvoiceRefund {
  /** The subscription as Stripe holds it after the refusal: cancelled. */
  subscription: Stripe.Subscription;
  /**
   * Over before this refusal, and not by our cancellation: the customer ended
   * it. Every paid invoice was refunded, not just the latest (s82 review,
   * minor 2), and a credit balance its cancellation left is worth a look.
   */
  endedBeforeRefusal: boolean;
}

const NO_REFUNDS: CoveredInvoiceRefund = {
  refundIds: [],
  pendingPaymentIds: [],
  inFlightPaymentIds: [],
  refundedOutsideChargeIds: [],
  disputedChargeIds: [],
  manualReviewInvoices: [],
};

function mergeRefunds(
  a: CoveredInvoiceRefund,
  b: CoveredInvoiceRefund,
): CoveredInvoiceRefund {
  return {
    refundIds: [...a.refundIds, ...b.refundIds],
    pendingPaymentIds: [...a.pendingPaymentIds, ...b.pendingPaymentIds],
    inFlightPaymentIds: [...a.inFlightPaymentIds, ...b.inFlightPaymentIds],
    refundedOutsideChargeIds: [
      ...a.refundedOutsideChargeIds,
      ...b.refundedOutsideChargeIds,
    ],
    disputedChargeIds: [...a.disputedChargeIds, ...b.disputedChargeIds],
    manualReviewInvoices: [
      ...a.manualReviewInvoices,
      ...b.manualReviewInvoices,
    ],
  };
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
 * A subscription the customer had already ended (s82 review, minor 2) has
 * every paid invoice considered, not only its latest: a cancellation with
 * proration can leave a final credit invoice as the latest, after the one that
 * collected the money. Each is decided by `decideInvoiceRefund` (Devin round
 * on 8744bed). A live subscription keeps the latest invoice: this refusal
 * cancels it without a final invoice.
 *
 * Throws on any Stripe failure — `CoveredRefundFailed` when the subscription
 * is stopped and only the refund failed. Callers decide: the subscription
 * webhook rethrows into a retryable 500, the lifetime webhook reports and
 * moves on.
 */
export async function refuseSubscriptionCoveredByLifetime(
  subscription: Stripe.Subscription,
  coverage?: InvoicePlanCoverage,
): Promise<CoveredSubscriptionRefusal> {
  const endedBeforeRefusal =
    isTerminalSubscriptionStatus(subscription.status) &&
    !isRefusedAsCoveredByLifetime(subscription);
  const stopped = await cancelCovered(subscription);

  try {
    const { refund, manual } = await invoicesToRefund(
      stopped,
      endedBeforeRefusal,
      coverage,
    );
    let refunds: CoveredInvoiceRefund = {
      ...NO_REFUNDS,
      manualReviewInvoices: manual,
    };
    for (const { invoiceId, alreadyCredited } of refund) {
      refunds = mergeRefunds(
        refunds,
        await refundCoveredInvoice(invoiceId, stopped.id, alreadyCredited),
      );
    }
    return { subscription: stopped, endedBeforeRefusal, ...refunds };
  } catch (error) {
    throw new CoveredRefundFailed(stopped, error);
  }
}

/**
 * What an ended subscription's invoices are judged against (Devin round on
 * 8744bed): the customer's grants, the moment they are judged at (the
 * subscription's purchase, `coverageFor`), and the catalogue's products.
 */
export interface InvoicePlanCoverage extends GrantsJudgedAt {
  /** Loaded when absent: one catalogue load and one price read per price. */
  readonly productIndex?: PlanProductIndex;
}

/** The customer's grants, and the moment an invoice is judged at. */
export interface GrantsJudgedAt {
  readonly grants: readonly DatedGrant[];
  readonly judgedAt: number;
}

/** An invoice to refund, and what credit notes already returned for it. */
interface InvoiceToRefund {
  invoiceId: string;
  alreadyCredited: number;
}

/**
 * The invoices a refusal refunds, and those it leaves to a person.
 *
 * A live subscription: its latest invoice, which bills the covered plan the
 * refusal was decided on. A subscription the customer ended: its latest and
 * every paid invoice, each decided by `decideInvoiceRefund` over all its lines
 * (s82 review N2, Devin round on 8744bed).
 */
async function invoicesToRefund(
  subscription: Stripe.Subscription,
  endedBeforeRefusal: boolean,
  coverage: InvoicePlanCoverage | undefined,
): Promise<{ refund: InvoiceToRefund[]; manual: ManualReviewInvoice[] }> {
  const latest = idOf(subscription.latest_invoice);
  if (!endedBeforeRefusal) {
    return {
      refund: latest ? [{ invoiceId: latest, alreadyCredited: 0 }] : [],
      manual: [],
    };
  }
  if (!coverage) {
    throw new Error(
      `the refusal of ended subscription ${subscription.id} was not told ` +
        `which plans its customer's grants covered`,
    );
  }

  const productIndex = coverage.productIndex ?? (await loadPlanProductIndex());
  const paid = await listPaidInvoices(subscription.id);
  const candidates =
    latest && !paid.some((invoice) => invoice.id === latest)
      ? [await stripe.invoices.retrieve(latest), ...paid]
      : paid;

  const refund: InvoiceToRefund[] = [];
  const manual: ManualReviewInvoice[] = [];
  const seen = new Set<string>();
  for (const invoice of candidates) {
    if (!invoice.id || seen.has(invoice.id)) continue;
    seen.add(invoice.id);
    const decision = await decideEndedInvoiceRefund(
      invoice,
      coverage,
      productIndex,
    );
    if (decision.kind === "refund") {
      refund.push({
        invoiceId: invoice.id,
        alreadyCredited: invoice.post_payment_credit_notes_amount ?? 0,
      });
    }
    manual.push(...manualReviewFor(invoice, decision));
    if (decision.kind === "skip") {
      logger.info(
        `Invoice ${invoice.id} of subscription ${subscription.id}, refused as ` +
          `covered by a lifetime grant, not refunded: ` +
          (decision.reason === "uncovered"
            ? `it bills no plan the customer's grants covered.`
            : `nothing on it was a charge.`),
        undefined,
        {
          component: "stripe/lifetime-covered-billing",
          action: "skip_covered_invoice",
          subscriptionId: subscription.id,
          invoiceId: invoice.id,
          reason: decision.reason,
        },
      );
    }
  }
  return { refund, manual };
}

/** The catalogue's products, and a per-run price-to-product lookup. */
export interface PlanProductIndex extends ProductPlanLookup {
  /** The Stripe product of a price, read once per run. */
  productOfPrice(priceId: string): Promise<string | null>;
}

/**
 * Which plans each Stripe product sells, from the catalogue's configured
 * prices (Devin 4244837615): the catalogue stores price ids only, and a price
 * change keeps the product, so an invoice line on a retired price still maps
 * to its plan. One catalogue load, failing loudly (s82 review, N1); one Stripe
 * read per configured price, cached for the run.
 */
export async function loadPlanProductIndex(): Promise<PlanProductIndex> {
  const priceIndex = await loadPaidPlanPriceIndex();
  const products = new Map<string, Promise<string | null>>();
  // Review of 67c6caf: a price Stripe does not have (deleted, or configured in
  // the other mode) has no product: null, said, and its lines go to a person.
  // Any other failure is thrown, and evicted, so a later ask reads it again.
  const productOfPrice = (priceId: string): Promise<string | null> => {
    const known = products.get(priceId);
    if (known) return known;
    const read = stripe.prices.retrieve(priceId).then(
      (price) => idOf(price.product),
      (error: unknown) => {
        if (isStripeResourceMissing(error)) {
          logger.warn(
            `Stripe price ${priceId} does not exist: no plan can be told ` +
              `from it, so the invoice lines billing it go to a person.`,
            undefined,
            {
              component: "stripe/lifetime-covered-billing",
              action: "price_missing",
              priceId,
            },
          );
          return null;
        }
        products.delete(priceId);
        throw error;
      },
    );
    products.set(priceId, read);
    return read;
  };

  const plansByProduct = new Map<string, Set<PaidPlanId>>();
  for (const priceId of priceIndex.priceIds) {
    const productId = await productOfPrice(priceId);
    if (!productId) continue;
    plansByProduct.set(
      productId,
      new Set([
        ...(plansByProduct.get(productId) ?? []),
        ...priceIndex.plansOf(priceId),
      ]),
    );
  }

  return {
    plansOfProduct: (productId) => [...(plansByProduct.get(productId) ?? [])],
    productOfPrice,
  };
}

/**
 * Decide one invoice of an ended subscription from every line it has: the
 * refusal and the late-settlement path both ask this (Devin 4244837497).
 */
export async function decideEndedInvoiceRefund(
  invoice: Stripe.Invoice,
  judged: GrantsJudgedAt,
  productIndex: PlanProductIndex,
): Promise<InvoiceRefundDecision> {
  const lines = await allInvoiceLines(invoice);
  const charges: InvoiceLineCharge[] = [];
  for (const line of lines) {
    charges.push({
      lineId: line.id,
      amount: line.amount,
      // Not a charge, never read: no product lookup for it.
      productId:
        line.amount > 0 ? await lineProductId(line, productIndex) : null,
    });
  }
  return decideInvoiceRefund(
    charges,
    coverageFor(
      judged.grants,
      judged.judgedAt,
      invoice.status_transitions?.paid_at ?? null,
    ),
    productIndex,
    invoice.status === "paid"
      ? {
          amountPaid: invoice.amount_paid,
          total: invoice.total ?? invoice.amount_paid,
        }
      : null,
  );
}

/** Line-item page size: Stripe's maximum. */
const INVOICE_LINE_PAGE_SIZE = 100;

/**
 * Every line of an invoice: the lines it carries, or, when Stripe says there
 * are more, every page of them.
 */
async function allInvoiceLines(
  invoice: Stripe.Invoice,
): Promise<Stripe.InvoiceLineItem[]> {
  if (!invoice.lines?.has_more) return invoice.lines?.data ?? [];

  const invoiceId = invoice.id as string;
  const lines: Stripe.InvoiceLineItem[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await stripe.invoices.listLineItems(invoiceId, {
      limit: INVOICE_LINE_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const nextCursor = nextStripePageCursor(
      page.data,
      page.has_more,
      startingAfter,
      seenCursors,
      `line-item lookup for invoice ${invoiceId}`,
    );
    lines.push(...page.data);

    if (!nextCursor) break;
    startingAfter = nextCursor;
  }
  return lines;
}

/**
 * A line's product: basil's `pricing.price_details.product`; on an endpoint of
 * an older API version, its `price.product`, or its price's product read from
 * Stripe. Null when the line names no price at all.
 */
async function lineProductId(
  line: Stripe.InvoiceLineItem,
  productIndex: PlanProductIndex,
): Promise<string | null> {
  const fromPricing = line.pricing?.price_details?.product;
  if (fromPricing) return fromPricing;

  const legacy = (
    line as {
      price?:
        | string
        | { id?: string; product?: string | { id?: string } }
        | null;
    }
  ).price;
  if (legacy && typeof legacy === "object" && legacy.product) {
    return idOf(legacy.product);
  }
  const priceId =
    line.pricing?.price_details?.price ??
    (typeof legacy === "string" ? legacy : legacy?.id);
  return priceId ? productIndex.productOfPrice(priceId) : null;
}

/** Paid-invoice page size: Stripe's maximum. */
const PAID_INVOICE_PAGE_SIZE = 100;

/**
 * Every paid invoice of one subscription: bounded by the subscription and the
 * status, read page by page; a cursor that does not advance throws.
 */
async function listPaidInvoices(
  subscriptionId: string,
): Promise<Stripe.Invoice[]> {
  const invoices: Stripe.Invoice[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();

  for (;;) {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      status: "paid",
      limit: PAID_INVOICE_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const nextCursor = nextStripePageCursor(
      page.data.filter((invoice): invoice is Stripe.Invoice & { id: string } =>
        Boolean(invoice.id),
      ),
      page.has_more,
      startingAfter,
      seenCursors,
      `paid-invoice lookup for subscription ${subscriptionId}`,
    );
    invoices.push(...page.data);

    if (!nextCursor) break;
    startingAfter = nextCursor;
  }

  return invoices;
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
 * same idempotency key: one refund either way. A charge refunded or disputed
 * outside this flow is reported, never thrown on (s82 review, MAJOR 1).
 */
export async function refundCoveredInvoice(
  invoiceId: string,
  subscriptionId: string,
  /**
   * What post-payment credit notes already returned for this invoice
   * (`post_payment_credit_notes_amount`): never refunded a second time
   * (re-review of 2928fcb).
   */
  alreadyCredited = 0,
): Promise<CoveredInvoiceRefund> {
  let creditedLeft = alreadyCredited;
  const refundIds: string[] = [];
  const pendingPaymentIds: string[] = [];
  const inFlightPaymentIds: string[] = [];
  const refundedOutsideChargeIds: string[] = [];
  const disputedChargeIds: string[] = [];
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

      // This invoice's share of the payment, less what credit notes already
      // returned for the invoice (consumed payment by payment).
      let share: number | null = payment.amount_paid ?? null;
      if (share !== null) {
        const credited = Math.min(creditedLeft, share);
        creditedLeft -= credited;
        share -= credited;
      }
      const outcome = await refundOnce(payment, subscriptionId, share);
      switch (outcome.kind) {
        case "refunded":
          refundIds.push(outcome.refundId);
          break;
        case "in_flight":
          inFlightPaymentIds.push(payment.id);
          break;
        case "refunded_outside":
          refundedOutsideChargeIds.push(outcome.chargeId);
          break;
        case "disputed":
          disputedChargeIds.push(outcome.chargeId);
          break;
        case "nothing_collected":
          break;
      }
    }

    if (!nextCursor) break;
    startingAfter = nextCursor;
  }

  return {
    refundIds,
    pendingPaymentIds,
    inFlightPaymentIds,
    refundedOutsideChargeIds,
    disputedChargeIds,
    // Decided per invoice by the caller, never here.
    manualReviewInvoices: [],
  };
}

/** What became of one paid payment. */
type RefundOutcome =
  /** Refunded by this refusal, now or before. */
  | { kind: "refunded"; refundId: string }
  /** Another delivery is making this very refund (s82 verification, mi-3). */
  | { kind: "in_flight" }
  /** Already refunded in full outside this flow (s82 review, MAJOR 1). */
  | { kind: "refunded_outside"; chargeId: string }
  /** Disputed: the dispute decides, not a refund (s82 review, MAJOR 1). */
  | { kind: "disputed"; chargeId: string }
  /** The payment collected nothing for this invoice. */
  | { kind: "nothing_collected" };

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
 *
 * s82 review (MAJOR 1): support can refund a charge, or the customer dispute
 * it, before a delayed or redelivered event reaches this refusal. A refund
 * made outside this flow carries no metadata, so the lookup misses it, and
 * Stripe refuses a second refund: `CoveredRefundFailed` and a 500 forever,
 * with the subscription never recorded and its Checkout never finished. So the
 * charge is read first. Refunded in full: settled outside, nothing more to do.
 * Partly refunded: only the remainder, under a key that names it. Disputed: no
 * refund, the dispute decides. The same two refusals from Stripe
 * (`charge_already_refunded`, `charge_disputed`) are caught as a backstop for
 * a change between the read and the refund.
 *
 * Review of 67c6caf: never more than this invoice collected through this
 * payment (`InvoicePayment.amount_paid`, less than the charge when one
 * payment paid several invoices), nor more than is left on the charge. A
 * payment shared with an uncovered invoice is never refunded for it.
 */
async function refundOnce(
  invoicePayment: Stripe.InvoicePayment,
  subscriptionId: string,
  /** This invoice's share of the payment still owed back; null if unknown. */
  invoiceShare: number | null,
): Promise<RefundOutcome> {
  const payment = invoicePayment.payment;
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

  // Our own refund first: once made, it is also what makes the charge read
  // as refunded.
  const found = await findCoveredRefund(target, subscriptionId);
  if (found.live) {
    return { kind: "refunded", refundId: found.live.id };
  }
  const previous = found.retryable;

  const charge = await readChargeOf(target);
  const chargeId = charge?.id ?? targetId;
  if (charge?.disputed) return { kind: "disputed", chargeId };
  const chargeLeft = charge
    ? charge.amount_captured - charge.amount_refunded
    : null;
  if (charge && (charge.refunded || (chargeLeft ?? 0) <= 0)) {
    return outsideUnlessOurs(target, subscriptionId, chargeId);
  }
  if (invoiceShare !== null && invoiceShare <= 0) {
    return { kind: "nothing_collected" };
  }
  const known = [chargeLeft, invoiceShare].filter(
    (amount): amount is number => amount !== null,
  );
  const remainder = known.length > 0 ? Math.min(...known) : null;
  const partial =
    remainder !== null &&
    (charge ? remainder < charge.amount_captured : invoiceShare !== null);

  const baseKey = `${COVERED_BY_LIFETIME}-refund-${subscriptionId}-${targetId}`;
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        ...target,
        ...(partial ? { amount: remainder } : {}),
        metadata: {
          reason_code: COVERED_BY_LIFETIME,
          subscription_id: subscriptionId,
        },
      },
      {
        idempotencyKey:
          baseKey +
          (previous ? `-after-${previous.id}` : "") +
          (partial ? `-remainder-${remainder}` : ""),
      },
    );
  } catch (error) {
    const code = stripeErrorCode(error);
    if (code === "charge_already_refunded") {
      return outsideUnlessOurs(target, subscriptionId, chargeId);
    }
    if (code === "charge_disputed") return { kind: "disputed", chargeId };
    // s82 verification (mi-3): another delivery is creating this very refund
    // — same key — and Stripe answered ours 409 (after the SDK's own retries
    // of a 409). It is in flight, not failed: re-check once, and if it has not
    // landed yet leave it to the request that owns it, which reports its own
    // failure.
    if (code !== "idempotency_key_in_use") throw error;
    const landed = await findCoveredRefund(target, subscriptionId);
    return landed.live
      ? { kind: "refunded", refundId: landed.live.id }
      : { kind: "in_flight" };
  }
  if (refundDisposition(refund, subscriptionId) === "retryable") {
    throw new Error(
      `refund ${refund.id} for subscription ${subscriptionId} is ${refund.status}`,
    );
  }
  return { kind: "refunded", refundId: refund.id };
}

/**
 * "Refunded outside this flow", unless the refund is ours after all.
 *
 * s82 review (N3): another delivery of this refusal can land our refund
 * between our lookup and the charge read, or the refund request. The charge
 * then reads as refunded, and the report said "refunded outside" about our own
 * refund. Look once more by metadata before saying so.
 */
async function outsideUnlessOurs(
  target: RefundTarget,
  subscriptionId: string,
  chargeId: string,
): Promise<RefundOutcome> {
  const ours = await findCoveredRefund(target, subscriptionId);
  return ours.live
    ? { kind: "refunded", refundId: ours.live.id }
    : { kind: "refunded_outside", chargeId };
}

/**
 * The charge a refund would return: a charge as is, a payment intent's latest.
 * Null when a payment intent has none, in which case the refund is attempted
 * as before and Stripe's own refusal is the backstop.
 */
async function readChargeOf(
  target: RefundTarget,
): Promise<Stripe.Charge | null> {
  if (target.charge) return stripe.charges.retrieve(target.charge);
  if (!target.payment_intent) return null;

  const paymentIntent = await stripe.paymentIntents.retrieve(
    target.payment_intent,
    { expand: ["latest_charge"] },
  );
  const latest = paymentIntent.latest_charge;
  if (!latest) return null;
  return typeof latest === "string" ? stripe.charges.retrieve(latest) : latest;
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
      refunded_outside_charge_ids: refusal.refundedOutsideChargeIds,
      disputed_charge_ids: refusal.disputedChargeIds,
      manual_review_invoice_ids: refusal.manualReviewInvoices.map(
        (invoice) => invoice.invoiceId,
      ),
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

/** `billing_events.event_type` of the once-only warning of a disputed charge. */
const DISPUTE_WARNING_EVENT_TYPE = "internal.covered_charge_disputed";

/**
 * Claim the one warning about a disputed charge of a refused subscription;
 * true for the caller that should make it (s82 review, MAJOR 1: alert ops
 * once). Same write-once pattern as `claimRefusalReport`; a claim the database
 * could not write answers true, since a second warning beats none.
 */
export async function claimDisputeWarning(
  supabase: SupabaseClient,
  chargeId: string,
  subscriptionId: string,
  userId: string,
): Promise<boolean> {
  return claimWarningOnce(supabase, {
    userId,
    eventType: DISPUTE_WARNING_EVENT_TYPE,
    eventId: `${COVERED_BY_LIFETIME}_disputed:${chargeId}`,
    data: { charge_id: chargeId, subscription_id: subscriptionId },
    subject: `charge ${chargeId}`,
  });
}

/** `billing_events.event_type` of the once-only manual-review warning. */
const MANUAL_INVOICE_WARNING_EVENT_TYPE =
  "internal.covered_invoice_manual_review";

/**
 * Claim the one warning that an invoice of a refused subscription needs a
 * person (Devin round on 8744bed): the refusal and every settlement of the
 * invoice ask, ops hear once.
 */
export async function claimManualInvoiceWarning(
  supabase: SupabaseClient,
  invoiceId: string,
  subscriptionId: string,
  userId: string,
): Promise<boolean> {
  return claimWarningOnce(supabase, {
    userId,
    eventType: MANUAL_INVOICE_WARNING_EVENT_TYPE,
    eventId: `${COVERED_BY_LIFETIME}_manual_invoice:${invoiceId}`,
    data: { invoice_id: invoiceId, subscription_id: subscriptionId },
    subject: `invoice ${invoiceId}`,
  });
}

/** `billing_events.event_type` of the once-only unknown-price warning. */
const UNKNOWN_PRICE_WARNING_EVENT_TYPE =
  "internal.ended_subscription_unknown_price";

/**
 * Claim the one warning that an ended subscription bills no price a loaded
 * catalogue sells, so it was skipped (s82 review, N1). Every duplicate event of
 * the lifetime runs the ended-subscription step again; ops hear of it once.
 */
export async function claimUnknownPriceWarning(
  supabase: SupabaseClient,
  subscriptionId: string,
  userId: string,
): Promise<boolean> {
  return claimWarningOnce(supabase, {
    userId,
    eventType: UNKNOWN_PRICE_WARNING_EVENT_TYPE,
    eventId: `${COVERED_BY_LIFETIME}_unknown_price:${subscriptionId}`,
    data: { subscription_id: subscriptionId },
    subject: `subscription ${subscriptionId}`,
  });
}

/**
 * The write-once claim behind each once-only warning: a synthetic
 * `stripe_event_id` whose UNIQUE constraint lets one insert succeed. A claim
 * the database could not write answers true: a second warning beats none.
 */
async function claimWarningOnce(
  supabase: SupabaseClient,
  claim: {
    userId: string;
    eventType: string;
    eventId: string;
    data: Record<string, string>;
    subject: string;
  },
): Promise<boolean> {
  const { error } = await supabase.from("billing_events").insert({
    user_id: claim.userId,
    event_type: claim.eventType,
    stripe_event_id: claim.eventId,
    data: claim.data,
    processed: true,
  });

  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  console.error(
    `Could not record the warning about ${claim.subject}; warning anyway: ` +
      error.message,
  );
  return true;
}

/** A customer's credit balance, as a positive amount in the smallest unit. */
export interface CustomerCredit {
  amount: number;
  currency: string | null;
}

/**
 * What credit a customer holds (s82 review, minor 2). A cancellation with
 * proration credits the unused time to the customer's balance; refunding the
 * whole payment beside it would pay that time back twice. Stripe keeps credit
 * as a negative balance. A deleted customer holds none. Throws on a read failure.
 */
export async function readCustomerCredit(
  stripeCustomerId: string,
): Promise<CustomerCredit> {
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) return { amount: 0, currency: null };
  return {
    amount: Math.max(0, -customer.balance),
    currency: customer.currency ?? null,
  };
}

/** `billing_events.event_type` of the refusal of a subscription already over. */
const TERMINAL_REFUSAL_EVENT_TYPE = "internal.terminal_subscription_refused";

function terminalRefusalEventId(subscriptionId: string): string {
  return `${COVERED_BY_LIFETIME}_terminal:${subscriptionId}`;
}

/**
 * Record, durably, that a subscription already over when it was refused was
 * refused as covered by a lifetime grant.
 *
 * s82, Devin Review on PR #81 (finding 5): the refusal's record is Stripe's
 * cancellation marker, which only its own cancellation writes. A subscription
 * the customer cancelled before its webhook ran is refused without one
 * (`cancelCovered` keeps the customer's reason, and Stripe will not update a
 * cancelled subscription), so a payment still in flight at the refusal settled
 * later, found no marker, and stayed charged. This row is the marker's stand-in,
 * in `billing_events` beside the refusal report, under a synthetic
 * `stripe_event_id` whose UNIQUE constraint makes it write-once.
 *
 * Written BEFORE the invoice is scanned for payments: a payment that settles
 * before the row lands is `paid` when the scan reads it and refunded there; one
 * that settles after finds the row. Either way `refundOnce` refunds it once.
 *
 * Unlike the report claim, a failed write throws: without the row a late payment
 * would stay charged, so the caller alerts and Stripe redelivers. A duplicate is
 * an earlier delivery's record, which stands.
 */
export async function recordTerminalRefusal(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  userId: string,
  planId: string,
): Promise<void> {
  const { error } = await supabase.from("billing_events").insert({
    user_id: userId,
    event_type: TERMINAL_REFUSAL_EVENT_TYPE,
    stripe_event_id: terminalRefusalEventId(subscription.id),
    data: {
      subscription_id: subscription.id,
      plan_id: planId,
      status: subscription.status,
    },
    processed: true,
  });

  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(
      `could not record the refusal of subscription ${subscription.id}: ` +
        error.message,
    );
  }
}

/**
 * Was this subscription refused as covered by a lifetime grant: by the marker
 * the refusal's cancellation wrote, or, for one already over when refused, by
 * `recordTerminalRefusal`'s row?
 *
 * Only a subscription that is over can carry that row, and over is final, so a
 * live one is answered from Stripe alone: a renewal never waits on this read.
 * Throws when the row cannot be read: never decide about money without knowing.
 */
export async function wasRefusedAsCoveredByLifetime(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  if (isRefusedAsCoveredByLifetime(subscription)) return true;
  if (!isTerminalSubscriptionStatus(subscription.status)) return false;

  const { data, error } = await supabase
    .from("billing_events")
    .select("id")
    .eq("stripe_event_id", terminalRefusalEventId(subscription.id))
    .maybeSingle();

  if (error) {
    throw new Error(
      `could not read whether subscription ${subscription.id} was refused ` +
        `as covered by a lifetime grant: ${error.message}`,
    );
  }
  return data !== null;
}

/** Ended-subscription page size: Stripe's maximum. */
const ENDED_SUBSCRIPTION_PAGE_SIZE = 100;

/**
 * Every subscription of a customer that is already over (`canceled` or
 * `incomplete_expired`, Stripe's `ended`) and that Stripe created at or after
 * `createdSince`.
 *
 * s82 finding 6 (implementer-found, opposite ordering): when a lifetime's event
 * is processed after a covered subscription's, and the customer had already
 * ended it, the subscription is no longer live, so the live rows the lifetime
 * handler reads never name it. Stripe does. Bounded three ways (one customer,
 * ended only, created since the lifetime was paid) and read page by page until
 * Stripe says there is no more. A cursor that does not advance throws, like
 * every other money-moving scan here.
 */
export async function listEndedSubscriptionsSince(
  stripeCustomerId: string,
  createdSince: number,
): Promise<Stripe.Subscription[]> {
  const ended: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();

  for (;;) {
    const page = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "ended",
      created: { gte: createdSince },
      limit: ENDED_SUBSCRIPTION_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const nextCursor = nextStripePageCursor(
      page.data,
      page.has_more,
      startingAfter,
      seenCursors,
      `ended-subscription lookup for customer ${stripeCustomerId}`,
    );
    ended.push(...page.data);

    if (!nextCursor) break;
    startingAfter = nextCursor;
  }

  return ended;
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
