/**
 * A chargeback on a SUBSCRIPTION invoice used to take nothing away.
 *
 * `handleMoneyReturned` revokes through `revokeEntitlementForPayment` and
 * `revokePurchasedCredits`, both keyed on `stripe_payment_intent_id` — a column
 * only `plan_entitlements` (Lifetime Pro) and `credit_purchases` (top-ups)
 * carry. `billing_subscriptions` has no payment-intent column and is touched by
 * no dispute or refund path at all, so a customer who charged back a monthly
 * invoice kept `status: 'active'`, kept their plan, and kept being billed for
 * the next period.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO
 *
 * It sets `cancel_at_period_end` on the Stripe subscription, and only when a
 * dispute CLOSES against us. Not on `charge.dispute.created`: that revocation is
 * provisional — the bank merely holds the money — and every provisional action
 * in this file has an undo, while a subscription cancellation does not (Stripe
 * issues a new id on resubscribe, and un-setting the flag on a customer who
 * cancelled it themselves would silently put them back on a plan they left).
 *
 * Not an immediate cancellation either, for the reason
 * `stopBillingForLifetimeOwner` already states beside it: a chargeback can be
 * filed months after the charge, so the CURRENT period may be one the customer
 * has since paid for in full. Ending it early would take money for nothing and
 * invite the second chargeback.
 *
 * And never on a guess: the disputed payment is resolved to a subscription
 * through Stripe's own invoice-payment mapping, and a payment that cannot be
 * tied to a subscription invoice is left alone and logged.
 *
 * Every Stripe call here is mocked. No subscription is ever cancelled for real.
 */

const mockConstructEvent = jest.fn();
const mockChargeRetrieve = jest.fn();
const mockDisputeRetrieve = jest.fn();
const mockInvoicePaymentsList = jest.fn();
const mockInvoiceRetrieve = jest.fn();
const mockSubscriptionRetrieve = jest.fn();
const mockSubscriptionUpdate = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    charges: { retrieve: (...args: unknown[]) => mockChargeRetrieve(...args) },
    disputes: {
      retrieve: (...args: unknown[]) => mockDisputeRetrieve(...args),
    },
    invoicePayments: {
      list: (...args: unknown[]) => mockInvoicePaymentsList(...args),
    },
    invoices: {
      retrieve: (...args: unknown[]) => mockInvoiceRetrieve(...args),
    },
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionRetrieve(...args),
      update: (...args: unknown[]) => mockSubscriptionUpdate(...args),
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

const UNIQUE_COLUMN: Record<string, string> = {
  billing_events: "stripe_event_id",
};

/** supabase-js-shaped client over `db`. See dispute-lifecycle.test.ts. */
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

// The credits module reaches for the cookie-scoped client at import time.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

const PAYMENT_INTENT = "pi_subscription_invoice";
const CHARGE_ID = "ch_1";
const INVOICE_ID = "in_1";
const SUBSCRIPTION_ID = "sub_1";
const MONTHLY_PRICE_CENTS = 1900;

function disputeEvent(eventId: string, type: string, status: string): unknown {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "dp_1",
        payment_intent: PAYMENT_INTENT,
        charge: CHARGE_ID,
        amount: MONTHLY_PRICE_CENTS,
        status,
      },
    },
  };
}

/** What Stripe answers when asked which invoice this payment paid. */
function invoicePayments(invoiceId: string | null) {
  return {
    data:
      invoiceId === null
        ? []
        : [
            {
              id: "inpay_1",
              object: "invoice_payment",
              invoice: invoiceId,
              status: "paid",
              payment: {
                type: "payment_intent",
                payment_intent: PAYMENT_INTENT,
              },
            },
          ],
  };
}

/** An invoice generated by a subscription, in the Basil `parent` shape. */
function subscriptionInvoice(subscriptionId: string) {
  return {
    id: INVOICE_ID,
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { subscription: subscriptionId, metadata: null },
    },
  };
}

function subscriptionState(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    status: "active",
    cancel_at_period_end: false,
    ...overrides,
  };
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

