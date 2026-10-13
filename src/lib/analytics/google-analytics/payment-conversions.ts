import type Stripe from "stripe";
import {
  findPaidPlanIdByStripePriceId,
  getOneTimeProduct,
  getCreditPackConfig,
} from "@/lib/stripe/plans";
import { STRIPE_CONFIG } from "@/lib/stripe/config";
import { COVERED_BY_LIFETIME } from "@/lib/stripe/lifetime-covered-billing";
import { isLifetimeProductId } from "@/lib/stripe/plan-types";
import type { OneTimeProductId } from "@/lib/stripe/plan-types";

/** A provider explicitly reported that the historical object is unavailable;
 * unlike a timeout, repeating normalization cannot establish its mode/time. */
export class PaymentEvidenceUnavailable extends Error {
  constructor() {
    super("historical payment evidence unavailable");
    this.name = "PaymentEvidenceUnavailable";
  }
}

export class PaymentReadBudgetExceeded extends Error {
  constructor() {
    super("payment evidence budget exhausted");
    this.name = "PaymentReadBudgetExceeded";
  }
}
/** Existing catalogue loaders have no signal parameter. Bound our await without
 * altering their financial callers/cache behavior; abandoned work is read-only. */
export async function readPaymentCatalogue<T>(
  operation: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PaymentReadBudgetExceeded()), 1500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface BillingSource {
  stripe_event_id: string;
  event_type: string;
  processed: boolean;
  /** billing_events stores event.data, never an event envelope. */
  data: unknown;
}
interface Page<T> {
  data: T[];
  has_more: boolean;
}
/** Read-only ports. The reconciliation owner supplies account-scoped billing reads;
 * no monetary/provisioning helper is reachable through this interface. */
export interface PaymentReads {
  historyBudget?(): AbortSignal;
  event(id: string): Promise<Stripe.Event>;
  intent(id: string): Promise<Stripe.PaymentIntent>;
  charge(id: string): Promise<Stripe.Charge>;
  invoice(id: string): Promise<Stripe.Invoice>;
  session(id: string): Promise<Stripe.Checkout.Session>;
  allocations(
    params: Stripe.InvoicePaymentListParams,
  ): Promise<Page<Stripe.InvoicePayment>>;
  refunds(params: Stripe.RefundListParams): Promise<Page<Stripe.Refund>>;
  disputes(params: Stripe.DisputeListParams): Promise<Page<Stripe.Dispute>>;
  /** Returns only a currently existing account, from billing_customers. */
  account(customerId: string): Promise<string | null>;
  reconciledInvoice(invoiceId: string, accountId: string): Promise<boolean>;
  /** Original retained payment row, including revoked/refunded entitlements.
   * Current entitlement status is not historical collection evidence. */
  reconciledOneOff(
    intentId: string,
    accountId: string,
  ): Promise<{ productId: OneTimeProductId; quantity: number } | null>;
  /** ID of a successfully processed PI success event, not an event list guess. */
  successfulPaymentEvent(intentId: string): Promise<string | null>;
}
export interface NormalizedPurchase {
  acquisitionEligible?: boolean;
  isRenewal?: boolean;
  successfulRefundMinor?: number | null;
  sourceKey: string;
  accountId: string;
  mode: "live" | "test";
  occurredAt: number;
  cashMinor: number;
  value: number;
  taxMinor: number;
  discountMinor: number;
  netRetainedMinor: number | null;
  financialState: "resolved" | "pending" | "unknown";
  currency: "USD";
  itemId: string;
  quantity: number;
  /** Provider references remain internal, never GA payload parameters. */
  paymentIntentIds: string[];
}
export interface PaymentNormalization {
  state: "normalized" | "pending" | "suppressed" | "unknown";
  reason?: string;
  purchases: NormalizedPurchase[];
}
interface RefundSnapshot {
  id: string;
  amount: number;
  currency: string;
  status: string | null;
}
/** These are accounting snapshots, not refund delivery events. In particular,
 * Refund.created is request time and cannot establish a later successful refund's
 * consent interval. The delivery reconciler must obtain each refund's own causal
 * final-state event before enqueueing it; a charge list's event time is not proof. */
