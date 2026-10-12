/**
 * s82, Devin Review on PR #81 (finding 1): a Checkout opened before a lifetime
 * grant lands must never bill the owner for a plan the grant covers.
 *
 * Checkout refuses a covered plan from the moment the grant exists, but a
 * subscription Checkout Session opened BEFORE it stays payable: open Pro
 * Checkout, buy Lifetime Pro in another tab, then pay the old Pro session, and
 * the account is billed $19 a month for a plan it owns. The webhook only ever
 * cancelled subscriptions that were already live when the lifetime landed.
 *
 * Belt and braces (CTO decision, plan decision 17):
 *  (a) the lifetime grant expires the customer's open subscription Checkouts
 *      whose plan it covers;
 *  (b) a subscription that starts while an undated grant covers its plan is
 *      cancelled at once and what it collected refunded — whichever of its
 *      own event and the grant's event is processed first.
 *
 * The real route handler, grant reader and grant writer run against a fake
 * database that applies the queries' own filters (`eq` / `in` / `is` / `neq` /
 * `or`), so "a trial does not count" and "a dated grant does not count" are
 * proved by the production query, not by a mock answering the right thing.
 * Stripe is a mock throughout; nothing is called for real.
 */

const mockConstructEvent = jest.fn();
const mockSubscriptionRetrieve = jest.fn();
const mockSubscriptionUpdate = jest.fn();
const mockSubscriptionCancel = jest.fn();
const mockSubscriptionsList = jest.fn();
const mockSessionsList = jest.fn();
const mockSessionsExpire = jest.fn();
const mockSessionsRetrieve = jest.fn();
const mockInvoicePaymentsList = jest.fn();
const mockRefundsList = jest.fn();
const mockRefundsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockChargesRetrieve = jest.fn();
const mockInvoicesList = jest.fn();
const mockInvoicesRetrieve = jest.fn();
const mockInvoicesListLineItems = jest.fn();
const mockCustomersRetrieve = jest.fn();
const mockPricesRetrieve = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: {
      retrieve: mockSubscriptionRetrieve,
      update: mockSubscriptionUpdate,
      cancel: mockSubscriptionCancel,
      list: mockSubscriptionsList,
    },
    checkout: {
      sessions: {
        list: mockSessionsList,
        expire: mockSessionsExpire,
        retrieve: mockSessionsRetrieve,
      },
    },
    invoicePayments: { list: mockInvoicePaymentsList },
    refunds: { list: mockRefundsList, create: mockRefundsCreate },
    paymentIntents: { retrieve: mockPaymentIntentsRetrieve },
    charges: { retrieve: mockChargesRetrieve },
    invoices: {
      list: mockInvoicesList,
      retrieve: mockInvoicesRetrieve,
      listLineItems: mockInvoicesListLineItems,
    },
    customers: { retrieve: mockCustomersRetrieve },
    prices: { retrieve: mockPricesRetrieve },
  })),
);

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "sig_test" })),
}));

// The plan a subscription bills is resolved from its price. A fixture
// catalogue here; the real lookup is covered in stripe-webhook-stale-writes.
jest.mock("@/lib/stripe/plans", () => ({
  ...jest.requireActual("@/lib/stripe/plans"),
  findPaidPlanIdByStripePriceId: jest.fn(
    async (priceId: string) =>
      ({
        price_starter: "starter",
        price_pro: "pro",
        price_agency: "agency",
      })[priceId] ?? null,
  ),
  // s82 review (N1, N2): one catalogue load, failing loudly. The same fixture
  // catalogue, plus one price misconfigured for two plans.
  loadPaidPlanPriceIndex: jest.fn(async () => {
    if (mockCatalogueReadFails) {
      throw new Error("Failed to load the plan catalogue: connection reset");
    }
    const plansByPrice: Record<string, string[]> = {
      price_starter: ["starter"],
      price_pro: ["pro"],
      price_agency: ["agency"],
      price_shared: ["starter", "pro"],
    };
    return {
      priceIds: Object.keys(plansByPrice),
      plansOf: (priceId: string) => plansByPrice[priceId] ?? [],
    };
  }),
}));

/** s82 review (N1): the `plans` table cannot be read. */
let mockCatalogueReadFails = false;

// Founding Agency completes through its reservation RPC in production; here
// it answers a fresh grant, which is all the cases below need from it.
jest.mock("@/lib/billing/founding-agency", () => ({
  ...jest.requireActual("@/lib/billing/founding-agency"),
  completeFoundingAgencyPurchase: jest.fn(async () => ({
    granted: true,
    duplicate: false,
  })),
}));

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
jest.mock("@/lib/monitoring/logger", () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
  },
}));

type Row = Record<string, unknown>;

const USER_ID = "user-1";
const STRIPE_CUSTOMER_ID = "cus_1";
const SUBSCRIPTION_ID = "sub_pro";
const LIFETIME_PAYMENT_INTENT = "pi_lifetime";
const INVOICE_ID = "in_first";
const SUBSCRIPTION_PAYMENT_INTENT = "pi_sub_first";

const PERIOD_START = 1785484800; // 2026-08-01T00:00:00Z
const PERIOD_END = 1788163200; // 2026-09-01T00:00:00Z
/** When the lifetime payment was confirmed (its payment intent's `created`). */
const LIFETIME_PAID_AT = PERIOD_START - 600;

/** In-memory tables, replaced per test. */
let db: Record<string, Row[]> = {};
let grantReadFails = false;
let subscriptionReadFails = false;
/**
 * Finding 5: the durable record of a refusal of a subscription already over
 * (a `billing_events` row under this synthetic id) cannot be written / read.
 */
let terminalRefusalWriteFails = false;
let terminalRefusalReadFails = false;
const TERMINAL_REFUSAL_ID_PREFIX = "covered_by_lifetime_terminal:";

/** One arm of a PostgREST `.or()` expression, e.g. `expires_at.gt.<iso>`. */
function armPredicate(arm: string): (row: Row) => boolean {
  const [column, operator, ...rest] = arm.split(".");
  const value = rest.join(".");
  if (operator === "is" && value === "null") {
    return (row) => (row[column] ?? null) === null;
  }
  if (operator === "gt") {
    return (row) => String(row[column] ?? "") > value;
  }
  throw new Error(`Unsupported or() arm in test stub: ${arm}`);
}

