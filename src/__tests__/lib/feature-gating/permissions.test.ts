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

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(),
}));

jest.mock("@/lib/stripe/tickets", () => ({
  getUserTicketBalance: jest.fn(),
  consumeTickets: jest.fn(),
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

import { getUserSubscription } from "@/lib/stripe/subscription";
import { getUserTicketBalance } from "@/lib/stripe/tickets";
import {
  getUserCreditBalance,
  consumeCredits,
  CREDIT_COSTS,
} from "@/lib/credits/system";

const asMock = (fn: unknown) => fn as jest.Mock;

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
    it("allows creation on enterprise, which has an unlimited website quota", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "enterprise" });
      queryCount = 5;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("allows creation on pro while under the 3-website quota", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
      queryCount = 2;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(2);
      expect(result.maxLimit).toBe(3);
    });

    it("denies creation on pro once the 3-website quota is used up", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
      queryCount = 3;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("limit of 3 websites");
    });

    it("allows creation on starter, which permits exactly one website", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "starter" });
      queryCount = 0;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(0);
      expect(result.maxLimit).toBe(1);
    });

    it("denies creation with no subscription, since the free fallback allows zero websites", async () => {
      asMock(getUserSubscription).mockResolvedValue(null);
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
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(100));

      const result = await canUseAIFeatures(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresTickets).toBeFalsy();
    });

    it("denies AI when the plan has no AI entitlement", async () => {
      asMock(getUserSubscription).mockResolvedValue(null);

      const result = await canUseAIFeatures(testUserId, 1);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("Pro or Enterprise subscription");
      expect(getUserCreditBalance).not.toHaveBeenCalled();
    });

    it("denies AI on pro when the credit balance is short", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(1));

      const result = await canUseAIFeatures(testUserId, 5);

      expect(result.allowed).toBe(false);
      expect(result.requiresTickets).toBe(true);
      expect(result.ticketsRequired).toBe(5);
      expect(result.reason).toContain("Insufficient credits");
    });
  });

  describe("canUseTranslation", () => {
    it("allows translation on pro, which has an unlimited translation quota", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("allows translation without a plan when the user holds tickets", async () => {
      asMock(getUserSubscription).mockResolvedValue(null);
      asMock(getUserTicketBalance).mockResolvedValue(3);

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresTickets).toBe(true);
      expect(result.ticketsRequired).toBe(1);
    });

    it("denies translation without a plan and without tickets", async () => {
      asMock(getUserSubscription).mockResolvedValue(null);
      asMock(getUserTicketBalance).mockResolvedValue(0);

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("Pro or Enterprise plan");
    });
  });

  describe("consumeFeatureUsage", () => {
    it("consumes credits and records usage for an AI suggestion", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
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
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
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
      asMock(getUserSubscription).mockResolvedValue(null);

      const result = await consumeFeatureUsage(testUserId, "ai_suggestion");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Pro or Enterprise subscription");
      expect(consumeCredits).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("surfaces the error when credit consumption fails", async () => {
      asMock(getUserSubscription).mockResolvedValue({ plan_id: "pro" });
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