describe("a chargeback on a subscription invoice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    // The charge still stands: nothing was refunded to settle this dispute.
    mockChargeRetrieve.mockResolvedValue({
      id: CHARGE_ID,
      payment_intent: PAYMENT_INTENT,
      amount: MONTHLY_PRICE_CENTS,
      amount_refunded: 0,
      refunded: false,
    });
    mockDisputeRetrieve.mockImplementation(async (disputeId: string) => ({
      id: disputeId,
      status: "needs_response",
      payment_intent: PAYMENT_INTENT,
      charge: CHARGE_ID,
      amount: MONTHLY_PRICE_CENTS,
    }));
    mockInvoicePaymentsList.mockResolvedValue(invoicePayments(INVOICE_ID));
    mockInvoiceRetrieve.mockResolvedValue(subscriptionInvoice(SUBSCRIPTION_ID));
    mockSubscriptionRetrieve.mockResolvedValue(subscriptionState());
    mockSubscriptionUpdate.mockResolvedValue(subscriptionState());
    db = {
      billing_events: [],
      billing_customers: [
        { id: "cust_row_1", user_id: "user-1", stripe_customer_id: "cus_1" },
      ],
      plan_entitlements: [],
      credit_purchases: [],
    };
  });

  describe("a dispute closed against us", () => {
    /**
     * Companion guard: the fixture reaches the route and is answered, so the
     * assertions below are about what the handler decided and not about a
     * payload that never arrived. True on both sides of the fix.
     */
    it("guard: the lost dispute reaches the route and is answered", async () => {
      const response = await deliver(
        disputeEvent("evt_lost", "charge.dispute.closed", "lost"),
      );

      expect(mockConstructEvent).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    });

    it("stops the subscription at the end of the period it has paid for", async () => {
      await deliver(disputeEvent("evt_lost", "charge.dispute.closed", "lost"));

      expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.objectContaining({ cancel_at_period_end: true }),
      );
    });

    it("records why, on the subscription itself", async () => {
      await deliver(disputeEvent("evt_lost", "charge.dispute.closed", "lost"));

      expect(mockSubscriptionUpdate).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.objectContaining({
          metadata: { cancelled_reason: "chargeback", disputeId: "dp_1" },
        }),
      );
    });

    it("resolves the subscription from the disputed payment, not from a guess", async () => {
      await deliver(disputeEvent("evt_lost", "charge.dispute.closed", "lost"));

      expect(mockInvoicePaymentsList).toHaveBeenCalledWith(
        expect.objectContaining({
          payment: { type: "payment_intent", payment_intent: PAYMENT_INTENT },
        }),
      );
      expect(mockInvoiceRetrieve).toHaveBeenCalledWith(INVOICE_ID);
    });
  });

  describe("a payment that is not a subscription invoice", () => {
    it("cancels nothing when the payment paid no invoice at all", async () => {
      // A Lifetime Pro purchase or a credit top-up: no invoice, no subscription.
      mockInvoicePaymentsList.mockResolvedValue(invoicePayments(null));

      const response = await deliver(
        disputeEvent("evt_lost", "charge.dispute.closed", "lost"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("cancels nothing when the invoice was not generated by a subscription", async () => {
      mockInvoiceRetrieve.mockResolvedValue({
        id: INVOICE_ID,
        parent: {
          type: "quote_details",
          quote_details: { quote: "qt_1" },
          subscription_details: null,
        },
      });

      const response = await deliver(
        disputeEvent("evt_lost", "charge.dispute.closed", "lost"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("cancels nothing when the payment paid two different subscriptions", async () => {
      // One payment intent can settle more than one invoice. Picking the first
      // would be cancelling by elimination — exactly what this must not do.
      mockInvoicePaymentsList.mockResolvedValue({
        data: [
          {
            id: "inpay_1",
            invoice: "in_1",
            status: "paid",
            payment: { type: "payment_intent", payment_intent: PAYMENT_INTENT },
          },
          {
            id: "inpay_2",
            invoice: "in_2",
            status: "paid",
            payment: { type: "payment_intent", payment_intent: PAYMENT_INTENT },
          },
        ],
      });
      mockInvoiceRetrieve.mockImplementation(async (invoiceId: string) => ({
        ...subscriptionInvoice(invoiceId === "in_1" ? "sub_1" : "sub_2"),
        id: invoiceId,
      }));

      const response = await deliver(
        disputeEvent("evt_lost", "charge.dispute.closed", "lost"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("cancels nothing when the dispute names no payment intent", async () => {
      const response = await deliver({
        id: "evt_lost",
        type: "charge.dispute.closed",
        data: {
          object: {
            id: "dp_1",
            payment_intent: null,
            charge: CHARGE_ID,
            amount: MONTHLY_PRICE_CENTS,
            status: "lost",
          },
        },
      });

      expect(response.status).toBe(200);
      expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("500s rather than guessing when Stripe cannot say what was paid", async () => {
      mockInvoicePaymentsList.mockRejectedValue(
        new Error("Stripe is unreachable"),
      );

      const response = await deliver(
        disputeEvent("evt_lost", "charge.dispute.closed", "lost"),
      );

      // Redelivery is recoverable; cancelling on an unknown mapping is not.
      expect(response.status).toBe(500);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });
  });

  describe("a dispute that does not close against us", () => {
    it("cancels nothing when the dispute is won", async () => {
      const response = await deliver(
        disputeEvent("evt_won", "charge.dispute.closed", "won"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("cancels nothing when the customer withdraws the dispute", async () => {
      const response = await deliver(
        disputeEvent(
          "evt_withdrawn",
          "charge.dispute.closed",
          "warning_closed",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("cancels nothing while the dispute is merely opened", async () => {
      // Revoking on `created` is provisional and reversible. Cancelling is not.
      const response = await deliver(
        disputeEvent("evt_created", "charge.dispute.created", "needs_response"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });
  });

  describe("a dispute delivered more than once", () => {
    it("does not touch a subscription already set to stop", async () => {
      mockSubscriptionRetrieve.mockResolvedValue(
        subscriptionState({ cancel_at_period_end: true }),
      );

      const response = await deliver(
        disputeEvent("evt_lost_again", "charge.dispute.closed", "lost"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("does not try to update a subscription that is already cancelled", async () => {
      // Stripe rejects an update on a cancelled subscription, so this would be
      // a 500 on every redelivery of a dispute whose work is already done.
      mockSubscriptionRetrieve.mockResolvedValue(
        subscriptionState({ status: "canceled" }),
      );

      const response = await deliver(
        disputeEvent("evt_lost_again", "charge.dispute.closed", "lost"),
      );

      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).not.toHaveBeenCalled();
    });

    it("cancels once across two deliveries of the same dispute", async () => {
      await deliver(
        disputeEvent("evt_lost_first", "charge.dispute.closed", "lost"),
      );
      expect(mockSubscriptionUpdate).toHaveBeenCalledTimes(1);

      // Stripe's copy now reflects the first delivery. A second delivery of the
      // same dispute under a new event id must read that and stop.
      mockSubscriptionRetrieve.mockResolvedValue(
        subscriptionState({ cancel_at_period_end: true }),
      );

      const again = await deliver(
        disputeEvent("evt_lost_second", "charge.dispute.closed", "lost"),
      );

      expect(again.status).toBe(200);
      expect(mockSubscriptionUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
