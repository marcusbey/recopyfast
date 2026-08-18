/**
 * A late `customer.subscription.*` must not resurrect a cancelled subscription,
 * and the plan must come from the price that is actually billed.
 *
 * TWO DEFECTS, ONE HANDLER PAIR.
 *
 * 1. ORDERING. Stripe states its events are unordered and delivery is
 *    at-least-once. `handleSubscriptionUpdated` wrote the payload verbatim,
 *    keyed only on `.eq("stripe_subscription_id", …)` with no timestamp
 *    comparison anywhere, so an `updated` that was slow or retried could land
 *    AFTER a `deleted` and write `status:'active'` — plus `cancel_at:null` and
 *    `canceled_at:null`, because every column was written unconditionally from
 *    the snapshot. It carries a different `event.id`, so the idempotency probe
 *    does not stop it: it is late, not duplicate. Nothing reconciles from
 *    Stripe afterwards, so that state is permanent and the account keeps Pro
 *    for free. A redelivered `created` reaches the same end through its upsert.
 *
 * 2. PLAN. `plan: subscription.metadata?.plan_id || "pro"` made the most
 *    expensive plan the fail-open default, on exactly the subscriptions that
 *    carry no metadata — the ones created from the Stripe dashboard or a
 *    Payment Link. `updateSubscription` is the only code path that keeps
 *    `metadata.plan_id` in step with the price, so any price change made
 *    outside it left the metadata stale and the row wrong.
 *
 * These tests drive the real route handler over an in-memory Supabase and a
 * mocked Stripe client whose `subscriptions.retrieve` returns what Stripe holds
 * NOW — the distinction the whole fix turns on. Every assertion is on the
 * persisted row, never on a mock call count. No Stripe API is contacted.
 */

const mockConstructEvent = jest.fn();
const mockSubscriptionUpdate = jest.fn();
const mockSubscriptionRetrieve = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: {
      update: mockSubscriptionUpdate,
      retrieve: mockSubscriptionRetrieve,
    },
  })),
);

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
process.env.STRIPE_STARTER_PRICE_ID = "price_starter_monthly";
process.env.STRIPE_STARTER_YEARLY_PRICE_ID = "price_starter_yearly";
process.env.STRIPE_PRO_PRICE_ID = "price_pro_monthly";
process.env.STRIPE_PRO_YEARLY_PRICE_ID = "price_pro_yearly";
process.env.STRIPE_TICKETS_PRICE_ID = "price_credits";
process.env.STRIPE_LIFETIME_PRICE_ID = "price_lifetime";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "sig_test" })),
}));

type Row = Record<string, unknown>;
type FakeError = { code?: string; message: string; details?: string };
type RowsResult = { data: Row[] | null; error: FakeError | null };

/** In-memory tables, replaced wholesale per test. */
let db: Record<string, Row[]> = {};

/**
 * A supabase-js-shaped client over `db`. Faithful on the detail the ordering
 * defect turns on: an `.update()` that matches no row resolves `{ error: null }`.
 */
function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "update" | "upsert" = "select";
    let values: Row = {};
    let conflictColumn: string | null = null;

    const rows = (): Row[] => db[table] ?? [];
    const matched = (): Row[] =>
      rows().filter((row) => predicates.every((predicate) => predicate(row)));

    const run = (): RowsResult => {
      switch (operation) {
        case "insert":
          db[table] = [...rows(), { ...values }];
          return { data: [{ ...values }], error: null };

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
      // `plans` is read with .order(); the catalogue loader sorts by sort_order
      // and the fixture below is already in that order.
      order: () => builder,
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
            error: {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
              details: `The result contains ${data?.length ?? 0} rows`,
            },
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
        resolve: (result: RowsResult) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };

    return builder;
  };

  return { from };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => createFakeClient()),
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import { clearPlanCatalogueCache } from "@/lib/stripe/plans";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const PERIOD_START = 1785484800; // 2026-08-01T00:00:00Z
const PERIOD_END = 1788163200; // 2026-09-01T00:00:00Z

/**
 * The `plans` rows the catalogue loader needs. NUMERIC columns are strings
 * because that is what PostgREST sends. The price ids are left null so
 * resolution falls through to the STRIPE_*_PRICE_ID environment variables set
 * above — the production arrangement.
 */
function planRow(overrides: Row = {}): Row {
  return {
    id: "pro",
    kind: "subscription",
    name: "Pro",
    description: "Up to 5 websites",
    price_monthly: "19.00",
    price_yearly_monthly_equivalent: "15.77",
    stripe_price_id_test: null,
    stripe_price_id_live: null,
    stripe_yearly_price_id_test: null,
    stripe_yearly_price_id_live: null,
    limits: {
      websites: 5,
      collaborators: 5,
      ai_features: true,
      translations: -1,
      ab_testing: true,
      monthly_credits: 500,
    },
    features: ["Up to 5 websites"],
    additional_site_price: "5.00",
    grants_plan_id: null,
    is_active: true,
    sort_order: 20,
    ...overrides,
  };
}