const UNIQUE_COLUMNS: Record<string, string> = {
  billing_events: "stripe_event_id",
  plan_entitlements: "stripe_payment_intent_id",
};

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "upsert" | "update" = "select";
    let values: Row = {};
    let conflictColumn: string | null = null;
    let stripeEventId: unknown = null;

    const rows = (): Row[] => db[table] ?? [];
    const matched = () =>
      rows().filter((row) => predicates.every((keep) => keep(row)));

    const run = (): { data: Row[] | null; error: Row | null } => {
      if (table === "plan_entitlements" && operation === "select") {
        if (grantReadFails) {
          return { data: null, error: { message: "connection reset" } };
        }
      }
      if (table === "billing_events") {
        const id =
          operation === "insert" ? values.stripe_event_id : stripeEventId;
        const isTerminalRefusal = String(id ?? "").startsWith(
          TERMINAL_REFUSAL_ID_PREFIX,
        );
        if (
          isTerminalRefusal &&
          ((operation === "insert" && terminalRefusalWriteFails) ||
            (operation === "select" && terminalRefusalReadFails))
        ) {
          return {
            data: null,
            error: { code: "PGRST500", message: "connection reset" },
          };
        }
      }
      if (
        table === "billing_subscriptions" &&
        operation === "select" &&
        subscriptionReadFails
      ) {
        return {
          data: null,
          error: { code: "PGRST500", message: "connection reset" },
        };
      }
      switch (operation) {
        case "insert": {
          const unique = UNIQUE_COLUMNS[table];
          if (
            unique &&
            values[unique] &&
            rows().some((row) => row[unique] === values[unique])
          ) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key" },
            };
          }
          db[table] = [...rows(), { ...values }];
          return { data: [{ ...values }], error: null };
        }
        case "upsert": {
          const key = conflictColumn;
          const existing = key
            ? rows().find((row) => row[key] === values[key])
            : undefined;
          db[table] = existing
            ? rows().map((row) =>
                row === existing ? { ...row, ...values } : row,
              )
            : [...rows(), { ...values }];
          return { data: [{ ...values }], error: null };
        }
        case "update": {
          const hits = matched();
          db[table] = rows().map((row) =>
            hits.includes(row) ? { ...row, ...values } : row,
          );
          return {
            data: hits.map((row) => ({ ...row, ...values })),
            error: null,
          };
        }
        default:
          return { data: matched(), error: null };
      }
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === "stripe_event_id") stripeEventId = value;
        predicates.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, allowed: unknown[]) => {
        predicates.push((row) => allowed.includes(row[column]));
        return builder;
      },
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] !== value);
        return builder;
      },
      or: (expression: string) => {
        const arms = expression.split(",").map(armPredicate);
        predicates.push((row) => arms.some((arm) => arm(row)));
        return builder;
      },
      returns: () => builder,
      insert: (payload: Row) => {
        operation = "insert";
        values = payload;
        return builder;
      },
      upsert: (payload: Row, options?: { onConflict?: string }) => {
        operation = "upsert";
        values = payload;
        conflictColumn = options?.onConflict ?? null;
        return builder;
      },
      update: (payload: Row) => {
        operation = "update";
        values = payload;
        return builder;
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        if (!data || data.length !== 1) {
          return {
            data: null,
            error: { code: "PGRST116", message: "0 or many rows" },
          };
        }
        return { data: data[0], error: null };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return { data: data?.[0] ?? null, error: null };
      },
      then: <T>(
        resolve: (result: { data: Row[] | null; error: Row | null }) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };

  // The two checkout-intent RPCs the subscription Checkout path calls.
  const rpc = async (name: string, args: Row) => {
    if (name === "attach_subscription_checkout_session") {
      return { data: null, error: null };
    }
    if (name === "finish_subscription_checkout_intent") {
      db.checkout_pending_intents = (db.checkout_pending_intents ?? []).map(
        (row) =>
          row.id === args.p_intent_id ? { ...row, status: args.p_status } : row,
      );
      return { data: null, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  };

  return { from, rpc };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => createFakeClient()),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

function grantRow(planId: string, overrides: Row = {}): Row {
  return {
    user_id: USER_ID,
    plan_id: planId,
    source: "lifetime_purchase",
    stripe_payment_intent_id: `pi_existing_${planId}`,
    revoked_at: null,
    expires_at: null,
    ...overrides,
  };
}

/** Stripe's subscriptions, by id, as `retrieve` answers them. */
let stripeSubscriptions: Record<string, Row> = {};

function stripeSubscription(
  id: string,
  plan: "starter" | "pro" | "agency",
  overrides: Row = {},
): Row {
  return {
    id,
    object: "subscription",
    customer: STRIPE_CUSTOMER_ID,
    status: "active",
    created: PERIOD_START,
    metadata: { user_id: USER_ID, plan_id: plan },
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancellation_details: { comment: null, feedback: null, reason: null },
    trial_start: null,
    trial_end: null,
    latest_invoice: INVOICE_ID,
    items: {
      data: [
        {
          id: `si_${id}`,
          price: { id: `price_${plan}` },
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
        },
      ],
    },
    ...overrides,
  };
}

/** Refunds Stripe holds, as `refunds.list` answers them. */
let stripeRefunds: Row[] = [];

/**
 * Charge state per payment intent, over a clean default: captured in full,
 * nothing refunded, no dispute. Review MAJOR 1: support can refund, or a
 * customer dispute, a charge outside this flow.
 */
let stripeCharges: Record<string, Row> = {};

function chargeOf(paymentIntentId: string): Row {
  return {
    id: `ch_${paymentIntentId}`,
    object: "charge",
    payment_intent: paymentIntentId,
    amount: 1900,
    amount_captured: 1900,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
    ...stripeCharges[paymentIntentId],
  };
}

/**
 * What Stripe remembers per idempotency key: the request's parameters and the
 * refund it answered. A reused key with the same parameters gets the first
 * refund back, as Stripe does; with other parameters it is an error.
 */
let refundsByIdempotencyKey: Record<string, { params: string; refund: Row }> =
  {};

function armStripe() {
  mockSubscriptionRetrieve.mockImplementation(async (id: string) => {
    const found = stripeSubscriptions[id];
    if (!found) throw new Error(`No such subscription: ${id}`);
    return { ...found };
  });
  mockSubscriptionUpdate.mockImplementation(async (id: string, params: Row) => {
    // Nor update one: a cancelled subscription is over for good.
    if (stripeSubscriptions[id]?.status === "canceled") {
      throw Object.assign(
        new Error(`Subscription ${id} is canceled and cannot be updated`),
        { type: "StripeInvalidRequestError" },
      );
    }
    stripeSubscriptions[id] = {
      ...stripeSubscriptions[id],
      ...params,
      metadata: {
        ...(stripeSubscriptions[id]?.metadata as Row),
        ...(params.metadata as Row),
      },
    };
    return { ...stripeSubscriptions[id] };
  });
  mockSubscriptionCancel.mockImplementation(async (id: string, params: Row) => {
    // Stripe will not cancel a subscription that is already over.
    if (stripeSubscriptions[id]?.status === "canceled") {
      throw Object.assign(
        new Error(`Subscription ${id} has already been canceled`),
        { type: "StripeInvalidRequestError" },
      );
    }
    stripeSubscriptions[id] = {
      ...stripeSubscriptions[id],
      status: "canceled",
      canceled_at: PERIOD_START + 60,
      cancellation_details: {
        ...(stripeSubscriptions[id]?.cancellation_details as Row),
        ...(params?.cancellation_details as Row),
        reason: "cancellation_requested",
      },
    };
    return { ...stripeSubscriptions[id] };
  });
  mockInvoicePaymentsList.mockResolvedValue({
    data: [
      {
        id: "inpay_1",
        invoice: INVOICE_ID,
        status: "paid",
        amount_paid: 1900,
        payment: {
          type: "payment_intent",
          payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        },
      },
    ],
    has_more: false,
  });
  mockRefundsList.mockImplementation(async (params: Row) => ({
    data: stripeRefunds.filter(
      (refund) => refund.payment_intent === params.payment_intent,
    ),
    has_more: false,
  }));
  mockRefundsCreate.mockImplementation(
    async (params: Row, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey;
      const remembered = key ? refundsByIdempotencyKey[key] : undefined;
      if (remembered) {
        if (remembered.params !== JSON.stringify(params)) {
          throw new Error(
            `Keys for idempotent requests (${key}) can only be used with the same parameters`,
          );
        }
        return { ...remembered.refund };
      }
      const refund = {
        id: `re_${stripeRefunds.length + 1}`,
        status: "succeeded",
        payment_intent: params.payment_intent,
        metadata: params.metadata,
      };
      stripeRefunds = [...stripeRefunds, refund];
      if (key) {
        refundsByIdempotencyKey[key] = {
          params: JSON.stringify(params),
          refund,
        };
      }
      return { ...refund };
    },
  );
  mockPaymentIntentsRetrieve.mockImplementation(retrievePaymentIntent);
  mockChargesRetrieve.mockImplementation(async (id: string) => ({
    ...chargeOf(id.replace(/^ch_/, "")),
    id,
  }));
  // A subscription's paid invoices: its latest, billing its own price.
  mockInvoicesList.mockImplementation(async (params: Row) => {
    const subscription = stripeSubscriptions[String(params.subscription)];
    const invoiceId = String(subscription?.latest_invoice ?? INVOICE_ID);
    return {
      data: [invoiceFor(invoiceId, priceOf(subscription))],
      has_more: false,
    };
  });
  mockInvoicesRetrieve.mockImplementation(async (id: string) =>
    invoiceFor(
      id,
      priceOf(
        Object.values(stripeSubscriptions).find(
          (subscription) => subscription.latest_invoice === id,
        ),
      ),
    ),
  );
  mockPricesRetrieve.mockImplementation(async (id: string) => ({
    id,
    object: "price",
    product: productOf(id),
  }));
  mockCustomersRetrieve.mockImplementation(async (id: string) => ({
    id,
    object: "customer",
    balance: 0,
  }));
  mockSubscriptionsList.mockImplementation(listSubscriptions);
  mockSessionsList.mockResolvedValue({ data: [], has_more: false });
  mockSessionsExpire.mockImplementation(async (id: string) => ({
    id,
    status: "expired",
  }));
}

/**
 * `subscriptions.list` over Stripe's subscriptions: the customer, status and
 * creation-window (`created.gte`) filters applied, newest first, paged by
 * `limit` / `starting_after` (review minor 5: the bound is tested by
 * behaviour, not only by the request's arguments).
 */
async function listSubscriptions(params: Row) {
  if (params.status !== "ended") {
    throw new Error(`Unexpected subscriptions.list status: ${params.status}`);
  }
  const matches = Object.values(stripeSubscriptions)
    .filter(
      (subscription) =>
        subscription.customer === params.customer &&
        ["canceled", "incomplete_expired"].includes(
          String(subscription.status),
        ) &&
        Number(subscription.created) >=
          Number((params.created as { gte?: number } | undefined)?.gte ?? 0),
    )
    .sort(
      (a, b) =>
        Number(b.created) - Number(a.created) ||
        String(a.id).localeCompare(String(b.id)),
    );
  const start = params.starting_after
    ? matches.findIndex((row) => row.id === params.starting_after) + 1
    : 0;
  const limit = Number(params.limit ?? 10);
  return {
    data: matches
      .slice(start, start + limit)
      .map((subscription) => ({ ...subscription })),
    has_more: start + limit < matches.length,
  };
}

/** The price a subscription bills: its first item's. */
function priceOf(subscription: Row | undefined): string {
  const items = (subscription?.items as { data?: Row[] } | undefined)?.data;
  return String((items?.[0]?.price as Row | undefined)?.id ?? "price_pro");
}

/** A paid invoice whose one line bills `priceIds` (basil's `pricing` shape). */
function invoiceFor(id: string, ...priceIds: string[]): Row {
  return {
    id,
    object: "invoice",
    status: "paid",
    lines: {
      object: "list",
      data: priceIds.map((priceId, index) => invoiceLine(id, priceId, index)),
      has_more: false,
    },
  };
}

function invoiceLine(
  invoiceId: string,
  priceId: string,
  index = 0,
  amount = 1900,
): Row {
  return {
    id: `il_${invoiceId}_${index}`,
    object: "line_item",
    amount,
    pricing: {
      type: "price_details",
      price_details: { price: priceId, product: productOf(priceId) },
      unit_amount_decimal: null,
    },
  };
}

/**
 * The Stripe product of a price (Devin round on 8744bed: lines map to plans by
 * product). `price_pro_v1` is a retired Pro price: same product.
 */
function productOf(priceId: string): string {
  return (
    {
      price_starter: "prod_starter",
      price_pro: "prod_pro",
      price_pro_v1: "prod_pro",
      price_agency: "prod_agency",
      price_shared: "prod_shared",
    }[priceId] ?? `prod_of_${priceId}`
  );
}

/** `paymentIntents.retrieve`: paid at the lifetime's time, with its charge. */
async function retrievePaymentIntent(
  id: string,
  params?: { expand?: string[] },
): Promise<Row> {
  return {
    id,
    created: LIFETIME_PAID_AT,
    latest_charge: params?.expand?.includes("latest_charge")
      ? chargeOf(id)
      : `ch_${id}`,
  };
}

function subscriptionCreated(eventId: string, subscriptionId: string) {
  return {
    id: eventId,
    type: "customer.subscription.created",
    data: { object: { id: subscriptionId, customer: STRIPE_CUSTOMER_ID } },
  };
}

function lifetimePaid(eventId: string, grantsPlanId = "pro") {
  return {
    id: eventId,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: LIFETIME_PAYMENT_INTENT,
        created: LIFETIME_PAID_AT,
        customer: STRIPE_CUSTOMER_ID,
        metadata: {
          type: "lifetime_purchase",
          user_id: USER_ID,
          grants_plan_id: grantsPlanId,
          ...(grantsPlanId === "agency"
            ? {
                product_id: "lifetime_agency",
                founding_reservation_id: "reservation_1",
              }
            : { product_id: "lifetime_pro" }),
        },
      },
    },
  };
}

function storedSubscription(id: string): Row | undefined {
  return (db.billing_subscriptions ?? []).find(
    (row) => row.stripe_subscription_id === id,
  );
}

