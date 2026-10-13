import type Stripe from "stripe";
import {
  PaymentEvidenceUnavailable,
  PaymentReadBudgetExceeded,
  normalizePaymentSource,
  type BillingSource,
  type PaymentReads,
} from "./payment-conversions";
export interface NormalizedRefund {
  sourceKey: string;
  parentSourceKey: string;
  accountId: string;
  mode: "live" | "test";
  onlyExistingParent?: boolean;
  occurredAt: number;
  amountMinor: number;
  taxMinor: number;
  itemId: string;
  quantity: number;
}
function id(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}
/** Refund snapshots prove amounts, but only their own causal transition proves
 * occurrence. A charge event must not give every older refund a new timestamp. */
function causalRefunds(
  event: Stripe.ChargeRefundedEvent,
): Stripe.Refund[] | null {
  const charge = event.data.object;
  if (!charge.refunds || charge.refunds.has_more !== false) return null;
  const current = charge.refunds.data.filter((r) => r.status === "succeeded");
  const previous = event.data.previous_attributes;
  if (previous?.refunds && previous.refunds.has_more === false) {
    const old = new Map(previous.refunds.data.map((r) => [r.id, r.status]));
    return current.filter((r) => old.get(r.id) !== "succeeded");
  }
  // A first return with exactly one successful child has no older returned
  // principal to misattribute. Any nonzero/unavailable prior total is unknown.
  if (
    previous?.amount_refunded === 0 &&
    current.length === 1 &&
    charge.amount_refunded === current[0].amount
  )
    return current;
  return null;
}
export async function normalizeBillingConversionSource(
  source: BillingSource,
  reads: PaymentReads,
) {
  if (
    ![
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ].includes(source.event_type)
  )
    return {
      ...(await normalizePaymentSource(source, reads)),
      refunds: [] as NormalizedRefund[],
    };
  try {
    const event = await reads.event(source.stripe_event_id);
    const stored =
      source.data && typeof source.data === "object" && "object" in source.data
        ? source.data.object
        : null;
    if (
      source.processed !== true ||
      event.id !== source.stripe_event_id ||
      event.type !== source.event_type ||
      !stored ||
      typeof stored !== "object" ||
      !("id" in stored) ||
      !("id" in event.data.object) ||
      stored.id !== event.data.object.id
    )
      return {
        state: "unknown" as const,
        reason: "event_mismatch",
        purchases: [],
        refunds: [],
      };
    if (
      event.type !== "charge.refunded" &&
      event.type !== "charge.dispute.created" &&
      event.type !== "charge.dispute.closed"
    )
      return {
        state: "unknown" as const,
        reason: "event_mismatch",
        purchases: [],
        refunds: [],
      };
    const charge =
      event.type === "charge.refunded"
        ? await reads.charge(event.data.object.id)
        : await reads.charge(id(event.data.object.charge)!);
    if (
      charge.livemode !== event.livemode ||
      event.data.object.livemode !== event.livemode
    )
      return {
        state: "unknown" as const,
        reason: "mode_mismatch",
        purchases: [],
        refunds: [],
      };
    const intentId = id(charge.payment_intent);
    const successfulId = intentId
      ? await reads.successfulPaymentEvent(intentId)
      : null;
    if (!successfulId)
      return {
        state: "unknown" as const,
        reason: "settlement_unknown",
        purchases: [],
        refunds: [],
      };
    const paidEvent = await reads.event(successfulId);
    const payment = await normalizePaymentSource(
      {
        stripe_event_id: successfulId,
        event_type: "payment_intent.succeeded",
        processed: true,
        data: paidEvent.data,
      },
      reads,
      { includeAutomaticReturns: true },
    );
    if (payment.state !== "normalized" || event.type !== "charge.refunded")
      return { ...payment, refunds: [] as NormalizedRefund[] };
    const all: Stripe.Refund[] = [];
    let after: string | undefined;
    let complete = false;
    for (let page = 0; page < 5; page++) {
      const batch = await reads.refunds({
        charge: charge.id,
        limit: 100,
        ...(after ? { starting_after: after } : {}),
      });
      if (batch.data.some((r) => all.some((prior) => prior.id === r.id))) break;
      if (all.length + batch.data.length > 100)
        return {
          ...payment,
          state: "pending" as const,
          reason: "normalization_limit",
          refunds: [],
        };
      all.push(...batch.data);
      if (!batch.has_more) {
        complete = true;
        break;
      }
      after = batch.data.at(-1)?.id;
      if (!after) break;
    }
    if (!complete)
      return {
        ...payment,
        state: "pending" as const,
        reason: "incomplete_refund_page",
        refunds: [],
      };
    const unresolved = all.some(
      (r) => r.status === "pending" || r.status === "requires_action",
    );
    const causal = causalRefunds(event);
    if (!causal || !causal.length)
      return {
        ...payment,
        state: unresolved ? ("pending" as const) : ("unknown" as const),
        reason: "refund_settlement_unknown",
        refunds: [],
      };
    const refunds: NormalizedRefund[] = [];
    const totalCash = payment.purchases.reduce(
      (sum, p) => sum + p.cashMinor,
      0,
    );
    for (const snapshot of causal) {
      const current = all.find((r) => r.id === snapshot.id);
      if (!current || current.status !== "succeeded") continue;
      if (
        current.amount !== snapshot.amount ||
        current.currency !== "usd" ||
        id(current.charge) !== charge.id ||
        !Number.isSafeInteger(current.amount) ||
        current.amount <= 0
      )
        return {
          ...payment,
          state: "unknown" as const,
          reason: "refund_evidence_mismatch",
          refunds: [],
        };
      const wholePayment =
        current.amount === charge.amount_captured &&
        totalCash === charge.amount_captured &&
        payment.purchases.every(
          (p) =>
            p.paymentIntentIds.length === 1 &&
            p.paymentIntentIds[0] === intentId,
        );
      const simplePartial =
        payment.purchases.length === 1 &&
        payment.purchases[0].taxMinor === 0 &&
        payment.purchases[0].cashMinor === charge.amount_captured &&
        payment.purchases[0].paymentIntentIds.length === 1 &&
        payment.purchases[0].paymentIntentIds[0] === intentId &&
        current.amount <= totalCash;
      if (!wholePayment && !simplePartial)
        return {
          ...payment,
          state: "unknown" as const,
          reason: "refund_allocation_unknown",
          refunds: [],
        };
      // A complete return proves every allocated share and its tax was returned.
      // Partial mixed/taxed splits still have no authoritative allocation.
      for (const parent of payment.purchases)
        refunds.push({
          onlyExistingParent: parent.acquisitionEligible === false,
          sourceKey: `${parent.mode}:${current.id}:${parent.sourceKey.slice(parent.mode.length + 1)}`,
          parentSourceKey: parent.sourceKey,
          accountId: parent.accountId,
          mode: parent.mode,
          occurredAt: event.created,
          amountMinor: wholePayment ? parent.cashMinor : current.amount,
          taxMinor: wholePayment ? parent.taxMinor : 0,
          itemId: parent.itemId,
          quantity: parent.quantity,
        });
    }
    return {
      ...payment,
      state: unresolved ? ("pending" as const) : ("normalized" as const),
      ...(unresolved ? { reason: "refund_pending" } : {}),
      refunds,
    };
  } catch (error) {
    if (error instanceof PaymentReadBudgetExceeded)
      return {
        state: "pending" as const,
        reason: "normalization_limit",
        purchases: [],
        refunds: [],
      };
    if (error instanceof PaymentEvidenceUnavailable)
      return {
        state: "unknown" as const,
        reason: "event_unavailable",
        purchases: [],
        refunds: [],
      };
    return {
      state: "pending" as const,
      reason: "provider_read_failed",
      purchases: [],
      refunds: [],
    };
  }
}
