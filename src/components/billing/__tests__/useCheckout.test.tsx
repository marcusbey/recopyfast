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

  it("follows a subscription recovery URL returned with 409", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: async () => ({
        error: "Your current subscription needs attention.",
        resumeUrl: "#resume-current-subscription",
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

    expect(window.location.hash).toBe("#resume-current-subscription");
    expect(result.current.error).toBeNull();
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

  it("shows when a checkout conflict with a valid retry time can be retried", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Checkout recovery is still in progress.",
        retryAt: "2099-01-02T15:47:00",
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

    expect(result.current.error).toBe(
      "Checkout recovery is still in progress. You can start a new checkout at 15:47.",
    );
    expect(result.current.isRedirecting).toBe(false);
  });

  it("does not show a retry sentence for an invalid retry time", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Checkout recovery is still in progress.",
        retryAt: "not-a-date",
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

    expect(result.current.error).toBe(
      "Checkout recovery is still in progress.",
    );
    expect(result.current.isRedirecting).toBe(false);
  });

  it("shows the 429 reset time as Try again at HH:MM", async () => {
    const resetAt = new Date(4_092_738_420 * 1000);
    const expectedTime = new Intl.DateTimeFormat("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(resetAt);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "X-RateLimit-Reset": "4092738420" }),
      json: async () => ({ error: "Rate limit exceeded" }),
    });
    const { result } = renderHook(() => useCheckout());

    await act(async () => {
      await result.current.startCheckout({
        intent: "credits",
        quantity: 1,
      });
    });

    expect(result.current.error).toBe(
      `Rate limit exceeded Try again at ${expectedTime}.`,
    );
  });
});
