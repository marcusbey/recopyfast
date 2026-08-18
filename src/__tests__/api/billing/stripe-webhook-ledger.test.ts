/**
 * The `billing_events` ledger is written BEFORE the effect, not after it.
 *
 * `logBillingEvent` used to run after the switch, and its insert was gated on
 * `if (userId)` — the exact inverse of the ledger-before-effect rule ADR 011
 * states (`docs/decisions/011-agency-digest-idempotent-send-ledger.md`), and of
 * the reason `billing_events.user_id` was made nullable in the first place
 * (`supabase/migrations/20260731003000_missing_tables_billing_credits.sql:17`).
 *
 * Two consequences, both reproduced below:
 *
 * 1. An event whose user cannot be resolved left NO row at all, so the
 *    idempotency probe at the top of POST never short-circuited it and every
 *    redelivery re-ran the handler. Replay safety rested entirely on four
 *    UNIQUE constraints elsewhere in the billing code; a future handler without
 *    one would have inherited an unguarded replay.
 * 2. A crash between an effect and the ledger insert re-ran that effect, and a
 *    delivery that lost a concurrency race ran the whole handler before finding
 *    out it had lost.
 *
 * `processed` now means what it says: false at claim time, true once the switch
 * has returned. The probe short-circuits on `processed = true` only — an
 * attempt that died half-way must be retried, not silently swallowed as a
 * duplicate. That is ADR 011's claim-then-update shape, not its rejected
 * insert-and-reject-on-conflict alternative.
 *
 * These tests drive the real route handler over an in-memory Supabase whose
 * `billing_events` enforces the UNIQUE constraint on `stripe_event_id`.
 */

const mockConstructEvent = jest.fn();
const mockSubscriptionRetrieve = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionRetrieve },
  })),
);

/**
 * The plan is resolved from the price against the `plans` catalogue. Loading a
 * real catalogue here would be a fixture for something this file does not test
 * — that resolution is covered end-to-end in stripe-webhook-stale-writes.test.ts.
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

let db: Record<string, Row[]> = {};

/**
 * When true, a SELECT on `billing_events` answers as if the row were not there
 * while the table still holds it — the TOCTOU window between two concurrent
 * deliveries of the same event, where both probes miss and only one insert can
 * win. Nothing else can reproduce a race inside a single-threaded test.
 */
let hideLedgerFromProbe = false;

/** The UNIQUE constraint the idempotency backstop relies on. */
const UNIQUE_COLUMN: Record<string, string> = {
  billing_events: "stripe_event_id",
};

/** supabase-js-shaped client over `db`. See stripe-webhook-ordering.test.ts. */
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

        default: {
          if (table === "billing_events" && hideLedgerFromProbe) {
            return { data: [], error: null };
          }
          return { data: matched(), error: null };
        }
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

/** A payment we did not originate: no user_id, no customer, no payment intent. */
function unattributableEvent(eventId: string): unknown {
  return {
    id: eventId,
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_dashboard", metadata: {} } },
  };
}

function subscriptionObject(): Record<string, unknown> {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
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
  };
}

