import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { NextRequest } from "next/server";
import { GET, PUT, DELETE } from "@/app/api/billing/subscription/route";

// Mock Supabase client
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "test-user-id", email: "test@example.com" } },
        error: null,
      }),
    },
  }),
}));

// Mock Stripe functions
jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
}));

import {
  getUserSubscription,
  updateSubscription,
  cancelSubscription,
} from "@/lib/stripe/subscription";

describe("/api/billing/subscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET", () => {
    it("should return user subscription", async () => {
      const mockSubscription = {
        id: "sub-123",
        plan_id: "pro",
        status: "active",
      };

      (getUserSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(getUserSubscription).toHaveBeenCalledWith("test-user-id");
    });

    it("should return null subscription for users without subscription", async () => {
      (getUserSubscription as jest.Mock).mockResolvedValue(null);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toBeNull();
    });
  });

  /**
   * There is no POST on this route any more. Buying a first subscription goes
   * through Stripe Checkout (POST /api/billing/checkout with
   * `{ intent: "subscription" }`), because creating it server-side left
   * `incomplete` rows that Stripe auto-cancelled. The former POST block of this
   * suite was removed with it; PUT below covers plan changes on an existing
   * subscription.
   */
  describe("PUT", () => {
    const putRequest = (body: unknown) =>
      new NextRequest("http://localhost:3000/api/billing/subscription", {
        method: "PUT",
        body: JSON.stringify(body),
      });

    it("should change the plan on an existing subscription", async () => {
      const result = {
        subscription: {
          id: "sub-123",
          plan_id: "starter",
          status: "active",
        },
        requiresAction: false,
        hostedInvoiceUrl: null,
      };
      (updateSubscription as jest.Mock).mockResolvedValue(result);

      const response = await PUT(putRequest({ planId: "starter" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(result);
      // billingPeriod defaults to monthly when the caller omits it.
      expect(updateSubscription).toHaveBeenCalledWith("test-user-id", {
        planId: "starter",
        billingPeriod: "monthly",
      });
    });

    it("should pass a yearly billing period through", async () => {
      (updateSubscription as jest.Mock).mockResolvedValue({
        subscription: { id: "sub-123" },
        requiresAction: false,
        hostedInvoiceUrl: null,
      });

      await PUT(putRequest({ planId: "pro", billingPeriod: "yearly" }));

      expect(updateSubscription).toHaveBeenCalledWith("test-user-id", {
        planId: "pro",
        billingPeriod: "yearly",
      });
    });

    it("should surface a required 3DS action to the caller", async () => {
      (updateSubscription as jest.Mock).mockResolvedValue({
        subscription: { id: "sub-123" },
        requiresAction: true,
        hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
      });

      const response = await PUT(putRequest({ planId: "pro" }));
      const data = await response.json();

      expect(data.requiresAction).toBe(true);
      expect(data.hostedInvoiceUrl).toBe("https://invoice.stripe.com/i/test");
    });

    it("should reject an unknown plan id", async () => {
      const response = await PUT(putRequest({ planId: "invalid-plan" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid plan ID");
      expect(updateSubscription).not.toHaveBeenCalled();
    });

    it("should reject the free plan, which cannot be purchased", async () => {
      const response = await PUT(putRequest({ planId: "free" }));

      expect(response.status).toBe(400);
      expect(updateSubscription).not.toHaveBeenCalled();
    });

    it("should reject an unknown billing period", async () => {
      const response = await PUT(
        putRequest({ planId: "pro", billingPeriod: "weekly" }),
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid billing period");
      expect(updateSubscription).not.toHaveBeenCalled();
    });

    it("should return 500 with the underlying reason when the change fails", async () => {
      (updateSubscription as jest.Mock).mockRejectedValue(
        new Error("No active subscription found"),
      );

      const response = await PUT(putRequest({ planId: "pro" }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("No active subscription found");
    });
  });

  describe("DELETE", () => {
    it("should cancel subscription at period end", async () => {
      const mockSubscription = {
        id: "sub-123",
        plan_id: "pro",
        status: "active",
        cancel_at_period_end: true,
      };

      (cancelSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const request = new NextRequest(
        "http://localhost:3000/api/billing/subscription",
      );

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(cancelSubscription).toHaveBeenCalledWith("test-user-id", false);
    });

    it("should cancel subscription immediately when requested", async () => {
      const mockSubscription = {
        id: "sub-123",
        plan_id: "pro",
        status: "canceled",
      };

      (cancelSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const request = new NextRequest(
        "http://localhost:3000/api/billing/subscription?immediate=true",
      );

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.subscription).toEqual(mockSubscription);
      expect(cancelSubscription).toHaveBeenCalledWith("test-user-id", true);
    });
  });
});
