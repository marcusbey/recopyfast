/**
 * A-8 — winning a dispute leaves the entitlement revoked forever.
 * A-20 — a partial refund revokes the entire entitlement and the whole wallet.
 *
 * `charge.refunded` and `charge.dispute.created` both used to route into
 * `handleMoneyReturned`, which read only `payment_intent` and revoked
 * unconditionally: there was no `charge.dispute.closed` case anywhere in the
 * switch, and neither `amount_refunded` nor the `refunded` boolean was ever
 * consulted. The route now reverses a dispute it wins (`handleDisputeClosed`)
 * and revokes on a refund only when the whole charge came back
 * (`handleChargeRefunded`).
 *
 * The real `revokeEntitlementForPayment` and `revokePurchasedCredits` run here
 * against an in-memory `plan_entitlements` / `credit_purchases`, so every
 * assertion is on the stored row rather than on a mock call or a status code.
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

/** supabase-js-shaped client over `db`. See stripe-webhook-ordering.test.ts. */
function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "update" | "upsert" = "select";
    let values: Row = {};

    const rows = (): Row[] => db[table] ?? [];
    const matched = (): Row[] =>
      rows().filter((row) => predicates.every((predicate) => predicate(row)));

    const run = (): RowsResult => {
      switch (operation) {
        case "insert":
          db[table] = [...rows(), { ...values }];
          return { data: [{ ...values }], error: null };

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
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
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

// The credits module reaches for the cookie-scoped client at import time via
// `@/lib/supabase/server`, which touches `next/headers`. Nothing in this file
// exercises a user-scoped read.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const PAYMENT_INTENT = "pi_lifetime_1";
const LIFETIME_PRICE_CENTS = 19900;

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

function disputeEvent(eventId: string, type: string, status: string): unknown {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "dp_1",
        payment_intent: PAYMENT_INTENT,
        amount: LIFETIME_PRICE_CENTS,
        status,
      },
    },
  };
}

function refundEvent(
  eventId: string,
  amountRefunded: number,
  refunded: boolean,
): unknown {
  return {
    id: eventId,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_1",
        customer: "cus_1",
        payment_intent: PAYMENT_INTENT,
        amount: LIFETIME_PRICE_CENTS,
        amount_refunded: amountRefunded,
        refunded,
      },
    },
  };
}

function entitlement(): Row | undefined {
  return db.plan_entitlements?.[0];
}

function wallet(): Row | undefined {
  return db.credit_purchases?.[0];
}

