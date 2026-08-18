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
/**
 * `charge.dispute.closed` carries the charge as a bare id, so deciding whether
 * the dispute was settled by refunding means asking Stripe for the charge.
 */
const mockChargeRetrieve = jest.fn();
/**
 * `charge.dispute.created` asks Stripe for the dispute's CURRENT status, because
 * the event payload only says what it was when the event was minted.
 */
const mockDisputeRetrieve = jest.fn();

/**
 * HARNESS ONLY — the behaviour asserted below is unchanged.
 *
 * A dispute closed AGAINST us now also stops the subscription the disputed
 * invoice was billing, which means asking Stripe which invoice the payment
 * paid (see dispute-subscription.test.ts, which is what covers that). Every
 * dispute in this file is against a Lifetime Pro payment intent — a one-off
 * purchase, which pays no invoice — so Stripe answers with an empty list and
 * there is no subscription to stop, exactly as these tests already assume.
 */
const mockInvoicePaymentsList = jest.fn(async () => ({ data: [] }));

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { update: mockSubscriptionUpdate },
    charges: { retrieve: (...args: unknown[]) => mockChargeRetrieve(...args) },
    disputes: {
      retrieve: (...args: unknown[]) => mockDisputeRetrieve(...args),
    },
    invoicePayments: {
      list: () => mockInvoicePaymentsList(),
    },
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

/**
 * UNIQUE constraints the code relies on. `billing_events.stripe_event_id` is
 * what makes each dispute's credit-revocation record write-once, so the fake has
 * to raise on a second insert the way Postgres does.
 */
const UNIQUE_COLUMN: Record<string, string> = {
  billing_events: "stripe_event_id",
};

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
import { restoreEntitlementForPayment } from "@/lib/billing/entitlements";
import {
  readRevokedCredits,
  recordCreditRevocation,
} from "@/lib/billing/credit-revocations";
import { restorePurchasedCredits } from "@/lib/credits/system";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const PAYMENT_INTENT = "pi_lifetime_1";
const CHARGE_ID = "ch_1";
const LIFETIME_PRICE_CENTS = 19900;

