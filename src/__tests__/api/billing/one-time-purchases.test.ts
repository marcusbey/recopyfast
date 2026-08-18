/**
 * One-off Stripe payments: credit top-ups and Lifetime Pro.
 *
 * Both are granted only from `payment_intent.succeeded`, so these tests drive
 * the real route handler rather than asserting on a hand-built event object.
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

const maybeSingleMock = jest.fn();
const insertMock = jest.fn();
/** Live `billing_subscriptions` rows the lifetime buyer still has running. */
const liveSubscriptionsMock = jest.fn();

interface QueryBuilder {
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  returns: jest.Mock;
  maybeSingle: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
}

/**
 * HARNESS ONLY — the behaviour asserted below is unchanged.
 *
 * The route now claims the `billing_events` row before the switch and marks it
 * `processed` after it, so an awaitable `.update().eq().select()` chain has to
 * exist on the fake client. It answers with one affected row, which is what
 * `assertRowMatched` expects of a ledger row that was just claimed. Nothing in
 * this file asserts on it: these tests are about credit top-ups and Lifetime
 * Pro, and the ledger itself is covered in stripe-webhook-ledger.test.ts.
 */
interface UpdateChain {
  eq: jest.Mock;
  select: jest.Mock;
  then: <T>(
    resolve: (value: { data: Array<{ id: string }>; error: null }) => T,
    reject?: (reason: unknown) => T,
  ) => Promise<T>;
}

const updateChain: UpdateChain = {
  eq: jest.fn((): UpdateChain => updateChain),
  select: jest.fn((): UpdateChain => updateChain),
  then: <T>(
    resolve: (value: { data: Array<{ id: string }>; error: null }) => T,
    reject?: (reason: unknown) => T,
  ) =>
    Promise.resolve({ data: [{ id: "billing_event_row" }], error: null }).then(
      resolve,
      reject,
    ),
};

const queryBuilder: QueryBuilder = {
  select: jest.fn((): QueryBuilder => queryBuilder),
  eq: jest.fn((): QueryBuilder => queryBuilder),
  in: jest.fn((): QueryBuilder => queryBuilder),
  returns: jest.fn(() => liveSubscriptionsMock()),
  maybeSingle: maybeSingleMock,
  insert: insertMock,
  update: jest.fn(() => updateChain),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => queryBuilder),
  })),
}));

