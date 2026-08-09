/**
 * A-22 — `checkout.session.completed` hardcodes the granted plan.
 *
 * `handleCheckoutSessionCompleted` used to call
 * `grantLifetime(userId, "pro", paymentIntentId)` while the
 * `payment_intent.succeeded` path to the same function passed
 * `metadata.grants_plan_id`. Session metadata omitted that key —
 * `src/lib/stripe/checkout.ts` carried it on `payment_intent_data.metadata`
 * only — so the literal was all the session path ever had.
 *
 * `plan_entitlements.stripe_payment_intent_id` is UNIQUE, so whichever of the
 * two events Stripe happened to deliver first silently decided what a $199
 * purchase bought — and `grantLifetime`'s own "a lifetime purchase with no
 * grants_plan_id" guard could never fire on this path. Checkout now writes
 * `grants_plan_id` at session level too, and the session handler reads it,
 * falling back to the catalogue only for sessions minted before that.
 *
 * The real `grantPlanEntitlement` runs against an in-memory `plan_entitlements`
 * that enforces the UNIQUE constraint, so every assertion is on the stored row.
 * The catalogue is configured to sell a lifetime product granting `starter`,
 * which is what makes the hardcoded `pro` visible at all.
 */

const mockConstructEvent = jest.fn();
const mockSubscriptionUpdate = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { update: mockSubscriptionUpdate },
  })),
);

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "sig_test" })),
}));

type Row = Record<string, unknown>;
type FakeError = { code?: string; message: string; details?: string };
type RowsResult = { data: Row[] | null; error: FakeError | null };

let db: Record<string, Row[]> = {};

