import { act, renderHook } from "@testing-library/react";
import { useCheckout } from "../useCheckout";

describe("useCheckout", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    window.history.replaceState({}, "", "/dashboard/billing");
  });

  it("resumes the open Stripe session when checkout returns its URL with 409", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "You already have a checkout in progress.",
        sessionId: "cs_open",
        url: "#open-checkout-cs_open",
      }),
    });
    const { result } = renderHook(() => useCheckout());

    await act(async () => {
      await result.current.startCheckout({
        intent: "subscription",
        planId: "pro",
        billingPeriod: "monthly",
      });
    });

    expect(window.location.hash).toBe("#open-checkout-cs_open");
    expect(result.current.error).toBeNull();
    expect(result.current.isRedirecting).toBe(true);
  });

  it("surfaces the conflict when no reusable checkout URL is available", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Checkout is still being prepared. Try again shortly.",
        sessionId: null,
        url: null,
      }),
    });
    const { result } = renderHook(() => useCheckout());

    await act(async () => {
      await result.current.startCheckout({
        intent: "subscription",
        planId: "pro",
        billingPeriod: "monthly",
      });
    });

    expect(window.location.hash).toBe("");
    expect(result.current.error).toBe(
      "Checkout is still being prepared. Try again shortly.",
    );
    expect(result.current.isRedirecting).toBe(false);
  });
});
