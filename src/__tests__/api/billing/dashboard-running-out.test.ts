/**
 * GET /api/billing/dashboard — the allowance a lifetime owner keeps once the
 * subscription they are running out ends (s82, s71 review N-1).
 *
 * A Founding Agency owner still running out an Agency subscription reads
 * "1,000 AI credits / month" and nothing said it drops to 250 at period end
 * (ADR 038). The payload now carries that number — only for an account with a
 * live subscription AND a permanent grant (the only state whose card has a
 * running-out row), and only when it is lower than the allowance in force, so
 * every other account's payload keeps exactly its old keys.
 *
 * The resolver itself is proved against the real entitlement code in
 * src/__tests__/lib/billing/lifetime-agency-allowance.test.ts.
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

jest.mock("@/lib/billing/effective-plan", () => ({
  readTrialGrant: jest.fn(),
  readGrantedPlanIds: jest.fn(),
  resolveMonthlyCreditsWithoutSubscription: jest.fn(),
}));

import { GET } from "@/app/api/billing/dashboard/route";
import { getUserSubscription } from "@/lib/stripe/subscription";
import { getCreditWallet, getCreditTransactions } from "@/lib/credits/system";
import { getPlanCatalogue } from "@/lib/stripe/plans";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import {
  readGrantedPlanIds,
  readTrialGrant,
  resolveMonthlyCreditsWithoutSubscription,
} from "@/lib/billing/effective-plan";

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

function wallet(included: number) {
  return {
    balance: included,
    included,
    purchased: 0,
    usedThisMonth: 0,
    totalPurchased: 0,
    totalConsumed: 0,
  };
}

const AGENCY_SUBSCRIPTION = {
  id: "sub_1",
  plan_id: "agency",
  status: "active",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "a@b.test" } },
    error: null,
  });
  asMock(getUserSubscription).mockResolvedValue(AGENCY_SUBSCRIPTION);
  asMock(getCreditWallet).mockResolvedValue(wallet(1000));
  asMock(getCreditTransactions).mockResolvedValue([]);
  asMock(getPlanCatalogue).mockResolvedValue(CATALOGUE);
  asMock(getEffectivePlan).mockResolvedValue({
    kind: "plan",
    planId: "agency",
    plan: { id: "agency" },
  });
  asMock(readTrialGrant).mockResolvedValue(null);
  asMock(readGrantedPlanIds).mockResolvedValue(["agency"]);
  asMock(resolveMonthlyCreditsWithoutSubscription).mockResolvedValue(250);
});

describe("includedAfterSubscription on the billing dashboard", () => {
  it("carries the lower allowance a lifetime owner keeps after the subscription", async () => {
    const body = await (await GET()).json();

    expect(body.includedAfterSubscription).toBe(250);
    expect(resolveMonthlyCreditsWithoutSubscription).toHaveBeenCalledWith(
      mockSupabase,
      "user-1",
    );
  });

  it("is absent when the subscription raises nothing", async () => {
    // A Lifetime Pro owner running out a Pro subscription: 500 either way.
    asMock(getCreditWallet).mockResolvedValue(wallet(500));
    asMock(resolveMonthlyCreditsWithoutSubscription).mockResolvedValue(500);

    const body = await (await GET()).json();

    expect(body).not.toHaveProperty("includedAfterSubscription");
  });

  it("is absent, and not even asked, for a plain subscriber", async () => {
    asMock(readGrantedPlanIds).mockResolvedValue([]);

    const body = await (await GET()).json();

    expect(body).not.toHaveProperty("includedAfterSubscription");
    expect(resolveMonthlyCreditsWithoutSubscription).not.toHaveBeenCalled();
  });

  it("is absent, and not even asked, with no live subscription", async () => {
    asMock(getUserSubscription).mockResolvedValue(null);
    asMock(getCreditWallet).mockResolvedValue(wallet(250));

    const body = await (await GET()).json();

    expect(body).not.toHaveProperty("includedAfterSubscription");
    expect(resolveMonthlyCreditsWithoutSubscription).not.toHaveBeenCalled();
  });

  it("is absent when no plan would be left (null)", async () => {
    asMock(resolveMonthlyCreditsWithoutSubscription).mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(body).not.toHaveProperty("includedAfterSubscription");
  });
});