const PLAN_ROWS: Row[] = [
  planRow({
    id: "free",
    name: "Free",
    price_monthly: "0.00",
    price_yearly_monthly_equivalent: "0.00",
    limits: {
      websites: 0,
      collaborators: 0,
      ai_features: false,
      translations: 0,
      ab_testing: false,
      monthly_credits: 0,
    },
    features: [],
    additional_site_price: null,
    sort_order: 0,
  }),
  planRow({
    id: "starter",
    name: "Starter",
    price_monthly: "9.00",
    price_yearly_monthly_equivalent: "7.47",
    limits: {
      websites: 1,
      collaborators: 0,
      ai_features: false,
      translations: 0,
      ab_testing: false,
      monthly_credits: 0,
    },
    features: ["1 website"],
    additional_site_price: null,
    sort_order: 10,
  }),
  planRow(),
  planRow({
    id: "credits",
    kind: "one_time",
    name: "Credits",
    price_monthly: "19.00",
    price_yearly_monthly_equivalent: null,
    limits: { credits_per_pack: 1000, max_packs_per_purchase: 100 },
    features: ["1,000 AI credits"],
    additional_site_price: null,
    sort_order: 30,
  }),
  planRow({
    id: "lifetime_pro",
    kind: "one_time",
    name: "Lifetime Pro",
    price_monthly: "199.00",
    price_yearly_monthly_equivalent: null,
    limits: {},
    features: ["Everything in Pro"],
    additional_site_price: null,
    grants_plan_id: "pro",
    sort_order: 40,
  }),
];

interface SubscriptionShape {
  status: string;
  priceId?: string;
  metadata?: Record<string, string>;
  canceledAt?: number | null;
}

/** A Stripe Subscription object, as both a payload and a retrieve result. */
function subscriptionObject({
  status,
  priceId = "price_pro_monthly",
  metadata = { user_id: "user-1", plan_id: "pro" },
  canceledAt = null,
}: SubscriptionShape): Record<string, unknown> {
  return {
    id: "sub_1",
    customer: "cus_1",
    status,
    metadata,
    items: {
      data: [
        {
          id: "si_1",
          price: { id: priceId },
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
        },
      ],
    },
    cancel_at: null,
    canceled_at: canceledAt,
    trial_start: null,
    trial_end: null,
  };
}

function subscriptionEvent(
  eventId: string,
  type: string,
  shape: SubscriptionShape,
): unknown {
  return { id: eventId, type, data: { object: subscriptionObject(shape) } };
}

