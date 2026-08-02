import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  canCreateWebsite,
  canUseAIFeatures,
  canUseTranslation,
  consumeFeatureUsage,
} from "@/lib/feature-gating/permissions";

/**
 * Supabase query-builder stub.
 *
 * `canCreateWebsite` awaits the result of `.from().select().eq()` directly
 * (there is no `.single()` in the chain), so every terminal link has to be
 * thenable. `setCount` controls what that await resolves to.
 */
let queryCount: number | null = 0;
const mockInsert = jest.fn();

const makeQuery = () => {
  const query: Record<string, unknown> = {
    then: (resolve: (value: { count: number | null }) => unknown) =>
      Promise.resolve({ count: queryCount, data: [], error: null }).then(
        resolve,
      ),
  };
  for (const method of ["select", "eq", "neq", "gte", "order", "limit"]) {
    query[method] = jest.fn(() => query);
  }
  query.insert = mockInsert;
  return query;
};

const mockSupabase = {
  from: jest.fn(() => makeQuery()),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

// The gates read the plan in force, which counts lifetime entitlements as well
// as subscriptions, so this is the seam to stub rather than the subscription
// table underneath it.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
  getEffectivePlanId: jest.fn(),
}));

jest.mock("@/lib/credits/system", () => {
  const actual = jest.requireActual("@/lib/credits/system");
  return {
    ...actual,
    getUserCreditBalance: jest.fn(),
    hasEnoughCredits: jest.fn(),
    consumeCredits: jest.fn(),
  };
});

import { getEffectivePlan } from "@/lib/billing/entitlements";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";
import {
  getUserCreditBalance,
  consumeCredits,
  CREDIT_COSTS,
} from "@/lib/credits/system";

const asMock = (fn: unknown) => fn as jest.Mock;

/**
 * Plan fixtures mirroring the seeded rows. They are built here rather than
 * loaded so a gate regression cannot hide behind a catalogue change.
 */
const plan = (overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan => ({
  id: "free",
  name: "Free",
  description: "No active subscription",
  price: 0,
  yearlyPrice: 0,
  features: [],
  limits: {
    websites: 0,
    collaborators: 0,
    aiFeatures: false,
    translations: 0,
    abTesting: false,
    monthlyCredits: 0,
  },
  additionalSitePrice: null,
  sortOrder: 0,
  ...overrides,
});

const FREE_PLAN = plan();

const STARTER_PLAN = plan({
  id: "starter",
  name: "Starter",
  price: 9,
  limits: { ...FREE_PLAN.limits, websites: 1 },
});

const PRO_PLAN = plan({
  id: "pro",
  name: "Pro",
  price: 19,
  limits: {
    websites: 5,
    collaborators: 5,
    aiFeatures: true,
    translations: -1,
    abTesting: true,
    monthlyCredits: 500,
  },
  additionalSitePrice: 5,
});

const UNLIMITED_PLAN = plan({
  id: "pro",
  name: "Pro",
  limits: { ...PRO_PLAN.limits, websites: -1 },
  additionalSitePrice: null,
});

const creditBalance = (total: number) => ({
  included: total,
  purchased: 0,
  total,
  usedThisMonth: 0,
});

describe("Feature Gating Permissions", () => {
  const testUserId = "test-user-id";

  beforeEach(() => {
    jest.clearAllMocks();
    queryCount = 0;
    mockInsert.mockResolvedValue({ error: null });
  });

  describe("canCreateWebsite", () => {
    it("allows creation on a plan with an unlimited website quota", async () => {
      asMock(getEffectivePlan).mockResolvedValue(UNLIMITED_PLAN);
      queryCount = 5;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("allows creation on pro while under its included website quota", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      queryCount = 2;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(2);
      expect(result.maxLimit).toBe(5);
    });

    it("quotes the overage price once pro's included websites are used up", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      queryCount = 5;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.maxLimit).toBe(5);
      expect(result.reason).toContain("includes 5 websites");
      expect(result.reason).toContain("$5 each per month");
    });

    it("allows creation on starter, which permits exactly one website", async () => {
      asMock(getEffectivePlan).mockResolvedValue(STARTER_PLAN);
      queryCount = 0;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(0);
      expect(result.maxLimit).toBe(1);
    });

    it("denies creation with no subscription, since the free fallback allows zero websites", async () => {
      asMock(getEffectivePlan).mockResolvedValue(FREE_PLAN);
      queryCount = 0;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.maxLimit).toBe(0);
      expect(result.reason).toContain("limit of 0 websites");
    });
  });

  describe("canUseAIFeatures", () => {
    it("allows AI on pro when the credit balance covers the cost", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(100));

      const result = await canUseAIFeatures(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresCredits).toBeFalsy();
    });

    it("denies AI when the plan has no AI entitlement", async () => {
      asMock(getEffectivePlan).mockResolvedValue(FREE_PLAN);

      const result = await canUseAIFeatures(testUserId, 1);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("Pro subscription");
      expect(getUserCreditBalance).not.toHaveBeenCalled();
    });

    it("denies AI on pro when the credit balance is short", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(1));

      const result = await canUseAIFeatures(testUserId, 5);

      expect(result.allowed).toBe(false);
      expect(result.requiresCredits).toBe(true);
      expect(result.creditsRequired).toBe(5);
      expect(result.reason).toContain("Insufficient credits");
    });
  });

  describe("canUseTranslation", () => {
    it("allows translation on pro, which has an unlimited translation quota", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("allows translation without a plan when the wallet holds credits", async () => {
      asMock(getEffectivePlan).mockResolvedValue(FREE_PLAN);
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(3));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresCredits).toBe(true);
      expect(result.creditsRequired).toBe(1);
    });

    it("denies translation without a plan and without credits", async () => {
      asMock(getEffectivePlan).mockResolvedValue(FREE_PLAN);
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(0));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("purchased credits");
    });
  });

  describe("consumeFeatureUsage", () => {
    it("consumes credits and records usage for an AI suggestion", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(100));
      asMock(consumeCredits).mockResolvedValue({ success: true });

      const result = await consumeFeatureUsage(testUserId, "ai_suggestion", {
        context: "test",
      });

      expect(result.success).toBe(true);
      expect(consumeCredits).toHaveBeenCalledWith(
        testUserId,
        CREDIT_COSTS.AI_SUGGESTION,
        "ai_suggestion",
        { context: "test" },
      );
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: testUserId,
        feature_type: "ai_suggestion",
        count: 1,
        metadata: {
          context: "test",
          credits_used: CREDIT_COSTS.AI_SUGGESTION,
        },
      });
    });

    it("charges the higher translation credit cost", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      asMock(consumeCredits).mockResolvedValue({ success: true });

      const result = await consumeFeatureUsage(testUserId, "translation");

      expect(result.success).toBe(true);
      expect(consumeCredits).toHaveBeenCalledWith(
        testUserId,
        CREDIT_COSTS.AI_TRANSLATION,
        "translation",
        undefined,
      );
    });

    it("fails without consuming credits when the plan lacks AI access", async () => {
      asMock(getEffectivePlan).mockResolvedValue(FREE_PLAN);

      const result = await consumeFeatureUsage(testUserId, "ai_suggestion");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Pro subscription");
      expect(consumeCredits).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("surfaces the error when credit consumption fails", async () => {
      asMock(getEffectivePlan).mockResolvedValue(PRO_PLAN);
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(100));
      asMock(consumeCredits).mockResolvedValue({
        success: false,
        error: "Insufficient credits",
      });

      const result = await consumeFeatureUsage(testUserId, "ai_suggestion");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient credits");
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });
});