function subscriptionEvent(eventId: string, type: string): unknown {
  return { id: eventId, type, data: { object: subscriptionObject() } };
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

function ledgerRows(eventId: string): Row[] {
  return (db.billing_events ?? []).filter(
    (row) => row.stripe_event_id === eventId,
  );
}

const LIVE_ROW: Row = {
  id: "row_1",
  user_id: "user-1",
  customer_id: "cust_row_1",
  stripe_subscription_id: "sub_1",
  plan: "pro",
  status: "incomplete",
};

describe("the billing_events ledger is written before the effect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    hideLedgerFromProbe = false;
    mockSubscriptionRetrieve.mockResolvedValue(subscriptionObject());
    db = {
      billing_events: [],
      billing_subscriptions: [],
      billing_customers: [
        { id: "cust_row_1", user_id: "user-1", stripe_customer_id: "cus_1" },
      ],
    };
  });

  describe("an event nobody can be attributed to", () => {
    /**
     * Companion guard: the fixture really does reach the route and really is
     * unattributable, so the assertions below are about the ledger and not
     * about a payload that never arrived. True on both sides of the fix.
     */
    it("guard: the payment reaches the route and is answered", async () => {
      const response = await deliver(unattributableEvent("evt_orphan"));

      expect(mockConstructEvent).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    });

    it("is still recorded, with no user attached", async () => {
      await deliver(unattributableEvent("evt_orphan"));

      expect(ledgerRows("evt_orphan")).toHaveLength(1);
      expect(ledgerRows("evt_orphan")[0].user_id).toBeNull();
    });

    it("short-circuits its own redelivery instead of running again", async () => {
      await deliver(unattributableEvent("evt_orphan"));
      const redelivery = await deliver(unattributableEvent("evt_orphan"));

      expect(await redelivery.json()).toEqual({
        received: true,
        duplicate: true,
      });
      expect(ledgerRows("evt_orphan")).toHaveLength(1);
    });
  });

  describe("an attempt that fails half-way", () => {
    it("leaves the event on record even though the handler threw", async () => {
      // `updated` for a subscription no row exists for: assertRowMatched
      // refuses it so Stripe redelivers.
      const response = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated"),
      );

      expect(response.status).toBe(500);
      expect(ledgerRows("evt_updated")).toHaveLength(1);
    });

    it("records it as not processed, because it was not", async () => {
      await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated"),
      );

      expect(ledgerRows("evt_updated")[0].processed).toBe(false);
    });

    /**
     * The guard against the naive version of this fix: short-circuiting on the
     * mere EXISTENCE of a ledger row would make every failed attempt
     * unretryable — the effect never happened, and Stripe's redelivery would be
     * answered 200 and discarded. `processed` is what tells the two apart.
     */
    it("is retried on redelivery rather than swallowed as a duplicate", async () => {
      await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated"),
      );

      // The `created` that the `updated` overtook finally lands its row.
      db.billing_subscriptions = [{ ...LIVE_ROW }];

      const redelivery = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated"),
      );

      expect(redelivery.status).toBe(200);
      expect(await redelivery.json()).toEqual({ received: true });
      expect(db.billing_subscriptions[0].status).toBe("active");
    });
  });

  describe("an attempt that succeeds", () => {
    /**
     * The other half of the `processed` contract, and the reason the column is
     * updated after the switch rather than left at its claim-time value: a row
     * that stayed `false` forever would make the flag mean nothing and every
     * redelivery re-run the handler.
     */
    it("marks the event processed once the handler has returned", async () => {
      db.billing_subscriptions = [{ ...LIVE_ROW }];

      const response = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated"),
      );

      expect(response.status).toBe(200);
      expect(ledgerRows("evt_updated")[0].processed).toBe(true);
    });
  });

  describe("two deliveries of the same event at once", () => {
    /**
     * Both probes miss, both try to claim, one hits the UNIQUE constraint. The
     * loser must find that out BEFORE running the handler — that is the whole
     * point of claiming first. It used to run the entire handler and only
     * discover the collision on the audit insert afterwards.
     */
    it("the loser answers 200 without applying the effect a second time", async () => {
      db.billing_events = [
        {
          user_id: "user-1",
          event_type: "customer.subscription.updated",
          stripe_event_id: "evt_updated",
          data: {},
          processed: false,
        },
      ];
      db.billing_subscriptions = [{ ...LIVE_ROW }];
      hideLedgerFromProbe = true;

      const response = await deliver(
        subscriptionEvent("evt_updated", "customer.subscription.updated"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        received: true,
        duplicate: true,
      });
      // The winner is still mid-flight; this delivery must not have touched the
      // row on its way to finding out it lost.
      expect(db.billing_subscriptions[0].status).toBe("incomplete");
    });
  });
});
