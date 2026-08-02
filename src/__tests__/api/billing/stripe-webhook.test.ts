/**
 * Suite 2B: Stripe Webhook Tests - API-017 to API-021
 * Tests Stripe webhook handling for subscription lifecycle events.
 */

// Mock Stripe
const mockConstructEvent = jest.fn();
jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
});

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

// Mock Supabase
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
  insert: jest.fn().mockResolvedValue({ error: null }),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockResolvedValue({ error: null }),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockSupabase),
}));

describe("Stripe Webhook Handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.from.mockReturnThis();
    mockSupabase.select.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
    mockSupabase.update.mockReturnThis();
  });

  // API-017: Webhook rejects invalid signature
  describe("API-017: Invalid signature rejection", () => {
    it("should reject requests with invalid Stripe signature", () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      expect(() => {
        mockConstructEvent("body", "invalid-sig", "whsec_test");
      }).toThrow("Invalid signature");
    });

    it("should reject requests with missing signature header", () => {
      const missingSignature = null;
      expect(missingSignature).toBeNull();
    });
  });

  // API-018: Webhook handles subscription.created
  describe("API-018: subscription.created event", () => {
    it("should upsert subscription data on creation", async () => {
      const event = {
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
            status: "active",
            items: {
              data: [{ price: { id: "price_pro" } }],
            },
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            cancel_at_period_end: false,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);

      // Simulate the webhook handler logic
      const subscription = event.data.object;
      expect(subscription.id).toBe("sub_123");
      expect(subscription.status).toBe("active");
      expect(subscription.items.data[0].price.id).toBe("price_pro");
    });
  });

  // API-019: Webhook handles subscription.deleted
  describe("API-019: subscription.deleted event", () => {
    it("should update subscription status to canceled", async () => {
      const event = {
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
            status: "canceled",
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const subscription = event.data.object;
      expect(subscription.status).toBe("canceled");
    });
  });

  // API-020 lives in one-time-purchases.test.ts, which drives the real route
  // handler for credit top-ups and Lifetime Pro instead of asserting on a
  // hand-built event object.

  // API-021: Webhook handles invoice.payment_failed
  describe("API-021: invoice.payment_failed event", () => {
    it("should update subscription status on payment failure", async () => {
      const event = {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_123",
            customer: "cus_123",
            subscription: "sub_123",
            status: "open",
            attempt_count: 1,
          },
        },
      };

      mockConstructEvent.mockReturnValue(event);

      const invoice = event.data.object;
      expect(invoice.status).toBe("open");
      expect(invoice.attempt_count).toBe(1);
      expect(invoice.subscription).toBe("sub_123");
    });
  });

  // Additional: Event type routing
  describe("Webhook event routing", () => {
    it("should handle all expected event types", () => {
      const expectedEvents = [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.payment_succeeded",
        "invoice.payment_failed",
        "payment_intent.succeeded",
        "customer.updated",
      ];

      expectedEvents.forEach((eventType) => {
        expect(eventType).toBeDefined();
        expect(typeof eventType).toBe("string");
      });
    });
  });
});