jest.mock("@/lib/credits/system", () => ({
  addPurchasedCredits: jest.fn(),
  revokePurchasedCredits: jest.fn(),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  grantPlanEntitlement: jest.fn(),
  revokeEntitlementForPayment: jest.fn(),
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import {
  addPurchasedCredits,
  revokePurchasedCredits,
} from "@/lib/credits/system";
import {
  grantPlanEntitlement,
  revokeEntitlementForPayment,
} from "@/lib/billing/entitlements";

const asMock = (fn: unknown) => fn as jest.Mock;

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

function paymentIntentEvent(metadata: Record<string, string>) {
  return {
    id: "evt_test",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_test", metadata } },
  };
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

describe("payment_intent.succeeded", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No prior billing_events row: the event has not been processed before.
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    insertMock.mockResolvedValue({ error: null });
    asMock(grantPlanEntitlement).mockResolvedValue({
      granted: true,
      duplicate: false,
    });
    asMock(addPurchasedCredits).mockResolvedValue({
      success: true,
      duplicate: false,
    });
    asMock(revokeEntitlementForPayment).mockResolvedValue({ revoked: true });
    asMock(revokePurchasedCredits).mockResolvedValue({ revoked: 0 });
    liveSubscriptionsMock.mockResolvedValue({ data: [], error: null });
    mockSubscriptionUpdate.mockResolvedValue({});
  });

  describe("credit purchases", () => {
    it("credits the wallet with the quantity Stripe carried", async () => {
      const response = await deliver(
        paymentIntentEvent({
          type: "credit_purchase",
          user_id: "user-1",
          credit_quantity: "1000",
        }),
      );

      expect(response.status).toBe(200);
      // 4th argument is amount_received, stored as price_cents. Absent on this
      // fixture, which is the "we do not know what it cost" case.
      expect(addPurchasedCredits).toHaveBeenCalledWith(
        "user-1",
        1000,
        "pi_test",
        undefined,
      );
    });

    it("fails loudly on an unusable quantity rather than crediting nothing", async () => {
      const response = await deliver(
        paymentIntentEvent({
          type: "credit_purchase",
          user_id: "user-1",
          credit_quantity: "not-a-number",
        }),
      );

      // 500 makes Stripe retry, which is recoverable; a silent 200 would lose
      // the top-up the customer already paid for.
      expect(response.status).toBe(500);
      expect(addPurchasedCredits).not.toHaveBeenCalled();
    });
  });

  describe("Lifetime Pro", () => {
    it("grants the plan named in the payment metadata, permanently", async () => {
      const response = await deliver(
        paymentIntentEvent({
          type: "lifetime_purchase",
          user_id: "user-1",
          grants_plan_id: "pro",
        }),
      );

      expect(response.status).toBe(200);
      expect(grantPlanEntitlement).toHaveBeenCalledWith(
        "user-1",
        "pro",
        "pi_test",
      );
      expect(addPurchasedCredits).not.toHaveBeenCalled();
    });

    it("accepts a redelivered purchase without granting twice", async () => {
      asMock(grantPlanEntitlement).mockResolvedValue({
        granted: false,
        duplicate: true,
      });

      const response = await deliver(
        paymentIntentEvent({
          type: "lifetime_purchase",
          user_id: "user-1",
          grants_plan_id: "pro",
        }),
      );

      expect(response.status).toBe(200);
      expect(grantPlanEntitlement).toHaveBeenCalledTimes(1);
    });

    /**
     * A lifetime buyer's running subscription is stopped for them. Each
     * cancellation is independent, so one failing must not decide the rest:
     * the guard used to sit outside the loop, and a transient Stripe error on
     * the first row left every later subscription billing forever. There is no
     * second chance — the grant is already recorded, so a webhook retry
     * short-circuits before reaching this code.
     */
    it("keeps cancelling after one subscription fails to cancel", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      jest.spyOn(console, "log").mockImplementation(() => {});
      liveSubscriptionsMock.mockResolvedValue({
        data: [
          { stripe_subscription_id: "sub_first" },
          { stripe_subscription_id: "sub_second" },
        ],
        error: null,
      });
      mockSubscriptionUpdate
        .mockRejectedValueOnce(new Error("Stripe rate limit"))
        .mockResolvedValueOnce({});

      const response = await deliver(
        paymentIntentEvent({
          type: "lifetime_purchase",
          user_id: "user-1",
          grants_plan_id: "pro",
        }),
      );

      // The grant still stands — cancellation trouble must never cost the
      // customer the thing they paid $199 for.
      expect(response.status).toBe(200);
      expect(mockSubscriptionUpdate).toHaveBeenCalledTimes(2);
      expect(mockSubscriptionUpdate).toHaveBeenLastCalledWith(
        "sub_second",
        expect.objectContaining({ cancel_at_period_end: true }),
      );
    });

    it("refuses a lifetime payment that says nothing about what it grants", async () => {
      const response = await deliver(
        paymentIntentEvent({
          type: "lifetime_purchase",
          user_id: "user-1",
        }),
      );

      expect(response.status).toBe(500);
      expect(grantPlanEntitlement).not.toHaveBeenCalled();
    });
  });

  it("ignores a payment we did not originate", async () => {
    const response = await deliver(paymentIntentEvent({}));

    expect(response.status).toBe(200);
    expect(addPurchasedCredits).not.toHaveBeenCalled();
    expect(grantPlanEntitlement).not.toHaveBeenCalled();
  });

  it("short-circuits an event it has already processed", async () => {
    // HARNESS ONLY — `processed: true` added to the fixture. The ledger row is
    // now written BEFORE the handler runs, so its mere existence no longer
    // means the event was applied; `processed` is what says so. The assertion
    // (a processed event does not grant twice) is unchanged.
    maybeSingleMock.mockResolvedValue({
      data: { id: "row-1", processed: true },
      error: null,
    });

    const response = await deliver(
      paymentIntentEvent({
        type: "lifetime_purchase",
        user_id: "user-1",
        grants_plan_id: "pro",
      }),
    );

    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(grantPlanEntitlement).not.toHaveBeenCalled();
  });
});