const LIVE = ["active", "trialing", "past_due"];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  grantReadFails = false;
  subscriptionReadFails = false;
  terminalRefusalWriteFails = false;
  terminalRefusalReadFails = false;
  mockCatalogueReadFails = false;
  stripeSubscriptions = {};
  stripeRefunds = [];
  stripeCharges = {};
  refundsByIdempotencyKey = {};
  db = {
    billing_customers: [
      { id: "bc_1", user_id: USER_ID, stripe_customer_id: STRIPE_CUSTOMER_ID },
    ],
    billing_events: [],
    billing_subscriptions: [],
    plan_entitlements: [],
    checkout_pending_intents: [],
    billing_invoices: [],
  };
  armStripe();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a subscription created after a lifetime grant covers its plan", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it("is cancelled at once, without proration, and its first invoice refunded in full", async () => {
    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionCancel).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ prorate: false, invoice_now: false }),
    );
    // Never "cancel at period end": that would keep the paid month running
    // for a plan already owned, and keep the charge.
    expect(mockSubscriptionUpdate).not.toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
    expect(mockInvoicePaymentsList).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: INVOICE_ID }),
    );
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    const [refundParams, refundOptions] = mockRefundsCreate.mock.calls[0];
    expect(refundParams).toMatchObject({
      payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
      metadata: {
        reason_code: "covered_by_lifetime",
        subscription_id: SUBSCRIPTION_ID,
      },
    });
    // A full refund: no amount.
    expect(refundParams).not.toHaveProperty("amount");
    expect(refundOptions).toEqual(
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("is recorded cancelled, never live, so it grants nothing", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    const row = storedSubscription(SUBSCRIPTION_ID);
    expect(row).toBeDefined();
    expect(row?.status).toBe("canceled");
    expect(LIVE).not.toContain(row?.status);
    expect(row?.canceled_at).toEqual(expect.any(String));
  });

  it("is reported to ops (Sentry) with ids only", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining(SUBSCRIPTION_ID),
      undefined,
      expect.objectContaining({ userId: USER_ID }),
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        planId: "pro",
      }),
    );
  });

  it("reaches the same refusal from a completed subscription Checkout", async () => {
    db.checkout_pending_intents = [
      { id: "intent_1", user_id: USER_ID, status: "pending" },
    ];

    const response = await deliver({
      id: "evt_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_pro",
          mode: "subscription",
          customer: STRIPE_CUSTOMER_ID,
          client_reference_id: USER_ID,
          subscription: SUBSCRIPTION_ID,
          payment_status: "paid",
          url: null,
          metadata: {
            user_id: USER_ID,
            plan_id: "pro",
            checkout_intent_id: "intent_1",
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
    // The reservation still completes: the checkout is over either way.
    expect(db.checkout_pending_intents[0].status).toBe("completed");
  });

  it("is a Founding Agency owner's Agency subscription too", async () => {
    db.plan_entitlements = [grantRow("agency")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "agency",
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });
});

describe("idempotency of the refusal", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it("does nothing more for a replayed event", async () => {
    const event = subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID);
    await deliver(event);
    const replay = await deliver(event);

    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("refunds once when a second event records the same subscription", async () => {
    // checkout.session.completed and customer.subscription.created both
    // record a Checkout subscription, each under its own event id.
    await deliver(subscriptionCreated("evt_first", SUBSCRIPTION_ID));
    const second = await deliver(
      subscriptionCreated("evt_second", SUBSCRIPTION_ID),
    );

    expect(second.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("asks Stripe to retry when the refund fails, and finishes only the refund on the retry", async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error("Stripe is down"));
    const event = subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID);

    const first = await deliver(event);
    expect(first.status).toBe(500);
    // Never billed silently: the failure is reported, not just retried.
    expect(mockLoggerError).toHaveBeenCalled();
    // Nothing recorded as live while the refusal is unfinished.
    expect(LIVE).not.toContain(storedSubscription(SUBSCRIPTION_ID)?.status);

    const retry = await deliver(event);

    expect(retry.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("asks Stripe to retry when the cancellation fails, recording nothing live", async () => {
    mockSubscriptionCancel.mockRejectedValueOnce(new Error("Stripe is down"));

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(storedSubscription(SUBSCRIPTION_ID)).toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it("fails closed when grants cannot be read: retried, nothing recorded", async () => {
    grantReadFails = true;

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(storedSubscription(SUBSCRIPTION_ID)).toBeUndefined();
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
  });
});

describe("a subscription no undated grant covers is recorded as before", () => {
  function expectRecordedLive() {
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("active");
  }

  it("an Agency subscription beside Lifetime Pro stays", async () => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "agency",
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expectRecordedLive();
  });

  it("a dated grant on the same plan does not trigger it", async () => {
    db.plan_entitlements = [
      grantRow("pro", {
        source: "qa_recovery_20260919",
        stripe_payment_intent_id: null,
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }),
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expectRecordedLive();
  });

  it("a trial on the same plan does not trigger it", async () => {
    db.plan_entitlements = [
      grantRow("pro", { source: "trial", stripe_payment_intent_id: null }),
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expectRecordedLive();
  });

  it("a revoked grant does not trigger it", async () => {
    db.plan_entitlements = [
      grantRow("pro", { revoked_at: "2026-07-01T00:00:00.000Z" }),
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expectRecordedLive();
  });

  it("another account's grant does not trigger it", async () => {
    db.plan_entitlements = [grantRow("pro", { user_id: "user-2" })];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expectRecordedLive();
  });

  it("a subscription the lifetime purchase already set to end is left to end", async () => {
    // It predates the grant: stopBillingForLifetimeOwner set it to cancel at
    // period end, the period it was paid for.
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        cancel_at_period_end: true,
        cancel_at: PERIOD_END,
        metadata: {
          user_id: USER_ID,
          plan_id: "pro",
          cancelled_reason: "lifetime_purchase",
        },
      },
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

describe("a subscription recorded before the grant's own event lands", () => {
  beforeEach(() => {
    db.billing_subscriptions = [
      {
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan: "pro",
        status: "active",
      },
    ];
  });

  it("is refused when Stripe created it after the lifetime was paid", async () => {
    // Opened before the lifetime purchase, paid after it: Stripe ordered the
    // events the other way round, so the subscription is already live here.
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 120 },
    );

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ prorate: false }),
    );
    expect(mockSubscriptionUpdate).not.toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining(SUBSCRIPTION_ID),
      undefined,
      expect.objectContaining({ userId: USER_ID }),
      expect.objectContaining({ subscriptionId: SUBSCRIPTION_ID }),
    );
  });

  it("keeps the existing cancel-at-period-end for a subscription that predates the purchase", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT - 86400 },
    );

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("leaves an Agency subscription beside a Lifetime Pro purchase alone", async () => {
    db.billing_subscriptions = [
      { ...db.billing_subscriptions[0], plan: "agency" },
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "agency",
      { created: LIFETIME_PAID_AT + 120 },
    );

    await deliver(lifetimePaid("evt_lifetime"));

    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("keeps the grant and reports it when the refusal fails", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 120 },
    );
    mockSubscriptionCancel.mockRejectedValueOnce(new Error("Stripe is down"));

    const response = await deliver(lifetimePaid("evt_lifetime"));

    // The $199 is captured and the grant written: a retry would never reach
    // this again (the grant short-circuits on its duplicate), so the failure
    // goes to ops instead of back to Stripe.
    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(1);
    // s82 review m-4: the actionable sentence is the alert; the error rides
    // in its metadata (`cause`), so Sentry titles the event with the sentence.
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining(SUBSCRIPTION_ID),
      undefined,
      expect.objectContaining({ userId: USER_ID }),
      expect.objectContaining({
        cause: expect.objectContaining({ message: "Stripe is down" }),
      }),
    );
  });
});

describe("a lifetime grant closes the subscription Checkouts it covers", () => {
  function openSession(id: string, overrides: Row = {}): Row {
    return {
      id,
      object: "checkout.session",
      mode: "subscription",
      status: "open",
      customer: STRIPE_CUSTOMER_ID,
      client_reference_id: USER_ID,
      metadata: { user_id: USER_ID, plan_id: "pro" },
      ...overrides,
    };
  }

  it("expires an open Pro subscription Checkout when Lifetime Pro lands", async () => {
    mockSessionsList.mockResolvedValue({
      data: [openSession("cs_pro")],
      has_more: false,
    });

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockSessionsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: STRIPE_CUSTOMER_ID, status: "open" }),
    );
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_pro");
  });

  it("expires a lower plan's Checkout, and leaves a higher plan's and one-off payments open", async () => {
    mockSessionsList.mockResolvedValue({
      data: [
        openSession("cs_starter", {
          metadata: { user_id: USER_ID, plan_id: "starter" },
        }),
        openSession("cs_agency", {
          metadata: { user_id: USER_ID, plan_id: "agency" },
        }),
        // A one-off payment is never expired, whatever plan its metadata
        // names: only a subscription Checkout can start monthly billing.
        openSession("cs_one_off", {
          mode: "payment",
          metadata: { user_id: USER_ID, plan_id: "pro" },
        }),
      ],
      has_more: false,
    });

    await deliver(lifetimePaid("evt_lifetime"));

    expect(mockSessionsExpire).toHaveBeenCalledTimes(1);
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_starter");
  });

  it("expires every covered Checkout of a Founding Agency owner", async () => {
    mockSessionsList.mockResolvedValue({
      data: [
        openSession("cs_pro"),
        openSession("cs_agency", {
          metadata: { user_id: USER_ID, plan_id: "agency" },
        }),
      ],
      has_more: false,
    });

    await deliver(lifetimePaid("evt_lifetime", "agency"));

    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_pro");
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_agency");
  });

  it("reads every page of open sessions", async () => {
    mockSessionsList
      .mockResolvedValueOnce({
        data: [openSession("cs_page_1")],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [openSession("cs_page_2")],
        has_more: false,
      });

    await deliver(lifetimePaid("evt_lifetime"));

    expect(mockSessionsList).toHaveBeenLastCalledWith(
      expect.objectContaining({ starting_after: "cs_page_1" }),
    );
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_page_1");
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_page_2");
  });

  it("reports an incomplete Checkout scan when Stripe says an empty page has more", async () => {
    mockSessionsList.mockResolvedValue({ data: [], has_more: true });

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(1);
    expect(mockSessionsList).toHaveBeenCalledTimes(1);
    const [alert] = alertsSaying("could not be read");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "expire_covered_checkout",
        cause: expect.objectContaining({
          message: expect.stringContaining("did not advance its cursor"),
        }),
      }),
    );
  });

  it("reports an incomplete Checkout scan when pagination repeats a cursor", async () => {
    let listCalls = 0;
    mockSessionsList.mockImplementation(async () => {
      listCalls += 1;
      if (listCalls > 2) throw new Error("test pagination loop guard");
      return {
        data: [
          openSession("cs_same", {
            metadata: { user_id: USER_ID, plan_id: "agency" },
          }),
        ],
        has_more: true,
      };
    });

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(1);
    expect(mockSessionsList).toHaveBeenCalledTimes(2);
    const [alert] = alertsSaying("could not be read");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "expire_covered_checkout",
        cause: expect.objectContaining({
          message: expect.stringContaining("did not advance its cursor"),
        }),
      }),
    );
  });

  it("keeps the grant and reports it when a session cannot be expired", async () => {
    mockSessionsList.mockResolvedValue({
      data: [openSession("cs_pro")],
      has_more: false,
    });
    mockSessionsExpire.mockRejectedValue(new Error("Stripe is down"));
    // The race-safe helper re-reads the session: still open, so it failed.
    mockSessionsRetrieve.mockResolvedValue({ id: "cs_pro", status: "open" });

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(1);
    // s82 review m-4: the sentence is the alert, the error its `cause`.
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining("cs_pro"),
      undefined,
      expect.objectContaining({ userId: USER_ID }),
      expect.objectContaining({
        cause: expect.objectContaining({ message: "Stripe is down" }),
      }),
    );
  });

  it("does not run again for a redelivered grant", async () => {
    mockSessionsList.mockResolvedValue({
      data: [openSession("cs_pro")],
      has_more: false,
    });

    await deliver(lifetimePaid("evt_lifetime"));
    await deliver(lifetimePaid("evt_lifetime_again"));

    expect(mockSessionsExpire).toHaveBeenCalledTimes(1);
  });
});

/*
 * s82 review of 6cac2ea (M-2 and m-1 … m-6): every guard that moves money is
 * pinned by a case that goes red when the guard is neutralised.
 */

/** The refund key the refusal sends for the subscription's first payment. */
const REFUND_KEY = `covered_by_lifetime-refund-${SUBSCRIPTION_ID}-${SUBSCRIPTION_PAYMENT_INTENT}`;

/** Sentry reports of a refusal (one per refused subscription). */
function refusalReports() {
  return mockLoggerError.mock.calls.filter(([message]) =>
    String(message).includes("was bought while a lifetime grant"),
  );
}

/** Warnings that an invoice needs a person (Devin round on 8744bed). */
function manualReviewWarnings() {
  return mockLoggerWarn.mock.calls.filter(([message]) =>
    String(message).includes("refund the covered lines by hand"),
  );
}

/** Alerts whose sentence contains `text`. */
function alertsSaying(text: string) {
  return mockLoggerError.mock.calls.filter(([message]) =>
    String(message).includes(text),
  );
}

function subscriptionCheckoutCompleted(eventId: string) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_pro",
        mode: "subscription",
        customer: STRIPE_CUSTOMER_ID,
        client_reference_id: USER_ID,
        subscription: SUBSCRIPTION_ID,
        payment_status: "paid",
        url: null,
        metadata: {
          user_id: USER_ID,
          plan_id: "pro",
          checkout_intent_id: "intent_1",
        },
      },
    },
  };
}

/**
 * An `invoice.payment_succeeded` event. `basil` is the shape of the API
 * version the SDK is pinned to (2025-07-30.basil): the subscription sits under
 * `parent.subscription_details`. `legacy` is an endpoint still set to an older
 * version, which carries it at the top level.
 */
function invoicePaid(
  eventId: string,
  shape: "basil" | "basil-expanded" | "legacy" = "basil",
  invoiceId = INVOICE_ID,
) {
  return {
    id: eventId,
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        customer: STRIPE_CUSTOMER_ID,
        ...(shape !== "legacy"
          ? {
              parent: {
                type: "subscription_details",
                quote_details: null,
                subscription_details: {
                  subscription:
                    shape === "basil-expanded"
                      ? { id: SUBSCRIPTION_ID }
                      : SUBSCRIPTION_ID,
                  metadata: {},
                },
              },
            }
          : { subscription: SUBSCRIPTION_ID }),
        amount_paid: 1900,
        amount_due: 1900,
        currency: "usd",
        status: "paid",
        hosted_invoice_url: null,
        invoice_pdf: null,
      },
    },
  };
}

function invoicePayment(
  id: string,
  status: string,
  paymentIntent: string,
): Row {
  return {
    id,
    invoice: INVOICE_ID,
    status,
    payment: { type: "payment_intent", payment_intent: paymentIntent },
  };
}

/** Deliver several events at once, each to its own request. */
async function deliverTogether(
  ...events: unknown[]
): Promise<WebhookResponse[]> {
  mockConstructEvent.mockImplementation((body: string) => JSON.parse(body));
  return Promise.all(
    events.map(
      (event) =>
        POST({
          text: async () => JSON.stringify(event),
        } as never) as unknown as Promise<WebhookResponse>,
    ),
  );
}

/**
 * Hold the first `count` calls until all of them have arrived, then let them
 * through together: two deliveries racing past the same check. A call whose
 * partner never arrives (its delivery failed earlier) is released after a
 * moment, so a broken race fails its assertions instead of hanging.
 */
function heldTogether<A extends unknown[], R>(
  count: number,
  next: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const waiting: Array<() => void> = [];
  let arrived = 0;
  return async (...args: A) => {
    if (arrived < count) {
      arrived += 1;
      await new Promise<void>((release) => {
        waiting.push(release);
        if (waiting.length === count) {
          waiting.forEach((go) => go());
        } else {
          setTimeout(release, 250);
        }
      });
    }
    return next(...args);
  };
}