export function normalizeRefunds(
  refunds: readonly RefundSnapshot[],
  collectedMinor: number,
): {
  state: "normalized" | "pending" | "unknown";
  refundedMinor: number;
  refunds: { id: string; amountMinor: number }[];
} {
  const unknown = { state: "unknown" as const, refundedMinor: 0, refunds: [] };
  if (!positive(collectedMinor)) return unknown;
  const seen = new Map<string, RefundSnapshot>();
  const successful: { id: string; amountMinor: number }[] = [];
  let pending = false;
  let total = 0;
  for (const refund of refunds) {
    const prior = seen.get(refund.id);
    if (
      !refund.id ||
      !positive(refund.amount) ||
      refund.currency !== STRIPE_CONFIG.CURRENCY
    )
      return unknown;
    if (prior) {
      if (
        prior.amount !== refund.amount ||
        prior.status !== refund.status ||
        prior.currency !== refund.currency
      )
        return unknown;
      continue;
    }
    seen.set(refund.id, refund);
    if (refund.status === "succeeded") {
      total += refund.amount;
      successful.push({ id: refund.id, amountMinor: refund.amount });
    } else if (
      refund.status === "pending" ||
      refund.status === "requires_action"
    )
      pending = true;
    else if (refund.status !== "failed" && refund.status !== "canceled")
      return unknown;
  }
  if (!Number.isSafeInteger(total) || total > collectedMinor) return unknown;
  return {
    state: pending ? "pending" : "normalized",
    refundedMinor: total,
    refunds: successful,
  };
}

/** History is all verified account transactions, never just consented GA rows.
 * A missing legacy event is not evidence that this is the account's first sale. */
export function summarizePaymentHistory(
  sourceKey: string,
  occurredAt: number,
  history: readonly { sourceKey: string; occurredAt: number }[],
  isComplete: boolean,
): "new" | "returning" | undefined {
  if (!positive(occurredAt)) return undefined;
  const prefix = sourceKey.split(":")[0];
  history = history.filter((entry) => entry.sourceKey.split(":")[0] === prefix);
  if (history.some((entry) => !positive(entry.occurredAt))) return undefined;
  if (
    history.some(
      (entry) =>
        entry.sourceKey !== sourceKey &&
        positive(entry.occurredAt) &&
        entry.occurredAt < occurredAt,
    )
  )
    return "returning";
  if (
    history.some(
      (entry) =>
        entry.sourceKey !== sourceKey && entry.occurredAt === occurredAt,
    )
  )
    return undefined;
  return isComplete ? "new" : undefined;
}

class EvidenceFailure extends Error {
  constructor(
    readonly state: "pending" | "suppressed" | "unknown",
    readonly reason: string,
  ) {
    super(reason);
  }
}
function refuse(
  reason: string,
  state: EvidenceFailure["state"] = "unknown",
): never {
  throw new EvidenceFailure(state, reason);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function id(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  )
    return value.id;
  return null;
}
function sourceObject(data: unknown): { id: string; object?: string } | null {
  if (!data || typeof data !== "object" || !("object" in data)) return null;
  const object = data.object;
  return object && typeof object === "object" && id(object)
    ? (object as { id: string; object?: string })
    : null;
}
function verifyMode(livemode: unknown, expected: boolean) {
  if (typeof livemode !== "boolean" || livemode !== expected)
    refuse("mode_mismatch");
}
function verifyCurrency(currency: string) {
  if (currency !== STRIPE_CONFIG.CURRENCY) refuse("unsupported_currency");
}

/** Bounded independent reads. Hitting the bound is retryable/incomplete evidence,
 * never a truncated list treated as complete accounting. No money is mutated. */
