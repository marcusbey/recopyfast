/** @jest-environment node */
import { normalizeBillingConversionSource } from "../payment-source";
import { normalizePaymentSource } from "../payment-conversions";
jest.mock("../payment-conversions", () => ({
  normalizePaymentSource: jest.fn(),
}));
const purchase = {
  sourceKey: "live:payment_intent:pi_1",
  accountId: "u",
  mode: "live",
  occurredAt: 100,
  cashMinor: 1900,
  value: 19,
  taxMinor: 0,
  discountMinor: 0,
  itemId: "pro",
  quantity: 1,
  paymentIntentIds: ["pi_1"],
  netRetainedMinor: 1400,
  financialState: "resolved",
};
function fixture() {
  const refund = {
    id: "re_1",
    charge: "ch_1",
    payment_intent: "pi_1",
    amount: 500,
    currency: "usd",
    status: "succeeded",
    created: 101,
  };
  const charge = {
    id: "ch_1",
    object: "charge",
    payment_intent: "pi_1",
    livemode: true,
    amount_refunded: 500,
    amount_captured: 1900,
    refunds: { data: [refund], has_more: false },
  };
  const event = {
    id: "evt_refund",
    type: "charge.refunded",
    livemode: true,
    created: 200,
    data: { object: charge, previous_attributes: { amount_refunded: 0 } },
  };
  const reads = {
    event: jest.fn(async (id: string) =>
      id === "evt_refund"
        ? event
        : {
            id: "evt_paid",
            type: "payment_intent.succeeded",
            data: { object: { id: "pi_1" } },
          },
    ),
    charge: jest.fn(async () => charge),
    successfulPaymentEvent: jest.fn(async () => "evt_paid"),
    refunds: jest.fn(async () => ({ data: [refund], has_more: false })),
  };
  return {
    refund,
    charge,
    event,
    reads,
    source: {
      stripe_event_id: event.id,
      event_type: event.type,
      processed: true,
      data: event.data,
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  (normalizePaymentSource as jest.Mock).mockResolvedValue({
    state: "normalized",
    purchases: [purchase],
  });
});
test("uses a refund's causal transition time, not request creation", async () => {
  const f = fixture();
  expect(
    await normalizeBillingConversionSource(f.source, f.reads as never),
  ).toMatchObject({
    state: "normalized",
    refunds: [
      {
        sourceKey: "live:re_1:payment_intent:pi_1",
        parentSourceKey: purchase.sourceKey,
        occurredAt: 200,
        amountMinor: 500,
      },
    ],
  });
});
test("does not give historical child refunds the newest charge event time", async () => {
  const f = fixture();
  f.event.data.previous_attributes.amount_refunded = 200;
  expect(
    await normalizeBillingConversionSource(f.source, f.reads as never),
  ).toMatchObject({
    state: "unknown",
    reason: "refund_settlement_unknown",
    refunds: [],
  });
});
test("does not apply an entire refund to each split invoice", async () => {
  const f = fixture();
  (normalizePaymentSource as jest.Mock).mockResolvedValue({
    state: "normalized",
    purchases: [
      { ...purchase, sourceKey: "live:invoice:in_1" },
      { ...purchase, sourceKey: "live:invoice:in_2" },
    ],
  });
  expect(
    await normalizeBillingConversionSource(f.source, f.reads as never),
  ).toMatchObject({
    state: "unknown",
    reason: "refund_allocation_unknown",
    refunds: [],
  });
});
test("pending refund keeps normalization retryable", async () => {
  const f = fixture();
  f.refund.status = "pending";
  expect(
    await normalizeBillingConversionSource(f.source, f.reads as never),
  ).toMatchObject({ state: "pending", refunds: [] });
});
test("a partial previous-attributes refund list is not causal completeness proof", async () => {
  const f = fixture();
  f.event.data.previous_attributes.amount_refunded = 200;
  Object.assign(f.event.data.previous_attributes, { refunds: { data: [] } });
  expect(
    await normalizeBillingConversionSource(f.source, f.reads as never),
  ).toMatchObject({
    state: "unknown",
    reason: "refund_settlement_unknown",
    refunds: [],
  });
});

test("review regression: full taxed single invoice has provable refund allocation", async () => {
  const f = fixture();
  f.refund.amount = 2090;
  f.charge.amount_refunded = 2090;
  f.charge.amount_captured = 2090;
  (normalizePaymentSource as jest.Mock).mockResolvedValue({
    state: "normalized",
    purchases: [
      {
        ...purchase,
        sourceKey: "live:invoice:in_1",
        cashMinor: 2090,
        value: 19,
        taxMinor: 190,
        netRetainedMinor: 0,
      },
    ],
  });
  expect(
    await normalizeBillingConversionSource(f.source, f.reads as never),
  ).toMatchObject({
    state: "normalized",
    refunds: [{ parentSourceKey: "live:invoice:in_1" }],
  });
});
test("review regression: full split-PI return has provable allocation to both invoices", async () => {
  const f = fixture();
  f.refund.amount = 3800;
  f.charge.amount_refunded = 3800;
  f.charge.amount_captured = 3800;
  (normalizePaymentSource as jest.Mock).mockResolvedValue({
    state: "normalized",
    purchases: [
      { ...purchase, sourceKey: "live:invoice:in_1" },
      { ...purchase, sourceKey: "live:invoice:in_2" },
    ],
  });
  const result = await normalizeBillingConversionSource(
    f.source,
    f.reads as never,
  );
  expect(result.state).toBe("normalized");
  expect(result.refunds).toHaveLength(2);
});