describe("M-2: the refusal's money guards, recorded after the grant", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it("M21: refunds a covered subscription bought after the grant even if the customer already cancelled it", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        canceled_at: PERIOD_START + 30,
        latest_invoice: {
          id: INVOICE_ID,
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: SUBSCRIPTION_ID },
          },
        },
        cancellation_details: {
          comment: "Cancelled by the customer",
          feedback: "too_expensive",
          reason: "cancellation_requested",
        },
      },
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      }),
      { idempotencyKey: REFUND_KEY },
    );
    expect(mockRefundsCreate.mock.calls[0][0]).not.toHaveProperty("amount");
    expect(stripeSubscriptions[SUBSCRIPTION_ID].cancellation_details).toEqual({
      comment: "Cancelled by the customer",
      feedback: "too_expensive",
      reason: "cancellation_requested",
    });
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining("subscription is canceled"),
      undefined,
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("does not refund or update an already-terminal subscription bought before the grant", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { status: "canceled", created: LIFETIME_PAID_AT - 60 },
    );

    const response = await deliver(
      subscriptionCreated("evt_terminal_before_grant", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("refunds an already-terminal subscription once across replay and a new event after Stripe's idempotency key expires", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        metadata: { user_id: USER_ID, cancelled_reason: "customer_requested" },
        cancellation_details: {
          comment: "Cancelled by the customer",
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );
    const original = JSON.parse(
      JSON.stringify(stripeSubscriptions[SUBSCRIPTION_ID]),
    );
    const event = subscriptionCreated("evt_terminal_replay", SUBSCRIPTION_ID);

    expect((await deliver(event)).status).toBe(200);
    expect(await (await deliver(event)).json()).toEqual({
      received: true,
      duplicate: true,
    });
    refundsByIdempotencyKey = {};
    expect(
      (
        await deliver(
          subscriptionCreated("evt_terminal_resend", SUBSCRIPTION_ID),
        )
      ).status,
    ).toBe(200);

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
    expect(mockInvoicePaymentsList).toHaveBeenCalledTimes(2);
    expect(mockRefundsList).toHaveBeenCalledTimes(2);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(stripeSubscriptions[SUBSCRIPTION_ID]).toEqual(original);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("checks an incomplete_expired subscription's invoice but refunds nothing when it collected nothing", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { status: "incomplete_expired" },
    );
    mockInvoicePaymentsList.mockResolvedValue({
      data: [{ id: "inpay_uncollected", status: "canceled", amount_paid: 0 }],
      has_more: false,
    });

    const response = await deliver(
      subscriptionCreated("evt_terminal_expired", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockInvoicePaymentsList).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: INVOICE_ID }),
    );
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe(
      "incomplete_expired",
    );
  });

  it("M01: refunds under a key derived from the subscription and the payment", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: REFUND_KEY,
    });
  });

  it("M01/m-6: two deliveries refusing the same subscription at once refund once, report once, and raise no false alarm", async () => {
    db.checkout_pending_intents = [
      { id: "intent_1", user_id: USER_ID, status: "pending" },
    ];
    // Both deliveries read the subscription live, and both look for an
    // earlier refund before either has made one.
    const retrieve = mockSubscriptionRetrieve.getMockImplementation();
    const listRefunds = mockRefundsList.getMockImplementation();
    if (!retrieve || !listRefunds) throw new Error("Stripe fake not armed");
    mockSubscriptionRetrieve.mockImplementation(heldTogether(2, retrieve));
    mockRefundsList.mockImplementation(heldTogether(2, listRefunds));

    const responses = await deliverTogether(
      subscriptionCheckoutCompleted("evt_checkout_completed"),
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    // The race was real: both missed the metadata lookup.
    expect(mockRefundsList).toHaveBeenCalledTimes(2);
    // One refund, because both asked under the same key.
    expect(stripeRefunds).toHaveLength(1);
    expect(
      mockRefundsCreate.mock.calls.map(
        ([, options]) => options?.idempotencyKey,
      ),
    ).toEqual([REFUND_KEY, REFUND_KEY]);
    expect(refusalReports()).toHaveLength(1);
    expect(alertsSaying("could not be")).toEqual([]);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("M17: refunds again after an earlier refund of the same payment failed", async () => {
    stripeRefunds = [
      {
        id: "re_failed",
        status: "failed",
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      },
    ];

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: `${REFUND_KEY}-after-re_failed`,
    });
    expect(
      stripeRefunds.filter((refund) => refund.status === "succeeded"),
    ).toHaveLength(1);
  });

  it("M13/M14: refunds only the paid payment, reports the one in flight, ignores the cancelled one", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [
        invoicePayment("inpay_paid", "paid", SUBSCRIPTION_PAYMENT_INTENT),
        invoicePayment("inpay_open", "open", "pi_debit_pending"),
        invoicePayment("inpay_canceled", "canceled", "pi_declined"),
      ],
      has_more: false,
    });

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
    });
    expect(mockRefundsList).not.toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_debit_pending" }),
    );
    expect(mockRefundsList).not.toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_declined" }),
    );
    const [report] = refusalReports();
    expect(report[0]).toContain(
      "1 payment(s) on its invoice are still processing",
    );
    expect(report[3]).toEqual(
      expect.objectContaining({
        refundIds: ["re_1"],
        pendingPaymentIds: ["inpay_open"],
      }),
    );
  });

  it("M03: refuses a lower plan — Starter beside Lifetime Pro", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "starter",
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("M06: refuses a subscription created in the same second the lifetime was paid", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT },
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("m-3: alerts 'refund it by hand' when the cancellation went through and the refund did not", async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error("Stripe is down"));

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[0]).toContain("was cancelled");
    expect(alert[0]).toContain("refund it by hand");
    expect(alertsSaying("could not be cancelled")).toEqual([]);
    // m-4: the sentence is the event; the error rides in the metadata.
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        cause: expect.objectContaining({ message: "Stripe is down" }),
      }),
    );
  });

  it("m-6: reports the refusal once when a second event records the same subscription", async () => {
    await deliver(subscriptionCreated("evt_first", SUBSCRIPTION_ID));
    await deliver(subscriptionCreated("evt_second", SUBSCRIPTION_ID));

    expect(refusalReports()).toHaveLength(1);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});

describe("m-1: recorded after the grant, one rule with the other ordering", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
  });

  it("sets a subscription bought before the lifetime was paid to end at period end, never cancelled now or refunded", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT - 86400 },
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created_late", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
      cancel_at_period_end: true,
      metadata: {
        cancelled_reason: "lifetime_purchase",
        paymentIntentId: "pi_existing_pro",
      },
    });
    // It runs out the period it paid for.
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("active");
  });

  it("dates a support comp from when it was granted", async () => {
    db.plan_entitlements = [
      grantRow("pro", {
        source: "comp",
        stripe_payment_intent_id: null,
        granted_at: new Date(LIFETIME_PAID_AT * 1000).toISOString(),
      }),
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT - 60 },
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
      cancel_at_period_end: true,
      metadata: { cancelled_reason: "lifetime_purchase" },
    });
  });

  it("refuses a subscription bought after a support comp was granted", async () => {
    db.plan_entitlements = [
      grantRow("pro", {
        source: "comp",
        stripe_payment_intent_id: null,
        granted_at: new Date(LIFETIME_PAID_AT * 1000).toISOString(),
      }),
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 60 },
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("asks Stripe to retry, and alerts in words, when the period-end cancellation fails", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT - 86400 },
    );
    mockSubscriptionUpdate.mockRejectedValueOnce(new Error("Stripe is down"));

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    const [alert] = alertsSaying("set it to cancel at period end by hand");
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({ message: "Stripe is down" }),
      }),
    );
  });
});

