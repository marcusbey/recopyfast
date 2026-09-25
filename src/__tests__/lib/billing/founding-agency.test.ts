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
  bindFoundingAgencyDuplicateRefundSession,
  bindFoundingAgencyCheckout,
  completeFoundingAgencyPurchase,
  getFoundingAgencyAvailability,
  getOpenFoundingAgencyCheckout,
  markFoundingAgencyDuplicateRefunded,
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
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("returns a verified open Checkout Session before new-session quota", async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      not: jest.fn(),
      maybeSingle: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({
      data: {
        id: "reservation-1",
        stripe_checkout_session_id: "cs_open",
        created_at: "2026-09-24T00:00:00.000Z",
      },
      error: null,
    });
    fromMock.mockReturnValue(query);
    retrieveSessionMock.mockResolvedValue({
      id: "cs_open",
      status: "open",
      url: "https://checkout.stripe.test/cs_open",
      client_reference_id: "user-1",
    });

    await expect(getOpenFoundingAgencyCheckout("user-1")).resolves.toEqual({
      sessionId: "cs_open",
      url: "https://checkout.stripe.test/cs_open",
    });
  });

  it("recovers and binds a matching open Session after the original bind acknowledgement was lost", async () => {
    const reservationQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn(),
    };
    reservationQuery.select.mockReturnValue(reservationQuery);
    reservationQuery.eq.mockReturnValue(reservationQuery);
    reservationQuery.maybeSingle.mockResolvedValue({
      data: {
        id: "reservation-1",
        stripe_checkout_session_id: null,
        created_at: "2026-09-24T00:10:00.000Z",
      },
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
    fromMock
      .mockReturnValueOnce(reservationQuery)
      .mockReturnValueOnce(customerQuery);
    listSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_recovered",
          status: "open",
          url: "https://checkout.stripe.test/cs_recovered",
          expires_at: 1_800_000_000,
          client_reference_id: "user-1",
          metadata: {
            user_id: "user-1",
            product_id: "lifetime_agency",
            founding_reservation_id: "reservation-1",
          },
        },
      ],
      has_more: false,
    });
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(getOpenFoundingAgencyCheckout("user-1")).resolves.toEqual({
      sessionId: "cs_recovered",
      url: "https://checkout.stripe.test/cs_recovered",
    });
    expect(listSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        created: {
          gte: Math.floor(Date.parse("2026-09-24T00:10:00.000Z") / 1000) - 300,
        },
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "bind_founding_agency_checkout",
      expect.objectContaining({
        p_reservation_id: "reservation-1",
        p_stripe_checkout_session_id: "cs_recovered",
        p_stripe_checkout_expires_at: 1_800_000_000,
      }),
    );
  });

  it.each([
    {
      status: "complete",
      url: "https://checkout.stripe.test/cs_1",
      user: "user-1",
    },
    { status: "open", url: null, user: "user-1" },
    {
      status: "open",
      url: "https://checkout.stripe.test/cs_1",
      user: "user-2",
    },
  ])("does not resume an unverified provider session %#", async (provider) => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      not: jest.fn(),
      maybeSingle: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({
      data: {
        id: "reservation-1",
        stripe_checkout_session_id: "cs_1",
        created_at: "2026-09-24T00:00:00.000Z",
      },
      error: null,
    });
    fromMock.mockReturnValue(query);
    retrieveSessionMock.mockResolvedValue({
      id: "cs_1",
      status: provider.status,
      url: provider.url,
      client_reference_id: provider.user,
    });

    await expect(getOpenFoundingAgencyCheckout("user-1")).resolves.toBeNull();
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

  it("returns the stable refund instruction for a second account purchase", async () => {
    rpcMock.mockResolvedValue({ data: "refund_required", error: null });

    await expect(
      completeFoundingAgencyPurchase("reservation-2", "user-1", "pi_2"),
    ).resolves.toEqual({
      granted: false,
      duplicate: false,
      refundRequired: true,
    });
  });

  it("persists the exact Checkout Session used for a duplicate refund", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(
      bindFoundingAgencyDuplicateRefundSession(
        "reservation-2",
        "user-1",
        "pi_2",
        "cs_2",
      ),
    ).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith(
      "bind_founding_agency_duplicate_refund_session",
      {
        p_reservation_id: "reservation-2",
        p_user_id: "user-1",
        p_stripe_payment_intent_id: "pi_2",
        p_stripe_checkout_session_id: "cs_2",
      },
    );
  });

  it("records a successful duplicate refund through the service-only RPC", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(
      markFoundingAgencyDuplicateRefunded(
        "reservation-2",
        "user-1",
        "pi_2",
        "re_2",
      ),
    ).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith(
      "mark_founding_agency_duplicate_refunded",
      {
        p_reservation_id: "reservation-2",
        p_user_id: "user-1",
        p_stripe_payment_intent_id: "pi_2",
        p_stripe_refund_id: "re_2",
      },
    );
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
            checkout_expires_at: Math.floor(Date.now() / 1000) - 60,
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

  it("retains an unresolved unbound hold during grace and searches Stripe history with clock skew", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-24T00:40:00.000Z") });
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
          checkout_expires_at: Math.floor(Date.now() / 1000) - 599,
          created_at: "2026-09-24T00:10:00.000Z",
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

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(0);
    expect(listSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        created: {
          gte: Math.floor(Date.parse("2026-09-24T00:10:00.000Z") / 1000) - 300,
        },
      }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("releases and flags an unresolved unbound hold after grace", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-24T00:40:00.000Z") });
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
          checkout_expires_at: Math.floor(Date.now() / 1000) - 601,
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
    expect(rpcMock).toHaveBeenCalledWith(
      "release_unresolved_founding_agency_checkout",
      {
        p_reservation_id: "reservation-unbound",
        p_reconciliation_reason: "stripe_history_no_session",
      },
    );
    jest.useRealTimers();
  });

  it("releases an overdue provider-error row, continues, and releases a healthy expired row", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-24T00:40:00.000Z") });
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      lte: jest.fn(),
      limit: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [
        {
          id: "reservation-error",
          user_id: "user-1",
          stripe_checkout_session_id: "cs_error",
          checkout_expires_at: Math.floor(Date.now() / 1000) - 601,
          created_at: "2026-09-24T00:00:00.000Z",
        },
        {
          id: "reservation-expired",
          user_id: "user-2",
          stripe_checkout_session_id: "cs_expired",
          checkout_expires_at: Math.floor(Date.now() / 1000) - 30,
          created_at: "2026-09-24T00:00:00.000Z",
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(query);
    retrieveSessionMock
      .mockRejectedValueOnce(new Error("request failed\nsecret detail"))
      .mockResolvedValueOnce({
        id: "cs_expired",
        status: "expired",
        payment_status: "unpaid",
      });
    rpcMock.mockResolvedValue({ data: true, error: null });
    const warn = jest.spyOn(console, "warn");

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(2);
    expect(rpcMock).toHaveBeenNthCalledWith(
      1,
      "release_unresolved_founding_agency_checkout",
      {
        p_reservation_id: "reservation-error",
        p_reconciliation_reason: "stripe_session_lookup_failed",
      },
    );
    expect(rpcMock).toHaveBeenNthCalledWith(
      2,
      "release_founding_agency_checkout",
      expect.objectContaining({ p_reservation_id: "reservation-expired" }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("reservation-error"),
    );
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret detail");
    jest.useRealTimers();
  });

  it("keeps a known paid session beyond grace", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-24T00:40:00.000Z") });
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      lte: jest.fn(),
      limit: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [
        {
          id: "reservation-paid",
          user_id: "user-1",
          stripe_checkout_session_id: "cs_paid",
          checkout_expires_at: Math.floor(Date.now() / 1000) - 601,
          created_at: "2026-09-24T00:00:00.000Z",
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(query);
    retrieveSessionMock.mockResolvedValue({
      id: "cs_paid",
      status: "complete",
      payment_status: "paid",
    });

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("keeps an open session until its provider expiry plus grace, then flags it without blocking later rows", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-24T00:40:00.000Z") });
    const now = Math.floor(Date.now() / 1000);
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      lte: jest.fn(),
      limit: jest.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.limit.mockResolvedValue({
      data: [
        {
          id: "reservation-open",
          user_id: "user-1",
          stripe_checkout_session_id: "cs_open",
          checkout_expires_at: now - 601,
          created_at: "2026-09-24T00:00:00.000Z",
        },
        {
          id: "reservation-expired",
          user_id: "user-2",
          stripe_checkout_session_id: "cs_expired",
          checkout_expires_at: now - 30,
          created_at: "2026-09-24T00:00:00.000Z",
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(query);
    retrieveSessionMock
      .mockResolvedValueOnce({
        id: "cs_open",
        status: "open",
        payment_status: "unpaid",
        expires_at: now + 60,
      })
      .mockResolvedValueOnce({
        id: "cs_expired",
        status: "expired",
        payment_status: "unpaid",
      });
    rpcMock.mockResolvedValue({ data: true, error: null });

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "release_founding_agency_checkout",
      expect.objectContaining({ p_reservation_id: "reservation-expired" }),
    );

    jest.setSystemTime(new Date((now + 661) * 1000));
    rpcMock.mockClear();
    retrieveSessionMock
      .mockResolvedValueOnce({
        id: "cs_open",
        status: "open",
        payment_status: "unpaid",
        expires_at: now + 60,
      })
      .mockResolvedValueOnce({
        id: "cs_expired",
        status: "expired",
        payment_status: "unpaid",
      });

    await expect(reconcileExpiredFoundingAgencyCheckouts()).resolves.toBe(2);
    expect(rpcMock).toHaveBeenCalledWith(
      "release_unresolved_founding_agency_checkout",
      {
        p_reservation_id: "reservation-open",
        p_reconciliation_reason: "stripe_session_state_unresolved",
      },
    );
    jest.useRealTimers();
  });
});