async function pages<T extends { id: string }>(
  read: (after?: string) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await read(after);
    if (!Array.isArray(result.data) || typeof result.has_more !== "boolean")
      refuse("incomplete_provider_page", "pending");
    for (const row of result.data) {
      if (!row.id || seen.has(row.id))
        refuse("incomplete_provider_page", "pending");
      seen.add(row.id);
      rows.push(row);
      if (rows.length > 100) refuse("normalization_limit", "pending");
    }
    if (!result.has_more) return rows;
    after = result.data.at(-1)?.id;
    if (!after) refuse("incomplete_provider_page", "pending");
  }
  return refuse("normalization_limit", "pending");
}

export async function normalizePaymentSource(
  source: BillingSource,
  reads: PaymentReads,
  options: { includeAutomaticReturns?: boolean } = {},
): Promise<PaymentNormalization> {
  if (source.processed !== true)
    return { state: "pending", reason: "source_unprocessed", purchases: [] };
  if (
    ![
      "payment_intent.succeeded",
      "invoice.payment_succeeded",
      "checkout.session.completed",
    ].includes(source.event_type)
  )
    return { state: "suppressed", reason: "unsupported_source", purchases: [] };
  // A bounded page alone is not a bounded source: one invoice can fan out to
  // many intents, refunds and disputes. Budget the entire normalization attempt.
  let readCount = 0;
  function limited<A extends unknown[], R>(read: (...args: A) => Promise<R>) {
    return (...args: A): Promise<R> => {
      if (++readCount > 60) refuse("normalization_limit", "pending");
      return read(...args);
    };
  }
  const original = reads;
  reads = {
    event: limited(original.event.bind(original)),
    intent: limited(original.intent.bind(original)),
    charge: limited(original.charge.bind(original)),
    invoice: limited(original.invoice.bind(original)),
    session: limited(original.session.bind(original)),
    allocations: limited(original.allocations.bind(original)),
    refunds: limited(original.refunds.bind(original)),
    disputes: limited(original.disputes.bind(original)),
    account: limited(original.account.bind(original)),
    reconciledInvoice: limited(original.reconciledInvoice.bind(original)),
    reconciledOneOff: limited(original.reconciledOneOff.bind(original)),
    successfulPaymentEvent: limited(
      original.successfulPaymentEvent.bind(original),
    ),
  };
  try {
    const event = await reads.event(source.stripe_event_id);
    const storedObject = sourceObject(source.data);
    const eventObject = sourceObject(event.data);
    if (
      event.id !== source.stripe_event_id ||
      event.type !== source.event_type ||
      !storedObject ||
      !eventObject ||
      storedObject.id !== eventObject.id ||
      typeof event.livemode !== "boolean"
    )
      refuse("event_mismatch");
    const live = event.livemode;
    verifyMode((event.data.object as { livemode?: boolean }).livemode, live);
    const mode = live ? "live" : "test";
    const verifiedIntents = new Map<string, Stripe.PaymentIntent>();
    const automaticallyReturned = new Set<string>();
    const accounting = new Map<
      string,
      {
        net: number | null;
        state: "resolved" | "pending" | "unknown";
        refundedMinor: number;
      }
    >();
    const allocationLists = new Map<string, Stripe.InvoicePayment[]>();
    const readAllocations = async (params: Stripe.InvoicePaymentListParams) =>
      pages((after) =>
        reads.allocations({
          ...params,
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        }),
      );
    const intentAllocations = async (intentId: string) => {
      let list = allocationLists.get(intentId);
      if (!list) {
        list = await readAllocations({
          payment: { type: "payment_intent", payment_intent: intentId },
        });
        allocationLists.set(intentId, list);
      }
      return list;
    };
    const verifyIntent = async (intentId: string, customerId: string) => {
      const cached = verifiedIntents.get(intentId);
      if (cached) {
        if (id(cached.customer) !== customerId) refuse("account_mismatch");
        return cached;
      }
      const intent = await reads.intent(intentId);
      if (intent.id !== intentId || id(intent.customer) !== customerId)
        refuse("account_mismatch");
      verifyMode(intent.livemode, live);
      verifyCurrency(intent.currency);
      if (intent.status !== "succeeded" || !positive(intent.amount_received))
        refuse("no_positive_collection", "suppressed");
      const chargeId = id(intent.latest_charge);
      if (!chargeId) refuse("charge_unknown");
      const charge = await reads.charge(chargeId);
      verifyMode(charge.livemode, live);
      verifyCurrency(charge.currency);
      if (
        charge.id !== chargeId ||
        id(charge.payment_intent) !== intentId ||
        id(charge.customer) !== customerId
      )
        refuse("charge_mismatch");
      if (
        !charge.paid ||
        !charge.captured ||
        charge.status !== "succeeded" ||
        charge.amount_captured !== intent.amount_received
      )
        refuse("cash_collection_unknown");
      const refunds = await pages((after) =>
        reads.refunds({
          charge: chargeId,
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        }),
      );
      for (const refund of refunds) {
        if (
          id(refund.charge) !== chargeId ||
          (refund.payment_intent && id(refund.payment_intent) !== intentId)
        )
          refuse("refund_parent_mismatch");
      }
      const snapshot = normalizeRefunds(refunds, intent.amount_received);
      if (snapshot.state === "unknown") refuse("refund_accounting_unknown");
      let autoReturned = 0;
      for (const refund of refunds) {
        const metadata = refund.metadata;
        const automatic =
          (metadata?.reason_code === COVERED_BY_LIFETIME &&
            Boolean(metadata.subscription_id)) ||
          (metadata?.reason_code === "duplicate_founding_lifetime" &&
            Boolean(metadata.founding_reservation_id));
        if (!automatic) continue;
        if (refund.status === "pending" || refund.status === "requires_action")
          refuse("automatic_refund_pending", "pending");
        if (refund.status === "succeeded") autoReturned += refund.amount;
      }
      if (autoReturned === intent.amount_received) {
        if (!options.includeAutomaticReturns)
          refuse("automatically_returned", "suppressed");
        automaticallyReturned.add(intentId);
      } else if (autoReturned > 0) refuse("partial_automatic_refund");
      // Historical paid status survives genuine refunds and disputes. Only net
      // retained principal becomes unknown when the two can overlap. Automatic
      // duplicate-protection returns above are the intentional exception.
      let financialState: "resolved" | "pending" | "unknown" =
        snapshot.state === "pending" ? "pending" : "resolved";
      let loss = 0;
      if (charge.disputed) {
        const disputes = await pages((after) =>
          reads.disputes({
            charge: chargeId,
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          }),
        );
        if (!disputes.length) financialState = "unknown";
        for (const dispute of disputes) {
          if (
            id(dispute.charge) !== chargeId ||
            dispute.livemode !== live ||
            dispute.currency !== STRIPE_CONFIG.CURRENCY ||
            !positive(dispute.amount)
          ) {
            financialState = "unknown";
          } else if (dispute.status === "lost") loss += dispute.amount;
          else if (
            dispute.status !== "won" &&
            dispute.status !== "warning_closed" &&
            financialState !== "unknown"
          )
            financialState = "pending";
        }
      }
      if (
        loss > intent.amount_received ||
        (loss > 0 && snapshot.refundedMinor > 0)
      )
        financialState = "unknown";
      accounting.set(intentId, {
        state: financialState,
        refundedMinor: snapshot.refundedMinor,
        net:
          financialState === "resolved"
            ? intent.amount_received - snapshot.refundedMinor - loss
            : null,
      });
      verifiedIntents.set(intentId, intent);
      return intent;
    };
    const accountFor = async (customer: unknown) => {
      const customerId = id(customer);
      if (!customerId) refuse("customer_unknown");
      const accountId = await reads.account(customerId);
      if (!accountId) refuse("account_missing", "suppressed");
      return { customerId, accountId };
    };
    const normalizeInvoice = async (
      invoiceId: string,
    ): Promise<NormalizedPurchase> => {
      const invoice = await reads.invoice(invoiceId);
      if (invoice.id !== invoiceId) refuse("invoice_mismatch");
      verifyMode(invoice.livemode, live);
      verifyCurrency(invoice.currency);
      const { customerId, accountId } = await accountFor(invoice.customer);
      if (!(await reads.reconciledInvoice(invoiceId, accountId)))
        refuse("invoice_unreconciled");
      if (!positive(invoice.amount_paid))
        refuse("no_positive_collection", "suppressed");
      if (invoice.status !== "paid") refuse("partial_invoice_unknown");
      const occurredAt = invoice.status_transitions.paid_at;
      if (!positive(occurredAt)) refuse("settlement_unknown");
      if (invoice.lines.has_more || invoice.lines.data.length !== 1)
        refuse("invoice_items_unknown");
      const line = invoice.lines.data[0];
      const priceId = id(line.pricing?.price_details?.price);
      const itemId = priceId
        ? await readPaymentCatalogue(findPaidPlanIdByStripePriceId(priceId))
        : null;
      if (!itemId || !positive(line.quantity)) refuse("catalog_unknown");
      const allocations = (
        await readAllocations({ invoice: invoiceId })
      ).filter((a) => a.status === "paid");
      if (!allocations.length || allocations.length > 20)
        refuse("invoice_cash_unknown");
      let cashMinor = 0;
      const paymentIntentIds = new Set<string>();
      let netRetainedMinor: number | null = 0;
      let successfulRefundMinor: number | null = 0;
      let isNetPending = false;
      let isNetUnknown = false;
      for (const allocation of allocations) {
        verifyMode(allocation.livemode, live);
        verifyCurrency(allocation.currency);
        if (
          id(allocation.invoice) !== invoiceId ||
          !positive(allocation.amount_paid) ||
          !positive(allocation.status_transitions.paid_at) ||
          allocation.status_transitions.paid_at > occurredAt ||
          allocation.payment.type !== "payment_intent"
        )
          refuse("invoice_allocation_unknown");
        const intentId = id(allocation.payment.payment_intent);
        if (!intentId) refuse("invoice_allocation_unknown");
        const intent = await verifyIntent(intentId, customerId);
        const siblings = (await intentAllocations(intentId)).filter(
          (a) => a.status === "paid",
        );
        let allocated = 0;
        for (const sibling of siblings) {
          verifyMode(sibling.livemode, live);
          verifyCurrency(sibling.currency);
          if (
            id(sibling.payment.payment_intent) !== intentId ||
            !positive(sibling.amount_paid)
          )
            refuse("invoice_allocation_unknown");
          allocated += sibling.amount_paid;
        }
        if (
          !siblings.some(
            (a) =>
              a.id === allocation.id &&
              a.amount_paid === allocation.amount_paid &&
              id(a.invoice) === invoiceId,
          ) ||
          !Number.isSafeInteger(allocated) ||
          allocated > intent.amount_received
        )
          refuse("invoice_allocation_unknown");
        const balance = accounting.get(intentId)!;
        // Stripe supplies invoice cash allocations, not a general allocation of
        // each later refund/dispute across those invoices. Never apply the whole
        // returned principal to every invoice or guess a proportional split.
        if (
          balance.net === null ||
          (balance.net !== intent.amount_received &&
            balance.net !== 0 &&
            (siblings.length !== 1 ||
              allocation.amount_paid !== intent.amount_received))
        ) {
          netRetainedMinor = null;
          if (balance.state === "pending") isNetPending = true;
          else isNetUnknown = true;
        } else if (netRetainedMinor !== null)
          netRetainedMinor +=
            balance.net === intent.amount_received
              ? allocation.amount_paid
              : balance.net;
        if (balance.refundedMinor === intent.amount_received) {
          if (successfulRefundMinor !== null)
            successfulRefundMinor += allocation.amount_paid;
        } else if (
          balance.refundedMinor > 0 &&
          (siblings.length !== 1 ||
            allocation.amount_paid !== intent.amount_received)
        )
          successfulRefundMinor = null;
        else if (successfulRefundMinor !== null)
          successfulRefundMinor += balance.refundedMinor;
        cashMinor += allocation.amount_paid;
        paymentIntentIds.add(intentId);
      }
      if (
        !positive(cashMinor) ||
        cashMinor !== invoice.amount_paid ||
        cashMinor !== invoice.total
      )
        refuse("mixed_credit_or_partial_invoice");
      const tax =
        invoice.total_taxes?.reduce(
          (sum, t) => (nonnegative(t.amount) ? sum + t.amount : Number.NaN),
          0,
        ) ?? 0;
      const discount =
        invoice.total_discount_amounts?.reduce(
          (sum, d) => (nonnegative(d.amount) ? sum + d.amount : Number.NaN),
          0,
        ) ?? 0;
      if (
        !nonnegative(tax) ||
        !nonnegative(discount) ||
        !nonnegative(invoice.subtotal) ||
        invoice.subtotal - discount + tax !== cashMinor ||
        line.amount !== invoice.subtotal ||
        invoice.total_excluding_tax !== cashMinor - tax
      )
        refuse("invoice_totals_unknown");
      // value is collected product revenue excluding tax, not catalogue sticker
      // price and not the entire PI when it has paid more than one invoice.
      return {
        acquisitionEligible: ![...paymentIntentIds].some((id) =>
          automaticallyReturned.has(id),
        ),
        isRenewal:
          invoice.billing_reason == null
            ? undefined
            : invoice.billing_reason === "subscription_cycle",
        successfulRefundMinor,
        sourceKey: `${mode}:invoice:${invoiceId}`,
        accountId,
        mode,
        occurredAt,
        cashMinor,
        value: (cashMinor - tax) / 100,
        taxMinor: tax,
        discountMinor: discount,
        netRetainedMinor,
        financialState: isNetUnknown
          ? "unknown"
          : isNetPending
            ? "pending"
            : "resolved",
        currency: "USD",
        itemId,
        quantity: line.quantity,
        paymentIntentIds: [...paymentIntentIds],
      };
    };
    if (event.type === "invoice.payment_succeeded") {
      return {
        state: "normalized",
        purchases: [await normalizeInvoice(eventObject.id)],
      };
    }
    let intentId = eventObject.id;
    let settlementEvent: Stripe.Event = event;
    let checkoutSession: Stripe.Checkout.Session | null = null;
    if (event.type === "checkout.session.completed") {
      const session = await reads.session(eventObject.id);
      checkoutSession = session;
      verifyMode(session.livemode, live);
      if (
        session.id !== eventObject.id ||
        session.mode !== "payment" ||
        session.payment_status !== "paid"
      )
        refuse("unpaid_or_setup", "suppressed");
      const payment = id(session.payment_intent);
      if (!payment) refuse("payment_unknown");
      intentId = payment;
      const successfulEventId = await reads.successfulPaymentEvent(intentId);
      if (!successfulEventId) refuse("settlement_unknown");
      settlementEvent = await reads.event(successfulEventId);
      if (
        settlementEvent.id !== successfulEventId ||
        settlementEvent.type !== "payment_intent.succeeded" ||
        id(settlementEvent.data.object) !== intentId
      )
        refuse("settlement_unknown");
      verifyMode(settlementEvent.livemode, live);
    }
    const successfulObject = settlementEvent.data
      .object as Stripe.PaymentIntent;
    if (
      successfulObject.object !== "payment_intent" ||
      successfulObject.status !== "succeeded"
    )
      refuse("payment_snapshot_unknown");
    verifyMode(successfulObject.livemode, live);
    const { customerId, accountId } = await accountFor(
      successfulObject.customer,
    );
    const intent = await verifyIntent(intentId, customerId);
    if (
      successfulObject.amount_received !== intent.amount_received ||
      successfulObject.currency !== intent.currency ||
      id(successfulObject.customer) !== customerId
    )
      refuse("payment_snapshot_mismatch");
    if (
      checkoutSession &&
      (id(checkoutSession.customer) !== customerId ||
        (checkoutSession.client_reference_id &&
          checkoutSession.client_reference_id !== accountId))
    )
      refuse("account_mismatch");
    const allocations = await intentAllocations(intentId);
    if (allocations.length) {
      const invoiceIds = [...new Set(allocations.map((a) => id(a.invoice)))];
      if (invoiceIds.some((i) => !i) || invoiceIds.length > 20)
        refuse("invoice_allocation_unknown");
      const purchases: NormalizedPurchase[] = [];
      for (const invoiceId of invoiceIds)
        purchases.push(await normalizeInvoice(invoiceId!));
      return { state: "normalized", purchases };
    }
    if (intent.metadata.user_id !== accountId) refuse("account_mismatch");
    let reconciled = await reads.reconciledOneOff(intentId, accountId);
    // Duplicate protection deliberately did not provision a second entitlement.
    // Its verified succeeded automatic refund is correction authority only;
    // never turn this metadata fallback into acquisition evidence.
    if (
      !reconciled &&
      automaticallyReturned.has(intentId) &&
      intent.metadata.type === "lifetime_purchase" &&
      isLifetimeProductId(intent.metadata.product_id)
    )
      reconciled = { productId: intent.metadata.product_id, quantity: 1 };
    if (!reconciled || !positive(reconciled.quantity))
      refuse("product_unreconciled");
    const productId = reconciled.productId;
    let price: number;
    if (productId === "credits" && intent.metadata.type === "credit_purchase") {
      const pack = await readPaymentCatalogue(getCreditPackConfig());
      if (
        Number(intent.metadata.credit_quantity) !==
        pack.creditsPerPack * reconciled.quantity
      )
        refuse("credit_quantity_mismatch");
      price = pack.pricePerPack;
    } else if (
      isLifetimeProductId(productId) &&
      intent.metadata.type === "lifetime_purchase" &&
      intent.metadata.product_id === productId &&
      reconciled.quantity === 1
    ) {
      const product = await readPaymentCatalogue(getOneTimeProduct(productId));
      if (
        !product.grantsPlanId ||
        product.grantsPlanId !== intent.metadata.grants_plan_id
      )
        refuse("catalog_grant_mismatch");
      price = product.price;
    } else return refuse("catalog_unknown");
    if (
      !Number.isFinite(price) ||
      Math.round(price * 100) * reconciled.quantity !== intent.amount_received
    )
      refuse("one_off_totals_unknown");
    if (!positive(settlementEvent.created)) refuse("settlement_unknown");
    return {
      state: "normalized",
      purchases: [
        {
          acquisitionEligible: !automaticallyReturned.has(intentId),
          isRenewal: false,
          successfulRefundMinor: accounting.get(intentId)!.refundedMinor,
          sourceKey: `${mode}:payment_intent:${intentId}`,
          accountId,
          mode,
          occurredAt: settlementEvent.created,
          cashMinor: intent.amount_received,
          value: intent.amount_received / 100,
          taxMinor: 0,
          discountMinor: 0,
          netRetainedMinor: accounting.get(intentId)!.net,
          financialState: accounting.get(intentId)!.state,
          currency: "USD",
          itemId: productId,
          quantity: reconciled.quantity,
          paymentIntentIds: [intentId],
        },
      ],
    };
  } catch (error) {
    if (error instanceof PaymentReadBudgetExceeded)
      return { state: "pending", reason: "normalization_limit", purchases: [] };
    if (error instanceof PaymentEvidenceUnavailable)
      return { state: "unknown", reason: "event_unavailable", purchases: [] };
    if (error instanceof EvidenceFailure)
      return { state: error.state, reason: error.reason, purchases: [] };
    // Provider/DB exception messages can contain customer information or keys.
    // A retryable typed outcome is sufficient for source-receipt observability.
    return { state: "pending", reason: "provider_read_failed", purchases: [] };
  }
}