describe("M-2 and m-3: recorded before the grant's own event", () => {
  function liveRow(plan: string) {
    db.billing_subscriptions = [
      {
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan,
        status: "active",
      },
    ];
  }

  it("M08: refuses a lower plan bought after the lifetime — Starter beside Lifetime Pro", async () => {
    liveRow("starter");
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "starter",
      { created: LIFETIME_PAID_AT + 120 },
    );

    await deliver(lifetimePaid("evt_lifetime"));

    expect(mockSubscriptionCancel).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ prorate: false }),
    );
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("M06: refuses a subscription created in the same second the lifetime was paid", async () => {
    liveRow("pro");
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT },
    );

    await deliver(lifetimePaid("evt_lifetime"));

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("m-3: cancelled but not refunded → 'refund it by hand', and no period-end update of a cancelled subscription", async () => {
    liveRow("pro");
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 120 },
    );
    mockRefundsCreate.mockRejectedValueOnce(new Error("Stripe is down"));

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [alert] = alertsSaying("refund it by hand");
    expect(alert[0]).toContain(
      "was cancelled, but its payment could not be refunded",
    );
    expect(alertsSaying("could not be cancelled")).toEqual([]);
    expect(alertsSaying("Cancel it by hand")).toEqual([]);
    // m-4: the sentence is the event; the error rides in the metadata.
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        cause: expect.objectContaining({ message: "Stripe is down" }),
      }),
    );
  });

  it("m-3 / finding 6: refunds, never cancels or updates, a subscription bought after the lifetime that Stripe already ended", async () => {
    liveRow("pro");
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        created: LIFETIME_PAID_AT + 120,
        status: "canceled",
        canceled_at: LIFETIME_PAID_AT + 300,
        cancellation_details: {
          comment: null,
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    // The refusal report, and no false alarm.
    expect(refusalReports()).toHaveLength(1);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});

describe("m-2: a refused subscription's payment that settles later", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it("is reported as refunded when it settles, then refunded in full when its invoice is paid", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [report] = refusalReports();
    expect(report[0]).toContain("refunded when it settles");

    // The bank debit settles days later.
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });
    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mockRefundsCreate.mock.calls[0];
    expect(params).toEqual({
      payment_intent: "pi_debit",
      metadata: {
        reason_code: "covered_by_lifetime",
        subscription_id: SUBSCRIPTION_ID,
      },
    });
    expect(options).toEqual({
      idempotencyKey: `covered_by_lifetime-refund-${SUBSCRIPTION_ID}-pi_debit`,
    });
    // The invoice is still recorded.
    expect(db.billing_invoices).toEqual([
      expect.objectContaining({ stripe_invoice_id: INVOICE_ID }),
    ]);
  });

  it("MA-1: refunds it from an endpoint on an older API version too (top-level subscription)", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });

    const response = await deliver(invoicePaid("evt_invoice_paid", "legacy"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_debit",
    });
  });

  it("refunds it when basil expands the invoice's subscription reference", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });

    const response = await deliver(
      invoicePaid("evt_invoice_paid", "basil-expanded"),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionRetrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("refunds nothing twice: a payment the refusal already refunded is found", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    await deliver(invoicePaid("evt_invoice_paid"));

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
  });

  it.each(["pending", "requires_action"])(
    "describes a late %s refund as created or found, never refunded in full",
    async (status) => {
      mockInvoicePaymentsList.mockResolvedValue({
        data: [invoicePayment("inpay_debit", "open", "pi_debit")],
        has_more: false,
      });
      await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
      stripeRefunds = [
        {
          id: `re_${status}`,
          status,
          payment_intent: "pi_debit",
          metadata: {
            reason_code: "covered_by_lifetime",
            subscription_id: SUBSCRIPTION_ID,
          },
        },
      ];
      mockInvoicePaymentsList.mockResolvedValue({
        data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
        has_more: false,
      });

      const response = await deliver(invoicePaid("evt_invoice_paid"));

      expect(response.status).toBe(200);
      const info = mockLoggerInfo.mock.calls.find(([message]) =>
        String(message).includes(`Invoice ${INVOICE_ID}`),
      );
      expect(info?.[0]).toContain("1 refund(s) created or found");
      expect(info?.[0]).not.toContain("refunded in full");
    },
  );

  it("asks Stripe to retry, and alerts in words, when the late refund fails", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });
    mockRefundsCreate.mockRejectedValueOnce(new Error("Stripe is down"));

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(500);
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[0]).toContain(INVOICE_ID);
    expect(alert[0]).toContain("refund it by hand");
    expect(alert[1]).toBeUndefined();
  });

  it("asks Stripe to retry, and alerts in words, when the refused-subscription row cannot be read", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });
    subscriptionReadFails = true;

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be read");
    expect(alert[0]).toContain(INVOICE_ID);
    expect(alert[0]).toContain(SUBSCRIPTION_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "read_subscription_for_late_refund",
        subscriptionId: SUBSCRIPTION_ID,
        invoiceId: INVOICE_ID,
        cause: expect.objectContaining({ message: "connection reset" }),
      }),
    );
  });

  it("refunds after Stripe refused the subscription even when the local row is stale-active", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    db.billing_subscriptions = db.billing_subscriptions.map((row) => ({
      ...row,
      status: "active",
    }));
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionRetrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_debit",
    });
  });

  it("refunds after Stripe refused the subscription even when its local row has not landed", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    db.billing_subscriptions = [];
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionRetrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("checks Stripe's refusal marker but never refunds an uncovered subscription with no local row", async () => {
    db.billing_subscriptions = [];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionRetrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the invoice and Stripe subscription name different customers", async () => {
    db.billing_subscriptions = [];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        customer: "cus_other",
        status: "canceled",
        cancellation_details: {
          comment: "covered_by_lifetime",
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(500);
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        invoiceId: INVOICE_ID,
        cause: expect.objectContaining({
          message: expect.stringContaining("customer does not match"),
        }),
      }),
    );
  });

  it("never refunds an invoice of a subscription that ended for another reason", async () => {
    db.billing_subscriptions = [
      {
        id: "row_1",
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan: "pro",
        status: "canceled",
      },
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        cancellation_details: {
          comment: null,
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("checks Stripe's refusal marker and never refunds a live subscription's invoice", async () => {
    db.billing_subscriptions = [
      {
        id: "row_1",
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan: "pro",
        status: "active",
      },
    ];

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionRetrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

/*
 * s82, Devin Review on PR #81 (finding 5): a covered subscription the customer
 * cancelled before its webhook ran is refused without a cancellation of ours,
 * so Stripe carries no `covered_by_lifetime` marker on it. A payment still in
 * flight at that refusal must still be refunded when it settles.
 */
describe("finding 5: a refused subscription already cancelled by the customer, whose payment settles later", () => {
  const CUSTOMER_REASON = {
    comment: "Cancelled by the customer",
    feedback: null,
    reason: "cancellation_requested",
  };

  function cancelledByCustomer(
    plan: "pro" | "agency" = "pro",
    overrides: Row = {},
  ): Row {
    return stripeSubscription(SUBSCRIPTION_ID, plan, {
      status: "canceled",
      canceled_at: PERIOD_START + 30,
      cancellation_details: CUSTOMER_REASON,
      ...overrides,
    });
  }

  function paymentInFlight() {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
  }

  function paymentSettles() {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });
  }

  const DEBIT_REFUND_KEY = `covered_by_lifetime-refund-${SUBSCRIPTION_ID}-pi_debit`;

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = cancelledByCustomer();
    paymentInFlight();
  });

  it("(a) refunds a subscription bought after the grant exactly once when its payment settles", async () => {
    const refused = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(refused.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [report] = refusalReports();
    expect(report[0]).toContain("refunded when it settles");

    // The bank debit settles days later.
    paymentSettles();
    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: "pi_debit",
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      },
      { idempotencyKey: DEBIT_REFUND_KEY },
    );
    // Nothing of the customer's own cancellation is touched.
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(stripeSubscriptions[SUBSCRIPTION_ID].cancellation_details).toEqual(
      CUSTOMER_REASON,
    );
  });

  it("(b) refunds it once across a replayed settlement, a new one after Stripe's idempotency key expires, and a resent refusal", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    paymentSettles();
    const settled = invoicePaid("evt_invoice_paid");

    expect((await deliver(settled)).status).toBe(200);
    expect(await (await deliver(settled)).json()).toEqual({
      received: true,
      duplicate: true,
    });
    refundsByIdempotencyKey = {};
    expect((await deliver(invoicePaid("evt_invoice_paid_resend"))).status).toBe(
      200,
    );
    // The settlement alone made the refund, once.
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);

    expect(
      (await deliver(subscriptionCreated("evt_sub_resend", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
  });

  it("(c) never refunds a cancelled subscription bought before the grant when its payment settles", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = cancelledByCustomer("pro", {
      created: LIFETIME_PAID_AT - 60,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);
    paymentSettles();
    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["an Agency subscription beside Lifetime Pro", "agency", [grantRow("pro")]],
    ["a subscription on an account with no lifetime grant", "pro", []],
  ] as const)(
    "(d) never refunds %s, cancelled by the customer, when its payment settles",
    async (_case, plan, grants) => {
      db.plan_entitlements = [...grants];
      stripeSubscriptions[SUBSCRIPTION_ID] = cancelledByCustomer(plan);

      expect(
        (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
          .status,
      ).toBe(200);
      paymentSettles();
      const response = await deliver(invoicePaid("evt_invoice_paid"));

      expect(response.status).toBe(200);
      expect(mockRefundsList).not.toHaveBeenCalled();
      expect(mockRefundsCreate).not.toHaveBeenCalled();
    },
  );

  it("(e) still refunds a subscription the refusal cancelled itself from Stripe's marker alone, without reading any local record", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    expect(
      stripeSubscriptions[SUBSCRIPTION_ID].cancellation_details,
    ).toMatchObject({ comment: "covered_by_lifetime" });
    expect(
      db.billing_events.some((row) =>
        String(row.stripe_event_id).startsWith(TERMINAL_REFUSAL_ID_PREFIX),
      ),
    ).toBe(false);

    terminalRefusalReadFails = true;
    paymentSettles();
    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: DEBIT_REFUND_KEY,
    });
  });

  it("refunds once a payment that settles while the refusal is scanning its invoice", async () => {
    const settlements: WebhookResponse[] = [];
    mockInvoicePaymentsList.mockImplementationOnce(async () => {
      // The refusal reads the payment in flight; it settles at once, and its
      // event is processed before the refusal goes on.
      paymentSettles();
      settlements.push(await deliver(invoicePaid("evt_invoice_paid")));
      return {
        data: [invoicePayment("inpay_debit", "open", "pi_debit")],
        has_more: false,
      };
    });

    const refused = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(refused.status).toBe(200);
    expect(settlements.map((settled) => settled.status)).toEqual([200]);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
  });

  it("asks Stripe to retry, alerts in words, and scans nothing when the refusal cannot be recorded", async () => {
    terminalRefusalWriteFails = true;
    const event = subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID);

    const response = await deliver(event);

    expect(response.status).toBe(500);
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(storedSubscription(SUBSCRIPTION_ID)).toBeUndefined();
    const [alert] = alertsSaying("could not be recorded");
    expect(alert[0]).toContain(SUBSCRIPTION_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[0]).toContain("refund it by hand");
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "record_terminal_refusal",
        subscriptionId: SUBSCRIPTION_ID,
        cause: expect.objectContaining({
          message: expect.stringContaining("connection reset"),
        }),
      }),
    );

    // Stripe's redelivery records it; the payment's settlement is refunded.
    terminalRefusalWriteFails = false;
    expect((await deliver(event)).status).toBe(200);
    paymentSettles();
    expect((await deliver(invoicePaid("evt_invoice_paid"))).status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("asks Stripe to retry, and alerts in words, when the refusal record cannot be read at settlement", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    paymentSettles();
    terminalRefusalReadFails = true;
    const settled = invoicePaid("evt_invoice_paid");

    const response = await deliver(settled);

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[0]).toContain(INVOICE_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "refund_covered_invoice",
        subscriptionId: SUBSCRIPTION_ID,
        invoiceId: INVOICE_ID,
        cause: expect.objectContaining({
          message: expect.stringContaining("connection reset"),
        }),
      }),
    );

    terminalRefusalReadFails = false;
    expect((await deliver(settled)).status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("never makes a live subscription's renewal depend on the refusal record", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "agency",
    );
    terminalRefusalReadFails = true;
    paymentSettles();

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

/*
 * s82, finding 6 (implementer-found, opposite ordering): the lifetime's event
 * is processed AFTER the subscription's, and the customer had already ended
 * the subscription. `stopBillingForLifetimeOwner` reads live rows only and
 * skips a subscription Stripe says is over, so one bought after the lifetime
 * was neither refunded nor recorded: what it collected, and any payment still
 * in flight, stayed charged.
 */
describe("finding 6: a covered subscription the customer ended before the lifetime's event lands", () => {
  const CUSTOMER_REASON = {
    comment: "Cancelled by the customer",
    feedback: null,
    reason: "cancellation_requested",
  };

  function endedByCustomer(
    overrides: Row = {},
    plan: "pro" | "agency" = "pro",
  ): Row {
    return stripeSubscription(SUBSCRIPTION_ID, plan, {
      status: "canceled",
      created: LIFETIME_PAID_AT + 120,
      canceled_at: LIFETIME_PAID_AT + 300,
      cancellation_details: CUSTOMER_REASON,
      ...overrides,
    });
  }

  function recordedRow(status: string, plan = "pro"): Row {
    return {
      user_id: USER_ID,
      customer_id: "bc_1",
      stripe_subscription_id: SUBSCRIPTION_ID,
      plan,
      status,
    };
  }

  function terminalRefusalRecords(): Row[] {
    return db.billing_events.filter((row) =>
      String(row.stripe_event_id).startsWith(TERMINAL_REFUSAL_ID_PREFIX),
    );
  }

  beforeEach(() => {
    // Recorded by its own event before the grant existed, then ended by the
    // customer; its deletion has been processed.
    db.billing_subscriptions = [recordedRow("canceled")];
    stripeSubscriptions[SUBSCRIPTION_ID] = endedByCustomer();
  });

  it.each(["canceled", "active"])(
    "(a) refunds a subscription bought after the lifetime once and records the refusal, never cancelling or updating it (local row %s)",
    async (localStatus) => {
      db.billing_subscriptions = [recordedRow(localStatus)];

      const response = await deliver(lifetimePaid("evt_lifetime"));

      expect(response.status).toBe(200);
      expect(db.plan_entitlements).toHaveLength(1);
      expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
      expect(mockRefundsCreate).toHaveBeenCalledWith(
        {
          payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
          metadata: {
            reason_code: "covered_by_lifetime",
            subscription_id: SUBSCRIPTION_ID,
          },
        },
        { idempotencyKey: REFUND_KEY },
      );
      expect(terminalRefusalRecords()).toEqual([
        expect.objectContaining({
          user_id: USER_ID,
          event_type: "internal.terminal_subscription_refused",
          data: expect.objectContaining({
            subscription_id: SUBSCRIPTION_ID,
            plan_id: "pro",
          }),
        }),
      ]);
      expect(mockSubscriptionCancel).not.toHaveBeenCalled();
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
      expect(stripeSubscriptions[SUBSCRIPTION_ID].cancellation_details).toEqual(
        CUSTOMER_REASON,
      );
      expect(refusalReports()).toHaveLength(1);
    },
  );

  it("(b) refunds a payment in flight at the lifetime's event once, when it settles", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(refusalReports()[0][0]).toContain("refunded when it settles");
    expect(terminalRefusalRecords()).toHaveLength(1);

    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });
    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_debit" }),
      {
        idempotencyKey: `covered_by_lifetime-refund-${SUBSCRIPTION_ID}-pi_debit`,
      },
    );
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
  });

  it("(c) leaves a subscription bought before the lifetime untouched, then and when a payment of it settles", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = endedByCustomer({
      created: LIFETIME_PAID_AT - 60,
    });

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);
    expect((await deliver(invoicePaid("evt_invoice_paid"))).status).toBe(200);

    expect(terminalRefusalRecords()).toEqual([]);
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("(c) leaves an Agency subscription beside a Lifetime Pro purchase untouched", async () => {
    db.billing_subscriptions = [recordedRow("canceled", "agency")];
    stripeSubscriptions[SUBSCRIPTION_ID] = endedByCustomer({}, "agency");

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);

    expect(terminalRefusalRecords()).toEqual([]);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("(d) refunds once across a replayed lifetime event and the lifetime's second event after Stripe's idempotency key expires", async () => {
    const event = lifetimePaid("evt_lifetime");

    expect((await deliver(event)).status).toBe(200);
    expect(await (await deliver(event)).json()).toEqual({
      received: true,
      duplicate: true,
    });
    refundsByIdempotencyKey = {};
    // The same purchase's other event: the grant is a duplicate.
    expect((await deliver(lifetimePaid("evt_lifetime_again"))).status).toBe(
      200,
    );

    expect(db.plan_entitlements).toHaveLength(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
    expect(terminalRefusalRecords()).toHaveLength(1);
    expect(refusalReports()).toHaveLength(1);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
  });

  it("(e) the live path is unchanged: a live subscription bought after the lifetime is cancelled and refunded once, and recorded by its marker only", async () => {
    db.billing_subscriptions = [recordedRow("active")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 120 },
    );

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionCancel).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({
        cancellation_details: { comment: "covered_by_lifetime" },
      }),
    );
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    expect(mockInvoicePaymentsList).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(refusalReports()).toHaveLength(1);
    expect(terminalRefusalRecords()).toEqual([]);
  });

  it("(e) the live path is unchanged: a live subscription bought before the lifetime is set to end at period end", async () => {
    db.billing_subscriptions = [recordedRow("active")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT - 86400 },
    );

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);

    expect(mockSubscriptionUpdate).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(terminalRefusalRecords()).toEqual([]);
  });

  it("lists only this customer's ended subscriptions created since the lifetime was paid, page by page", async () => {
    // A full first page of newer ended Agency subscriptions, which Lifetime
    // Pro does not cover; the covered one is the oldest, on the second page.
    for (let index = 0; index < 100; index += 1) {
      const id = `sub_agency_${String(index).padStart(3, "0")}`;
      stripeSubscriptions[id] = stripeSubscription(id, "agency", {
        status: "canceled",
        created: LIFETIME_PAID_AT + 1000 + index,
      });
    }
    // Another customer's ended Pro subscription is never listed, nor is one
    // of this customer's bought before the lifetime (review minor 5).
    stripeSubscriptions.sub_other = stripeSubscription("sub_other", "pro", {
      customer: "cus_other",
      status: "canceled",
      created: LIFETIME_PAID_AT + 500,
    });
    stripeSubscriptions.sub_predating = stripeSubscription(
      "sub_predating",
      "pro",
      { status: "canceled", created: LIFETIME_PAID_AT - 60 },
    );

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);

    const bound = {
      customer: STRIPE_CUSTOMER_ID,
      status: "ended",
      created: { gte: LIFETIME_PAID_AT },
      limit: 100,
    };
    expect(mockSubscriptionsList.mock.calls).toEqual([
      [bound],
      [{ ...bound, starting_after: "sub_agency_000" }],
    ]);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      metadata: { subscription_id: SUBSCRIPTION_ID },
    });
    expect(terminalRefusalRecords()).toHaveLength(1);
  });

  it("fails closed, alerts in words, and finishes on the retry when the listing says more but does not advance", async () => {
    mockSubscriptionsList.mockResolvedValueOnce({ data: [], has_more: true });
    const event = lifetimePaid("evt_lifetime");

    const response = await deliver(event);

    expect(response.status).toBe(500);
    expect(db.plan_entitlements).toHaveLength(1);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be read");
    expect(alert[0]).toContain(LIFETIME_PAYMENT_INTENT);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "refuse_ended_covered_subscriptions",
        paymentIntentId: LIFETIME_PAYMENT_INTENT,
        cause: expect.objectContaining({
          message: expect.stringContaining("did not advance its cursor"),
        }),
      }),
    );

    // Stripe's redelivery: the grant is a duplicate, the step runs again.
    expect((await deliver(event)).status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(terminalRefusalRecords()).toHaveLength(1);
  });

  it("asks Stripe to retry, alerts in words, and scans nothing when the refusal cannot be recorded; the retry finishes it", async () => {
    terminalRefusalWriteFails = true;
    const event = lifetimePaid("evt_lifetime");

    const response = await deliver(event);

    expect(response.status).toBe(500);
    expect(db.plan_entitlements).toHaveLength(1);
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be recorded");
    expect(alert[0]).toContain(SUBSCRIPTION_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "record_terminal_refusal",
        subscriptionId: SUBSCRIPTION_ID,
      }),
    );

    terminalRefusalWriteFails = false;
    expect((await deliver(event)).status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(terminalRefusalRecords()).toHaveLength(1);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry, alerts in words, and refunds once on the retry when the refund fails", async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error("Stripe is down"));
    const event = lifetimePaid("evt_lifetime");

    const response = await deliver(event);

    expect(response.status).toBe(500);
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[0]).toContain(SUBSCRIPTION_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        cause: expect.objectContaining({ message: "Stripe is down" }),
      }),
    );

    expect((await deliver(event)).status).toBe(200);
    expect(stripeRefunds).toHaveLength(1);
    expect(refusalReports()).toHaveLength(1);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
  });
});

