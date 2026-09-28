/**
 * GET /api/billing/dashboard for a founding offer account (s47a).
 *
 * The offer is the account's one trial row, so the billing page already shows
 * it as a trial: the countdown, the credits used, and `everTrialed` once it
 * lapses. Two facts are new and ride on the payload, spread only when set:
 * `trial.offerId` while the offer runs, and `endedOfferId` once it has lapsed
 * or been released — which is what lets the lapsed screen say "Your founding
 * offer has ended" instead of "Your 14-day Pro trial has ended".
 *
 * Same harness as dashboard-unentitled.test.ts.
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
}));

import { GET } from "@/app/api/billing/dashboard/route";
import { getUserSubscription } from "@/lib/stripe/subscription";
import { getCreditWallet, getCreditTransactions } from "@/lib/credits/system";
import { getPlanCatalogue } from "@/lib/stripe/plans";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import {
  readGrantedPlanIds,
  readTrialGrant,
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

const EMPTY_WALLET = {
  balance: 0,
  included: 0,
  purchased: 0,
  usedThisMonth: 0,
  totalPurchased: 0,
  totalConsumed: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

const NO_PLAN = { kind: "none", planId: null, plan: null };

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
  asMock(readGrantedPlanIds).mockResolvedValue([]);
});

describe("the founding offer on the billing dashboard", () => {
  it("carries the running offer, its countdown and its 100-credit allowance", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "plan",
      planId: "pro",
      plan: { id: "pro" },
    });
    // The wallet's `included` is the resolver's 100 (founding-offer-allowance
    // .test.ts); the route passes it through as the card's limit.
    asMock(getCreditWallet).mockResolvedValue({
      ...EMPTY_WALLET,
      included: 100,
      usedThisMonth: 30,
    });
    const endsAt = daysFromNow(79.6);
    asMock(readTrialGrant).mockResolvedValue({
      grantedAt: daysFromNow(-10.4),
      expiresAt: endsAt,
      isActive: true,
      offerId: "founding_20",
    });

    const body = await (await GET()).json();

    expect(body.trial).toEqual({
      daysRemaining: 80,
      endsAt,
      creditsUsed: 30,
      creditsLimit: 100,
      offerId: "founding_20",
    });
    expect(body.everTrialed).toBe(true);
    expect(body).not.toHaveProperty("endedOfferId");
  });

  it.each([
    ["lapsed", { grantedAt: daysFromNow(-91), expiresAt: daysFromNow(-1) }],
    // A released QA account: `revoked_at` set, expiry still in the future.
    ["released", { grantedAt: daysFromNow(-3), expiresAt: daysFromNow(87) }],
  ])(
    "tells a %s offer account its founding offer has ended",
    async (_label, window) => {
      asMock(getEffectivePlan).mockResolvedValue(NO_PLAN);
      asMock(readTrialGrant).mockResolvedValue({
        ...window,
        isActive: false,
        offerId: "founding_20",
      });

      const body = await (await GET()).json();

      expect(body.effectivePlanId).toBeNull();
      expect(body.trial).toBeNull();
      expect(body.everTrialed).toBe(true);
      expect(body.endedOfferId).toBe("founding_20");
    },
  );

  it("says nothing about an offer to a lapsed plain trial", async () => {
    asMock(getEffectivePlan).mockResolvedValue(NO_PLAN);
    asMock(readTrialGrant).mockResolvedValue({
      grantedAt: daysFromNow(-20),
      expiresAt: daysFromNow(-6),
      isActive: false,
    });

    const body = await (await GET()).json();

    expect(body.everTrialed).toBe(true);
    expect(body).not.toHaveProperty("endedOfferId");
  });

  it("keeps a running plain trial's card free of any offer key", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "plan",
      planId: "pro",
      plan: { id: "pro" },
    });
    asMock(getCreditWallet).mockResolvedValue({
      ...EMPTY_WALLET,
      included: 500,
      usedThisMonth: 120,
    });
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
    expect(body).not.toHaveProperty("endedOfferId");
  });
});

/**
 * PR #49 review, finding 2: an offer holder who buys a lifetime product (a
 * permanent non-trial grant, no subscription) must stop seeing the offer card.
 * The unexpired offer row survives underneath the purchase, exactly as a trial
 * row does, and the card would keep counting down and saying "Choose a plan"
 * to someone who has just paid outright. Same rule as the badge
 * (`/api/billing/entitlement`, `readGrantedPlanIds`).
 */
describe("an offer holder who bought outright", () => {
  const RUNNING_OFFER = {
    grantedAt: daysFromNow(-10),
    expiresAt: daysFromNow(80),
    isActive: true,
    offerId: "founding_20" as const,
  };

  it.each([
    ["Lifetime Pro", "pro"],
    ["Founding Agency", "agency"],
  ])(
    "gets no offer card and no countdown after buying %s",
    async (_label, planId) => {
      asMock(getEffectivePlan).mockResolvedValue({
        kind: "plan",
        planId,
        plan: { id: planId },
      });
      asMock(readTrialGrant).mockResolvedValue(RUNNING_OFFER);
      asMock(readGrantedPlanIds).mockResolvedValue([planId]);

      const body = await (await GET()).json();

      expect(body.trial).toBeNull();
      // Still an account that once had the offer, and its offer has not ended.
      expect(body.everTrialed).toBe(true);
      expect(body).not.toHaveProperty("endedOfferId");
    },
  );

  it("keeps the ended-offer history for a lifetime buyer whose offer has since lapsed", async () => {
    asMock(getEffectivePlan).mockResolvedValue(NO_PLAN);
    asMock(readTrialGrant).mockResolvedValue({
      ...RUNNING_OFFER,
      grantedAt: daysFromNow(-91),
      expiresAt: daysFromNow(-1),
      isActive: false,
    });
    asMock(readGrantedPlanIds).mockResolvedValue(["pro"]);

    const body = await (await GET()).json();

    expect(body.endedOfferId).toBe("founding_20");
  });
});
