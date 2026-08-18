/**
 * A-7 — `customer.subscription.updated` / `.deleted` silently succeed on zero
 * rows.
 *
 * `handleSubscriptionUpdated` and `handleSubscriptionDeleted` used to issue
 * `.update(...).eq("stripe_subscription_id", ...)` with no `.select()`, and the
 * guard `assertWritten` inspects only `error`. supabase-js returns
 * `{ error: null }` for an update that matched zero rows, so the handler
 * reported success, the route answered 200, and Stripe discarded the event
 * permanently. Both now `.select("id")` and refuse an empty result through
 * `assertRowMatched`.
 *
 * The fake client below reproduces exactly that: a zero-row update is not an
 * error. Nothing else in this file is stubbed out — the real route handler runs
 * and the assertions are on the stored row.
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

/**
 * HARNESS ONLY — the behaviour asserted below is unchanged.
 *
 * `handleSubscriptionCreated` / `handleSubscriptionUpdated` now re-read the
 * subscription from Stripe before writing, so a late delivery cannot resurrect
 * a cancelled row (see stripe-webhook-stale-writes.test.ts, which is what
 * covers that). `deliver` therefore answers every retrieve with the delivered
 * event's own object: "Stripe holds exactly what this event says" is the
 * assumption every case in this file was written under.
 *
 * The plan lookup is stubbed for the same reason. It is real end-to-end in
 * stripe-webhook-stale-writes.test.ts; here it would only mean maintaining a
 * `plans` fixture for a file that is about matching zero rows.
 */
jest.mock("@/lib/stripe/plans", () => ({
  ...jest.requireActual("@/lib/stripe/plans"),
  findPaidPlanIdByStripePriceId: jest.fn(async () => "pro"),
}));

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "sig_test" })),
}));

type Row = Record<string, unknown>;
type FakeError = { code?: string; message: string; details?: string };
type RowsResult = { data: Row[] | null; error: FakeError | null };

/** In-memory tables, replaced wholesale per test. */
let db: Record<string, Row[]> = {};

