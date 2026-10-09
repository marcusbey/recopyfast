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
import { BillingRefusal } from "@/lib/billing/billing-refusal";

describe("/api/billing/subscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENCY_CHECKOUT_ENABLED = "true";
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

    it("withdraws an Agency upgrade when the Agency checkout switch is off", async () => {
      process.env.AGENCY_CHECKOUT_ENABLED = "false";

      const response = await PUT(putRequest({ planId: "agency" }));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "Agency checkout is temporarily unavailable.",
      });
      expect(updateSubscription).not.toHaveBeenCalled();
    });

    it.each(["starter", "pro"] as const)(
      "keeps %s plan changes available when Agency checkout is withdrawn",
      async (planId) => {
        process.env.AGENCY_CHECKOUT_ENABLED = "false";
        (updateSubscription as jest.Mock).mockResolvedValue({
          subscription: { id: "sub-123", plan_id: planId },
          requiresAction: false,
          hostedInvoiceUrl: null,
        });

        const response = await PUT(putRequest({ planId }));

        expect(response.status).toBe(200);
        expect(updateSubscription).toHaveBeenCalledWith("test-user-id", {
          planId,
          billingPeriod: "monthly",
        });
      },
    );

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

    // s82 (s69 L5): this case used to be "should return 500 with the
    // underlying reason when the change fails" — it pinned the leak itself:
    // whatever text an exception carried, Stripe's included, went to the
    // client. A refusal written for the customer is now a `BillingRefusal`
    // and keeps its words; anything else stays in the log.
    it("answers a deliberate refusal with its own status and message", async () => {
      (updateSubscription as jest.Mock).mockRejectedValue(
        new BillingRefusal("No active subscription found", 404),
      );

      const response = await PUT(putRequest({ planId: "pro" }));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "No active subscription found",
      });
    });

    it("never returns any other error's text: Stripe's stays in the log", async () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const stripeError = Object.assign(
        new Error("No such customer: 'cus_live_123'"),
        { type: "StripeInvalidRequestError" },
      );
      (updateSubscription as jest.Mock).mockRejectedValue(stripeError);

      const response = await PUT(putRequest({ planId: "pro" }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: "Failed to update subscription" });
      expect(JSON.stringify(data)).not.toContain("cus_live_123");
      expect(consoleError).toHaveBeenCalledWith(
        expect.any(String),
        stripeError,
      );
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

    it("answers a deliberate refusal with its own status and message", async () => {
      (cancelSubscription as jest.Mock).mockRejectedValue(
        new BillingRefusal("No active subscription found", 404),
      );

      const response = await DELETE(
        new NextRequest("http://localhost:3000/api/billing/subscription"),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "No active subscription found",
      });
    });

    it("never returns any other error's text", async () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const stripeError = new Error(
        "No such subscription: 'sub_live_456'; a similar object exists in test mode",
      );
      (cancelSubscription as jest.Mock).mockRejectedValue(stripeError);

      const response = await DELETE(
        new NextRequest("http://localhost:3000/api/billing/subscription"),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to cancel subscription",
      });
      expect(consoleError).toHaveBeenCalledWith(
        expect.any(String),
        stripeError,
      );
    });
  });
});
