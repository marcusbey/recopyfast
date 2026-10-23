/**
 * DataFast revenue attribution on Stripe Checkout (ADR 074).
 *
 * DataFast's Stripe connection attributes revenue from two session metadata
 * keys. They are added without disturbing any metadata the webhook depends on,
 * never on a setup-mode session, and never inside an idempotent create's
 * params — a retried idempotency key with different params is refused by
 * Stripe, and the DataFast session cookie rotates.
 */

const mockSessionCreate = jest.fn();
const mockSessionUpdate = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockSessionCreate(...args),
        update: (...args: unknown[]) => mockSessionUpdate(...args),
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
  getCreditPackConfig: jest.fn(async () => ({
    creditsPerPack: 1000,
    pricePerPack: 10,
  })),
  getOneTimeProduct: jest.fn(async (id: string) => ({
    name: id,
    description: "desc",
    grantsPlanId: id === "credits" ? null : "pro",
  })),
  resolveOneTimePriceId: jest.fn(async () => "price_lifetime"),
}));
jest.mock("@/lib/deployment/origin", () => ({
  resolveDeploymentOrigin: jest.fn(() => "https://app.example.test"),
}));

import { createCheckoutSession } from "@/lib/stripe/checkout";

const VISITOR = "a3ab2331-989f-4cfa-91c6-2461c9e3c6bd";
const SESSION = "7d1c0d3e-6a0f-4bbf-9b1e-0c2f1f3c9a11";
const attribution = {
  datafast_visitor_id: VISITOR,
  datafast_session_id: SESSION,
};

function createdParams() {
  return mockSessionCreate.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSessionCreate.mockResolvedValue({
    id: "cs_1",
    url: "https://checkout.stripe.com/c/pay/cs_1",
  });
  mockSessionUpdate.mockResolvedValue({ id: "cs_1" });
});

afterEach(() => jest.restoreAllMocks());

it("credits: adds both keys to the session metadata and keeps the webhook's", async () => {
  await createCheckoutSession(
    "user-1",
    "buyer@example.com",
    { type: "credits", quantity: 2 },
    undefined,
    { attribution },
  );
  const params = createdParams();
  expect(params.client_reference_id).toBe("user-1");
  expect(params.metadata).toEqual({
    user_id: "user-1",
    type: "credit_purchase",
    ...attribution,
  });
  // The wallet grant reads payment_intent_data; it is left exactly as it was.
  expect(params.payment_intent_data.metadata).toEqual({
    user_id: "user-1",
    credit_quantity: "2000",
    type: "credit_purchase",
  });
  expect(mockSessionUpdate).not.toHaveBeenCalled();
});

it("lifetime: keeps every lifetime key alongside attribution", async () => {
  await createCheckoutSession(
    "user-1",
    "buyer@example.com",
    { type: "lifetime", productId: "lifetime_pro" },
    undefined,
    { attribution },
  );
  expect(createdParams().metadata).toEqual({
    user_id: "user-1",
    product_id: "lifetime_pro",
    grants_plan_id: "pro",
    type: "lifetime_purchase",
    ...attribution,
  });
});

it("idempotent subscription: params stay byte-identical across retries; attribution is a later metadata update", async () => {
  const create = (attr: typeof attribution | undefined) =>
    createCheckoutSession(
      "user-1",
      "buyer@example.com",
      { type: "subscription", planId: "pro", billingPeriod: "yearly" },
      undefined,
      {
        pendingIntentId: "intent-1",
        expiresAt: "2026-10-23T18:30:00.000Z",
        attribution: attr,
      },
    );

  await create(attribution);
  await create({ ...attribution, datafast_session_id: "rotated-session" });

  const [first, second] = mockSessionCreate.mock.calls;
  expect(first[0]).toEqual(second[0]);
  expect(first[1]).toEqual({
    idempotencyKey: "subscription-checkout:intent-1",
  });
  expect(first[0].metadata).toEqual({
    user_id: "user-1",
    plan_id: "pro",
    checkout_intent_id: "intent-1",
  });
  expect(mockSessionUpdate).toHaveBeenNthCalledWith(1, "cs_1", {
    metadata: attribution,
  });
});

it("a failed attribution update never fails the checkout", async () => {
  mockSessionUpdate.mockRejectedValue(new Error("stripe down"));
  await expect(
    createCheckoutSession(
      "user-1",
      "buyer@example.com",
      { type: "subscription", planId: "pro", billingPeriod: "yearly" },
      undefined,
      { pendingIntentId: "intent-1", attribution },
    ),
  ).resolves.toMatchObject({ sessionId: "cs_1" });
  expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain(
    VISITOR,
  );
});

it("setup mode (card update) never carries attribution", async () => {
  await createCheckoutSession(
    "user-1",
    "buyer@example.com",
    { type: "payment_method" },
    undefined,
    { attribution },
  );
  expect(createdParams().metadata).toEqual({
    user_id: "user-1",
    type: "payment_method_setup",
  });
  expect(mockSessionUpdate).not.toHaveBeenCalled();
});

it("drops invalid values and adds nothing without cookies", async () => {
  await createCheckoutSession(
    "user-1",
    "buyer@example.com",
    { type: "credits", quantity: 1 },
    undefined,
    {
      attribution: {
        datafast_visitor_id: "x".repeat(600),
        datafast_session_id: SESSION,
      },
    },
  );
  expect(createdParams().metadata).toEqual({
    user_id: "user-1",
    type: "credit_purchase",
    datafast_session_id: SESSION,
  });

  mockSessionCreate.mockClear();
  await createCheckoutSession("user-1", "buyer@example.com", {
    type: "credits",
    quantity: 1,
  });
  expect(createdParams().metadata).toEqual({
    user_id: "user-1",
    type: "credit_purchase",
  });
});
