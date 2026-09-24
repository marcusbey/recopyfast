const mockSessionCreate = jest.fn();
const mockSessionList = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockSessionCreate(...args),
        list: (...args: unknown[]) => mockSessionList(...args),
      },
    },
  },
  STRIPE_CONFIG: { CURRENCY: "usd" },
}));

jest.mock("@/lib/stripe/customer", () => ({
  createOrGetCustomer: jest.fn(async () => ({
    stripeCustomer: { id: "cus_1" },
  })),
}));

jest.mock("@/lib/stripe/plans", () => ({
  resolveStripePriceId: jest.fn(async () => "price_pro_yearly"),
  getCreditPackConfig: jest.fn(),
  getOneTimeProduct: jest.fn(),
  resolveOneTimePriceId: jest.fn(),
}));

jest.mock("@/lib/deployment/origin", () => ({
  resolveDeploymentOrigin: jest.fn(() => "https://app.example.test"),
}));

import {
  createCheckoutSession,
  findCheckoutSessionForIntent,
} from "@/lib/stripe/checkout";

describe("subscription Checkout pending-intent contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionCreate.mockResolvedValue({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });
  });

  it("uses the database intent for Stripe metadata, expiry and idempotency", async () => {
    const expiresAt = "2026-09-24T18:30:00.000Z";

    await createCheckoutSession(
      "user-1",
      "buyer@example.com",
      { type: "subscription", planId: "pro", billingPeriod: "yearly" },
      undefined,
      { pendingIntentId: "intent_1", expiresAt },
    );
    await createCheckoutSession(
      "user-1",
      "buyer@example.com",
      { type: "subscription", planId: "pro", billingPeriod: "yearly" },
      undefined,
      { pendingIntentId: "intent_1", expiresAt },
    );

    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: Date.parse(expiresAt) / 1000,
        metadata: expect.objectContaining({ checkout_intent_id: "intent_1" }),
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({
            checkout_intent_id: "intent_1",
          }),
        }),
      }),
      { idempotencyKey: "subscription-checkout:intent_1" },
    );
    expect(mockSessionCreate).toHaveBeenCalledTimes(2);
    expect(mockSessionCreate.mock.calls[0][1]).toEqual(
      mockSessionCreate.mock.calls[1][1],
    );
  });

  it("paginates provider history before concluding an intent has no session", async () => {
    mockSessionList
      .mockResolvedValueOnce({
        data: [
          {
            id: "cs_other",
            client_reference_id: "user-1",
            metadata: { checkout_intent_id: "intent_other" },
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "cs_recovered",
            client_reference_id: "user-1",
            metadata: { checkout_intent_id: "intent_1" },
            url: null,
            status: "complete",
          },
        ],
        has_more: false,
      });

    await expect(
      findCheckoutSessionForIntent("user-1", "buyer@example.com", "intent_1"),
    ).resolves.toEqual({
      sessionId: "cs_recovered",
      url: null,
      status: "complete",
    });
    expect(mockSessionList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ starting_after: "cs_other" }),
    );
  });

  it("bounds recovery history to the intent creation window", async () => {
    mockSessionList.mockResolvedValue({ data: [], has_more: false });

    await findCheckoutSessionForIntent(
      "user-1",
      "buyer@example.com",
      "intent_1",
      undefined,
      "2026-09-24T17:30:00.000Z",
    );

    expect(mockSessionList).toHaveBeenCalledWith(
      expect.objectContaining({
        created: { gte: Date.parse("2026-09-24T17:30:00.000Z") / 1000 },
      }),
    );
  });
});
