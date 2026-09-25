const rpcMock = jest.fn();
const fromMock = jest.fn();
const retrieveSessionMock = jest.fn();
const listSessionsMock = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: rpcMock, from: fromMock })),
}));

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
        list: (...args: unknown[]) => listSessionsMock(...args),
      },
    },
  },
}));

import {
  bindFoundingAgencyCheckout,
  completeFoundingAgencyPurchase,
  getFoundingAgencyAvailability,
  reconcileExpiredFoundingAgencyCheckouts,
  releaseFoundingAgencyCheckout,
  reserveFoundingAgencySpot,
} from "@/lib/billing/founding-agency";

describe("founding Agency capacity RPCs", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    retrieveSessionMock.mockReset();
    listSessionsMock.mockReset();
  });

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

  it.each(["sold_out", "capacity_busy", "owned", "refunded"] as const)(
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
      bindFoundingAgencyCheckout(
        "reservation-1",
        "user-1",
        "cs_1",
        1_800_000_000,
      ),
    ).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenNthCalledWith(
      1,
      "bind_founding_agency_checkout",
      expect.objectContaining({
        p_stripe_checkout_expires_at: 1_800_000_000,
      }),
    );
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

  it("releases a bound hold only after Stripe confirms the session expired unpaid", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      not: jest.fn(),
      lte: jest.fn(),
      limit: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [
        {
          id: "reservation-1",
          user_id: "user-1",
          stripe_checkout_session_id: "cs_expired",
          created_at: "2026-09-24T00:00:00.000Z",
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(query);
    retrieveSessionMock.mockResolvedValue({
      id: "cs_expired",
      status: "expired",
      payment_status: "unpaid",
    });
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(1);
    expect(retrieveSessionMock).toHaveBeenCalledWith("cs_expired");
    expect(rpcMock).toHaveBeenCalledWith(
      "release_founding_agency_checkout",
      expect.objectContaining({
        p_reservation_id: "reservation-1",
        p_user_id: "user-1",
        p_stripe_checkout_session_id: "cs_expired",
      }),
    );
  });

  it.each([
    { status: "complete", payment_status: "paid" },
    { status: "open", payment_status: "unpaid" },
  ])(
    "retains a bound hold when Stripe reports $status/$payment_status",
    async (provider) => {
      const query = {
        select: jest.fn(),
        eq: jest.fn(),
        not: jest.fn(),
        lte: jest.fn(),
        limit: jest.fn(),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.not.mockReturnValue(query);
      query.lte.mockReturnValue(query);
      query.limit.mockResolvedValue({
        data: [
          {
            id: "reservation-1",
            user_id: "user-1",
            stripe_checkout_session_id: "cs_pending",
            created_at: "2026-09-24T00:00:00.000Z",
          },
        ],
        error: null,
      });
      fromMock.mockReturnValue(query);
      retrieveSessionMock.mockResolvedValue(provider);

      await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(0);
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("releases an expired unbound hold only after Stripe history proves no session exists", async () => {
    const reservationQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      lte: jest.fn(),
      limit: jest.fn(),
    };
    reservationQuery.select.mockReturnValue(reservationQuery);
    reservationQuery.eq.mockReturnValue(reservationQuery);
    reservationQuery.lte.mockReturnValue(reservationQuery);
    reservationQuery.limit.mockResolvedValue({
      data: [
        {
          id: "reservation-unbound",
          user_id: "user-1",
          stripe_checkout_session_id: null,
          created_at: "2026-09-24T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const customerQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn(),
    };
    customerQuery.select.mockReturnValue(customerQuery);
    customerQuery.eq.mockReturnValue(customerQuery);
    customerQuery.maybeSingle.mockResolvedValue({
      data: { stripe_customer_id: "cus_1" },
      error: null,
    });
    fromMock.mockImplementation((table: string) =>
      table === "billing_customers" ? customerQuery : reservationQuery,
    );
    listSessionsMock.mockResolvedValue({ data: [], has_more: false });
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(1);
    expect(listSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1" }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "release_founding_agency_checkout",
      expect.objectContaining({
        p_reservation_id: "reservation-unbound",
        p_stripe_checkout_session_id: null,
      }),
    );
  });
});
