import {
  calculateJanitorMaxPasses,
  createJanitorStageTracker,
  createTerminalDeliveryLedger,
  paginateProviderList,
  reconcileUntilQuiescent,
} from "../../../e2e/support/stripe-provider-janitor";

describe("janitor stage diagnostics", () => {
  it("reports the trusted database stage and only safe PostgREST fields", async () => {
    const tracker = createJanitorStageTracker();
    const providerError = {
      code: "42703",
      message: "column checkout_reservations.id does not exist",
      details: "service_role_key=must-not-leak",
      hint: "customer@example.com",
    };

    await expect(
      tracker.run("database:discover:checkout_reservations", async () => {
        throw providerError;
      }),
    ).rejects.toBe(providerError);

    expect(tracker.diagnostic(providerError)).toBe(
      "database:discover:checkout_reservations: code=42703 message=column checkout_reservations.id does not exist",
    );
    expect(tracker.diagnostic(providerError)).not.toContain("must-not-leak");
    expect(tracker.diagnostic(providerError)).not.toContain(
      "customer@example.com",
    );
    expect(tracker.diagnostic(providerError)).not.toContain("[object Object]");
    expect(
      tracker.diagnostic({
        code: "42501",
        message: "authorization: bearer sk_test_sensitive",
      }),
    ).toBe(
      "database:discover:checkout_reservations: code=42501 message=authorization: [REDACTED]",
    );
  });

  it("attributes a terminal reconciliation failure to the outer quiescence stage", async () => {
    const tracker = createJanitorStageTracker();
    const terminalError = new Error(
      "Stripe provider janitor did not reach quiescence after 17 passes.",
    );

    await expect(
      tracker.run("reconcile:quiescence", async () => {
        await tracker.run(
          "database:discover:subscriptions",
          async () => undefined,
        );
        throw terminalError;
      }),
    ).rejects.toBe(terminalError);

    expect(tracker.diagnostic(terminalError)).toBe(
      "reconcile:quiescence: Stripe provider janitor did not reach quiescence after 17 passes.",
    );
  });

  it("preserves the innermost trusted stage when that operation fails", async () => {
    const tracker = createJanitorStageTracker();
    const databaseError = new Error("database unavailable");

    await expect(
      tracker.run("reconcile:quiescence", () =>
        tracker.run("database:discover:subscriptions", async () => {
          throw databaseError;
        }),
      ),
    ).rejects.toBe(databaseError);

    expect(tracker.diagnostic(databaseError)).toBe(
      "database:discover:subscriptions: database unavailable",
    );
  });
});