/*
 * Independent review of 9807278..5ae80b1 (MAJOR 1, minors 2-4). Each case
 * goes red without its fix.
 */
describe("review MAJOR 1: a charge already refunded or disputed outside this flow", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    db.checkout_pending_intents = [
      { id: "intent_1", user_id: USER_ID, status: "pending" },
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  /** Answered 2xx, the subscription recorded, the Checkout finished. */
  function expectRecordedAndCheckoutFinished(response: WebhookResponse) {
    expect(response.status).toBe(200);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
    expect(db.checkout_pending_intents[0].status).toBe("completed");
    expect(alertsSaying("could not be refunded")).toEqual([]);
  }

  function disputeWarnings() {
    return mockLoggerWarn.mock.calls.filter(([message]) =>
      String(message).includes("disputed"),
    );
  }

  function infoReport(): string | undefined {
    return mockLoggerInfo.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("was bought while a lifetime grant"));
  }

  it("a charge support already refunded in full: nothing refunded again, reported at info", async () => {
    stripeCharges[SUBSCRIPTION_PAYMENT_INTENT] = {
      refunded: true,
      amount_refunded: 1900,
    };

    const response = await deliver(
      subscriptionCheckoutCompleted("evt_checkout_completed"),
    );

    expectRecordedAndCheckoutFinished(response);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(refusalReports()).toEqual([]);
    expect(infoReport()).toContain("already refunded outside");
  });

  it("a partially refunded charge: only the remainder is refunded, once", async () => {
    stripeCharges[SUBSCRIPTION_PAYMENT_INTENT] = { amount_refunded: 500 };

    const response = await deliver(
      subscriptionCheckoutCompleted("evt_checkout_completed"),
    );

    expectRecordedAndCheckoutFinished(response);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        amount: 1400,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      },
      { idempotencyKey: `${REFUND_KEY}-remainder-1400` },
    );

    // The subscription's own event finds that refund.
    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("a disputed charge: nothing refunded, one warning to resolve it in Stripe", async () => {
    stripeCharges[SUBSCRIPTION_PAYMENT_INTENT] = { disputed: true };

    const response = await deliver(
      subscriptionCheckoutCompleted("evt_checkout_completed"),
    );
    expectRecordedAndCheckoutFinished(response);
    // The subscription's own event warns no more.
    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const warnings = disputeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain(`ch_${SUBSCRIPTION_PAYMENT_INTENT}`);
    expect(warnings[0][0]).toContain("resolve it in Stripe");
    expect(refusalReports()).toEqual([]);
  });

  it("backstop: Stripe answers charge_already_refunded to the refund: answered 200, reported at info", async () => {
    mockRefundsCreate.mockRejectedValueOnce(
      Object.assign(new Error("Charge has already been refunded."), {
        type: "StripeInvalidRequestError",
        code: "charge_already_refunded",
      }),
    );

    const response = await deliver(
      subscriptionCheckoutCompleted("evt_checkout_completed"),
    );

    expectRecordedAndCheckoutFinished(response);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(infoReport()).toContain("already refunded outside");
  });

  it("backstop: Stripe answers charge_disputed to the refund: answered 200, one warning", async () => {
    mockRefundsCreate.mockRejectedValueOnce(
      Object.assign(new Error("Charge has been disputed."), {
        type: "StripeInvalidRequestError",
        code: "charge_disputed",
      }),
    );

    const response = await deliver(
      subscriptionCheckoutCompleted("evt_checkout_completed"),
    );

    expectRecordedAndCheckoutFinished(response);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(disputeWarnings()).toHaveLength(1);
  });

  it("a late payment refunded outside before it settles: answered 200, nothing refunded again", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "open", "pi_debit")],
      has_more: false,
    });
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    stripeCharges.pi_debit = { refunded: true, amount_refunded: 1900 };
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_debit", "paid", "pi_debit")],
      has_more: false,
    });

    const response = await deliver(invoicePaid("evt_invoice_paid"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(alertsSaying("could not be refunded")).toEqual([]);
  });
});

describe("review minor 2: every paid invoice of a subscription the customer ended", () => {
  const FINAL_INVOICE = "in_final_credit";

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    // Cancelled by the customer with proration: its latest invoice is a final
    // one that only credited the unused time; the first collected the money.
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        canceled_at: PERIOD_START + 30,
        latest_invoice: FINAL_INVOICE,
        cancellation_details: {
          comment: "Cancelled by the customer",
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );
    mockInvoicePaymentsList.mockImplementation(async (params: Row) => ({
      data:
        params.invoice === INVOICE_ID
          ? [invoicePayment("inpay_1", "paid", SUBSCRIPTION_PAYMENT_INTENT)]
          : [],
      has_more: false,
    }));
    mockInvoicesList.mockResolvedValue({
      data: [
        invoiceFor(FINAL_INVOICE, "price_pro"),
        invoiceFor(INVOICE_ID, "price_pro"),
      ],
      has_more: false,
    });
  });

  it("refunds the paid first invoice when the latest is a final credit invoice", async () => {
    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockInvoicesList).toHaveBeenCalledWith({
      subscription: SUBSCRIPTION_ID,
      status: "paid",
      limit: 100,
    });
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: SUBSCRIPTION_PAYMENT_INTENT }),
      { idempotencyKey: REFUND_KEY },
    );
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
  });

  it("reads every page of paid invoices", async () => {
    mockInvoicesList
      .mockResolvedValueOnce({
        data: [invoiceFor(FINAL_INVOICE, "price_pro")],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [invoiceFor(INVOICE_ID, "price_pro")],
        has_more: false,
      });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    const bound = { subscription: SUBSCRIPTION_ID, status: "paid", limit: 100 };
    expect(mockInvoicesList.mock.calls).toEqual([
      [bound],
      [{ ...bound, starting_after: FINAL_INVOICE }],
    ]);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when paid-invoice pagination does not advance", async () => {
    mockInvoicesList.mockResolvedValueOnce({ data: [], has_more: true });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: expect.stringContaining("did not advance its cursor"),
        }),
      }),
    );
  });

  it("warns ops, once, when the customer is left holding a credit balance", async () => {
    mockCustomersRetrieve.mockImplementation(async (id: string) => ({
      id,
      object: "customer",
      balance: -950,
      currency: "usd",
    }));

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);
    expect(
      (await deliver(subscriptionCreated("evt_sub_resend", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    const warnings = mockLoggerWarn.mock.calls.filter(([message]) =>
      String(message).includes("credit balance"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain(STRIPE_CUSTOMER_ID);
    expect(warnings[0][0]).toContain("950");
  });

  it("keeps the latest-invoice refund for a live subscription: no invoice listing, no balance read", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockInvoicesList).not.toHaveBeenCalled();
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });
});

describe("review minor 3: the ended-subscription step reads the cover once and skips what it cannot resolve", () => {
  beforeEach(() => {
    db.billing_subscriptions = [
      {
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan: "pro",
        status: "canceled",
      },
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { status: "canceled", created: LIFETIME_PAID_AT + 120 },
    );
  });

  it("returns early, listing nothing, when no live grant covers the plan (a revoked lifetime's late event)", async () => {
    db.plan_entitlements = [
      grantRow("pro", {
        stripe_payment_intent_id: LIFETIME_PAYMENT_INTENT,
        revoked_at: "2026-08-02T00:00:00.000Z",
      }),
    ];

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("reads the lifetime cover once for every ended subscription it checks", async () => {
    stripeSubscriptions.sub_second = stripeSubscription("sub_second", "pro", {
      status: "canceled",
      created: LIFETIME_PAID_AT + 240,
      latest_invoice: "in_second",
    });

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);

    const lifetimeReads = mockPaymentIntentsRetrieve.mock.calls.filter(
      ([id]) => id === LIFETIME_PAYMENT_INTENT,
    );
    expect(lifetimeReads).toHaveLength(1);
    expect(
      mockRefundsCreate.mock.calls.map(([params]) => params.metadata),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subscription_id: SUBSCRIPTION_ID }),
        expect.objectContaining({ subscription_id: "sub_second" }),
      ]),
    );
  });

  it("skips, with a warning, an ended subscription whose plan cannot be resolved; the covered one is still refunded", async () => {
    stripeSubscriptions.sub_unknown = stripeSubscription("sub_unknown", "pro", {
      status: "canceled",
      created: LIFETIME_PAID_AT + 240,
      items: {
        data: [
          {
            id: "si_unknown",
            price: { id: "price_unknown" },
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      metadata: { subscription_id: SUBSCRIPTION_ID },
    });
    const warnings = mockLoggerWarn.mock.calls.filter(([message]) =>
      String(message).includes("sub_unknown"),
    );
    expect(warnings).toHaveLength(1);
    expect(alertsSaying("sub_unknown")).toEqual([]);
  });
});

describe("review minor 4: a refusal that collected nothing is not an error", () => {
  it("reports an incomplete_expired subscription bought after the grant at info, never as an error", async () => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { status: "incomplete_expired" },
    );
    mockInvoicePaymentsList.mockResolvedValue({
      data: [{ id: "inpay_uncollected", status: "canceled", amount_paid: 0 }],
      has_more: false,
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
    const report = mockLoggerInfo.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("was bought while a lifetime grant"));
    expect(report).toContain(SUBSCRIPTION_ID);
    expect(report).toContain("nothing it collected needed refunding");
  });
});

/*
 * Re-review of 76f610f, N1-N3 (Devin comment 4244242732 is N1).
 */
