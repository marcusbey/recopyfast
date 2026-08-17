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

jest.mock("@/lib/billing/effective-plan", () => ({
  readTrialGrant: jest.fn(),
}));

import { GET } from "@/app/api/billing/dashboard/route";
import { getUserSubscription } from "@/lib/stripe/subscription";
import { getCreditWallet, getCreditTransactions } from "@/lib/credits/system";
import { getPlanCatalogue } from "@/lib/stripe/plans";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { readTrialGrant } from "@/lib/billing/effective-plan";

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
  asMock(readTrialGrant).mockResolvedValue(null);
});

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/**
 * The two facts the billing page needs beyond "you have no plan": is a trial
 * running right now, and has this account ever had one.
 *
 * The second is what tells "Choose a plan to continue" apart from "Your trial
 * has ended", and the unentitled branch carries no signal for it today —
 * both states are simply `effectivePlanId === null`.
 */
describe("trial state on the billing dashboard", () => {
  const TRIAL_WALLET = { ...EMPTY_WALLET, included: 500, usedThisMonth: 120 };

  it("carries the running trial and what it has spent", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "plan",
      planId: "pro",
      plan: { id: "pro" },
    });
    asMock(getCreditWallet).mockResolvedValue(TRIAL_WALLET);
    const endsAt = daysFromNow(8.4);
    asMock(readTrialGrant).mockResolvedValue({
      grantedAt: daysFromNow(-5.6),
      expiresAt: endsAt,
      isActive: true,
    });

    const body = await (await GET()).json();

    expect(body.trial).toEqual({
      daysRemaining: 9,
      endsAt,
      creditsUsed: 120,
      creditsLimit: 500,
    });
    expect(body.everTrialed).toBe(true);
  });

  it("hides the trial once a subscription is live", async () => {
    // Conversion is reflected by the card disappearing. The grant is left to
    // lapse on its own clock, so it is still there and still unexpired.
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "plan",
      planId: "pro",
      plan: { id: "pro" },
    });
    asMock(getUserSubscription).mockResolvedValue({ id: "sub_1" });
    asMock(readTrialGrant).mockResolvedValue({
      grantedAt: daysFromNow(-5),
      expiresAt: daysFromNow(9),
      isActive: true,
    });

    const body = await (await GET()).json();

    expect(body.trial).toBeNull();
    // Still true — they did trial, they just converted.
    expect(body.everTrialed).toBe(true);
  });

  it("marks an expired trial as spent so the page can say so", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "none",
      planId: null,
      plan: null,
    });
    asMock(readTrialGrant).mockResolvedValue({
      grantedAt: daysFromNow(-20),
      expiresAt: daysFromNow(-6),
      isActive: false,
    });

    const body = await (await GET()).json();

    expect(body.effectivePlanId).toBeNull();
    expect(body.trial).toBeNull();
    expect(body.everTrialed).toBe(true);
  });

  it("reports a never-trialled account as never having trialled", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "none",
      planId: null,
      plan: null,
    });

    const body = await (await GET()).json();

    expect(body.trial).toBeNull();
    expect(body.everTrialed).toBe(false);
  });
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
