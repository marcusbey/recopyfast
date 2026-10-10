/**
 * POST /api/billing/subscription/reactivate — what reaches the client.
 *
 * s82 (s69 L5): the handler returned `error.message` for anything thrown, so
 * Stripe's and PostgREST's sentences reached the page. A refusal written for
 * the customer is a `BillingRefusal` and keeps its words and status — that is
 * how the lifetime refusal (s82, proved against the real function in
 * src/__tests__/lib/stripe/reactivate-lifetime.test.ts) reaches the card.
 */

const mockGetUser = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

jest.mock("@/lib/stripe/subscription", () => ({
  reactivateSubscription: jest.fn(),
}));

import { POST } from "@/app/api/billing/subscription/reactivate/route";
import { reactivateSubscription } from "@/lib/stripe/subscription";
import { BillingRefusal } from "@/lib/billing/billing-refusal";

const mockReactivate = reactivateSubscription as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/billing/subscription/reactivate", () => {
  it("refuses an unauthenticated caller with 401 and reactivates nothing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mockReactivate).not.toHaveBeenCalled();
  });

  it("reactivates the caller's subscription", async () => {
    const subscription = { id: "sub-row-1", cancel_at_period_end: false };
    mockReactivate.mockResolvedValue(subscription);

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ subscription });
    expect(mockReactivate).toHaveBeenCalledWith("user-1");
  });

  it("answers the lifetime refusal with 409 and its message", async () => {
    mockReactivate.mockRejectedValue(
      new BillingRefusal(
        "Your lifetime plan already includes this one, so this subscription can't be restarted.",
        409,
      ),
    );

    const response = await POST();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Your lifetime plan already includes this one, so this subscription can't be restarted.",
    });
  });

  it("never returns any other error's text", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const stripeError = Object.assign(
      new Error(
        "This subscription is canceled and cannot be updated: sub_live_789",
      ),
      { type: "StripeInvalidRequestError" },
    );
    mockReactivate.mockRejectedValue(stripeError);

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Failed to reactivate subscription" });
    expect(JSON.stringify(data)).not.toContain("sub_live_789");
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), stripeError);
  });
});
