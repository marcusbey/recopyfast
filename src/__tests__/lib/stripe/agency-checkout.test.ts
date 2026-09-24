jest.mock("@/lib/stripe/config", () => ({
  stripe: { checkout: { sessions: { create: jest.fn() } } },
  STRIPE_CONFIG: { CURRENCY: "usd" },
}));

jest.mock("@/lib/stripe/customer", () => ({
  createOrGetCustomer: jest.fn(async () => ({
    stripeCustomer: { id: "cus_agency" },
  })),
}));

jest.mock("@/lib/stripe/plans", () => ({
  resolveStripePriceId: jest.fn(),
  resolveOneTimePriceId: jest.fn(),
  getOneTimeProduct: jest.fn(async (productId: string) => ({
    id: productId,
    name: "Founding Agency (lifetime)",
    description: "Founding offer",
    grantsPlanId: productId === "lifetime_agency" ? "agency" : "pro",
  })),
  getCreditPackConfig: jest.fn(),
}));

jest.mock("@/lib/deployment/origin", () => ({
  resolveDeploymentOrigin: jest.fn(() => "https://preview.example.com"),
}));

import {
  createCheckoutSession,
  preflightLifetimeCheckout,
} from "@/lib/stripe/checkout";
import { createOrGetCustomer } from "@/lib/stripe/customer";
import { stripe } from "@/lib/stripe/config";
import {
  resolveOneTimePriceId,
  resolveStripePriceId,
  getOneTimeProduct,
} from "@/lib/stripe/plans";

const mockCreateSession = stripe.checkout.sessions.create as jest.Mock;
const mockResolveStripePriceId = resolveStripePriceId as jest.Mock;
const mockResolveOneTimePriceId = resolveOneTimePriceId as jest.Mock;
const mockCreateOrGetCustomer = createOrGetCustomer as jest.Mock;
const mockGetOneTimeProduct = getOneTimeProduct as jest.Mock;

describe("Agency Checkout sessions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSession.mockResolvedValue({
      id: "cs_agency",
      url: "https://checkout.stripe.test/cs_agency",
    });
    mockResolveStripePriceId.mockImplementation(
      async (_planId: string, period: string) => `price_agency_${period}`,
    );
    mockResolveOneTimePriceId.mockResolvedValue("price_lifetime_agency");
  });

  it.each(["monthly", "yearly"] as const)(
    "creates an Agency %s subscription checkout",
    async (billingPeriod) => {
      await createCheckoutSession("user-1", "buyer@example.com", {
        type: "subscription",
        planId: "agency",
        billingPeriod,
      });

      expect(mockResolveStripePriceId).toHaveBeenCalledWith(
        "agency",
        billingPeriod,
      );
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          line_items: [{ price: `price_agency_${billingPeriod}`, quantity: 1 }],
          subscription_data: {
            metadata: {
              user_id: "user-1",
              plan_id: "agency",
              billing_period: billingPeriod,
            },
          },
        }),
      );
    },
  );

  it("creates a reservation-bound Founding Agency lifetime checkout", async () => {
    await createCheckoutSession("user-1", "buyer@example.com", {
      type: "lifetime",
      productId: "lifetime_agency",
      reservationId: "reservation-1",
      checkoutExpiresAt: 1_800_000_000,
    });

    expect(mockResolveOneTimePriceId).toHaveBeenCalledWith("lifetime_agency");
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        expires_at: 1_800_000_000,
        line_items: [{ price: "price_lifetime_agency", quantity: 1 }],
        metadata: expect.objectContaining({
          product_id: "lifetime_agency",
          grants_plan_id: "agency",
          founding_reservation_id: "reservation-1",
        }),
        payment_intent_data: {
          metadata: expect.objectContaining({
            product_id: "lifetime_agency",
            grants_plan_id: "agency",
            founding_reservation_id: "reservation-1",
          }),
        },
      }),
      { idempotencyKey: "founding-agency-reservation-1" },
    );
  });

  it("uses the prepared founding checkout without repeating prerequisites after reservation", async () => {
    const prepared = await preflightLifetimeCheckout(
      "user-1",
      "buyer@example.com",
      "lifetime_agency",
    );

    await createCheckoutSession("user-1", "buyer@example.com", {
      type: "lifetime",
      productId: "lifetime_agency",
      reservationId: "reservation-prepared",
      checkoutExpiresAt: 1_800_000_000,
      prepared,
    });

    expect(mockCreateOrGetCustomer).toHaveBeenCalledTimes(1);
    expect(mockGetOneTimeProduct).toHaveBeenCalledTimes(1);
    expect(mockResolveOneTimePriceId).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_agency" }),
      { idempotencyKey: "founding-agency-reservation-prepared" },
    );
  });

  it("replays identical Stripe params after time advances", async () => {
    const intent = {
      type: "lifetime" as const,
      productId: "lifetime_agency" as const,
      reservationId: "reservation-stable",
      checkoutExpiresAt: 1_800_000_000,
    };

    jest.useFakeTimers({ now: new Date("2026-09-24T00:00:00Z") });
    await createCheckoutSession("user-1", "buyer@example.com", intent);
    jest.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    await createCheckoutSession("user-1", "buyer@example.com", intent);

    expect(mockCreateSession.mock.calls[1]).toEqual(
      mockCreateSession.mock.calls[0],
    );
    jest.useRealTimers();
  });

  it("keeps omitted lifetime productId backward compatible with Lifetime Pro", async () => {
    await createCheckoutSession("user-1", "buyer@example.com", {
      type: "lifetime",
    });

    expect(mockResolveOneTimePriceId).toHaveBeenCalledWith("lifetime_pro");
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ product_id: "lifetime_pro" }),
      }),
    );
  });
});