describe("reconcileUntilQuiescent", () => {
  it("repeats reconciliation until two consecutive clean observations", async () => {
    const reconcilePass = jest
      .fn()
      .mockResolvedValueOnce({ mutableCount: 2 })
      .mockResolvedValueOnce({ mutableCount: 0 })
      .mockResolvedValueOnce({ mutableCount: 0 });
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      reconcileUntilQuiescent(
        { reconcilePass, sleep },
        { maxPasses: 6, quietPasses: 2, intervalMs: 250 },
      ),
    ).resolves.toEqual({ passes: 3, mutableCount: 0 });

    expect(reconcilePass).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails closed when mutable ownership never reaches quiescence", async () => {
    await expect(
      reconcileUntilQuiescent(
        {
          reconcilePass: jest.fn().mockResolvedValue({ mutableCount: 1 }),
          sleep: jest.fn().mockResolvedValue(undefined),
        },
        { maxPasses: 3, quietPasses: 2, intervalMs: 250 },
      ),
    ).rejects.toThrow(/did not reach quiescence after 3 passes/i);
  });

  it("starts consecutive quiet proof only after the configured observation horizon", async () => {
    let now = 0;
    const reconcilePass = jest.fn().mockResolvedValue({ mutableCount: 0 });
    const sleep = jest.fn().mockImplementation(async (milliseconds: number) => {
      now += milliseconds;
    });

    await expect(
      reconcileUntilQuiescent(
        { reconcilePass, sleep, now: () => now },
        {
          maxPasses: 8,
          quietPasses: 2,
          intervalMs: 100,
          minObservationMs: 300,
        },
      ),
    ).resolves.toEqual({ passes: 5, mutableCount: 0 });

    expect(reconcilePass).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("requires a fresh quiet sequence after late activity that is cleaned in the same pass", async () => {
    const passes = [
      ...Array.from({ length: 15 }, () => ({
        mutableCount: 0,
        hadActivity: false,
      })),
      { mutableCount: 0, hadActivity: true },
      ...Array.from({ length: 16 }, () => ({
        mutableCount: 0,
        hadActivity: false,
      })),
    ];
    const reconcilePass = jest
      .fn()
      .mockImplementation(async (pass: number) => passes[pass - 1]);

    await expect(
      reconcileUntilQuiescent(
        { reconcilePass, sleep: jest.fn().mockResolvedValue(undefined) },
        { maxPasses: 32, quietPasses: 16, intervalMs: 1 },
      ),
    ).resolves.toEqual({ passes: 32, mutableCount: 0 });

    expect(reconcilePass).toHaveBeenCalledTimes(32);
  });

  it("budgets sixteen fresh quiet passes after activity in the first post-horizon quiet window", async () => {
    const quietPasses = 16;
    const intervalMs = 2_000;
    const minObservationMs = 300_000;
    const firstPostHorizonQuietPass =
      Math.ceil(minObservationMs / intervalMs) + 1;
    const activityPass = firstPostHorizonQuietPass + quietPasses - 1;
    const maxPasses = calculateJanitorMaxPasses({
      minObservationMs,
      intervalMs,
      quietPasses,
    });
    let now = 0;
    const reconcilePass = jest
      .fn()
      .mockImplementation(async (pass: number) => ({
        mutableCount: 0,
        hadActivity: pass === activityPass,
      }));
    const sleep = jest.fn().mockImplementation(async (milliseconds: number) => {
      now += milliseconds;
    });

    await expect(
      reconcileUntilQuiescent(
        { reconcilePass, sleep, now: () => now },
        {
          maxPasses,
          quietPasses,
          intervalMs,
          minObservationMs,
        },
      ),
    ).resolves.toEqual({
      passes: activityPass + quietPasses,
      mutableCount: 0,
    });

    expect(reconcilePass).toHaveBeenCalledTimes(activityPass + quietPasses);
    expect((maxPasses - 1) * intervalMs).toBeLessThan(10 * 60_000);
  });

  it("fails closed when late activity repeatedly resets every quiet window", async () => {
    const quietPasses = 16;
    const intervalMs = 2_000;
    const minObservationMs = 0;
    const maxPasses = calculateJanitorMaxPasses({
      minObservationMs,
      intervalMs,
      quietPasses,
    });

    await expect(
      reconcileUntilQuiescent(
        {
          reconcilePass: jest.fn().mockResolvedValue({
            mutableCount: 0,
            hadActivity: true,
          }),
          sleep: jest.fn().mockResolvedValue(undefined),
        },
        { maxPasses, quietPasses, intervalMs, minObservationMs },
      ),
    ).rejects.toThrow(
      `Stripe provider janitor did not reach quiescence after ${maxPasses} passes.`,
    );
  });
});

describe("createTerminalDeliveryLedger", () => {
  it("keeps per-object terminal proof cumulative across cleanup passes", () => {
    const ledger = createTerminalDeliveryLedger();
    ledger.observe([
      { eventType: "customer.deleted", objectId: "cus_one" },
      {
        eventType: "customer.subscription.deleted",
        objectId: "sub_one",
      },
    ]);
    ledger.observe([
      { eventType: "customer.deleted", objectId: "cus_two" },
      {
        eventType: "customer.subscription.deleted",
        objectId: "sub_two",
      },
    ]);

    expect(
      ledger.hasEvery(
        new Set(["cus_one", "cus_two"]),
        new Set(["sub_one", "sub_two"]),
      ),
    ).toBe(true);
    expect(ledger.snapshot()).toEqual({
      customerIds: ["cus_one", "cus_two"],
      subscriptionIds: ["sub_one", "sub_two"],
    });
  });

  it("restores already-terminal worker cleanup proof for a parent rerun", () => {
    const ledger = createTerminalDeliveryLedger({
      customerIds: ["cus_worker"],
      subscriptionIds: ["sub_worker"],
    });

    expect(
      ledger.hasEvery(new Set(["cus_worker"]), new Set(["sub_worker"])),
    ).toBe(true);
  });
});

describe("paginateProviderList", () => {
  it("reads every page until the provider says discovery is complete", async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "one" }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "two" }],
        has_more: false,
      });

    await expect(paginateProviderList(fetchPage)).resolves.toEqual([
      { id: "one" },
      { id: "two" },
    ]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "one");
  });

  it("fails closed when a page claims more data without a usable cursor", async () => {
    await expect(
      paginateProviderList(
        jest.fn().mockResolvedValue({ data: [], has_more: true }),
      ),
    ).rejects.toThrow(/incomplete provider discovery/i);
  });
});