describe("review N1: a catalogue that cannot be read never skips a refund", () => {
  beforeEach(() => {
    db.billing_subscriptions = [
      {
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan: "pro",
        status: "canceled",
      },
    ];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { status: "canceled", created: LIFETIME_PAID_AT + 120 },
    );
  });

  function skipWarnings() {
    return mockLoggerWarn.mock.calls.filter(([message]) =>
      String(message).includes("skipped"),
    );
  }

  it("answers 5xx and skips nothing when the catalogue cannot be read; the retry refunds", async () => {
    mockCatalogueReadFails = true;
    const event = lifetimePaid("evt_lifetime");

    const response = await deliver(event);

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(skipWarnings()).toEqual([]);
    const [alert] = alertsSaying("could not be read");
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        action: "refuse_ended_covered_subscriptions",
        cause: expect.objectContaining({
          message: expect.stringContaining("Failed to load the plan catalogue"),
        }),
      }),
    );

    mockCatalogueReadFails = false;
    expect((await deliver(event)).status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("warns once, across two deliveries, about a price the loaded catalogue does not sell", async () => {
    stripeSubscriptions.sub_unknown = stripeSubscription("sub_unknown", "pro", {
      status: "canceled",
      created: LIFETIME_PAID_AT + 240,
      items: {
        data: [
          {
            id: "si_unknown",
            price: { id: "price_unknown" },
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });

    expect((await deliver(lifetimePaid("evt_lifetime"))).status).toBe(200);
    // The same purchase's other event: the grant is a duplicate, the step runs again.
    expect((await deliver(lifetimePaid("evt_lifetime_again"))).status).toBe(
      200,
    );

    const warnings = skipWarnings().filter(([message]) =>
      String(message).includes("sub_unknown"),
    );
    expect(warnings).toHaveLength(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it("refunds the coverable subscription and still answers 5xx when another fails transiently; the retry finishes", async () => {
    stripeSubscriptions.sub_b = stripeSubscription("sub_b", "pro", {
      status: "canceled",
      created: LIFETIME_PAID_AT + 240,
      latest_invoice: "in_b",
    });
    mockInvoicePaymentsList.mockImplementation(async (params: Row) => ({
      data:
        params.invoice === "in_b"
          ? [invoicePayment("inpay_b", "paid", "pi_b")]
          : [invoicePayment("inpay_1", "paid", SUBSCRIPTION_PAYMENT_INTENT)],
      has_more: false,
    }));
    const createRefund = mockRefundsCreate.getMockImplementation();
    let failedOnce = false;
    mockRefundsCreate.mockImplementation(
      async (params: Row, options?: { idempotencyKey?: string }) => {
        if (params.payment_intent === "pi_b" && !failedOnce) {
          failedOnce = true;
          throw new Error("Stripe is down");
        }
        return createRefund?.(params, options);
      },
    );
    const event = lifetimePaid("evt_lifetime");

    expect((await deliver(event)).status).toBe(500);
    expect(stripeRefunds.map((refund) => refund.payment_intent)).toEqual([
      SUBSCRIPTION_PAYMENT_INTENT,
    ]);

    expect((await deliver(event)).status).toBe(200);
    expect(stripeRefunds.map((refund) => refund.payment_intent).sort()).toEqual(
      ["pi_b", SUBSCRIPTION_PAYMENT_INTENT].sort(),
    );
  });

  it("answers 5xx, with an alert, when a subscription's price is configured for two plans", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        created: LIFETIME_PAID_AT + 120,
        items: {
          data: [
            {
              id: "si_shared",
              price: { id: "price_shared" },
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
            },
          ],
        },
      },
    );

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(skipWarnings()).toEqual([]);
    const [alert] = alertsSaying("cannot be decided");
    expect(alert[0]).toContain(SUBSCRIPTION_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
  });
});

describe("review N2: only invoices billing a plan the grant covers are refunded", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    // Bought on Agency after Lifetime Pro, downgraded to Pro, then ended by
    // the customer: an Agency-period invoice and a Pro-period one.
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        canceled_at: PERIOD_START + 30,
        latest_invoice: "in_pro",
        cancellation_details: {
          comment: "Cancelled by the customer",
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );
    mockInvoicePaymentsList.mockImplementation(async (params: Row) => ({
      data: [
        params.invoice === "in_agency"
          ? invoicePayment("inpay_agency", "paid", "pi_agency")
          : invoicePayment("inpay_pro", "paid", "pi_pro"),
      ],
      has_more: false,
    }));
    mockInvoicesList.mockResolvedValue({
      data: [
        invoiceFor("in_pro", "price_pro"),
        invoiceFor("in_agency", "price_agency"),
      ],
      has_more: false,
    });
  });

  it("refunds the Pro-period invoice and not the Agency-period one", async () => {
    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_pro",
    });
    expect(mockInvoicePaymentsList).not.toHaveBeenCalledWith(
      expect.objectContaining({ invoice: "in_agency" }),
    );
  });

  it("reads every line, past the first page, before deciding: an Agency line on page two makes it mixed", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          ...invoiceFor("in_pro", "price_pro"),
          lines: {
            object: "list",
            data: [invoiceLine("in_pro", "price_pro")],
            has_more: true,
          },
        },
      ],
      has_more: false,
    });
    mockInvoicesListLineItems.mockResolvedValue({
      data: [
        invoiceLine("in_pro", "price_pro", 0),
        invoiceLine("in_pro", "price_agency", 1, 4900),
      ],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockInvoicesListLineItems).toHaveBeenCalledWith("in_pro", {
      limit: 100,
    });
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(manualReviewWarnings()).toHaveLength(1);
  });

  it("sends an invoice whose line product is configured for two plans to a person, never refunding it", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [invoiceFor("in_pro", "price_shared")],
      has_more: false,
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(manualReviewWarnings()).toHaveLength(1);
    expect(alertsSaying("could not be refunded")).toEqual([]);
  });
});

describe("review N3: our own refund, landed by a concurrent delivery, is never reported as refunded outside", () => {
  /** Our refund, as another delivery of this refusal makes it. */
  function concurrentRefundLands() {
    stripeRefunds = [
      ...stripeRefunds,
      {
        id: "re_concurrent",
        status: "succeeded",
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      },
    ];
    stripeCharges[SUBSCRIPTION_PAYMENT_INTENT] = {
      refunded: true,
      amount_refunded: 1900,
    };
  }

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  function expectReportedAsOurs() {
    const [report] = refusalReports();
    expect(report[0]).toContain("1 refund(s) created or found");
    expect(report[0]).not.toContain("already refunded outside");
    expect(report[3]).toEqual(
      expect.objectContaining({
        refundIds: ["re_concurrent"],
        refundedOutsideChargeIds: [],
      }),
    );
  }

  it("lands between our refund lookup and the charge read", async () => {
    const listRefunds = mockRefundsList.getMockImplementation();
    let landed = false;
    mockRefundsList.mockImplementation(async (params: Row) => {
      const page = await listRefunds?.(params);
      if (!landed) {
        landed = true;
        concurrentRefundLands();
      }
      return page;
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expectReportedAsOurs();
  });

  it("lands between the charge read and our refund request", async () => {
    mockRefundsCreate.mockImplementationOnce(async () => {
      concurrentRefundLands();
      throw Object.assign(new Error("Charge has already been refunded."), {
        type: "StripeInvalidRequestError",
        code: "charge_already_refunded",
      });
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expectReportedAsOurs();
  });
});

/*
 * Devin round on 8744bed (comments 4244837497, 4244837575, 4244837615,
 * 4244837673, 4244837719): the refunds of an ENDED subscription bought after a
 * grant are decided per invoice, over every line, by product, against every
 * grant that predates the subscription; the settlement path decides the same
 * way. Live subscriptions are unchanged.
 */
describe("Devin round on 8744bed: per-invoice refund decisions for ended subscriptions", () => {
  const CUSTOMER_REASON = {
    comment: "Cancelled by the customer",
    feedback: null,
    reason: "cancellation_requested",
  };

  /** A Pro subscription bought after the grant and ended by the customer. */
  function endedPro(overrides: Row = {}): Row {
    return stripeSubscription(SUBSCRIPTION_ID, "pro", {
      status: "canceled",
      canceled_at: PERIOD_START + 30,
      latest_invoice: "in_pro",
      cancellation_details: CUSTOMER_REASON,
      ...overrides,
    });
  }

  /** Each invoice's one payment, by invoice: `in_x` is paid by `pi_x`. */
  function paymentsByInvoice(open: string[] = []) {
    mockInvoicePaymentsList.mockImplementation(async (params: Row) => {
      const invoice = String(params.invoice);
      const suffix = invoice.replace(/^in_/, "");
      return {
        data: [
          invoicePayment(
            `inpay_${suffix}`,
            open.includes(invoice) ? "open" : "paid",
            `pi_${suffix}`,
          ),
        ],
        has_more: false,
      };
    });
  }

  function refundedPayments(): string[] {
    return stripeRefunds.map((refund) => String(refund.payment_intent)).sort();
  }

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = endedPro();
    paymentsByInvoice();
  });

  it("4244837497: an excluded Agency invoice whose payment settles after the refusal is never refunded", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [invoiceFor("in_pro", "price_pro")],
      has_more: false,
    });
    mockInvoicesRetrieve.mockImplementation(async (id: string) =>
      id === "in_agency"
        ? invoiceFor("in_agency", "price_agency")
        : invoiceFor(id, "price_pro"),
    );

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);
    expect(refundedPayments()).toEqual(["pi_pro"]);

    // The Agency invoice's bank debit settles days later.
    const response = await deliver(
      invoicePaid("evt_agency_paid", "basil", "in_agency"),
    );

    expect(response.status).toBe(200);
    expect(refundedPayments()).toEqual(["pi_pro"]);
    expect(manualReviewWarnings()).toEqual([]);
  });

  it("4244837497: a settled payment on a covered invoice of the same subscription is still refunded", async () => {
    mockInvoicesList.mockResolvedValue({ data: [], has_more: false });
    paymentsByInvoice(["in_pro"]);
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    expect(refundedPayments()).toEqual([]);

    paymentsByInvoice();
    const response = await deliver(
      invoicePaid("evt_pro_paid", "basil", "in_pro"),
    );

    expect(response.status).toBe(200);
    expect(refundedPayments()).toEqual(["pi_pro"]);
  });

  it("4244837497: a mixed invoice settling after the refusal goes to a person, once", async () => {
    mockInvoicesList.mockResolvedValue({ data: [], has_more: false });
    mockInvoicesRetrieve.mockImplementation(async (id: string) =>
      id === "in_mixed"
        ? invoiceFor("in_mixed", "price_pro", "price_agency")
        : invoiceFor(id, "price_pro"),
    );
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(
      (await deliver(invoicePaid("evt_mixed_paid", "basil", "in_mixed")))
        .status,
    ).toBe(200);
    expect(
      (await deliver(invoicePaid("evt_mixed_paid_again", "basil", "in_mixed")))
        .status,
    ).toBe(200);

    expect(refundedPayments()).not.toContain("pi_mixed");
    const warnings = manualReviewWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain("in_mixed");
  });

  it("4244837575: a Pro + Agency invoice on one payment is not refunded; a person is told once", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          ...invoiceFor("in_pro", "price_pro"),
          lines: {
            object: "list",
            data: [
              invoiceLine("in_pro", "price_pro", 0, 1900),
              invoiceLine("in_pro", "price_agency", 1, 4900),
            ],
            has_more: false,
          },
        },
      ],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);
    expect(
      (await deliver(subscriptionCreated("evt_sub_resend", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const warnings = manualReviewWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain(
      "invoice in_pro mixes covered and uncovered charges",
    );
    expect(warnings[0][2]).toEqual(
      expect.objectContaining({ invoiceId: "in_pro", reason: "mixed" }),
    );
  });

  it("4244837615: an invoice on a retired Pro price is refunded through its product", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [invoiceFor("in_pro", "price_pro_v1")],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(refundedPayments()).toEqual(["pi_pro"]);
  });

  it("4244837673: with Lifetime Pro and then Founding Agency before the subscription, its Agency-period invoice is refunded too", async () => {
    db.plan_entitlements = [
      grantRow("pro"),
      grantRow("agency", { stripe_payment_intent_id: "pi_existing_agency" }),
    ];
    mockInvoicesList.mockResolvedValue({
      data: [
        invoiceFor("in_pro", "price_pro"),
        invoiceFor("in_agency", "price_agency"),
      ],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(refundedPayments()).toEqual(["pi_agency", "pi_pro"]);
  });

  it("4244837673: an Agency grant paid after the subscription was bought does not cover its invoices", async () => {
    db.plan_entitlements = [
      grantRow("pro"),
      grantRow("agency", { stripe_payment_intent_id: "pi_later_agency" }),
    ];
    const retrieve = mockPaymentIntentsRetrieve.getMockImplementation();
    mockPaymentIntentsRetrieve.mockImplementation(
      async (id: string, params?: { expand?: string[] }) =>
        id === "pi_later_agency"
          ? { id, created: PERIOD_START + 3600 }
          : retrieve?.(id, params),
    );
    mockInvoicesList.mockResolvedValue({
      data: [
        invoiceFor("in_pro", "price_pro"),
        invoiceFor("in_agency", "price_agency"),
      ],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(refundedPayments()).toEqual(["pi_pro"]);
  });

  it("4244837719: an ambiguous line after a covered one sends the invoice to a person, never refunding it", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [invoiceFor("in_pro", "price_pro", "price_shared")],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [warning] = manualReviewWarnings();
    expect(warning[2]).toEqual(
      expect.objectContaining({ invoiceId: "in_pro", reason: "ambiguous" }),
    );
  });

  it("ignores a proration credit for the Agency time when deciding a Pro invoice", async () => {
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          ...invoiceFor("in_pro", "price_pro"),
          lines: {
            object: "list",
            data: [
              invoiceLine("in_pro", "price_pro", 0, 1900),
              invoiceLine("in_pro", "price_agency", 1, -3000),
            ],
            has_more: false,
          },
        },
      ],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(refundedPayments()).toEqual(["pi_pro"]);
    expect(manualReviewWarnings()).toEqual([]);
  });

  it("leaves a live subscription's refusal unchanged: its latest invoice is refunded without the line decision", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_1", "paid", SUBSCRIPTION_PAYMENT_INTENT)],
      has_more: false,
    });

    expect(
      (await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID)))
        .status,
    ).toBe(200);

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(refundedPayments()).toEqual([SUBSCRIPTION_PAYMENT_INTENT]);
    expect(mockInvoicesList).not.toHaveBeenCalled();
    expect(mockInvoicesRetrieve).not.toHaveBeenCalled();
    expect(mockPricesRetrieve).not.toHaveBeenCalled();
  });
});

