/** @jest-environment node */
import type Stripe from "stripe";
import {
  normalizePaymentSource,
  summarizePaymentHistory,
  normalizeRefunds,
  type PaymentReads,
  type BillingSource,
} from "../payment-conversions";

jest.mock("@/lib/stripe/plans", () => ({
  findPaidPlanIdByStripePriceId: jest.fn(async (id: string) =>
    id === "price_pro" ? "pro" : null,
  ),
  getOneTimeProduct: jest.fn(async (id: string) => ({
    id,
    name: id,
    price: 100,
    grantsPlanId: id === "lifetime_agency" ? "agency" : "pro",
  })),
  getCreditPackConfig: jest.fn(async () => ({
    creditsPerPack: 100,
    pricePerPack: 10,
  })),
}));
jest.mock("@/lib/stripe/lifetime-covered-billing", () => ({
  COVERED_BY_LIFETIME: "covered_by_lifetime",
}));
const paidAt = 1_800_000_000;
function fixture() {
  const intent = {
    id: "pi_1",
    object: "payment_intent",
    livemode: true,
    customer: "cus_1",
    status: "succeeded",
    currency: "usd",
    amount_received: 10000,
    created: paidAt - 86400,
    latest_charge: "ch_1",
    metadata: {
      type: "lifetime_purchase",
      user_id: "user_1",
      product_id: "lifetime_pro",
      grants_plan_id: "pro",
    },
  } as unknown as Stripe.PaymentIntent;
  const charge = {
    id: "ch_1",
    object: "charge",
    customer: "cus_1",
    livemode: true,
    status: "succeeded",
    paid: true,
    captured: true,
    amount: 10000,
    amount_captured: 10000,
    currency: "usd",
    payment_intent: "pi_1",
    disputed: false,
  } as unknown as Stripe.Charge;
  const event = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    livemode: true,
    created: paidAt,
    data: { object: intent },
  } as unknown as Stripe.Event;
  const source: BillingSource = {
    stripe_event_id: "evt_1",
    event_type: event.type,
    processed: true,
    data: { object: intent },
  };
  const invoice = {
    id: "in_1",
    object: "invoice",
    livemode: true,
    customer: "cus_1",
    status: "paid",
    currency: "usd",
    amount_paid: 10000,
    total: 10000,
    subtotal: 10000,
    total_excluding_tax: 10000,
    total_taxes: [],
    total_discount_amounts: [],
    status_transitions: { paid_at: paidAt },
    lines: {
      has_more: false,
      data: [
        {
          id: "il_1",
          amount: 10000,
          quantity: 1,
          pricing: { price_details: { price: "price_pro" } },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
  const allocation = {
    id: "ip_1",
    invoice: "in_1",
    status: "paid",
    livemode: true,
    currency: "usd",
    amount_paid: 10000,
    payment: { type: "payment_intent", payment_intent: "pi_1" },
    status_transitions: { paid_at: paidAt },
  } as Stripe.InvoicePayment;
  const reads: PaymentReads = {
    event: jest.fn(async () => event),
    intent: jest.fn(async () => intent),
    charge: jest.fn(async () => charge),
    invoice: jest.fn(async () => invoice),
    session: jest.fn(),
    allocations: jest.fn(async () => ({ data: [], has_more: false })),
    refunds: jest.fn(async () => ({ data: [], has_more: false })),
    disputes: jest.fn(async () => ({ data: [], has_more: false })),
    account: jest.fn(async () => "user_1"),
    reconciledInvoice: jest.fn(async () => true),
    reconciledOneOff: jest.fn(async () => ({
      productId: "lifetime_pro" as const,
      quantity: 1,
    })),
    successfulPaymentEvent: jest.fn(async () => "evt_1"),
  };
  return { intent, charge, event, source, invoice, allocation, reads };
}
async function purchase(f = fixture()) {
  return normalizePaymentSource(f.source, f.reads);
}

describe("authoritative payment normalization", () => {
  it("uses provider event settlement, verified account/catalog, and one canonical PI key", async () => {
    expect(await purchase()).toMatchObject({
      state: "normalized",
      purchases: [
        {
          sourceKey: "live:payment_intent:pi_1",
          accountId: "user_1",
          occurredAt: paidAt,
          cashMinor: 10000,
          value: 100,
          currency: "USD",
          itemId: "lifetime_pro",
        },
      ],
    });
  });
  it("does not require an envelope livemode in data-only billing_events", async () => {
    const f = fixture();
    expect(f.source.data).not.toHaveProperty("livemode");
    expect((await purchase(f)).state).toBe("normalized");
  });
  it.each([false, undefined])(
    "does not normalize unprocessed source %s",
    async (processed) => {
      const f = fixture();
      f.source.processed = processed as boolean;
      expect((await purchase(f)).state).toBe("pending");
      expect(f.reads.event).not.toHaveBeenCalled();
    },
  );
  it("can normalize an old source after it becomes processed", async () => {
    const f = fixture();
    f.source.processed = false;
    expect((await purchase(f)).state).toBe("pending");
    f.source.processed = true;
    expect((await purchase(f)).state).toBe("normalized");
  });
  it.each(["event", "intent", "charge"] as const)(
    "refuses mismatched %s live mode",
    async (field) => {
      const f = fixture();
      f[field].livemode = false;
      expect((await purchase(f)).state).not.toBe("normalized");
    },
  );
  it("separates verified TEST transactions by mode", async () => {
    const f = fixture();
    f.event.livemode = f.intent.livemode = f.charge.livemode = false;
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ sourceKey: "test:payment_intent:pi_1", mode: "test" }],
    });
  });
  it("does not infer live mode when event retrieval is unavailable", async () => {
    const f = fixture();
    (f.reads.event as jest.Mock).mockRejectedValue(
      new Error("secret provider detail"),
    );
    expect(await purchase(f)).toEqual({
      state: "pending",
      reason: "provider_read_failed",
      purchases: [],
    });
  });
  it.each(["cad", "jpy"])(
    "refuses unsupported currency %s",
    async (currency) => {
      const f = fixture();
      f.intent.currency = currency;
      expect(await purchase(f)).toMatchObject({
        state: "unknown",
        reason: "unsupported_currency",
      });
    },
  );
  it.each([0, -1, 0.5, Number.NaN])(
    "does not count invalid collection %s",
    async (amount) => {
      const f = fixture();
      f.intent.amount_received = amount;
      expect((await purchase(f)).state).not.toBe("normalized");
    },
  );
  it("rejects account metadata/customer mismatch", async () => {
    const f = fixture();
    f.intent.metadata.user_id = "other";
    expect(await purchase(f)).toMatchObject({
      state: "unknown",
      reason: "account_mismatch",
    });
  });
  it("refuses missing/deleted source account", async () => {
    const f = fixture();
    (f.reads.account as jest.Mock).mockResolvedValue(null);
    expect((await purchase(f)).state).toBe("suppressed");
  });
  it("refuses unrecognized or unreconciled product", async () => {
    const f = fixture();
    (f.reads.reconciledOneOff as jest.Mock).mockResolvedValue(null);
    expect((await purchase(f)).state).toBe("unknown");
  });
  it("counts lifetime Agency with catalog grant agreement", async () => {
    const f = fixture();
    f.intent.metadata.product_id = "lifetime_agency";
    f.intent.metadata.grants_plan_id = "agency";
    (f.reads.reconciledOneOff as jest.Mock).mockResolvedValue({
      productId: "lifetime_agency",
      quantity: 1,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ itemId: "lifetime_agency" }],
    });
  });
  it("validates credit quantity against the current catalog", async () => {
    const f = fixture();
    f.intent.metadata = {
      type: "credit_purchase",
      user_id: "user_1",
      credit_quantity: "1000",
    };
    (f.reads.reconciledOneOff as jest.Mock).mockResolvedValue({
      productId: "credits",
      quantity: 10,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ itemId: "credits", quantity: 10 }],
    });
    f.intent.metadata.credit_quantity = "999";
    expect((await purchase(f)).state).toBe("unknown");
  });
  it("does not count setup/forged return sources", async () => {
    const f = fixture();
    f.source.event_type = "checkout.return.success";
    expect((await purchase(f)).state).toBe("suppressed");
  });
  it("canonicalizes paid Checkout through original PI success rather than session creation", async () => {
    const f = fixture();
    const session = {
      id: "cs_1",
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_1",
      livemode: true,
      customer: "cus_1",
      client_reference_id: "user_1",
      created: paidAt - 3600,
    } as unknown as Stripe.Checkout.Session;
    f.source.event_type = "checkout.session.completed";
    f.source.data = { object: session };
    const checkoutEvent = {
      ...f.event,
      type: "checkout.session.completed",
      data: { object: session },
    };
    (f.reads.event as jest.Mock)
      .mockResolvedValueOnce(checkoutEvent)
      .mockResolvedValue(f.event);
    (f.reads.session as jest.Mock).mockResolvedValue(session);
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [
        { sourceKey: "live:payment_intent:pi_1", occurredAt: paidAt },
      ],
    });
  });
  it("does not fabricate Checkout-only settlement", async () => {
    const f = fixture();
    const session = {
      id: "cs_1",
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_1",
      livemode: true,
      customer: "cus_1",
    };
    f.source.event_type = "checkout.session.completed";
    f.source.data = { object: session };
    (f.reads.event as jest.Mock).mockResolvedValue({
      ...f.event,
      type: f.source.event_type,
      data: { object: session },
    });
    (f.reads.session as jest.Mock).mockResolvedValue(session);
    (f.reads.successfulPaymentEvent as jest.Mock).mockResolvedValue(null);
    expect(await purchase(f)).toMatchObject({
      state: "unknown",
      reason: "settlement_unknown",
    });
  });
  it("uses invoice identity for invoice-associated PI and actual allocation", async () => {
    const f = fixture();
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [f.allocation],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ sourceKey: "live:invoice:in_1", cashMinor: 10000 }],
    });
  });
  it("normalizes invoices from their paid timestamp", async () => {
    const f = fixture();
    f.source.event_type = "invoice.payment_succeeded";
    f.source.data = { object: f.invoice };
    (f.reads.event as jest.Mock).mockResolvedValue({
      ...f.event,
      type: f.source.event_type,
      data: { object: f.invoice },
    });
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [f.allocation],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ occurredAt: paidAt, itemId: "pro" }],
    });
  });
  it("allocates a PI across two invoices without copying its full amount", async () => {
    const f = fixture();
    const other = {
      ...f.allocation,
      id: "ip_2",
      invoice: "in_2",
      amount_paid: 4000,
    };
    f.allocation.amount_paid = 6000;
    (f.reads.allocations as jest.Mock).mockImplementation(async (p) => ({
      data: p.invoice
        ? [p.invoice === "in_1" ? f.allocation : other]
        : [f.allocation, other],
      has_more: false,
    }));
    (f.reads.invoice as jest.Mock).mockImplementation(async (id) => ({
      ...f.invoice,
      id,
      amount_paid: id === "in_1" ? 6000 : 4000,
      total: id === "in_1" ? 6000 : 4000,
      subtotal: id === "in_1" ? 6000 : 4000,
      total_excluding_tax: id === "in_1" ? 6000 : 4000,
      lines: {
        has_more: false,
        data: [
          { ...f.invoice.lines.data[0], amount: id === "in_1" ? 6000 : 4000 },
        ],
      },
    }));
    const result = await purchase(f);
    expect(result.state).toBe("normalized");
    expect(result.purchases.map((p) => p.cashMinor)).toEqual([6000, 4000]);
  });
  it("a complete PI refund proves zero retained cash and exact returned shares for all invoices", async () => {
    const f = fixture();
    const other = {
      ...f.allocation,
      id: "ip_2",
      invoice: "in_2",
      amount_paid: 4000,
    };
    f.allocation.amount_paid = 6000;
    (f.reads.allocations as jest.Mock).mockImplementation(async (p) => ({
      data: p.invoice
        ? [p.invoice === "in_1" ? f.allocation : other]
        : [f.allocation, other],
      has_more: false,
    }));
    (f.reads.invoice as jest.Mock).mockImplementation(async (id) => ({
      ...f.invoice,
      id,
      amount_paid: id === "in_1" ? 6000 : 4000,
      total: id === "in_1" ? 6000 : 4000,
      subtotal: id === "in_1" ? 6000 : 4000,
      total_excluding_tax: id === "in_1" ? 6000 : 4000,
      lines: {
        has_more: false,
        data: [
          { ...f.invoice.lines.data[0], amount: id === "in_1" ? 6000 : 4000 },
        ],
      },
    }));
    (f.reads.refunds as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "re_full",
          charge: "ch_1",
          payment_intent: "pi_1",
          amount: 10000,
          currency: "usd",
          status: "succeeded",
          metadata: {},
        },
      ],
      has_more: false,
    });
    const result = await purchase(f);
    expect(result.state).toBe("normalized");
    expect(result.purchases.map((p) => p.cashMinor)).toEqual([6000, 4000]);
    expect(result.purchases.map((p) => p.netRetainedMinor)).toEqual([0, 0]);
    expect(result.purchases.map((p) => p.successfulRefundMinor)).toEqual([
      6000, 4000,
    ]);
  });
  it("keeps mixed-credit and wholly credit-funded invoices unknown", async () => {
    const f = fixture();
    f.source.event_type = "invoice.payment_succeeded";
    f.source.data = { object: f.invoice };
    (f.reads.event as jest.Mock).mockResolvedValue({
      ...f.event,
      type: f.source.event_type,
      data: { object: f.invoice },
    });
    f.allocation.amount_paid = 5000;
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [f.allocation],
      has_more: false,
    });
    expect((await purchase(f)).state).toBe("unknown");
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [],
      has_more: false,
    });
    expect((await purchase(f)).state).toBe("unknown");
  });
  it("bounds malformed/endless provider pagination", async () => {
    const f = fixture();
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [],
      has_more: true,
    });
    expect(await purchase(f)).toMatchObject({
      state: "pending",
      reason: "incomplete_provider_page",
    });
  });
  it.each(["covered_by_lifetime", "duplicate_founding_lifetime"])(
    "holds purchase for pending automatic refund %s and excludes succeeded",
    async (reason) => {
      const f = fixture();
      const refund = {
        id: "re_1",
        charge: "ch_1",
        payment_intent: "pi_1",
        amount: 10000,
        currency: "usd",
        status: "pending",
        metadata: {
          reason_code: reason,
          subscription_id: "sub_1",
          founding_reservation_id: "reservation_1",
        },
      };
      (f.reads.refunds as jest.Mock).mockResolvedValue({
        data: [refund],
        has_more: false,
      });
      expect((await purchase(f)).state).toBe("pending");
      refund.status = "succeeded";
      expect((await purchase(f)).state).toBe("suppressed");
      refund.status = "failed";
      expect((await purchase(f)).state).toBe("normalized");
    },
  );
  it("holds an unresolved dispute instead of inventing retained money", async () => {
    const f = fixture();
    f.charge.disputed = true;
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ netRetainedMinor: null, financialState: "unknown" }],
    });
  });
});

