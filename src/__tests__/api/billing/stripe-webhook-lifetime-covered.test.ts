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
const mockSessionsList = jest.fn();
const mockSessionsExpire = jest.fn();
const mockSessionsRetrieve = jest.fn();
const mockInvoicePaymentsList = jest.fn();
const mockRefundsList = jest.fn();
const mockRefundsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: {
      retrieve: mockSubscriptionRetrieve,
      update: mockSubscriptionUpdate,
      cancel: mockSubscriptionCancel,
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
}));

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
jest.mock("@/lib/monitoring/logger", () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
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

    const rows = (): Row[] => db[table] ?? [];
    const matched = () =>
      rows().filter((row) => predicates.every((keep) => keep(row)));

    const run = (): { data: Row[] | null; error: Row | null } => {
      if (table === "plan_entitlements" && operation === "select") {
        if (grantReadFails) {
          return { data: null, error: { message: "connection reset" } };
        }
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
  mockPaymentIntentsRetrieve.mockImplementation(async (id: string) => ({
    id,
    created: LIFETIME_PAID_AT,
  }));
  mockSessionsList.mockResolvedValue({ data: [], has_more: false });
  mockSessionsExpire.mockImplementation(async (id: string) => ({
    id,
    status: "expired",
  }));
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
  stripeSubscriptions = {};
  stripeRefunds = [];
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

function invoicePaid(eventId: string) {
  return {
    id: eventId,
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: INVOICE_ID,
        object: "invoice",
        customer: STRIPE_CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
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

  it("M21: records a subscription already cancelled for another reason as it is, and never refunds it", async () => {
    stripeSubscriptions[SUBSCRIPTION_ID] = stripeSubscription(
      SUBSCRIPTION_ID,
      "pro",
      {
        status: "canceled",
        canceled_at: PERIOD_START + 30,
        cancellation_details: {
          comment: null,
          feedback: null,
          reason: "cancellation_requested",
        },
      },
    );

    const response = await deliver(
      subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID),
    );

    expect(response.status).toBe(200);
    expect(mockSubscriptionCancel).not.toHaveBeenCalled();
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(storedSubscription(SUBSCRIPTION_ID)?.status).toBe("canceled");
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

  it("m-3: leaves alone a subscription Stripe already ended for another reason", async () => {
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
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
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

  it("refunds nothing twice: a payment the refusal already refunded is found", async () => {
    await deliver(subscriptionCreated("evt_sub_created", SUBSCRIPTION_ID));
    await deliver(invoicePaid("evt_invoice_paid"));

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(stripeRefunds).toHaveLength(1);
  });

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

  it("reads nothing from Stripe for a live subscription's invoice", async () => {
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
    expect(mockSubscriptionRetrieve).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});