/**
 * A supabase-js-shaped client over `db`, faithful on the one detail this
 * finding turns on: `.update()` that matches no row resolves `{ error: null }`.
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
          // THE MECHANISM: zero rows matched is not an error.
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

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const PERIOD_START = 1785484800; // 2026-08-01T00:00:00Z
const PERIOD_END = 1788163200; // 2026-09-01T00:00:00Z

function subscriptionEvent(
  eventId: string,
  type: string,
  status: string,
): unknown {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status,
        metadata: { user_id: "user-1", plan_id: "pro" },
        items: {
          data: [
            {
              id: "si_1",
              price: { id: "price_pro_monthly" },
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
            },
          ],
        },
        cancel_at: null,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
      },
    },
  };
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  mockSubscriptionRetrieve.mockResolvedValue(
    (event as { data: { object: unknown } }).data.object,
  );
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

function storedSubscription(): Row | undefined {
  return db.billing_subscriptions?.find(
    (row) => row.stripe_subscription_id === "sub_1",
  );
}

describe("A-7: subscription webhooks that match no row", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    db = {
      billing_events: [],
      billing_subscriptions: [],
      billing_customers: [
        { id: "cust_row_1", user_id: "user-1", stripe_customer_id: "cus_1" },
      ],
    };
  });

  /**
   * Stripe states that events are not ordered, and the normal SCA sequence
   * delivers `updated` (active) for a subscription that was born `incomplete`.
   * Lose the `updated` and the row settles at `incomplete`, which is absent
   * from LIVE_SUBSCRIPTION_STATUSES — a paying customer held at the paywall.
   */
  /**
   * Companion to the test below, kept from when that was a `test.failing`
   * marker: a marker passes on ANY failure, so each one needed a sibling
   * proving the harness actually reached the handler. Here: the same three
   * deliveries land exactly one subscription row, which means the signature
   * mock, the idempotency read, `requireBillingCustomer` and the upsert all
   * ran. True on both sides of the fix.
   */
  it("guard: the three-delivery sequence reaches the handler and writes one row", async () => {
    const outOfOrder = subscriptionEvent(
      "evt_updated",
      "customer.subscription.updated",
      "active",
    );

    await deliver(outOfOrder);
    await deliver(
      subscriptionEvent(
        "evt_created",
        "customer.subscription.created",
        "incomplete",
      ),
    );
    await deliver(outOfOrder);

    expect(mockConstructEvent).toHaveBeenCalledTimes(3);
    expect(db.billing_subscriptions).toHaveLength(1);
    expect(storedSubscription()?.plan).toBe("pro");
  });

  it("an out-of-order updated survives long enough to land once created arrives", async () => {
    const outOfOrder = subscriptionEvent(
      "evt_updated",
      "customer.subscription.updated",
      "active",
    );

    // 1. `updated` arrives first. There is no row to update.
    await deliver(outOfOrder);
    // 2. `created` lands the row, born `incomplete` as an SCA subscription is.
    await deliver(
      subscriptionEvent(
        "evt_created",
        "customer.subscription.created",
        "incomplete",
      ),
    );
    // 3. Stripe redelivers the same event id on its retry schedule — which it
    //    only does if step 1 was refused. Answering 200 there logs the event
    //    to `billing_events`, so this redelivery short-circuits as a duplicate
    //    and the `active` status is gone for good.
    await deliver(outOfOrder);

    expect(storedSubscription()?.status).toBe("active");
  });

  /**
   * Guard: the very same event fixture DOES land when the row exists, so the
   * case below is genuinely about matching zero rows and not about a
   * malformed payload or a handler that was never reached.
   */
  it("guard: the update fixture lands when the subscription row exists", async () => {
    db.billing_subscriptions = [
      {
        id: "row_1",
        user_id: "user-1",
        customer_id: "cust_row_1",
        stripe_subscription_id: "sub_1",
        plan: "pro",
        status: "incomplete",
      },
    ];

    const response = await deliver(
      subscriptionEvent(
        "evt_updated",
        "customer.subscription.updated",
        "active",
      ),
    );

    expect(response.status).toBe(200);
    expect(storedSubscription()?.status).toBe("active");
  });

  it("refuses an update for a subscription it has never seen, so Stripe redelivers", async () => {
    const response = await deliver(
      subscriptionEvent(
        "evt_updated",
        "customer.subscription.updated",
        "active",
      ),
    );

    expect(response.status).toBe(500);
    expect(db.billing_subscriptions).toHaveLength(0);
  });

  it("guard: the deletion fixture lands when the subscription row exists", async () => {
    db.billing_subscriptions = [
      {
        id: "row_1",
        user_id: "user-1",
        customer_id: "cust_row_1",
        stripe_subscription_id: "sub_1",
        plan: "pro",
        status: "active",
      },
    ];

    const response = await deliver(
      subscriptionEvent(
        "evt_deleted",
        "customer.subscription.deleted",
        "canceled",
      ),
    );

    expect(response.status).toBe(200);
    expect(storedSubscription()?.status).toBe("canceled");
  });

  it("refuses a deletion for a subscription it has never seen", async () => {
    const response = await deliver(
      subscriptionEvent(
        "evt_deleted",
        "customer.subscription.deleted",
        "canceled",
      ),
    );

    // A lost `deleted` leaves the account on a plan nobody is paying for.
    expect(response.status).toBe(500);
  });

  it("still short-circuits a genuine redelivery of an event it did apply", async () => {
    db.billing_subscriptions = [
      {
        id: "row_1",
        user_id: "user-1",
        customer_id: "cust_row_1",
        stripe_subscription_id: "sub_1",
        plan: "pro",
        status: "incomplete",
      },
    ];

    const event = subscriptionEvent(
      "evt_updated",
      "customer.subscription.updated",
      "active",
    );
    await deliver(event);
    const redelivery = await deliver(event);

    // The idempotency guard has to survive whatever fix lands: an event that
    // was genuinely applied is logged, and a second delivery is a no-op.
    expect(await redelivery.json()).toEqual({
      received: true,
      duplicate: true,
    });
    expect(storedSubscription()?.status).toBe("active");
  });
});
