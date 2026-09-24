import {
  performHostedFieldAction,
  performOptionalHostedFieldAction,
  waitForHostedCheckoutReturn,
} from "../../../e2e/support/stripe-hosted-fields";

const detachedFrameError = () => new Error("locator.count: Frame was detached");

function fieldCollection(field: unknown, count = 1) {
  return {
    count: jest.fn().mockResolvedValue(count),
    nth: jest.fn().mockReturnValue(field),
  };
}

function frameWithField(field: unknown) {
  return {
    locator: jest.fn().mockReturnValue(fieldCollection(field)),
  };
}

describe("Stripe-hosted frame snapshots", () => {
  it.each(["count", "visibility", "action"])(
    "discards a frame detached during %s and acts on its replacement",
    async (detachedAt) => {
      const staleField = {
        isVisible: jest.fn().mockImplementation(() => {
          if (detachedAt === "visibility") {
            return Promise.reject(detachedFrameError());
          }
          return Promise.resolve(true);
        }),
      };
      const staleCollection = fieldCollection(staleField);
      if (detachedAt === "count") {
        staleCollection.count.mockRejectedValue(detachedFrameError());
      }
      const staleFrame = {
        locator: jest.fn().mockReturnValue(staleCollection),
      };
      const replacementField = { isVisible: jest.fn().mockResolvedValue(true) };
      const replacementFrame = frameWithField(replacementField);
      const page = {
        frames: jest
          .fn()
          .mockReturnValueOnce([staleFrame])
          .mockReturnValue([replacementFrame]),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
      };
      const action = jest.fn().mockImplementation((field) => {
        if (field === staleField && detachedAt === "action") {
          return Promise.reject(detachedFrameError());
        }
        return Promise.resolve("acted");
      });

      await expect(
        performHostedFieldAction(
          page as never,
          'input[name="cardNumber"]',
          action,
          {
            timeoutMs: 500,
            intervalMs: 250,
            retryDetachedAction:
              detachedAt === "action" ? "idempotent-setter" : undefined,
          },
        ),
      ).resolves.toBe("acted");

      expect(page.frames).toHaveBeenCalledTimes(2);
      expect(action).toHaveBeenLastCalledWith(
        replacementField,
        expect.objectContaining({
          playwrightTimeoutMs: expect.any(Function),
        }),
      );
      expect(page.waitForTimeout).toHaveBeenCalledWith(250);
    },
  );

  it("does not retry a detached non-idempotent action", async () => {
    const actionError = detachedFrameError();
    const field = { isVisible: jest.fn().mockResolvedValue(true) };
    const page = {
      frames: jest.fn().mockReturnValue([frameWithField(field)]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const action = jest.fn().mockRejectedValue(actionError);

    await expect(
      performHostedFieldAction(page as never, 'button[type="submit"]', action, {
        timeoutMs: 500,
        intervalMs: 250,
      }),
    ).rejects.toBe(actionError);

    expect(page.frames).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("does not hide an unrelated idempotent-setter failure", async () => {
    const actionError = new Error("locator.fill: browser process exited");
    const field = { isVisible: jest.fn().mockResolvedValue(true) };
    const page = {
      frames: jest.fn().mockReturnValue([frameWithField(field)]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const action = jest.fn().mockRejectedValue(actionError);

    await expect(
      performHostedFieldAction(
        page as never,
        'input[name="cardNumber"]',
        action,
        {
          timeoutMs: 500,
          intervalMs: 250,
          retryDetachedAction: "idempotent-setter",
        },
      ),
    ).rejects.toBe(actionError);

    expect(page.frames).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("gives a stalled idempotent setter a real remaining wall-clock bound", async () => {
    const observedTimeouts: number[] = [];
    const field = {
      isVisible: jest.fn().mockResolvedValue(true),
      fill: jest
        .fn()
        .mockImplementation(
          (_value: string, { timeout }: { timeout: number }) => {
            observedTimeouts.push(timeout);
            return new Promise((_, reject) => {
              setTimeout(() => reject(detachedFrameError()), timeout);
            });
          },
        ),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frameWithField(field)]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const startedAt = Date.now();

    await expect(
      performHostedFieldAction(
        page as never,
        'input[name="cardNumber"]',
        (candidate, deadline) =>
          candidate.fill("4242", {
            timeout: deadline.playwrightTimeoutMs(),
          }),
        {
          timeoutMs: 40,
          intervalMs: 10,
          retryDetachedAction: "idempotent-setter",
        },
      ),
    ).rejects.toThrow(/did not render required field/i);

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(observedTimeouts).toHaveLength(1);
    expect(observedTimeouts[0]).toBeGreaterThan(0);
    expect(observedTimeouts[0]).toBeLessThanOrEqual(40);
  });

  it("fails within the existing bound when every current frame detaches", async () => {
    const detachedCollection = fieldCollection(undefined);
    detachedCollection.count.mockRejectedValue(detachedFrameError());
    const page = {
      frames: jest
        .fn()
        .mockReturnValue([
          { locator: jest.fn().mockReturnValue(detachedCollection) },
        ]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      performHostedFieldAction(
        page as never,
        'input[name="cardNumber"]',
        jest.fn(),
        { timeoutMs: 500, intervalMs: 250 },
      ),
    ).rejects.toThrow(
      /did not render required field input\[name="cardNumber"\]/i,
    );

    expect(page.frames).toHaveBeenCalledTimes(3);
    expect(detachedCollection.count).toHaveBeenCalledTimes(3);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it("does not hide unrelated locator failures", async () => {
    const unrelatedError = new Error("locator.count: browser process exited");
    const collection = fieldCollection(undefined);
    collection.count.mockRejectedValue(unrelatedError);
    const page = {
      frames: jest
        .fn()
        .mockReturnValue([{ locator: jest.fn().mockReturnValue(collection) }]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      performHostedFieldAction(
        page as never,
        'input[name="cardNumber"]',
        jest.fn(),
        { timeoutMs: 500, intervalMs: 250 },
      ),
    ).rejects.toBe(unrelatedError);

    expect(page.frames).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("keeps an absent optional field optional but retries a detached snapshot", async () => {
    const detachedCollection = fieldCollection(undefined);
    detachedCollection.count.mockRejectedValue(detachedFrameError());
    const stableMissingCollection = fieldCollection(undefined, 0);
    const page = {
      frames: jest
        .fn()
        .mockReturnValueOnce([
          { locator: jest.fn().mockReturnValue(detachedCollection) },
        ])
        .mockReturnValue([
          { locator: jest.fn().mockReturnValue(stableMissingCollection) },
        ]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const action = jest.fn();

    await expect(
      performOptionalHostedFieldAction(
        page as never,
        'input[name="billingName"]',
        action,
        { timeoutMs: 500, intervalMs: 250 },
      ),
    ).resolves.toBeNull();

    expect(page.frames).toHaveBeenCalledTimes(2);
    expect(action).not.toHaveBeenCalled();
  });

  it("discards a partial post-submit text count and returns after a replacement frame scan", async () => {
    const firstFrame = {
      getByText: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
      }),
    };
    const detachedFrame = {
      getByText: jest.fn().mockReturnValue({
        count: jest.fn().mockRejectedValue(detachedFrameError()),
      }),
    };
    const replacementFrame = {
      getByText: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(0),
      }),
    };
    const page = {
      url: jest
        .fn()
        .mockReturnValueOnce("https://checkout.stripe.com/c/pay/test")
        .mockReturnValue(
          "http://127.0.0.1:3000/dashboard/billing?checkout=success",
        ),
      frames: jest
        .fn()
        .mockReturnValueOnce([firstFrame, detachedFrame])
        .mockReturnValue([replacementFrame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await waitForHostedCheckoutReturn(page as never, {
      timeoutMs: 500,
      intervalMs: 250,
    });

    expect(page.frames).toHaveBeenCalledTimes(2);
    expect(page.url).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledWith(250);
  });

  it("never treats repeated detached post-submit scans as zero evidence", async () => {
    const detachedText = {
      count: jest.fn().mockRejectedValue(detachedFrameError()),
    };
    const page = {
      url: jest.fn().mockReturnValue("https://checkout.stripe.com/c/pay/test"),
      frames: jest
        .fn()
        .mockReturnValue([
          { getByText: jest.fn().mockReturnValue(detachedText) },
        ]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      waitForHostedCheckoutReturn(page as never, {
        timeoutMs: 500,
        intervalMs: 250,
      }),
    ).rejects.toThrow(/did not return to the application/i);

    expect(page.frames).toHaveBeenCalledTimes(3);
    expect(detachedText.count).toHaveBeenCalledTimes(3);
  });

  it("preserves the postal-code failure after a complete hosted-text scan", async () => {
    const page = {
      url: jest.fn().mockReturnValue("https://checkout.stripe.com/c/pay/test"),
      frames: jest.fn().mockReturnValue([
        {
          getByText: jest.fn().mockReturnValue({
            count: jest.fn().mockResolvedValue(1),
          }),
        },
      ]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      waitForHostedCheckoutReturn(page as never, {
        timeoutMs: 500,
        intervalMs: 250,
      }),
    ).rejects.toThrow(/postal code incomplete/i);

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});
