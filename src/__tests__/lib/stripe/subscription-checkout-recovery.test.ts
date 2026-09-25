const retrieveMock = jest.fn();
const listInvoicePaymentsMock = jest.fn();
const retrievePaymentIntentMock = jest.fn();
const createPortalSessionMock = jest.fn();
const readEqMock = jest.fn();
const readInMock = jest.fn();
const writeEqMock = jest.fn();
const writeUpdateMock = jest.fn();
const writeSingleMock = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    subscriptions: {
      retrieve: (...args: unknown[]) => retrieveMock(...args),
    },
    invoicePayments: {
      list: (...args: unknown[]) => listInvoicePaymentsMock(...args),
    },
    paymentIntents: {
      retrieve: (...args: unknown[]) => retrievePaymentIntentMock(...args),
    },
    billingPortal: {
      sessions: {
        create: (...args: unknown[]) => createPortalSessionMock(...args),
      },
    },
  },
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => {
    const builder = {
      update: (value: unknown) => {
        writeUpdateMock(value);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        writeEqMock(column, value);
        return builder;
      },
      select: () => builder,
      single: () => writeSingleMock(),
    };
    return { from: () => builder };
  },
}));

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));
jest.mock("@/lib/stripe/plans", () => ({
  getPaidPlan: jest.fn(),
  resolveStripePriceId: jest.fn(),
}));

