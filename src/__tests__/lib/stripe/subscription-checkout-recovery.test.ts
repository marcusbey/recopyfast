const cancelMock = jest.fn();
const retrieveMock = jest.fn();
const updateMock = jest.fn();
const readEqMock = jest.fn();
const readInMock = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    subscriptions: {
      cancel: (...args: unknown[]) => cancelMock(...args),
      retrieve: (...args: unknown[]) => retrieveMock(...args),
    },
  },
}));

const writeSingleMock = jest.fn();
const writeBuilder = {
  update: (...args: unknown[]) => {
    updateMock(...args);
    return writeBuilder;
  },
  eq: () => writeBuilder,
  select: () => writeBuilder,
  single: (...args: unknown[]) => writeSingleMock(...args),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ from: () => writeBuilder }),
}));

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));
jest.mock("@/lib/stripe/plans", () => ({
  getPaidPlan: jest.fn(),
  resolveStripePriceId: jest.fn(),
}));

import { cancelRecoverableSubscriptionsForCheckout } from "@/lib/stripe/subscription";

function readClient(rows: unknown[], error: { message: string } | null = null) {
  const builder = {
    select: () => builder,
    eq: (...args: unknown[]) => {
      readEqMock(...args);
      return builder;
    },
    in: (...args: unknown[]) => {
      readInMock(...args);
      return builder;
    },
    then: <T>(
      resolve: (value: {
        data: unknown[];
        error: { message: string } | null;
      }) => T,
      reject?: (reason: unknown) => T,
    ) => Promise.resolve({ data: rows, error }).then(resolve, reject),
  };
  return { from: () => builder } as never;
}

function row(id: string, status: string) {
  return {
    id: `row-${id}`,
    user_id: "user-1",
    stripe_subscription_id: id,
    status,
  };
}

describe("recoverable subscription checkout obligations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    writeSingleMock.mockResolvedValue({ data: { id: "updated" }, error: null });
  });

  it("cancels and durably records every incomplete, unpaid and paused obligation", async () => {
    const rows = [
      row("sub-incomplete", "incomplete"),
      row("sub-unpaid", "unpaid"),
      row("sub-paused", "paused"),
    ];
    cancelMock
      .mockResolvedValueOnce({ id: "sub-incomplete", status: "canceled" })
      .mockResolvedValueOnce({ id: "sub-unpaid", status: "canceled" })
      .mockResolvedValueOnce({
        id: "sub-paused",
        status: "incomplete_expired",
      });
    retrieveMock
      .mockResolvedValueOnce({ id: "sub-incomplete", status: "incomplete" })
      .mockResolvedValueOnce({ id: "sub-unpaid", status: "unpaid" })
      .mockResolvedValueOnce({ id: "sub-paused", status: "paused" });

    await expect(
      cancelRecoverableSubscriptionsForCheckout(readClient(rows), "user-1"),
    ).resolves.toBeUndefined();

    expect(cancelMock.mock.calls).toEqual([
      ["sub-incomplete"],
      ["sub-unpaid"],
      ["sub-paused"],
    ]);
    expect(updateMock).toHaveBeenCalledTimes(3);
    expect(updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "incomplete_expired" }),
    );
    expect(readEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(readInMock).toHaveBeenCalledWith("status", [
      "incomplete",
      "unpaid",
      "paused",
    ]);
  });

  it("recovers an ambiguous cancellation only when Stripe now reports terminal", async () => {
    cancelMock.mockRejectedValue(new Error("timeout"));
    retrieveMock
      .mockResolvedValueOnce({ id: "sub-1", status: "incomplete" })
      .mockResolvedValueOnce({ id: "sub-1", status: "canceled" });

    await expect(
      cancelRecoverableSubscriptionsForCheckout(
        readClient([row("sub-1", "incomplete")]),
        "user-1",
      ),
    ).resolves.toBeUndefined();
    expect(retrieveMock).toHaveBeenCalledWith("sub-1");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" }),
    );
  });

  it.each(["incomplete", "unpaid"])(
    "fails closed when ambiguous cancellation still reads %s",
    async (status) => {
      cancelMock.mockRejectedValue(new Error("timeout"));
      retrieveMock
        .mockResolvedValueOnce({ id: "sub-1", status })
        .mockResolvedValueOnce({ id: "sub-1", status });

      await expect(
        cancelRecoverableSubscriptionsForCheckout(
          readClient([row("sub-1", status)]),
          "user-1",
        ),
      ).rejects.toThrow(/not terminal/);
      expect(updateMock).not.toHaveBeenCalled();
    },
  );

  it.each(["active", "trialing", "past_due"])(
    "preserves a stale recoverable row whose provider state is now %s",
    async (status) => {
      retrieveMock.mockResolvedValue({ id: "sub-1", status });

      await expect(
        cancelRecoverableSubscriptionsForCheckout(
          readClient([row("sub-1", "incomplete")]),
          "user-1",
        ),
      ).rejects.toThrow(/not terminal/);
      expect(cancelMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed when Stripe cancellation returns a different subscription", async () => {
    retrieveMock.mockResolvedValue({ id: "sub-1", status: "incomplete" });
    cancelMock.mockResolvedValue({ id: "sub-other", status: "canceled" });

    await expect(
      cancelRecoverableSubscriptionsForCheckout(
        readClient([row("sub-1", "incomplete")]),
        "user-1",
      ),
    ).rejects.toThrow(/unexpected subscription/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("fails closed on subscription read or durable cancellation write failure", async () => {
    await expect(
      cancelRecoverableSubscriptionsForCheckout(
        readClient([], { message: "read failed" }),
        "user-1",
      ),
    ).rejects.toThrow(/read failed/);

    retrieveMock.mockResolvedValue({ id: "sub-1", status: "unpaid" });
    cancelMock.mockResolvedValue({ id: "sub-1", status: "canceled" });
    writeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "write failed" },
    });
    await expect(
      cancelRecoverableSubscriptionsForCheckout(
        readClient([row("sub-1", "unpaid")]),
        "user-1",
      ),
    ).rejects.toThrow(/write failed/);
  });
});