describe("refund and historical classification", () => {
  it("deduplicates successful refund IDs but exposes pending and ignores failed", () => {
    expect(
      normalizeRefunds(
        [
          { id: "re_1", amount: 200, currency: "usd", status: "succeeded" },
          { id: "re_1", amount: 200, currency: "usd", status: "succeeded" },
          { id: "re_2", amount: 300, currency: "usd", status: "pending" },
          { id: "re_3", amount: 900, currency: "usd", status: "failed" },
        ],
        1000,
      ),
    ).toEqual({
      state: "pending",
      refundedMinor: 200,
      refunds: [{ id: "re_1", amountMinor: 200 }],
    });
  });
  it("refuses conflicting duplicates and over-refund", () => {
    expect(
      normalizeRefunds(
        [
          { id: "re_1", amount: 200, currency: "usd", status: "succeeded" },
          { id: "re_1", amount: 300, currency: "usd", status: "succeeded" },
        ],
        1000,
      ).state,
    ).toBe("unknown");
    expect(
      normalizeRefunds(
        [{ id: "re_1", amount: 2000, currency: "usd", status: "succeeded" }],
        1000,
      ).state,
    ).toBe("unknown");
  });
  it("does not guess new from incomplete history; known prior proves returning", () => {
    expect(
      summarizePaymentHistory("live:payment_intent:pi_1", paidAt, [], false),
    ).toBeUndefined();
    expect(
      summarizePaymentHistory("live:payment_intent:pi_1", paidAt, [], true),
    ).toBe("new");
    expect(
      summarizePaymentHistory(
        "live:payment_intent:pi_1",
        paidAt,
        [{ sourceKey: "live:invoice:old", occurredAt: paidAt - 1 }],
        false,
      ),
    ).toBe("returning");
  });
  it("same canonical payment from another webhook is not a returning customer", () => {
    expect(
      summarizePaymentHistory(
        "live:payment_intent:pi_1",
        paidAt,
        [{ sourceKey: "live:payment_intent:pi_1", occurredAt: paidAt }],
        true,
      ),
    ).toBe("new");
  });
});

