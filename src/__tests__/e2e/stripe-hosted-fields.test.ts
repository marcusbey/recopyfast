import { waitForHostedCheckoutReturn } from "../../../e2e/support/stripe-hosted-fields";

const APP_ORIGIN = "http://127.0.0.1:3000";
const STRIPE_CHECKOUT_URL = "https://checkout.stripe.com/c/pay/test";
const OWNED_SESSION_ID = "cs_test_ownedSession123456789";
const OTHER_SESSION_ID = "cs_test_otherSession987654321";

function checkoutPage(url: string) {
  return {
    isClosed: jest.fn().mockReturnValue(false),
    url: jest.fn().mockReturnValue(url),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
  };
}

describe("human-assisted Stripe Checkout return polling", () => {
  it("accepts the exact loopback success return without inspecting hosted fields", async () => {
    const page = checkoutPage(
      `${APP_ORIGIN}/dashboard/billing?checkout=success&session_id=${OWNED_SESSION_ID}`,
    );

    await expect(
      waitForHostedCheckoutReturn(
        page as never,
        {
          expectedAppOrigin: APP_ORIGIN,
          expectedCheckoutSessionId: OWNED_SESSION_ID,
          timeoutMs: 500,
          intervalMs: 250,
        } as never,
      ),
    ).resolves.toBeUndefined();

    expect(page.isClosed).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("fails closed when a lookalike success path uses another origin", async () => {
    const page = checkoutPage(
      `http://127.0.0.1.attacker.invalid:3000/dashboard/billing?checkout=success&session_id=${OWNED_SESSION_ID}`,
    );

    await expect(
      waitForHostedCheckoutReturn(
        page as never,
        {
          expectedAppOrigin: APP_ORIGIN,
          expectedCheckoutSessionId: OWNED_SESSION_ID,
          timeoutMs: 500,
          intervalMs: 250,
        } as never,
      ),
    ).rejects.toThrow(/unexpected return origin/i);

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  test.each([
    ["missing session", `${APP_ORIGIN}/dashboard/billing?checkout=success`],
    [
      "wrong session",
      `${APP_ORIGIN}/dashboard/billing?checkout=success&session_id=${OTHER_SESSION_ID}`,
    ],
    [
      "duplicate checkout",
      `${APP_ORIGIN}/dashboard/billing?checkout=success&checkout=success&session_id=${OWNED_SESSION_ID}`,
    ],
    [
      "duplicate session",
      `${APP_ORIGIN}/dashboard/billing?checkout=success&session_id=${OWNED_SESSION_ID}&session_id=${OWNED_SESSION_ID}`,
    ],
    [
      "extra query key",
      `${APP_ORIGIN}/dashboard/billing?checkout=success&session_id=${OWNED_SESSION_ID}&source=unexpected`,
    ],
    [
      "fragment",
      `${APP_ORIGIN}/dashboard/billing?checkout=success&session_id=${OWNED_SESSION_ID}#unexpected`,
    ],
    [
      "wrong path",
      `${APP_ORIGIN}/dashboard/other?checkout=success&session_id=${OWNED_SESSION_ID}`,
    ],
    [
      "cancel result",
      `${APP_ORIGIN}/dashboard/billing?checkout=cancelled&session_id=${OWNED_SESSION_ID}`,
    ],
  ])("rejects an inexact owned return: %s", async (_label, url) => {
    const page = checkoutPage(url);
    const error = await waitForHostedCheckoutReturn(
      page as never,
      {
        expectedAppOrigin: APP_ORIGIN,
        expectedCheckoutSessionId: OWNED_SESSION_ID,
        timeoutMs: 500,
        intervalMs: 250,
      } as never,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Stripe-hosted Checkout returned without the exact owned success contract.",
    );
    expect((error as Error).message).not.toContain(OWNED_SESSION_ID);
    expect((error as Error).message).not.toContain(OTHER_SESSION_ID);
    expect((error as Error).message).not.toContain(url);
  });

  it("rejects when the human closes the headed page", async () => {
    const page = checkoutPage(STRIPE_CHECKOUT_URL);
    page.isClosed.mockReturnValue(true);

    await expect(
      waitForHostedCheckoutReturn(
        page as never,
        {
          expectedAppOrigin: APP_ORIGIN,
          expectedCheckoutSessionId: OWNED_SESSION_ID,
          timeoutMs: 500,
          intervalMs: 250,
        } as never,
      ),
    ).rejects.toThrow(/page was closed/i);

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("converts a page close during polling into the fixed safe diagnostic", async () => {
    let isClosed = false;
    const page = checkoutPage(STRIPE_CHECKOUT_URL);
    page.isClosed.mockImplementation(() => isClosed);
    page.waitForTimeout.mockImplementation(async () => {
      isClosed = true;
      throw new Error("Target page, context or browser has been closed");
    });

    await expect(
      waitForHostedCheckoutReturn(
        page as never,
        {
          expectedAppOrigin: APP_ORIGIN,
          expectedCheckoutSessionId: OWNED_SESSION_ID,
          timeoutMs: 500,
          intervalMs: 250,
        } as never,
      ),
    ).rejects.toThrow(
      "Stripe-hosted Checkout page was closed before human completion.",
    );
  });

  it("rejects when the runner interrupts the human wait", async () => {
    const controller = new AbortController();
    const page = checkoutPage(STRIPE_CHECKOUT_URL);
    page.waitForTimeout.mockImplementation(async () => {
      controller.abort();
    });

    await expect(
      waitForHostedCheckoutReturn(
        page as never,
        {
          expectedAppOrigin: APP_ORIGIN,
          expectedCheckoutSessionId: OWNED_SESSION_ID,
          signal: controller.signal,
          timeoutMs: 500,
          intervalMs: 250,
        } as never,
      ),
    ).rejects.toThrow(/interrupted/i);
  });

  it("times out with a fixed diagnostic while Checkout remains hosted", async () => {
    const page = checkoutPage(STRIPE_CHECKOUT_URL);

    await expect(
      waitForHostedCheckoutReturn(
        page as never,
        {
          expectedAppOrigin: APP_ORIGIN,
          expectedCheckoutSessionId: OWNED_SESSION_ID,
          timeoutMs: 500,
          intervalMs: 250,
        } as never,
      ),
    ).rejects.toThrow(/did not return.*within the human completion window/i);

    expect(page.url).toHaveBeenCalledTimes(3);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
  });
});