/** What Stripe answers a retrieve with — i.e. the subscription's real state. */
function stripeHolds(shape: SubscriptionShape): void {
  mockSubscriptionRetrieve.mockResolvedValue(subscriptionObject(shape));
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

function storedSubscription(): Row | undefined {
  return db.billing_subscriptions?.find(
    (row) => row.stripe_subscription_id === "sub_1",
  );
}

const LIVE_ROW: Row = {
  id: "row_1",
  user_id: "user-1",
  customer_id: "cust_row_1",
  stripe_subscription_id: "sub_1",
  plan: "pro",
  status: "active",
  cancel_at: null,
  canceled_at: null,
};

describe("Stripe subscription webhooks: late deliveries and plan resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    clearPlanCatalogueCache();
    db = {
      billing_events: [],
      billing_subscriptions: [],
      billing_customers: [
        { id: "cust_row_1", user_id: "user-1", stripe_customer_id: "cus_1" },
      ],
      plans: PLAN_ROWS,
    };
    stripeHolds({ status: "active" });
  });

  describe("a delivery that arrives after the subscription is gone", () => {
    /**
     * Companion guard. A negative assertion passes when nothing happened at
     * all, so this proves the same fixture DOES reach the write: with Stripe
     * holding `active`, the `updated` event lands `active` on the row.
     */
    it("guard: an updated event does reach the row and write to it", async () => {
      db.billing_subscriptions = [{ ...LIVE_ROW, status: "incomplete" }];
      stripeHolds({ status: "active" });

      const response = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated", {
          status: "active",
        }),
      );

      expect(response.status).toBe(200);
      expect(storedSubscription()?.status).toBe("active");
    });

    it("does not put a cancelled subscription back on plan when a stale updated lands", async () => {
      db.billing_subscriptions = [{ ...LIVE_ROW }];

      // 1. The customer cancels. Stripe's copy is terminal from here on.
      stripeHolds({ status: "canceled", canceledAt: PERIOD_START });
      await deliver(
        subscriptionEvent("evt_deleted", "customer.subscription.deleted", {
          status: "canceled",
          canceledAt: PERIOD_START,
        }),
      );
      expect(storedSubscription()?.status).toBe("canceled");

      // 2. An `updated` emitted BEFORE the cancellation is delivered after it —
      //    slow delivery or a Stripe retry. Its snapshot still says `active`,
      //    and its event id is new, so the idempotency probe lets it through.
      const response = await deliver(
        subscriptionEvent(
          "evt_updated_stale",
          "customer.subscription.updated",
          {
            status: "active",
          },
        ),
      );

      expect(response.status).toBe(200);
      const row = storedSubscription();
      expect(row?.status).toBe("canceled");
      expect(row?.canceled_at).not.toBeNull();
    });

    it("does not resurrect the row when a created is redelivered after the deletion", async () => {
      db.billing_subscriptions = [{ ...LIVE_ROW }];

      stripeHolds({ status: "canceled", canceledAt: PERIOD_START });
      await deliver(
        subscriptionEvent("evt_deleted", "customer.subscription.deleted", {
          status: "canceled",
          canceledAt: PERIOD_START,
        }),
      );

      // Stripe redelivers the original `created`, whose snapshot is the state at
      // creation time. The upsert writes every column, so nothing else stops it.
      const response = await deliver(
        subscriptionEvent("evt_created", "customer.subscription.created", {
          status: "active",
        }),
      );

      expect(response.status).toBe(200);
      expect(db.billing_subscriptions).toHaveLength(1);
      expect(storedSubscription()?.status).toBe("canceled");
    });

    it("records when Stripe cancelled, not when the event was processed", async () => {
      // The deletion handler deliberately does NOT re-read from Stripe — the
      // event is terminal, so the payload cannot be stale about `canceled_at`,
      // and making the one handler that REMOVES access depend on Stripe being
      // reachable would be a worse trade than the accuracy it buys.
      db.billing_subscriptions = [{ ...LIVE_ROW }];

      await deliver(
        subscriptionEvent("evt_deleted", "customer.subscription.deleted", {
          status: "canceled",
          canceledAt: PERIOD_START,
        }),
      );

      expect(storedSubscription()?.canceled_at).toBe(
        new Date(PERIOD_START * 1000).toISOString(),
      );
    });
  });

  describe("which plan the row records", () => {
    it("guard: a subscription billing the Pro price is recorded as pro", async () => {
      db.billing_subscriptions = [{ ...LIVE_ROW, plan: "starter" }];
      stripeHolds({ status: "active", priceId: "price_pro_monthly" });

      const response = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated", {
          status: "active",
        }),
      );

      expect(response.status).toBe(200);
      expect(storedSubscription()?.plan).toBe("pro");
    });

    it("resolves the plan from the price when the subscription carries no metadata", async () => {
      // A subscription created from the Stripe dashboard or a Payment Link. It
      // is billing Starter, and it used to be recorded as `pro`.
      stripeHolds({
        status: "active",
        priceId: "price_starter_monthly",
        metadata: {},
      });

      const response = await deliver(
        subscriptionEvent("evt_created", "customer.subscription.created", {
          status: "active",
          priceId: "price_starter_monthly",
          metadata: {},
        }),
      );

      expect(response.status).toBe(200);
      expect(storedSubscription()?.plan).toBe("starter");
    });

    it("believes the price over stale metadata naming a different plan", async () => {
      // `updateSubscription` is the only path that keeps metadata.plan_id in
      // step with the price. A plan change made anywhere else — the Stripe
      // dashboard, the API — leaves the metadata behind.
      stripeHolds({
        status: "active",
        priceId: "price_starter_yearly",
        metadata: { user_id: "user-1", plan_id: "pro" },
      });

      const response = await deliver(
        subscriptionEvent("evt_created", "customer.subscription.created", {
          status: "active",
          priceId: "price_starter_yearly",
          metadata: { user_id: "user-1", plan_id: "pro" },
        }),
      );

      expect(response.status).toBe(200);
      expect(storedSubscription()?.plan).toBe("starter");
    });

    it("refuses a subscription whose price matches no plan rather than defaulting", async () => {
      // billing_subscriptions_plan_valid admits only 'starter' and 'pro', so a
      // guess here is either a wrong plan or a 23514 with the event discarded.
      stripeHolds({
        status: "active",
        priceId: "price_not_in_the_catalogue",
        metadata: { user_id: "user-1", plan_id: "pro" },
      });

      const response = await deliver(
        subscriptionEvent("evt_created", "customer.subscription.created", {
          status: "active",
          priceId: "price_not_in_the_catalogue",
          metadata: { user_id: "user-1", plan_id: "pro" },
        }),
      );

      expect(response.status).toBe(500);
      expect(db.billing_subscriptions).toHaveLength(0);
    });
  });

  describe("when Stripe cannot be reached", () => {
    it("returns 5xx and writes nothing when the subscription cannot be re-read", async () => {
      // Falling back to the payload snapshot here would reintroduce the stale
      // write at exactly the moment the network is unhealthy — i.e. when
      // deliveries are most likely to be late in the first place.
      db.billing_subscriptions = [{ ...LIVE_ROW, status: "canceled" }];
      mockSubscriptionRetrieve.mockRejectedValue(
        new Error("Stripe is unreachable"),
      );

      const response = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated", {
          status: "active",
        }),
      );

      expect(response.status).toBe(500);
      expect(storedSubscription()?.status).toBe("canceled");
    });
  });
});