describe("adversarial evidence boundaries", () => {
  it("does not use an old success timestamp for a different collected amount", async () => {
    const f = fixture();
    const old = { ...f.intent, amount_received: 5000 };
    (f.reads.event as jest.Mock).mockResolvedValue({
      ...f.event,
      data: { object: old },
    });
    expect(await purchase(f)).toMatchObject({
      state: "unknown",
      reason: "payment_snapshot_mismatch",
    });
  });
  it("does not count an invoice whose success event object has another mode", async () => {
    const f = fixture();
    f.source.event_type = "invoice.payment_succeeded";
    f.source.data = { object: f.invoice };
    (f.reads.event as jest.Mock).mockResolvedValue({
      ...f.event,
      type: f.source.event_type,
      data: { object: { ...f.invoice, livemode: false } },
    });
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [f.allocation],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "unknown",
      reason: "mode_mismatch",
    });
  });
  it("cross-checks Checkout customer and reference with the verified payment account", async () => {
    const f = fixture();
    const session = {
      id: "cs_1",
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_1",
      livemode: true,
      customer: "cus_other",
      client_reference_id: "other",
    };
    f.source.event_type = "checkout.session.completed";
    f.source.data = { object: session };
    (f.reads.event as jest.Mock)
      .mockResolvedValueOnce({
        ...f.event,
        type: f.source.event_type,
        data: { object: session },
      })
      .mockResolvedValue(f.event);
    (f.reads.session as jest.Mock).mockResolvedValue(session);
    expect(await purchase(f)).toMatchObject({
      state: "unknown",
      reason: "account_mismatch",
    });
  });
  it("finds an automatic refund on a later page before allowing purchase", async () => {
    const f = fixture();
    (f.reads.refunds as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            id: "re_1",
            charge: "ch_1",
            payment_intent: "pi_1",
            amount: 1,
            currency: "usd",
            status: "failed",
            metadata: {},
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "re_2",
            charge: "ch_1",
            payment_intent: "pi_1",
            amount: 10000,
            currency: "usd",
            status: "pending",
            metadata: {
              reason_code: "covered_by_lifetime",
              subscription_id: "sub_1",
            },
          },
        ],
        has_more: false,
      });
    expect(await purchase(f)).toMatchObject({
      state: "pending",
      reason: "automatic_refund_pending",
    });
    expect(f.reads.refunds).toHaveBeenLastCalledWith({
      charge: "ch_1",
      limit: 100,
      starting_after: "re_1",
    });
  });
  it("keeps a genuine later refund's purchase history", async () => {
    const f = fixture();
    (f.reads.refunds as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "re_1",
          charge: "ch_1",
          payment_intent: "pi_1",
          amount: 10000,
          currency: "usd",
          status: "succeeded",
          metadata: {},
        },
      ],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [{ cashMinor: 10000 }],
    });
  });
  it("tax is not product revenue and a catalog discount is not counted twice", async () => {
    const f = fixture();
    f.invoice.subtotal = 12000;
    f.invoice.lines.data[0].amount = 12000;
    f.invoice.total_discount_amounts = [{ amount: 3000, discount: "di_1" }];
    f.invoice.total_taxes = [{ amount: 1000 } as Stripe.Invoice.TotalTax];
    f.invoice.total_excluding_tax = 9000;
    f.source.event_type = "invoice.payment_succeeded";
    f.source.data = { object: f.invoice };
    (f.reads.event as jest.Mock).mockResolvedValue({
      ...f.event,
      type: f.source.event_type,
      data: { object: f.invoice },
    });
    (f.reads.allocations as jest.Mock).mockResolvedValue({
      data: [f.allocation],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [
        { cashMinor: 10000, value: 90, taxMinor: 1000, discountMinor: 3000 },
      ],
    });
  });
  it("malformed history cannot prove new and TEST history cannot prove live returning", () => {
    expect(
      summarizePaymentHistory(
        "live:payment_intent:pi_1",
        paidAt,
        [{ sourceKey: "live:invoice:old", occurredAt: Number.NaN }],
        true,
      ),
    ).toBeUndefined();
    expect(
      summarizePaymentHistory(
        "live:payment_intent:pi_1",
        paidAt,
        [{ sourceKey: "test:invoice:old", occurredAt: paidAt - 1 }],
        true,
      ),
    ).toBe("new");
  });
});