/** What Stripe reports for the disputed charge. */
function chargeState(amountRefunded: number, refunded: boolean) {
  return {
    id: CHARGE_ID,
    payment_intent: PAYMENT_INTENT,
    amount: LIFETIME_PRICE_CENTS,
    amount_refunded: amountRefunded,
    refunded,
  };
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

function disputeEvent(
  eventId: string,
  type: string,
  status: string,
  disputeId: string = "dp_1",
): unknown {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: disputeId,
        payment_intent: PAYMENT_INTENT,
        charge: CHARGE_ID,
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
        ...chargeState(amountRefunded, refunded),
        customer: "cus_1",
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
    // Default: the charge still stands. A dispute settled by refunding is the
    // exception, and the tests that model it say so.
    mockChargeRetrieve.mockResolvedValue(chargeState(0, false));
    // Default: the dispute is still running, so a `created` applies normally.
    mockDisputeRetrieve.mockImplementation(async (disputeId: string) => ({
      id: disputeId,
      status: "needs_response",
      payment_intent: PAYMENT_INTENT,
      charge: CHARGE_ID,
      amount: LIFETIME_PRICE_CENTS,
    }));
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

    /**
     * The hole Devin found in the first version of this fix.
     *
     * Refunding the charge is the STANDARD way to settle an early-fraud warning
     * or inquiry, and Stripe then closes the dispute as `warning_closed` (or
     * `won`) — a status the handler read as "restore everything". The customer
     * ended up with the $199 back, lifetime access, and a refilled wallet.
     *
     * Note the middle step is a no-op for our tables: `revokeEntitlementForPayment`
     * filters on `revoked_at IS NULL`, so the dispute revocation is already in
     * place and `source` still says `revoked:dispute`. Checking the source alone
     * cannot catch this sequence — only the charge can.
     */
    it("does not restore when the dispute was settled by refunding the charge", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      // The merchant refunds in full to settle it.
      mockChargeRetrieve.mockResolvedValue(
        chargeState(LIFETIME_PRICE_CENTS, true),
      );
      await deliver(refundEvent("evt_refund", LIFETIME_PRICE_CENTS, true));

      // Stripe closes the dispute off the back of that refund.
      const closed = await deliver(
        disputeEvent(
          "evt_dispute_closed",
          "charge.dispute.closed",
          "warning_closed",
        ),
      );

      expect(closed.status).toBe(200);
      expect(entitlement()?.revoked_at).not.toBeNull();
      expect(wallet()?.credits_remaining).toBe(0);
    });

    it("does not restore a won dispute whose charge was refunded anyway", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      mockChargeRetrieve.mockResolvedValue(
        chargeState(LIFETIME_PRICE_CENTS, true),
      );
      await deliver(
        disputeEvent("evt_dispute_closed", "charge.dispute.closed", "won"),
      );

      expect(entitlement()?.revoked_at).not.toBeNull();
      expect(wallet()?.credits_remaining).toBe(0);
    });

    it("checks the disputed charge before restoring anything", async () => {
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

      // The restore path is only reachable through the charge lookup, so the
      // clean-win cases above cannot pass by skipping the refund check.
      expect(mockChargeRetrieve).toHaveBeenCalledWith(CHARGE_ID);
      expect(entitlement()?.revoked_at).toBeNull();
      expect(wallet()?.credits_remaining).toBe(1000);
    });

    it("leaves the revocation in place when the dispute names no charge", async () => {
      await deliver(
        disputeEvent(
          "evt_dispute_created",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      const closed = await deliver({
        id: "evt_dispute_closed",
        type: "charge.dispute.closed",
        data: {
          object: {
            id: "dp_1",
            payment_intent: PAYMENT_INTENT,
            charge: null,
            amount: LIFETIME_PRICE_CENTS,
            status: "won",
          },
        },
      });

      // Unverifiable, so it fails closed: a support ticket is recoverable,
      // giving away a product we may have refunded is not.
      expect(closed.status).toBe(200);
      expect(mockChargeRetrieve).not.toHaveBeenCalled();
      expect(entitlement()?.revoked_at).not.toBeNull();
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

  /**
   * A `charge.dispute.created` processed after its own `closed`.
   *
   * Two ways in. Delivery is at-least-once and explicitly unordered, so a
   * first-time `created` can arrive late; and dispute events used to miss the
   * route's idempotency short-circuit altogether, because `logBillingEvent` only
   * writes the seen-list row once it can attribute an event to a user and a
   * Dispute object carries neither `metadata.user_id` nor `customer`. Either way
   * the handler re-revoked, and with the dispute already closed nothing was left
   * to restore it: the customer paid and held nothing.
   */
  describe("a created that arrives after the dispute has closed", () => {
    it("does not re-revoke what winning the dispute restored", async () => {
      await deliver(
        disputeEvent(
          "evt_created_first",
          "charge.dispute.created",
          "needs_response",
        ),
      );
      await deliver(disputeEvent("evt_closed", "charge.dispute.closed", "won"));
      expect(entitlement()?.revoked_at).toBeNull();
      expect(wallet()?.credits_remaining).toBe(1000);

      // The late arrival. A distinct event id on purpose: the seen-list cannot
      // answer this one, so it is the live status doing the work.
      mockDisputeRetrieve.mockResolvedValue({
        id: "dp_1",
        status: "won",
        payment_intent: PAYMENT_INTENT,
        charge: CHARGE_ID,
        amount: LIFETIME_PRICE_CENTS,
      });

      const late = await deliver(
        disputeEvent(
          "evt_created_late",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      expect(late.status).toBe(200);
      expect(entitlement()?.revoked_at).toBeNull();
      expect(entitlement()?.source).toBe("lifetime_purchase");
      expect(wallet()?.credits_remaining).toBe(1000);
    });

    it("still applies a redelivery while the dispute is running", async () => {
      await deliver(
        disputeEvent(
          "evt_created_first",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      // Same dispute, still open — a retry after a crash must COMPLETE the
      // revocation, not skip it, and re-applying must not double anything.
      const again = await deliver(
        disputeEvent(
          "evt_created_again",
          "charge.dispute.created",
          "needs_response",
        ),
      );

      expect(again.status).toBe(200);
      expect(entitlement()?.revoked_at).not.toBeNull();
      expect(wallet()?.credits_remaining).toBe(0);
      // One dispute, one clawback record, still holding the truthful amount.
      expect(
        db.billing_events?.filter(
          (row) => row.stripe_event_id === "credits_revoked:dp_1",
        ),
      ).toHaveLength(1);
      await expect(readRevokedCredits("dp_1")).resolves.toBe(1000);
    });

    it("500s rather than guessing when the dispute cannot be read", async () => {
      mockDisputeRetrieve.mockRejectedValue(new Error("Stripe is unreachable"));

      const response = await deliver(
        disputeEvent("evt_created", "charge.dispute.created", "needs_response"),
      );

      // Stripe redelivers, which is recoverable; acting on an unknown status is
      // not. Nothing was touched.
      expect(response.status).toBe(500);
      expect(entitlement()?.revoked_at).toBeNull();
      expect(wallet()?.credits_remaining).toBe(1000);
    });

    it("logs dispute events, so a genuine redelivery short-circuits", async () => {
      const created = disputeEvent(
        "evt_created",
        "charge.dispute.created",
        "needs_response",
      );

      await deliver(created);
      const redelivery = await deliver(created);

      // The belt-and-braces half: `logBillingEvent` resolves a dispute's user
      // through the payment intent now, so the event reaches the seen-list and
      // the same event id never runs the handler twice.
      expect(await redelivery.json()).toEqual({
        received: true,
        duplicate: true,
      });
      expect(
        db.billing_events?.filter(
          (row) => row.stripe_event_id === "evt_created",
        ),
      ).toHaveLength(1);
    });
  });

  /**
   * A `closed` whose `created` never landed.
   *
   * `lost` used to be a bare early return that assumed `created` had already
   * revoked. Nothing guarantees that: `created` can be delivered after this
   * event, or fail until Stripe stops trying. The assumption's worst case is the
   * one that costs most — a chargeback that took the money and left the customer
   * holding the product.
   */
  it("revokes on a lost dispute even if the created never arrived", async () => {
    const response = await deliver(
      disputeEvent("evt_closed_lost", "charge.dispute.closed", "lost"),
    );

    expect(response.status).toBe(200);
    expect(entitlement()?.revoked_at).not.toBeNull();
    expect(entitlement()?.source).toBe("revoked:dispute");
    expect(wallet()?.credits_remaining).toBe(0);
  });

  /**
   * A payment can be disputed more than once, and the clawbacks differ.
   *
   * The record of "how much this took away" used to be keyed per PAYMENT with
   * insert-ignore-duplicates, so a second dispute silently reused the first
   * one's number. `credits_purchased` does not cap that away — the stale number
   * IS what the pack held — so winning twice handed back credits that had been
   * spent in between. Keyed per dispute now.
   */
  describe("a payment disputed twice", () => {
    /** What `credit_usage` would leave behind: the customer spent 600. */
    function spendCredits(remaining: number): void {
      db.credit_purchases = (db.credit_purchases ?? []).map((row) => ({
        ...row,
        credits_remaining: remaining,
      }));
    }

    it("gives back only what the second dispute took, not what the first did", async () => {
      // Dispute #1 takes the whole 1,000 and is won.
      await deliver(
        disputeEvent(
          "evt_created_1",
          "charge.dispute.created",
          "needs_response",
          "dp_1",
        ),
      );
      await deliver(
        disputeEvent("evt_closed_1", "charge.dispute.closed", "won", "dp_1"),
      );
      expect(wallet()?.credits_remaining).toBe(1000);

      // The customer spends 600 of what came back.
      spendCredits(400);

      // Dispute #2 can only take the 400 that is left.
      await deliver(
        disputeEvent(
          "evt_created_2",
          "charge.dispute.created",
          "needs_response",
          "dp_2",
        ),
      );
      expect(wallet()?.credits_remaining).toBe(0);

      await deliver(
        disputeEvent("evt_closed_2", "charge.dispute.closed", "won", "dp_2"),
      );

      // 400, not the 1,000 dispute #1 recorded: the 600 was already spent.
      expect(wallet()?.credits_remaining).toBe(400);
    });

    it("keeps a record per dispute rather than one per payment", async () => {
      await deliver(
        disputeEvent(
          "evt_created_1",
          "charge.dispute.created",
          "needs_response",
          "dp_1",
        ),
      );
      await deliver(
        disputeEvent("evt_closed_1", "charge.dispute.closed", "won", "dp_1"),
      );
      spendCredits(400);
      await deliver(
        disputeEvent(
          "evt_created_2",
          "charge.dispute.created",
          "needs_response",
          "dp_2",
        ),
      );

      await expect(readRevokedCredits("dp_1")).resolves.toBe(1000);
      await expect(readRevokedCredits("dp_2")).resolves.toBe(400);
    });
  });

  describe("the credit-revocation record", () => {
    it("survives a second delivery of the same dispute without changing", async () => {
      // The first delivery's number is the truthful one: by the time a retry
      // runs, the wallet it measured has already been zeroed.
      await recordCreditRevocation({
        stripeDisputeId: "dp_1",
        stripePaymentIntentId: PAYMENT_INTENT,
        credits: 1000,
        userId: "user-1",
      });

      // A redelivery reaching the insert hits the UNIQUE constraint, which is
      // tolerated rather than thrown — and must not lower the recorded amount.
      await expect(
        recordCreditRevocation({
          stripeDisputeId: "dp_1",
          stripePaymentIntentId: PAYMENT_INTENT,
          credits: 1,
          userId: "user-1",
        }),
      ).resolves.toBeUndefined();

      await expect(readRevokedCredits("dp_1")).resolves.toBe(1000);
      expect(
        db.billing_events?.filter(
          (row) => row.stripe_event_id === "credits_revoked:dp_1",
        ),
      ).toHaveLength(1);
    });

    it("restores to a balance rather than adding to one, so a replay is a no-op", async () => {
      // As revocation leaves it.
      db.credit_purchases = (db.credit_purchases ?? []).map((row) => ({
        ...row,
        credits_remaining: 0,
      }));

      await expect(
        restorePurchasedCredits(PAYMENT_INTENT, 400),
      ).resolves.toEqual({ restored: 400 });
      expect(wallet()?.credits_remaining).toBe(400);

      // A `charge.dispute.closed` processed twice must not pay out twice. Were
      // this additive, the balance would climb to 800.
      await expect(
        restorePurchasedCredits(PAYMENT_INTENT, 400),
      ).resolves.toEqual({ restored: 0 });
      expect(wallet()?.credits_remaining).toBe(400);
    });
  });

  /**
   * The second layer of the same defence, exercised directly.
   *
   * No webhook sequence can isolate it: a refund revocation implies a refunded
   * charge, which `handleDisputeClosed` already refuses on. This is what stops a
   * future caller — or a dispute closed while Stripe reports the charge as
   * un-refunded — from reversing a revocation that was never a chargeback.
   */
  describe("restoreEntitlementForPayment only reverses a chargeback", () => {
    it("refuses a row revoked by a refund", async () => {
      db.plan_entitlements = [
        {
          id: "ent_1",
          user_id: "user-1",
          plan_id: "pro",
          source: "revoked:refund",
          stripe_payment_intent_id: PAYMENT_INTENT,
          revoked_at: "2026-08-08T00:00:00.000Z",
        },
      ];

      await expect(
        restoreEntitlementForPayment(PAYMENT_INTENT),
      ).resolves.toEqual({ restored: false });

      expect(entitlement()?.revoked_at).toBe("2026-08-08T00:00:00.000Z");
      expect(entitlement()?.source).toBe("revoked:refund");
    });

    it("restores a row revoked by a dispute", async () => {
      db.plan_entitlements = [
        {
          id: "ent_1",
          user_id: "user-1",
          plan_id: "pro",
          source: "revoked:dispute",
          stripe_payment_intent_id: PAYMENT_INTENT,
          revoked_at: "2026-08-08T00:00:00.000Z",
        },
      ];

      await expect(
        restoreEntitlementForPayment(PAYMENT_INTENT),
      ).resolves.toEqual({ restored: true });

      expect(entitlement()?.revoked_at).toBeNull();
      expect(entitlement()?.source).toBe("lifetime_purchase");
    });
  });
});
