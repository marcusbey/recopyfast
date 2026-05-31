import { SUBSCRIPTION_PLANS, TICKET_CONFIG } from "@/lib/stripe/config";

// Mock Stripe to prevent initialization error
jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({}));
});

// Set required env vars before importing
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_STARTER_PRICE_ID = "price_starter_test";
process.env.STRIPE_STARTER_YEARLY_PRICE_ID = "price_starter_yearly_test";
process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
process.env.STRIPE_PRO_YEARLY_PRICE_ID = "price_pro_yearly_test";
process.env.STRIPE_ENTERPRISE_PRICE_ID = "price_enterprise_test";
process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID = "price_enterprise_yearly_test";
process.env.STRIPE_TICKETS_PRICE_ID = "price_tickets_test";

describe("Stripe Config - Subscription Plans", () => {
  // UNIT-001: All plans have valid priceId/yearlyPriceId when env set
  describe("UNIT-001: Plan price IDs", () => {
    it("should have valid priceId and yearlyPriceId for Starter", () => {
      expect(SUBSCRIPTION_PLANS.STARTER.priceId).toBeTruthy();
      expect(SUBSCRIPTION_PLANS.STARTER.yearlyPriceId).toBeTruthy();
    });

    it("should have valid priceId and yearlyPriceId for Pro", () => {
      expect(SUBSCRIPTION_PLANS.PRO.priceId).toBeTruthy();
      expect(SUBSCRIPTION_PLANS.PRO.yearlyPriceId).toBeTruthy();
    });

    it("should have valid priceId and yearlyPriceId for Enterprise", () => {
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.priceId).toBeTruthy();
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.yearlyPriceId).toBeTruthy();
    });

    it("should have null priceId for Free plan", () => {
      expect(SUBSCRIPTION_PLANS.FREE.priceId).toBeNull();
      expect(SUBSCRIPTION_PLANS.FREE.yearlyPriceId).toBeNull();
    });
  });

  // UNIT-002: Yearly prices = monthly * 0.83 (17% off)
  describe("UNIT-002: Yearly pricing discount", () => {
    it("Starter yearly price should be $7.47", () => {
      expect(SUBSCRIPTION_PLANS.STARTER.yearlyPrice).toBe(7.47);
    });

    it("Pro yearly price should be $15.77", () => {
      expect(SUBSCRIPTION_PLANS.PRO.yearlyPrice).toBe(15.77);
    });

    it("Enterprise yearly price should be $32.37", () => {
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.yearlyPrice).toBe(32.37);
    });

    it("Free yearly price should be $0", () => {
      expect(SUBSCRIPTION_PLANS.FREE.yearlyPrice).toBe(0);
    });
  });

  // UNIT-003: Website limits
  describe("UNIT-003: Website limits per plan", () => {
    it("Free plan should have 0 websites", () => {
      expect(SUBSCRIPTION_PLANS.FREE.limits.websites).toBe(0);
    });

    it("Starter plan should have 1 website", () => {
      expect(SUBSCRIPTION_PLANS.STARTER.limits.websites).toBe(1);
    });

    it("Pro plan should have 3 websites", () => {
      expect(SUBSCRIPTION_PLANS.PRO.limits.websites).toBe(3);
    });

    it("Enterprise plan should have unlimited websites (-1)", () => {
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.limits.websites).toBe(-1);
    });
  });

  // UNIT-004: AI features availability
  describe("UNIT-004: AI features per plan", () => {
    it("Free plan should NOT have AI features", () => {
      expect(SUBSCRIPTION_PLANS.FREE.limits.aiFeatures).toBe(false);
    });

    it("Starter plan should NOT have AI features", () => {
      expect(SUBSCRIPTION_PLANS.STARTER.limits.aiFeatures).toBe(false);
    });

    it("Pro plan should have AI features", () => {
      expect(SUBSCRIPTION_PLANS.PRO.limits.aiFeatures).toBe(true);
    });

    it("Enterprise plan should have AI features", () => {
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.limits.aiFeatures).toBe(true);
    });
  });

  // UNIT-005: Ticket pricing
  describe("UNIT-005: Ticket system pricing", () => {
    it("should be $0.50 per ticket", () => {
      expect(TICKET_CONFIG.PRICE_PER_TICKET).toBe(0.5);
    });

    it("should be 10 tickets per purchase", () => {
      expect(TICKET_CONFIG.TICKETS_PER_PURCHASE).toBe(10);
    });

    it("should cost $5 for 10 tickets", () => {
      expect(
        TICKET_CONFIG.PRICE_PER_TICKET * TICKET_CONFIG.TICKETS_PER_PURCHASE,
      ).toBe(5);
    });
  });

  // UNIT-006: Plan hierarchy
  describe("UNIT-006: Plan hierarchy", () => {
    it("should have increasing prices: Free < Starter < Pro < Enterprise", () => {
      expect(SUBSCRIPTION_PLANS.FREE.price).toBeLessThan(
        SUBSCRIPTION_PLANS.STARTER.price,
      );
      expect(SUBSCRIPTION_PLANS.STARTER.price).toBeLessThan(
        SUBSCRIPTION_PLANS.PRO.price,
      );
      expect(SUBSCRIPTION_PLANS.PRO.price).toBeLessThan(
        SUBSCRIPTION_PLANS.ENTERPRISE.price,
      );
    });

    it("should have increasing website limits", () => {
      expect(SUBSCRIPTION_PLANS.FREE.limits.websites).toBeLessThan(
        SUBSCRIPTION_PLANS.STARTER.limits.websites,
      );
      expect(SUBSCRIPTION_PLANS.STARTER.limits.websites).toBeLessThan(
        SUBSCRIPTION_PLANS.PRO.limits.websites,
      );
      // Enterprise is -1 (unlimited), which is semantically the highest
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.limits.websites).toBe(-1);
    });

    it("should have increasing collaborator limits", () => {
      expect(SUBSCRIPTION_PLANS.FREE.limits.collaborators).toBe(0);
      expect(SUBSCRIPTION_PLANS.STARTER.limits.collaborators).toBe(0);
      expect(SUBSCRIPTION_PLANS.PRO.limits.collaborators).toBe(5);
      expect(SUBSCRIPTION_PLANS.ENTERPRISE.limits.collaborators).toBe(-1);
    });
  });
});