describe("historical payment versus net money", () => {
  it.each(["won", "warning_closed"])(
    "retains principal after %s dispute",
    async (status) => {
      const f = fixture();
      f.charge.disputed = true;
      (f.reads.disputes as jest.Mock).mockResolvedValue({
        data: [
          {
            id: "dp_1",
            charge: "ch_1",
            payment_intent: "pi_1",
            livemode: true,
            currency: "usd",
            amount: 10000,
            status,
          },
        ],
        has_more: false,
      });
      expect(await purchase(f)).toMatchObject({
        state: "normalized",
        purchases: [
          {
            cashMinor: 10000,
            netRetainedMinor: 10000,
            financialState: "resolved",
          },
        ],
      });
    },
  );
  it("lost dispute makes net zero, not never historically paid", async () => {
    const f = fixture();
    f.charge.disputed = true;
    (f.reads.disputes as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "dp_1",
          charge: "ch_1",
          livemode: true,
          currency: "usd",
          amount: 10000,
          status: "lost",
        },
      ],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [
        { cashMinor: 10000, netRetainedMinor: 0, financialState: "resolved" },
      ],
    });
  });
  it("does not subtract a lost dispute and refund for the same principal twice", async () => {
    const f = fixture();
    f.charge.disputed = true;
    (f.reads.disputes as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "dp_1",
          charge: "ch_1",
          livemode: true,
          currency: "usd",
          amount: 10000,
          status: "lost",
        },
      ],
      has_more: false,
    });
    (f.reads.refunds as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "re_1",
          charge: "ch_1",
          amount: 10000,
          currency: "usd",
          status: "succeeded",
          metadata: {},
        },
      ],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [
        { cashMinor: 10000, netRetainedMinor: null, financialState: "unknown" },
      ],
    });
  });
  it("pending dispute holds only net reconciliation, not historical payer evidence", async () => {
    const f = fixture();
    f.charge.disputed = true;
    (f.reads.disputes as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "dp_1",
          charge: "ch_1",
          livemode: true,
          currency: "usd",
          amount: 10000,
          status: "under_review",
        },
      ],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [
        { cashMinor: 10000, netRetainedMinor: null, financialState: "pending" },
      ],
    });
  });
  it("ordinary full refund and revoked current grant do not erase historical payment", async () => {
    const f = fixture();
    (f.reads.reconciledOneOff as jest.Mock).mockResolvedValue({
      productId: "lifetime_pro",
      quantity: 1,
      revoked: true,
    });
    (f.reads.refunds as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "re_1",
          charge: "ch_1",
          amount: 10000,
          currency: "usd",
          status: "succeeded",
          metadata: {},
        },
      ],
      has_more: false,
    });
    expect(await purchase(f)).toMatchObject({
      state: "normalized",
      purchases: [
        { cashMinor: 10000, netRetainedMinor: 0, financialState: "resolved" },
      ],
    });
  });
});

