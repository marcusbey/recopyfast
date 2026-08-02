import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  canAddCollaborator,
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
// Only the resolution is stubbed. `hasAnyEntitlement` is the real predicate:
// it is the one the router also consumes, so a gate must not be tested against
// a local copy of it that could quietly disagree.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
  getEffectivePlanId: jest.fn(),
  hasAnyEntitlement: jest.requireActual("@/lib/billing/effective-plan")
    .hasAnyEntitlement,
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
import type { Entitlement } from "@/lib/billing/entitlements";
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
  id: "starter",
  name: "Starter",
  description: "",
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

const NO_LIMITS = plan().limits;

/** What `getEffectivePlan` hands a gate for a user who is on a plan. */
const entitled = (subscriptionPlan: SubscriptionPlan): Entitlement => ({
  kind: "plan",
  planId: subscriptionPlan.id,
  plan: subscriptionPlan,
});

/** ...for one holding purchased credits and no plan... */
const CREDIT_HOLDER: Entitlement = {
  kind: "credits",
  planId: null,
  plan: null,
};

/** ...and for one with nothing. There is no free plan to stand in for it. */
const UNENTITLED: Entitlement = { kind: "none", planId: null, plan: null };

const STARTER_PLAN = plan({
  price: 9,
  limits: { ...NO_LIMITS, websites: 1 },
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
      asMock(getEffectivePlan).mockResolvedValue(entitled(UNLIMITED_PLAN));
      queryCount = 5;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("allows creation on pro while under its included website quota", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
      queryCount = 2;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(2);
      expect(result.maxLimit).toBe(5);
    });

    it("quotes the overage price once pro's included websites are used up", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
      queryCount = 5;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.maxLimit).toBe(5);
      expect(result.reason).toContain("includes 5 websites");
      expect(result.reason).toContain("$5 each per month");
    });

    it("allows creation on starter, which permits exactly one website", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(STARTER_PLAN));
      queryCount = 0;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.currentLimit).toBe(0);
      expect(result.maxLimit).toBe(1);
    });

    it("denies creation on a plan whose website quota is used up", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(STARTER_PLAN));
      queryCount = 1;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.maxLimit).toBe(1);
      expect(result.reason).toContain("limit of 1 website");
    });
  });

  describe("canUseAIFeatures", () => {
    it("allows AI on pro when the credit balance covers the cost", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(100));

      const result = await canUseAIFeatures(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresCredits).toBeFalsy();
    });

    it("denies AI when the plan has no AI entitlement", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(STARTER_PLAN));

      const result = await canUseAIFeatures(testUserId, 1);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("Pro subscription");
      expect(getUserCreditBalance).not.toHaveBeenCalled();
    });

    it("denies AI on pro when the credit balance is short", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
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
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("allows translation on a plan with no included allowance when the wallet holds credits", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(STARTER_PLAN));
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(3));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresCredits).toBe(true);
      expect(result.creditsRequired).toBe(1);
    });

    it("denies translation with no included allowance and no credits", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(STARTER_PLAN));
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(0));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("purchased credits");
    });
  });

  describe("consumeFeatureUsage", () => {
    it("consumes credits and records usage for an AI suggestion", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
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
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
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
      asMock(getEffectivePlan).mockResolvedValue(entitled(STARTER_PLAN));

      const result = await consumeFeatureUsage(testUserId, "ai_suggestion");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Pro subscription");
      expect(consumeCredits).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("surfaces the error when credit consumption fails", async () => {
      asMock(getEffectivePlan).mockResolvedValue(entitled(PRO_PLAN));
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

  /**
   * An account with no plan. Previously this state did not exist: an
   * unsubscribed user resolved to the `free` row, and every gate quietly
   * evaluated that row's limits instead of asking whether they had paid.
   */
  describe("an account with no plan", () => {
    beforeEach(() => {
      asMock(getEffectivePlan).mockResolvedValue(UNENTITLED);
    });

    it("cannot create a website, and is not asked how many it already has", async () => {
      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toBe(
        "This account has no active plan. Choose a plan to continue.",
      );
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("cannot add a collaborator", async () => {
      const result = await canAddCollaborator(testUserId, "site-1");

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("no active plan");
    });

    it("cannot use AI, and the wallet is not consulted", async () => {
      const result = await canUseAIFeatures(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("no active plan");
      expect(getUserCreditBalance).not.toHaveBeenCalled();
    });

    it("cannot translate, having nothing to pay with", async () => {
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(0));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("no active plan");
    });

    it("consumes nothing and records no usage", async () => {
      const result = await consumeFeatureUsage(testUserId, "ai_suggestion");

      expect(result.success).toBe(false);
      expect(result.error).toContain("no active plan");
      expect(consumeCredits).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  /**
   * An account holding purchased credits and no plan.
   *
   * They paid for a delivered good, so it stays spendable — clawing it back is
   * the shape of a chargeback. What it must not do is behave like a plan: no
   * sites, no seats, no capability flags.
   */
  describe("an account with credits but no plan", () => {
    beforeEach(() => {
      asMock(getEffectivePlan).mockResolvedValue(CREDIT_HOLDER);
    });

    it("can spend them on a translation", async () => {
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(50));

      const result = await canUseTranslation(testUserId);

      expect(result.allowed).toBe(true);
      expect(result.requiresCredits).toBe(true);
      expect(result.creditsRequired).toBe(1);
    });

    it("can spend them on an AI suggestion", async () => {
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(50));

      const result = await canUseAIFeatures(testUserId);

      expect(result.allowed).toBe(true);
    });

    it("actually consumes them, and records the usage", async () => {
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(50));
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

    it("is refused once the balance runs out", async () => {
      asMock(getUserCreditBalance).mockResolvedValue(creditBalance(0));

      const result = await canUseAIFeatures(testUserId, 1);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Insufficient credits");
    });

    it("still cannot create a website — credits are not a quota", async () => {
      queryCount = 0;

      const result = await canCreateWebsite(testUserId);

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("needs a plan");
      // Not even asked how many sites they have; there is no allowance to
      // compare against.
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("still cannot add a collaborator", async () => {
      const result = await canAddCollaborator(testUserId, "site-1");

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain("needs a plan");
    });
  });
});
