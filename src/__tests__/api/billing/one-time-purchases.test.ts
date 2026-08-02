/**
 * One-off Stripe payments: credit top-ups and Lifetime Pro.
 *
 * Both are granted only from `payment_intent.succeeded`, so these tests drive
 * the real route handler rather than asserting on a hand-built event object.
 */

const mockConstructEvent = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
);

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "sig_test" })),
}));

const maybeSingleMock = jest.fn();
const insertMock = jest.fn();

interface QueryBuilder {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
  insert: jest.Mock;
}

const queryBuilder: QueryBuilder = {
  select: jest.fn((): QueryBuilder => queryBuilder),
  eq: jest.fn((): QueryBuilder => queryBuilder),
  maybeSingle: maybeSingleMock,
  insert: insertMock,
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
    maybeSingleMock.mockResolvedValue({ data: { id: "row-1" }, error: null });

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