it("bounds total provider and billing reads across many invoice payments", async () => {
  const f = fixture();
  f.source.event_type = "invoice.payment_succeeded";
  f.source.data = { object: f.invoice };
  (f.reads.event as jest.Mock).mockResolvedValue({
    ...f.event,
    type: f.source.event_type,
    data: { object: f.invoice },
  });
  const allocations = Array.from({ length: 20 }, (_, i) => ({
    ...f.allocation,
    id: `ip_${i}`,
    amount_paid: 500,
    payment: { type: "payment_intent", payment_intent: `pi_${i}` },
  }));
  (f.reads.allocations as jest.Mock).mockImplementation(async (p) => ({
    data: p.invoice
      ? allocations
      : allocations.filter(
          (a) => a.payment.payment_intent === p.payment.payment_intent,
        ),
    has_more: false,
  }));
  (f.reads.intent as jest.Mock).mockImplementation(async (id) => ({
    ...f.intent,
    id,
    amount_received: 500,
    latest_charge: `ch_${id}`,
  }));
  (f.reads.charge as jest.Mock).mockImplementation(async (id) => ({
    ...f.charge,
    id,
    payment_intent: id.slice(3),
    amount_captured: 500,
  }));
  expect(await purchase(f)).toMatchObject({
    state: "pending",
    reason: "normalization_limit",
  });
  expect(
    Object.values(f.reads).reduce(
      (sum, read) => sum + (read as jest.Mock).mock.calls.length,
      0,
    ),
  ).toBeLessThanOrEqual(60);
});