/** The UNIQUE constraint that makes the first event to land the decider. */
const UNIQUE_COLUMN: Record<string, string> = {
  plan_entitlements: "stripe_payment_intent_id",
  billing_events: "stripe_event_id",
};

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "update" = "select";
    let values: Row = {};

    const rows = (): Row[] => db[table] ?? [];
    const matched = (): Row[] =>
      rows().filter((row) => predicates.every((predicate) => predicate(row)));

    const run = (): RowsResult => {
      switch (operation) {
        case "insert": {
          const unique = UNIQUE_COLUMN[table];
          const clashes =
            unique !== undefined &&
            values[unique] !== undefined &&
            rows().some((row) => row[unique] === values[unique]);

          if (clashes) {
            return {
              data: null,
              error: {
                code: "23505",
                message: `duplicate key value violates unique constraint "${table}_${unique}_key"`,
              },
            };
          }

          db[table] = [...rows(), { ...values }];
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
      returns: () => builder,
      insert: (payload: Row) => {
        operation = "insert";
        values = payload;
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

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

/** What the catalogue says Lifetime Pro confers. `null` = not on sale. */
let lifetimeGrantPlanId: string | null = "starter";

jest.mock("@/lib/stripe/plans", () => ({
  isPaidPlanId: (value: unknown) => value === "starter" || value === "pro",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
  resolveStripePriceId: jest.fn(async () => "price_test"),
  getLifetimeGrantPlanId: jest.fn(async () => lifetimeGrantPlanId),
  getOneTimeProduct: jest.fn(async () => ({
    id: "lifetime_pro",
    grantsPlanId: lifetimeGrantPlanId,
  })),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const USER_ID = "user-1";
const PAYMENT_INTENT = "pi_lifetime_1";

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

/**
 * A completed Checkout Session in the shape `createCheckoutSession` produces:
 * `grants_plan_id` lives on `payment_intent_data.metadata`, never here.
 */
function checkoutSessionEvent(
  eventId: string,
  metadata: Record<string, string>,
  paymentStatus: string = "paid",
): unknown {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        customer: "cus_1",
        payment_status: paymentStatus,
        payment_intent: PAYMENT_INTENT,
        client_reference_id: null,
        metadata,
      },
    },
  };
}

function paymentIntentEvent(
  eventId: string,
  metadata: Record<string, string>,
): unknown {
  return {
    id: eventId,
    type: "payment_intent.succeeded",
    data: {
      object: { id: PAYMENT_INTENT, customer: "cus_1", metadata },
    },
  };
}

function grantedPlanIds(): unknown[] {
  return (db.plan_entitlements ?? []).map((row) => row.plan_id);
}

describe("A-22: which plan a completed lifetime checkout grants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    lifetimeGrantPlanId = "starter";
    db = {
      billing_events: [],
      billing_subscriptions: [],
      billing_customers: [
        { id: "cust_row_1", user_id: USER_ID, stripe_customer_id: "cus_1" },
      ],
      plan_entitlements: [],
    };
  });

  /**
   * Companion to the test below, kept from when that was a `test.failing`
   * marker: a marker passes on ANY failure, including a broken mock or an event
   * that never reaches the switch, so each one needed a sibling proving the path
   * ran. Here: a production-shaped session is accepted and DOES write exactly
   * one entitlement — so the case below is about which plan, not about whether
   * anything happened.
   */
  it("guard: grantLifetime and the entitlements store work for this fixture", async () => {
    // Driven through `payment_intent.succeeded`, which reaches the very same
    // `grantLifetime` with a plan id that is not a literal. Deliberately not
    // the session path: a fix may legitimately make that path refuse, and a
    // guard must not depend on the defect being present.
    const response = await deliver(
      paymentIntentEvent("evt_payment_intent", {
        user_id: USER_ID,
        type: "lifetime_purchase",
        grants_plan_id: "starter",
      }),
    );

    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(1);
    expect(db.plan_entitlements?.[0]?.stripe_payment_intent_id).toBe(
      PAYMENT_INTENT,
    );
  });

  it("does not grant a plan the catalogue never sold", async () => {
    // Production shape: the session carries no `grants_plan_id` at all, and
    // the lifetime product on sale grants `starter`.
    await deliver(
      checkoutSessionEvent("evt_session", {
        user_id: USER_ID,
        type: "lifetime_purchase",
      }),
    );

    // Deliberately negative: a fix may resolve the plan from the catalogue or
    // refuse the event outright. Either is fine; handing out `pro` is not.
    expect(grantedPlanIds()).not.toContain("pro");
  });

  it("guard: a session carrying grants_plan_id reaches the switch and is answered", async () => {
    const response = await deliver(
      checkoutSessionEvent("evt_session", {
        user_id: USER_ID,
        type: "lifetime_purchase",
        grants_plan_id: "starter",
      }),
    );

    // Signature verification, the idempotency read and the audit insert all
    // ran, so whatever the case below reads next was produced by the route.
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(
      db.billing_events?.some((row) => row.stripe_event_id === "evt_session"),
    ).toBe(true);
  });

  it("grants the plan the purchase actually names", async () => {
    await deliver(
      checkoutSessionEvent("evt_session", {
        user_id: USER_ID,
        type: "lifetime_purchase",
        grants_plan_id: "starter",
      }),
    );

    expect(grantedPlanIds()).toEqual(["starter"]);
  });

  it("guard: grantLifetime does refuse a purchase with no plan on the other path", async () => {
    lifetimeGrantPlanId = null;

    // The identical "nothing says what this grants" condition, delivered as
    // `payment_intent.succeeded`. It is refused there, which is what makes the
    // session path's silence a defect rather than a design choice.
    const response = await deliver(
      paymentIntentEvent("evt_payment_intent", {
        user_id: USER_ID,
        type: "lifetime_purchase",
      }),
    );

    expect(response.status).toBe(500);
    expect(db.plan_entitlements).toHaveLength(0);
  });

  it("refuses a lifetime session when nothing says what it grants", async () => {
    // Lifetime Pro is not on sale, so there is no catalogue answer either.
    // `grantLifetime` has exactly this guard; the hardcoded literal is what
    // stopped it ever firing on the session path.
    lifetimeGrantPlanId = null;

    const response = await deliver(
      checkoutSessionEvent("evt_session", {
        user_id: USER_ID,
        type: "lifetime_purchase",
      }),
    );

    expect(response.status).toBe(500);
    expect(db.plan_entitlements).toHaveLength(0);
  });

  /**
   * Fix-stable: the two events key off the same payment intent and the UNIQUE
   * constraint means only one grant is ever written. Whatever fix lands has to
   * keep that true.
   */
  it("grants exactly once when both events arrive", async () => {
    await deliver(
      paymentIntentEvent("evt_payment_intent", {
        user_id: USER_ID,
        type: "lifetime_purchase",
        grants_plan_id: "starter",
      }),
    );
    const session = await deliver(
      checkoutSessionEvent("evt_session", {
        user_id: USER_ID,
        type: "lifetime_purchase",
        grants_plan_id: "starter",
      }),
    );

    expect(session.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(1);
    expect(grantedPlanIds()).toEqual(["starter"]);
  });

  it("grants nothing for a session whose money has not moved", async () => {
    const response = await deliver(
      checkoutSessionEvent(
        "evt_session",
        {
          user_id: USER_ID,
          type: "lifetime_purchase",
          grants_plan_id: "starter",
        },
        "unpaid",
      ),
    );

    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(0);
  });

  it("ignores a completed session that is not a lifetime purchase", async () => {
    const response = await deliver(
      checkoutSessionEvent("evt_session", {
        user_id: USER_ID,
        type: "credit_purchase",
      }),
    );

    expect(response.status).toBe(200);
    expect(db.plan_entitlements).toHaveLength(0);
  });
});
