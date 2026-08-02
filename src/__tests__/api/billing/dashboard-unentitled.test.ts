/**
 * GET /api/billing/dashboard for an account with no plan.
 *
 * This is the one billing surface an unpaid account can reach — every other
 * dashboard route redirects here — so it has to render a state, not an error.
 * It used to resolve the plan through a `free` fallback, which meant the page
 * that exists to sell a subscription depended on a row the product no longer
 * sells.
 */

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn(() => {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    for (const method of ["select", "eq", "gte", "order", "limit"]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
    return chain;
  }),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(),
}));

jest.mock("@/lib/credits/system", () => ({
  getCreditWallet: jest.fn(),
  getCreditTransactions: jest.fn(),
}));

jest.mock("@/lib/stripe/plans", () => ({
  getPlanCatalogue: jest.fn(),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));

jest.mock("@/lib/stripe/payment-methods", () => ({
  listPaymentMethods: jest.fn(),
}));

import { GET } from "@/app/api/billing/dashboard/route";
import { getUserSubscription } from "@/lib/stripe/subscription";
import { getCreditWallet, getCreditTransactions } from "@/lib/credits/system";
import { getPlanCatalogue } from "@/lib/stripe/plans";
import { getEffectivePlan } from "@/lib/billing/entitlements";

const asMock = (fn: unknown) => fn as jest.Mock;

const CATALOGUE = {
  subscriptions: [],
  oneTimeProducts: [],
  creditPack: {
    creditsPerPack: 1000,
    maxPacksPerPurchase: 100,
    pricePerPack: 19,
  },
};

const EMPTY_WALLET = {
  balance: 0,
  included: 0,
  purchased: 0,
  usedThisMonth: 0,
  totalPurchased: 0,
  totalConsumed: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "a@b.test" } },
    error: null,
  });
  asMock(getUserSubscription).mockResolvedValue(null);
  asMock(getCreditWallet).mockResolvedValue(EMPTY_WALLET);
  asMock(getCreditTransactions).mockResolvedValue([]);
  asMock(getPlanCatalogue).mockResolvedValue(CATALOGUE);
});

describe("billing dashboard for an unentitled account", () => {
  it("answers 200 with a null plan rather than 500", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      entitled: false,
      planId: null,
      plan: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.effectivePlanId).toBeNull();
    expect(body.catalogue).toEqual(CATALOGUE);
  });

  it("reports the plan id for an account that has one", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      entitled: true,
      planId: "pro",
      plan: { id: "pro" },
    });

    const body = await (await GET()).json();

    expect(body.effectivePlanId).toBe("pro");
  });

  it("still refuses an unauthenticated caller", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });
});