test("a later automatic return still yields correction evidence without acquisition eligibility", async () => {
  const f = fixture();
  (f.reads.refunds as jest.Mock).mockResolvedValue({
    data: [
      {
        id: "re_auto",
        charge: "ch_1",
        amount: 10000,
        currency: "usd",
        status: "succeeded",
        metadata: {
          reason_code: "duplicate_founding_lifetime",
          founding_reservation_id: "reservation",
        },
      },
    ],
    has_more: false,
  });
  expect(
    await normalizePaymentSource(f.source, f.reads, {
      includeAutomaticReturns: true,
    }),
  ).toMatchObject({
    state: "normalized",
    purchases: [
      { acquisitionEligible: false, cashMinor: 10000, netRetainedMinor: 0 },
    ],
  });
});
test("an unavailable catalog cannot hold normalization open indefinitely", async () => {
  jest.useFakeTimers();
  const plans = jest.requireMock("@/lib/stripe/plans");
  plans.getOneTimeProduct.mockImplementationOnce(() => new Promise(() => {}));
  try {
    const result = purchase();
    await jest.advanceTimersByTimeAsync(1501);
    expect(await result).toMatchObject({
      state: "pending",
      reason: "normalization_limit",
    });
  } finally {
    jest.useRealTimers();
  }
});
test("a partially paid open invoice is incomplete money evidence, not zero collection", async () => {
  const f = fixture();
  f.invoice.status = "open";
  f.invoice.amount_paid = 5000;
  f.source.event_type = "invoice.payment_succeeded";
  f.source.data = { object: f.invoice };
  (f.reads.event as jest.Mock).mockResolvedValue({
    ...f.event,
    type: f.source.event_type,
    data: { object: f.invoice },
  });
  expect(await purchase(f)).toMatchObject({
    state: "unknown",
    reason: "partial_invoice_unknown",
  });
});