describe("A-8 / A-20: money coming back out", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    db = {
      billing_events: [],
      billing_customers: [
        { id: "cust_row_1", user_id: "user-1", stripe_customer_id: "cus_1" },
      ],
      plan_entitlements: [
        {
          id: "ent_1",
          user_id: "user-1",
          plan_id: "pro",
          source: "lifetime_purchase",
          stripe_payment_intent_id: PAYMENT_INTENT,
          revoked_at: null,
        },
      ],
      credit_purchases: [
        {
          id: "cp_1",
          user_id: "user-1",
          credits_purchased: 1000,
          credits_remaining: 1000,
          price_cents: LIFETIME_PRICE_CENTS,
          stripe_payment_intent_id: PAYMENT_INTENT,
          expires_at: null,
        },
      ],
    };
  });

  describe("A-8: a dispute that closes in our favour", () => {
    /**
     * Companion to the test below, kept from when that was a `test.failing`
     * marker: a marker passes on ANY failure, so each one needed a sibling
     * proving the harness reaches the code under test. Here: both deliveries
     * are accepted, and the `created` one really does revoke — so the test
     * below asserts on a revocation that genuinely happened, not on an empty
     * fixture. True on both sides of the fix.
     */
    it("guard: both dispute events reach the handler, and created revokes", async () => {
      const created = await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );
      expect(created.status).toBe(200);
      expect(entitlement()?.revoked_at).not.toBeNull();

      const closed = await deliver(
        disputeEvent("evt_dispute_closed", "charge.dispute.closed", "won"),
      );
      expect(closed.status).toBe(200);
      // Revocation is soft: the row survives, which is what makes a reversal
      // possible at all.
      expect(db.plan_entitlements).toHaveLength(1);
    });

    it("restores the entitlement when the dispute is won", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );
      await deliver(
        disputeEvent("evt_dispute_closed", "charge.dispute.closed", "won"),
      );

      expect(entitlement()?.revoked_at).toBeNull();
    });

    it("guard: the wallet row is reachable by payment intent and survives revocation", async () => {
      expect(wallet()?.credits_remaining).toBe(1000);

      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      // `revokePurchasedCredits` found the row by `stripe_payment_intent_id`
      // and zeroed it rather than deleting it — so `credits_purchased` still
      // records what there is to restore.
      expect(db.credit_purchases).toHaveLength(1);
      expect(wallet()?.credits_purchased).toBe(1000);
    });

    it("restores the purchased credits when the dispute is won", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );
      await deliver(
        disputeEvent("evt_dispute_closed", "charge.dispute.closed", "won"),
      );

      expect(wallet()?.credits_remaining).toBe(1000);
    });

    it("guard: a withdrawn-dispute event is delivered and accepted", async () => {
      const withdrawn = await deliver(
        disputeEvent(
          "evt_dispute_closed",
          "charge.dispute.closed",
          "warning_closed",
        ),
      );

      // Reaches the route and is answered — the case below is about what it
      // does with it, not about whether it arrives.
      expect(mockConstructEvent).toHaveBeenCalledTimes(1);
      expect(withdrawn.status).toBe(200);
    });

    it("restores the entitlement when the customer withdraws the dispute", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );
      await deliver(
        disputeEvent(
          "evt_dispute_closed",
          "charge.dispute.closed",
          "warning_closed",
        ),
      );

      expect(entitlement()?.revoked_at).toBeNull();
    });

    /**
     * Fix-stable: revoking on dispute *creation* is intended — the money is
     * held by the bank from that moment. The defect is the missing reversal,
     * not this.
     */
    it("revokes provisionally the moment the dispute is opened", async () => {
      const response = await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      expect(response.status).toBe(200);
      expect(entitlement()?.revoked_at).not.toBeNull();
      expect(entitlement()?.source).toBe("revoked:dispute");
      expect(wallet()?.credits_remaining).toBe(0);
    });

    it("leaves a dispute lost by us revoked", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );
      await deliver(
        disputeEvent("evt_dispute_closed", "charge.dispute.closed", "lost"),
      );

      expect(entitlement()?.revoked_at).not.toBeNull();
      expect(wallet()?.credits_remaining).toBe(0);
    });
  });

  describe("A-20: a refund smaller than the payment", () => {
    /**
     * Companion to the test below — see the A-8 guard for why every marker
     * needed one. A `billing_events` row means the partial-refund payload
     * travelled the whole route: signature, idempotency read, the switch, the
     * customer lookup and the audit insert.
     */
    it("guard: the partial-refund payload reaches the route and is audited", async () => {
      expect(entitlement()?.revoked_at).toBeNull();

      const response = await deliver(refundEvent("evt_partial", 1000, false));

      expect(response.status).toBe(200);
      expect(
        db.billing_events?.some((row) => row.stripe_event_id === "evt_partial"),
      ).toBe(true);
    });

    it("a $10 goodwill refund on a $199 purchase does not revoke the entitlement", async () => {
      const response = await deliver(refundEvent("evt_partial", 1000, false));

      expect(response.status).toBe(200);
      expect(entitlement()?.revoked_at).toBeNull();
    });

    it("guard: the assertion below is reading the right wallet row", async () => {
      expect(wallet()?.stripe_payment_intent_id).toBe(PAYMENT_INTENT);

      await deliver(refundEvent("evt_partial", 1000, false));

      expect(db.credit_purchases).toHaveLength(1);
      expect(wallet()?.credits_purchased).toBe(1000);
    });

    it("a partial refund does not empty the credit wallet", async () => {
      await deliver(refundEvent("evt_partial", 1000, false));

      expect(wallet()?.credits_remaining).toBe(1000);
    });

    /**
     * Fix-stable: a full refund must still take the product back. Any fix that
     * reads `amount_refunded` has to keep answering this the same way.
     */
    it("a full refund revokes the entitlement and the wallet", async () => {
      const response = await deliver(
        refundEvent("evt_full", LIFETIME_PRICE_CENTS, true),
      );

      expect(response.status).toBe(200);
      expect(entitlement()?.revoked_at).not.toBeNull();
      expect(entitlement()?.source).toBe("revoked:refund");
      expect(wallet()?.credits_remaining).toBe(0);
    });

    it("a refund for a payment that granted nothing is a quiet no-op", async () => {
      db.plan_entitlements = [];
      db.credit_purchases = [];

      const response = await deliver(
        refundEvent("evt_orphan", LIFETIME_PRICE_CENTS, true),
      );

      expect(response.status).toBe(200);
    });
  });
});
