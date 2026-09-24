const rpcMock = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: rpcMock })),
}));

import {
  bindFoundingAgencyCheckout,
  completeFoundingAgencyPurchase,
  getFoundingAgencyAvailability,
  releaseFoundingAgencyCheckout,
  reserveFoundingAgencySpot,
} from "@/lib/billing/founding-agency";

describe("founding Agency capacity RPCs", () => {
  beforeEach(() => rpcMock.mockReset());

  it("returns only completed-sale availability to public callers", async () => {
    rpcMock.mockResolvedValue({
      data: [{ completed: 49, remaining: 1, sold_out: false }],
      error: null,
    });

    await expect(getFoundingAgencyAvailability()).resolves.toEqual({
      remaining: 1,
      soldOut: false,
      limit: 50,
    });
    expect(rpcMock).toHaveBeenCalledWith("get_founding_agency_availability");
  });

  it("returns a durable reservation for checkout retries", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          reservation_id: "reservation-1",
          outcome: "reserved",
          checkout_expires_at: 1_800_000_000,
        },
      ],
      error: null,
    });

    await expect(reserveFoundingAgencySpot("user-1")).resolves.toEqual({
      reservationId: "reservation-1",
      outcome: "reserved",
      checkoutExpiresAt: 1_800_000_000,
    });
  });

  it.each(["sold_out", "capacity_busy", "owned"] as const)(
    "preserves the %s capacity outcome",
    async (outcome) => {
      rpcMock.mockResolvedValue({
        data: [{ reservation_id: null, outcome, checkout_expires_at: null }],
        error: null,
      });

      await expect(reserveFoundingAgencySpot("user-1")).resolves.toEqual({
        reservationId: null,
        outcome,
        checkoutExpiresAt: null,
      });
    },
  );

  it("binds, releases and completes through service-only RPCs", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: "granted", error: null });

    await expect(
      bindFoundingAgencyCheckout("reservation-1", "user-1", "cs_1"),
    ).resolves.toBeUndefined();
    await expect(
      releaseFoundingAgencyCheckout("reservation-1", "user-1", "cs_1"),
    ).resolves.toBe(true);
    await expect(
      completeFoundingAgencyPurchase("reservation-1", "user-1", "pi_1"),
    ).resolves.toEqual({ granted: true, duplicate: false });
  });

  it("fails closed when a reservation cannot be bound", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    await expect(
      bindFoundingAgencyCheckout("reservation-1", "user-1", "cs_1"),
    ).rejects.toThrow(/could not be bound/);
  });
});
