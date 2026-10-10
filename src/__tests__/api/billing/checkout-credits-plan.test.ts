/**
 * s51 — AI credits come with a plan.
 *
 * AI spend happens only inside editing, and editing now needs the site
 * owner's plan. Selling credits to an account with no plan would sell
 * something that cannot be spent. The billing screens already offer no
 * purchase control without a plan; this is the server saying the same thing,
 * before any Stripe call. Credits already held are kept (nothing here touches
 * a balance) and become spendable when a plan is chosen.
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: { id: "user-1", email: "buyer@example.com" } },
            error: null,
          }),
      },
    }),
  ),
}));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({})),
}));
jest.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: jest.fn(),
  preflightLifetimeCheckout: jest.fn(),
  findCheckoutSessionForIntent: jest.fn(),
  getCheckoutSessionStatus: jest.fn(),
  expireCheckoutSession: jest.fn(),
}));
jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(() => Promise.resolve(null)),
  getRecoverableSubscriptionCheckout: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
  getGrantedPlanIds: jest.fn(() => Promise.resolve([])),
}));
jest.mock("@/lib/stripe/plans", () => ({
  isAgencyCheckoutEnabled: () => true,
  isPaidPlanId: (value: unknown) =>
    value === "starter" || value === "pro" || value === "agency",
  isLifetimeProductId: (value: unknown) =>
    value === "lifetime_pro" || value === "lifetime_agency",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
  getCreditPackConfig: jest.fn(() =>
    Promise.resolve({ maxPacksPerPurchase: 10 }),
  ),
  getOneTimeProduct: jest.fn(),
  resolveStripePriceId: jest.fn(),
}));

import { POST } from "@/app/api/billing/checkout/route";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import type { Entitlement } from "@/lib/billing/effective-plan";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";

const mockCreateCheckoutSession = createCheckoutSession as jest.MockedFunction<
  typeof createCheckoutSession
>;
const mockGetEffectivePlan = getEffectivePlan as jest.MockedFunction<
  typeof getEffectivePlan
>;

const ON_PLAN: Entitlement = {
  kind: "plan",
  planId: "pro",
  plan: { id: "pro", name: "Pro" } as SubscriptionPlan,
};

function buyCredits(): NextRequest {
  return new NextRequest("https://www.recopyfa.st/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "credits", quantity: 1 }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockCreateCheckoutSession.mockResolvedValue({
    url: "https://checkout.stripe.test/c/pay/cs_test_1",
    sessionId: "cs_test_1",
  } as Awaited<ReturnType<typeof createCheckoutSession>>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("s51 — POST /api/billing/checkout, intent credits", () => {
  it.each([
    ["none", { kind: "none", planId: null, plan: null }],
    ["credits", { kind: "credits", planId: null, plan: null }],
  ] as const)(
    "refuses a credits checkout from an account with no plan before any Stripe call (%s)",
    async (_kind, entitlement) => {
      mockGetEffectivePlan.mockResolvedValue(entitlement as Entitlement);

      const response = await POST(buyCredits());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "AI credits come with a plan. Choose a plan to buy more.",
        upgradeRequired: true,
      });
      expect(mockGetEffectivePlan).toHaveBeenCalledWith("user-1");
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    },
  );

  it("still lets a plan holder buy credits", async () => {
    mockGetEffectivePlan.mockResolvedValue(ON_PLAN);

    const response = await POST(buyCredits());

    expect(response.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      "user-1",
      "buyer@example.com",
      { type: "credits", quantity: 1 },
      undefined,
    );
  });

  it("fails closed when the entitlement read throws", async () => {
    mockGetEffectivePlan.mockRejectedValue(
      new Error("Failed to read plan entitlements: timeout"),
    );

    const response = await POST(buyCredits());

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });
});
