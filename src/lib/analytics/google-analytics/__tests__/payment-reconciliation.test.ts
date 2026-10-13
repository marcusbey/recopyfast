/** @jest-environment node */
import { reconcilePaymentAnalytics } from "../payment-reconciliation";
const rpc = jest.fn(),
  normalize = jest.fn(),
  history = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
jest.mock("../payment-reads", () => ({ createPaymentReads: () => ({}) }));
jest.mock("../payment-source", () => ({
  normalizeBillingConversionSource: (...args: unknown[]) => normalize(...args),
}));
jest.mock("../payment-history", () => ({
  classifyAccountPaymentHistory: (...args: unknown[]) => history(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  history.mockResolvedValue({ complete: false, transactions: [] });
  process.env.ANALYTICS_PAYMENT_NORMALIZATION_ENABLED = "1";
  process.env.VERCEL_ENV = "production";
  rpc.mockImplementation((name: string) => ({
    abortSignal: async () => ({
      data:
        name === "claim_analytics_payment_sources"
          ? [{ stripe_event_id: "evt_1", claim_token: "token" }]
          : true,
      error: null,
    }),
  }));
});
test("normalization is disabled until explicitly enabled", async () => {
  delete process.env.ANALYTICS_PAYMENT_NORMALIZATION_ENABLED;
  expect(await reconcilePaymentAnalytics()).toMatchObject({ disabled: true });
  expect(rpc).not.toHaveBeenCalled();
});
test("canonical live purchase and every refund are atomically finished together", async () => {
  normalize.mockResolvedValue({
    state: "normalized",
    purchases: [
      {
        mode: "live",
        sourceKey: "live:payment_intent:pi_1",
        accountId: "u",
        occurredAt: 1800000000,
        value: 19,
        taxMinor: 0,
        itemId: "pro",
        quantity: 1,
      },
    ],
    refunds: [
      {
        mode: "live",
        sourceKey: "live:re_1:payment_intent:pi_1",
        parentSourceKey: "live:payment_intent:pi_1",
        accountId: "u",
        occurredAt: 1800000001,
        amountMinor: 500,
        itemId: "pro",
        quantity: 1,
      },
    ],
  });
  expect(await reconcilePaymentAnalytics()).toMatchObject({
    claimed: 1,
    complete: 1,
  });
  const call = rpc.mock.calls.find(
    (c) => c[0] === "finish_analytics_payment_source",
  );
  expect(call[1].p_candidates).toHaveLength(2);
  expect(call[1].p_candidates[1]).toMatchObject({
    kind: "refund",
    source_key: "refund:live:re_1:payment_intent:pi_1",
    parent_source_key: "purchase:live:payment_intent:pi_1",
  });
});
test("TEST and unresolved automatic-refund sources cannot enqueue acquisition", async () => {
  normalize.mockResolvedValueOnce({
    state: "pending",
    reason: "automatic_refund_pending",
    purchases: [],
    refunds: [],
  });
  await reconcilePaymentAnalytics();
  expect(
    rpc.mock.calls.find((c) => c[0] === "finish_analytics_payment_source")[1],
  ).toMatchObject({ p_state: "pending", p_candidates: [] });
});
test("a lost finalization acknowledgement leaves normalization retryable, never sends Google", async () => {
  normalize.mockResolvedValue({
    state: "normalized",
    purchases: [],
    refunds: [],
  });
  rpc.mockImplementation((name: string) => ({
    abortSignal: async () =>
      name === "claim_analytics_payment_sources"
        ? {
            data: [{ stripe_event_id: "evt_1", claim_token: "token" }],
            error: null,
          }
        : { data: null, error: { message: "private" } },
  }));
  expect(await reconcilePaymentAnalytics()).toMatchObject({
    finalize_failed: 1,
  });
});

test("one source with many invoices reuses one same-account history read", async () => {
  normalize.mockResolvedValue({
    state: "normalized",
    purchases: Array.from({ length: 20 }, (_, i) => ({
      mode: "live",
      sourceKey: `live:invoice:in_${i}`,
      accountId: "u",
      occurredAt: 1800000000,
      value: 19,
      taxMinor: 0,
      itemId: "pro",
      quantity: 1,
    })),
    refunds: [],
  });
  await reconcilePaymentAnalytics();
  expect(history).toHaveBeenCalledTimes(1);
});