import { getRecoverableSubscriptionCheckout } from "@/lib/stripe/subscription";

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
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID = "bpc_test";
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st";
    listInvoicePaymentsMock.mockResolvedValue({ data: [], has_more: false });
    writeSingleMock.mockResolvedValue({
      data: { id: "row-sub-1" },
      error: null,
    });
  });

  it.each(["incomplete", "past_due", "unpaid"])(
    "returns the latest hosted invoice for %s without cancelling",
    async (status) => {
      retrieveMock.mockResolvedValue({
        id: "sub-1",
        status,
        customer: "cus_1",
        latest_invoice: {
          id: "in_1",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
        },
      });

      await expect(
        getRecoverableSubscriptionCheckout(
          readClient([row("sub-1", status)]),
          "user-1",
        ),
      ).resolves.toEqual({
        kind: "resume",
        resumeUrl: "https://invoice.stripe.com/i/in_1",
      });
    },
  );

  it.each(["incomplete", "past_due", "unpaid", "paused"])(
    "blocks a %s subscription while any invoice payment is processing",
    async (status) => {
      retrieveMock.mockResolvedValue({
        id: "sub-1",
        status,
        customer: "cus_1",
        latest_invoice: { id: "in_1", hosted_invoice_url: null },
      });
      listInvoicePaymentsMock.mockResolvedValue({
        data: [
          {
            id: "ip_1",
            payment: {
              type: "payment_intent",
              payment_intent: { id: "pi_1", status: "processing" },
            },
          },
        ],
        has_more: false,
      });

      await expect(
        getRecoverableSubscriptionCheckout(
          readClient([row("sub-1", status)]),
          "user-1",
        ),
      ).resolves.toEqual({ kind: "processing" });
    },
  );

  it("creates a billing portal recovery URL for a paused subscription when configured", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub-paused",
      status: "paused",
      customer: "cus_1",
      latest_invoice: null,
    });
    createPortalSessionMock.mockResolvedValue({
      url: "https://billing.stripe.com/p/session_1",
    });

    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([row("sub-paused", "paused")]),
        "user-1",
      ),
    ).resolves.toEqual({
      kind: "resume",
      resumeUrl: "https://billing.stripe.com/p/session_1",
    });
    expect(createPortalSessionMock).toHaveBeenCalledWith({
      customer: "cus_1",
      configuration: "bpc_test",
      return_url: "https://www.recopyfa.st/dashboard/billing",
    });
  });

  it("uses Stripe's default billing portal configuration when no override is set", async () => {
    delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
    retrieveMock.mockResolvedValue({
      id: "sub-paused",
      status: "paused",
      customer: "cus_1",
      latest_invoice: null,
    });
    createPortalSessionMock.mockResolvedValue({
      url: "https://billing.stripe.com/p/default-session",
    });

    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([row("sub-paused", "paused")]),
        "user-1",
      ),
    ).resolves.toEqual({
      kind: "resume",
      resumeUrl: "https://billing.stripe.com/p/default-session",
    });
    expect(createPortalSessionMock).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://www.recopyfa.st/dashboard/billing",
    });
  });

  it("returns a clear paused recovery outcome when Stripe rejects portal creation", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub-paused",
      status: "paused",
      customer: "cus_1",
      latest_invoice: null,
    });
    createPortalSessionMock.mockRejectedValue(
      new Error(
        "No configuration provided and no default configuration exists",
      ),
    );

    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([row("sub-paused", "paused")]),
        "user-1",
      ),
    ).resolves.toEqual({ kind: "paused_without_portal" });
  });

  it("blocks replacement when a recoverable subscription has no recovery URL", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub-1",
      status: "incomplete",
      latest_invoice: { id: "in_1", hosted_invoice_url: null },
    });

    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([row("sub-1", "incomplete")]),
        "user-1",
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it.each(["active", "trialing"])(
    "returns the upgrade conflict when provider state recovered to %s",
    async (status) => {
      retrieveMock.mockResolvedValue({ id: "sub-1", status });

      await expect(
        getRecoverableSubscriptionCheckout(
          readClient([row("sub-1", "incomplete")]),
          "user-1",
        ),
      ).resolves.toEqual({ kind: "already_subscribed" });
    },
  );

  it("never cancels a recoverable subscription", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub-1",
      status: "incomplete",
      latest_invoice: {
        id: "in_1",
        hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
      },
    });

    await getRecoverableSubscriptionCheckout(
      readClient([row("sub-1", "incomplete")]),
      "user-1",
    );

    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(jest.requireMock("@/lib/stripe/config").stripe.subscriptions),
    ).toEqual(["retrieve"]);
  });

  it("persists a provider-terminal status through the owned row scope", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub-1",
      status: "incomplete_expired",
      latest_invoice: null,
    });

    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([row("sub-1", "incomplete")]),
        "user-1",
      ),
    ).resolves.toBeNull();

    expect(writeUpdateMock).toHaveBeenCalledWith({
      status: "incomplete_expired",
    });
    expect(writeEqMock.mock.calls).toEqual([
      ["id", "row-sub-1"],
      ["user_id", "user-1"],
      ["stripe_subscription_id", "sub-1"],
    ]);
  });

  it("reads every invoice-payment page and retrieves an unexpanded payment intent", async () => {
    retrieveMock.mockResolvedValue({
      id: "sub-1",
      status: "past_due",
      latest_invoice: {
        id: "in_1",
        hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
      },
    });
    listInvoicePaymentsMock
      .mockResolvedValueOnce({
        has_more: true,
        data: [
          {
            id: "ip_page_1",
            payment: { type: "payment_intent", payment_intent: "pi_1" },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "ip_page_2",
            payment: { type: "payment_intent", payment_intent: "pi_2" },
          },
        ],
        has_more: false,
      });
    retrievePaymentIntentMock
      .mockResolvedValueOnce({ id: "pi_1", status: "requires_payment_method" })
      .mockResolvedValueOnce({ id: "pi_2", status: "processing" });

    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([row("sub-1", "past_due")]),
        "user-1",
      ),
    ).resolves.toEqual({ kind: "processing" });
    expect(readEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(readInMock).toHaveBeenCalledWith("status", [
      "incomplete",
      "past_due",
      "unpaid",
      "paused",
    ]);
  });

  it("fails closed on subscription read failure", async () => {
    await expect(
      getRecoverableSubscriptionCheckout(
        readClient([], { message: "read failed" }),
        "user-1",
      ),
    ).rejects.toThrow(/read failed/);
  });
});