describe("every invoice payment of a refused subscription is considered", () => {
  function firstInvoicePaymentPage() {
    return Array.from({ length: 10 }, (_, index) =>
      invoicePayment(
        `inpay_canceled_${index}`,
        "canceled",
        `pi_declined_${index}`,
      ),
    );
  }

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it("refunds a paid payment on the second invoice-payment page", async () => {
    const firstPage = firstInvoicePaymentPage();
    mockInvoicePaymentsList.mockImplementation(async (params: Row) =>
      params.starting_after
        ? {
            data: [invoicePayment("inpay_paid_2", "paid", "pi_paid_2")],
            has_more: false,
          }
        : { data: firstPage, has_more: true },
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockInvoicePaymentsList).toHaveBeenNthCalledWith(2, {
      invoice: INVOICE_ID,
      limit: 10,
      starting_after: "inpay_canceled_9",
    });
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_paid_2",
    });
  });

  it("fails closed when a later invoice-payment page cannot be read", async () => {
    const firstPage = firstInvoicePaymentPage();
    mockInvoicePaymentsList.mockImplementation(async (params: Row) => {
      if (params.starting_after) {
        throw new Error("Stripe invoice-payment pagination failed");
      }
      return { data: firstPage, has_more: true };
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: "Stripe invoice-payment pagination failed",
        }),
      }),
    );
  });

  it("fails closed when invoice-payment pagination repeats a cursor", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [invoicePayment("inpay_same", "canceled", "pi_declined")],
      has_more: true,
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(mockInvoicePaymentsList).toHaveBeenCalledTimes(2);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const [alert] = alertsSaying("could not be refunded");
    expect(alert[3]).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: expect.stringContaining("did not advance its cursor"),
        }),
      }),
    );
  });
});

describe("invoice-payment reference shapes", () => {
  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it("refunds a charge-backed invoice payment by charge id", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: "inpay_charge",
          invoice: INVOICE_ID,
          status: "paid",
          payment: { type: "charge", charge: "ch_paid" },
        },
      ],
      has_more: false,
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ charge: "ch_paid" }),
      expect.any(Object),
    );
  });

  it("refunds an expanded payment-intent reference by its id", async () => {
    mockInvoicePaymentsList.mockResolvedValue({
      data: [
        {
          id: "inpay_expanded",
          invoice: INVOICE_ID,
          status: "paid",
          payment: {
            type: "payment_intent",
            payment_intent: { id: "pi_expanded" },
          },
        },
      ],
      has_more: false,
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_expanded" }),
      expect.any(Object),
    );
  });
});

/*
 * s82 verification of 8f6c30e (mi-1 … mi-4): the remaining money rules pinned.
 */

describe("mi-1: which lifetime a subscription is measured against, and refund retries", () => {
  it("X1: measures against the EARLIEST covering grant — a Pro bought between Lifetime Pro and a later Founding Agency is refunded", async () => {
    db.plan_entitlements = [grantRow("pro"), grantRow("agency")];
    mockPaymentIntentsRetrieve.mockImplementation(async (id: string) => ({
      id,
      created:
        id === "pi_existing_pro" ? LIFETIME_PAID_AT : LIFETIME_PAID_AT + 200,
    }));
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 100 },
    );

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
  });

  it("X10: refunds again after an earlier refund of the same payment was cancelled", async () => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
    stripeRefunds = [
      {
        id: "re_canceled",
        status: "canceled",
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      },
    ];

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: `${REFUND_KEY}-after-re_canceled`,
    });
  });
});

describe("Stripe refund lookup stays idempotent beyond one page", () => {
  const documentedLiveStatuses = [
    "succeeded",
    "pending",
    "requires_action",
  ] as const;

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  it.each(documentedLiveStatuses)(
    "finds a matching %s refund after the first 100 and never refunds twice",
    async (status) => {
      const firstPage = Array.from({ length: 100 }, (_, index) => ({
        id: `re_unrelated_${index}`,
        status: "succeeded",
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: { reason_code: "other", subscription_id: SUBSCRIPTION_ID },
      }));
      const matching = {
        id: `re_existing_${status}`,
        status,
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      };
      mockRefundsList.mockImplementation(async (params: Row) =>
        params.starting_after
          ? { data: [matching], has_more: false }
          : { data: firstPage, has_more: true },
      );

      const response = await deliver(
        subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
      );

      expect(response.status).toBe(200);
      expect(mockRefundsList).toHaveBeenNthCalledWith(2, {
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        limit: 100,
        starting_after: "re_unrelated_99",
      });
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      const [report] = refusalReports();
      expect(report[3]).toEqual(
        expect.objectContaining({ refundIds: [matching.id] }),
      );
    },
  );

  it.each(["pending", "requires_action"])(
    "reports a %s refund as created or found, never already refunded in full",
    async (status) => {
      stripeRefunds = [
        {
          id: `re_${status}`,
          status,
          payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
          metadata: {
            reason_code: "covered_by_lifetime",
            subscription_id: SUBSCRIPTION_ID,
          },
        },
      ];

      const response = await deliver(
        subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
      );

      expect(response.status).toBe(200);
      const [report] = refusalReports();
      expect(report[0]).toContain("1 refund(s) created or found");
      expect(report[0]).not.toContain("refunded in full");
    },
  );

  it("fails closed when a later refund page cannot be read", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `re_unrelated_${index}`,
      status: "succeeded",
      payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
      metadata: { reason_code: "other", subscription_id: SUBSCRIPTION_ID },
    }));
    mockRefundsList.mockImplementation(async (params: Row) => {
      if (params.starting_after) {
        throw new Error("Stripe pagination failed");
      }
      return { data: firstPage, has_more: true };
    });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(alertsSaying("could not be refunded")).toHaveLength(1);
  });

  it("fails closed when Stripe says another page exists without a cursor", async () => {
    mockRefundsList.mockResolvedValueOnce({ data: [], has_more: true });

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(alertsSaying("could not be refunded")).toHaveLength(1);
  });

  it.each([null, "future_status"])(
    "fails closed on an undocumented matching refund status (%s)",
    async (status) => {
      mockRefundsList.mockResolvedValueOnce({
        data: [
          {
            id: "re_unknown",
            status,
            payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
            metadata: {
              reason_code: "covered_by_lifetime",
              subscription_id: SUBSCRIPTION_ID,
            },
          },
        ],
        has_more: false,
      });

      const response = await deliver(
        subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
      );

      expect(response.status).toBe(500);
      expect(mockRefundsCreate).not.toHaveBeenCalled();
      expect(alertsSaying("could not be refunded")).toHaveLength(1);
    },
  );

  it.each([null, "future_status"])(
    "fails closed when a newly created refund has an undocumented status (%s)",
    async (status) => {
      mockRefundsCreate.mockResolvedValueOnce({
        id: "re_unknown",
        status,
        payment_intent: SUBSCRIPTION_PAYMENT_INTENT,
        metadata: {
          reason_code: "covered_by_lifetime",
          subscription_id: SUBSCRIPTION_ID,
        },
      });

      const response = await deliver(
        subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
      );

      expect(response.status).toBe(500);
      expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
      expect(refusalReports()).toEqual([]);
      expect(alertsSaying("could not be refunded")).toHaveLength(1);
    },
  );
});

describe("mi-2: when the covering lifetime cannot be read", () => {
  beforeEach(() => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
  });

  function expectCoverReadAlert() {
    const [alert] = alertsSaying("could not be read");
    expect(alert[0]).toContain(SUBSCRIPTION_ID);
    expect(alert[0]).toContain("Returning 5xx so Stripe redelivers");
    expect(alert[1]).toBeUndefined();
    expect(alert[3]).toEqual(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        cause: expect.objectContaining({ message: expect.any(String) }),
      }),
    );
  }

  it("alerts in words and asks Stripe to retry when the grants cannot be read", async () => {
    db.plan_entitlements = [grantRow("pro")];
    grantReadFails = true;

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(storedSubscription(SUBSCRIPTION_ID)).toBeUndefined();
    expectCoverReadAlert();
  });

  it("alerts in words and asks Stripe to retry when the lifetime's payment cannot be read", async () => {
    db.plan_entitlements = [grantRow("pro")];
    mockPaymentIntentsRetrieve.mockRejectedValue(new Error("Stripe is down"));

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(500);
    expect(storedSubscription(SUBSCRIPTION_ID)).toBeUndefined();
    expectCoverReadAlert();
  });

  function paymentStripeDoesNotHave() {
    // Only the seeded grant's payment is missing; the subscription's own
    // payment, whose charge the refund reads (review MAJOR 1), exists.
    mockPaymentIntentsRetrieve.mockImplementation(
      async (id: string, params?: { expand?: string[] }) => {
        if (id !== "pi_qa_journey") return retrievePaymentIntent(id, params);
        throw Object.assign(
          new Error("No such payment_intent: 'pi_qa_journey'"),
          {
            type: "StripeInvalidRequestError",
            code: "resource_missing",
            statusCode: 404,
          },
        );
      },
    );
    db.plan_entitlements = [
      grantRow("pro", {
        stripe_payment_intent_id: "pi_qa_journey",
        granted_at: new Date(LIFETIME_PAID_AT * 1000).toISOString(),
      }),
    ];
  }

  it("dates a grant whose payment Stripe does not have from when it was granted: bought after → refused", async () => {
    paymentStripeDoesNotHave();
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 60 },
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(alertsSaying("could not be read")).toEqual([]);
  });

  it("dates a grant whose payment Stripe does not have from when it was granted: bought before → ends at period end", async () => {
    paymentStripeDoesNotHave();
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT - 60 },
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({ cancel_at_period_end: true }),
    );
  });
});

describe("mi-3: a refund another delivery is making right now", () => {
  /** Stripe's answer while another request with the same key is in flight. */
  function keyInUse() {
    return Object.assign(
      new Error(
        "There is currently another in-progress request using this Stripe-Idempotency-Key.",
      ),
      {
        type: "StripeInvalidRequestError",
        code: "idempotency_key_in_use",
        statusCode: 409,
      },
    );
  }

  beforeEach(() => {
    db.plan_entitlements = [grantRow("pro")];
  });

  it("subscription-first: no 'could not be refunded' alert and no period-end update; the refusal is reported with the refund in flight", async () => {
    db.billing_subscriptions = [
      {
        user_id: USER_ID,
        customer_id: "bc_1",
        stripe_subscription_id: SUBSCRIPTION_ID,
        plan: "pro",
        status: "active",
      },
    ];
    db.plan_entitlements = [];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      { created: LIFETIME_PAID_AT + 120 },
    );
    mockRefundsCreate.mockRejectedValueOnce(keyInUse());

    const response = await deliver(lifetimePaid("evt_lifetime"));

    expect(response.status).toBe(200);
    expect(alertsSaying("could not be refunded")).toEqual([]);
    expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    const [report] = refusalReports();
    expect(report[0]).toContain(
      "1 refund(s) were already being made by another delivery",
    );
    expect(report[3]).toEqual(
      expect.objectContaining({ inFlightPaymentIds: ["inpay_1"] }),
    );
  });

  it("grant-first: answered 200 with the subscription recorded cancelled, not 500 with 'refund it by hand'", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
    mockRefundsCreate.mockRejectedValueOnce(keyInUse());

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(alertsSaying("could not be refunded")).toEqual([]);
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
  });

  it("re-checks once: a refund that finished meanwhile is counted as made", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
    mockRefundsCreate.mockImplementationOnce(async (params: Row) => {
      // The other delivery's request completes while ours is refused.
      stripeRefunds = [
        ...stripeRefunds,
        {
          id: "re_other",
          status: "succeeded",
          payment_intent: params.payment_intent,
          metadata: params.metadata,
        },
      ];
      throw keyInUse();
    });

    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));

    const [report] = refusalReports();
    expect(report[3]).toEqual(
      expect.objectContaining({
        refundIds: ["re_other"],
        inFlightPaymentIds: [],
      }),
    );
  });
});

describe("mi-4: a refusal finished by a retry is still reported", () => {
  it("reports it once, with the payments still in flight, when the retry completes the refund", async () => {
    db.plan_entitlements = [grantRow("pro")];
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
    );
    mockInvoicePaymentsList.mockResolvedValue({
      data: [
        invoicePayment("inpay_paid", "paid", SUBSCRIPTION_PAYMENT_INTENT),
        invoicePayment("inpay_open", "open", "pi_debit_pending"),
      ],
      has_more: false,
    });
    mockRefundsCreate.mockRejectedValueOnce(new Error("Stripe is down"));
    const event = subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID);

    expect((await deliver(event)).status).toBe(500);
    expect(refusalReports()).toEqual([]);

    expect((await deliver(event)).status).toBe(200);

    const reports = refusalReports();
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toContain(
      "1 payment(s) on its invoice are still processing",
    );
    expect(reports[0][3]).toEqual(
      expect.objectContaining({
        refundIds: ["re_1"],
        pendingPaymentIds: ["inpay_open"],
      }),
    );
  });
});
