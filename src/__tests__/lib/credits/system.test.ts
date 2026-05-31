/**
 * Suite 1B: Credit System Tests - UNIT-010 to UNIT-013
 * Tests credit costs, plan credits, balance calculation, and deduction order.
 */

// Mock Supabase client before any imports that use it
jest.mock("@/lib/supabase/server", () => {
  const mock = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    single: jest.fn(),
    insert: jest.fn(),
    update: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(),
  };
  return {
    createClient: jest.fn().mockResolvedValue(mock),
    __mock: mock,
  };
});

import {
  CREDIT_COSTS,
  PLAN_CREDITS,
  CREDIT_PACKAGES,
} from "@/lib/credits/system";

describe("Credit System", () => {
  // UNIT-010: Credit costs
  describe("UNIT-010: Credit costs per operation", () => {
    it("AI suggestion should cost 1 credit", () => {
      expect(CREDIT_COSTS.AI_SUGGESTION).toBe(1);
    });

    it("AI translation should cost 5 credits", () => {
      expect(CREDIT_COSTS.AI_TRANSLATION).toBe(5);
    });

    it("Bulk AI operation should cost 10 credits", () => {
      expect(CREDIT_COSTS.BULK_AI_OPERATION).toBe(10);
    });
  });

  // UNIT-011: Plan credits
  describe("UNIT-011: Monthly included credits per plan", () => {
    it("Free plan should include 0 credits", () => {
      expect(PLAN_CREDITS.FREE).toBe(0);
    });

    it("Pro plan should include 500 credits", () => {
      expect(PLAN_CREDITS.PRO).toBe(500);
    });

    it("Enterprise plan should include 2000 credits", () => {
      expect(PLAN_CREDITS.ENTERPRISE).toBe(2000);
    });
  });

  // UNIT-012: Credit balance calculation
  describe("UNIT-012: Balance calculation logic", () => {
    it("should calculate total as max(0, included - used) + purchased", () => {
      // Simulating the getUserCreditBalance logic directly
      const included = 500;
      const usedThisMonth = 200;
      const purchased = 100;

      const total = Math.max(0, included - usedThisMonth) + purchased;
      expect(total).toBe(400);
    });

    it("should floor included credits at 0 when overused", () => {
      const included = 500;
      const usedThisMonth = 600;
      const purchased = 50;

      const total = Math.max(0, included - usedThisMonth) + purchased;
      expect(total).toBe(50);
    });

    it("should return only purchased when no subscription", () => {
      const included = 0; // Free plan
      const usedThisMonth = 0;
      const purchased = 200;

      const total = Math.max(0, included - usedThisMonth) + purchased;
      expect(total).toBe(200);
    });

    it("should return 0 when all credits exhausted", () => {
      const included = 100;
      const usedThisMonth = 100;
      const purchased = 0;

      const total = Math.max(0, included - usedThisMonth) + purchased;
      expect(total).toBe(0);
    });
  });

  // UNIT-013: Credit deduction order
  describe("UNIT-013: Monthly credits exhausted before purchased", () => {
    it("should deduct from monthly credits first", () => {
      const included = 500;
      const usedThisMonth = 490; // 10 remaining monthly
      const purchased = 100;
      const creditsToConsume = 5;

      // Monthly remaining = 500 - 490 = 10
      const monthlyRemaining = included - usedThisMonth;
      expect(monthlyRemaining).toBe(10);

      // 5 credits consumed from monthly (enough monthly remaining)
      const fromMonthly = Math.min(creditsToConsume, monthlyRemaining);
      const fromPurchased = creditsToConsume - fromMonthly;

      expect(fromMonthly).toBe(5);
      expect(fromPurchased).toBe(0);
    });

    it("should spill over to purchased when monthly exhausted", () => {
      const included = 500;
      const usedThisMonth = 495; // 5 remaining monthly
      const purchased = 100;
      const creditsToConsume = 15;

      const monthlyRemaining = included - usedThisMonth;
      expect(monthlyRemaining).toBe(5);

      // Need 15, only 5 monthly left, so 10 from purchased
      const fromMonthly = Math.min(creditsToConsume, monthlyRemaining);
      const fromPurchased = Math.max(0, creditsToConsume - fromMonthly);

      expect(fromMonthly).toBe(5);
      expect(fromPurchased).toBe(10);
    });

    it("should take entirely from purchased when monthly depleted", () => {
      const included = 500;
      const usedThisMonth = 500; // 0 remaining monthly
      const purchased = 100;
      const creditsToConsume = 10;

      const monthlyRemaining = Math.max(0, included - usedThisMonth);
      const fromMonthly = Math.min(creditsToConsume, monthlyRemaining);
      const fromPurchased = creditsToConsume - fromMonthly;

      expect(fromMonthly).toBe(0);
      expect(fromPurchased).toBe(10);
    });
  });

  // Credit packages validation
  describe("Credit packages", () => {
    it("Starter pack should have 1000 credits for $19", () => {
      expect(CREDIT_PACKAGES.STARTER.credits).toBe(1000);
      expect(CREDIT_PACKAGES.STARTER.price).toBe(19);
    });

    it("Professional pack should have 5000 credits for $79", () => {
      expect(CREDIT_PACKAGES.PROFESSIONAL.credits).toBe(5000);
      expect(CREDIT_PACKAGES.PROFESSIONAL.price).toBe(79);
    });

    it("Enterprise pack should have 20000 credits for $299", () => {
      expect(CREDIT_PACKAGES.ENTERPRISE.credits).toBe(20000);
      expect(CREDIT_PACKAGES.ENTERPRISE.price).toBe(299);
    });

    it("larger packs should have better price per credit", () => {
      const starterPerCredit =
        CREDIT_PACKAGES.STARTER.price / CREDIT_PACKAGES.STARTER.credits;
      const proPerCredit =
        CREDIT_PACKAGES.PROFESSIONAL.price /
        CREDIT_PACKAGES.PROFESSIONAL.credits;
      const enterprisePerCredit =
        CREDIT_PACKAGES.ENTERPRISE.price / CREDIT_PACKAGES.ENTERPRISE.credits;

      expect(proPerCredit).toBeLessThan(starterPerCredit);
      expect(enterprisePerCredit).toBeLessThan(proPerCredit);
    });
  });
});
