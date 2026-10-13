/** @jest-environment node */
import { createPaymentReads } from "../payment-reads";
const query = {
  select: jest.fn(),
  eq: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
  maybeSingle: jest.fn(),
  abortSignal: jest.fn(),
};
const from = jest.fn(() => query);
const provider = {
  events: { retrieve: jest.fn() },
  paymentIntents: { retrieve: jest.fn() },
  charges: { retrieve: jest.fn() },
  invoices: { retrieve: jest.fn() },
  checkout: { sessions: { retrieve: jest.fn() } },
  invoicePayments: { list: jest.fn() },
  refunds: { list: jest.fn() },
  disputes: { list: jest.fn() },
};
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ from }),
}));
jest.mock("@/lib/stripe/config", () => ({
  get stripe() {
    return provider;
  },
}));
jest.mock("@/lib/stripe/plans", () => ({
  getCreditPackConfig: async () => ({ creditsPerPack: 100 }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  for (const key of ["select", "eq", "order", "limit", "abortSignal"] as const)
    query[key].mockReturnValue(query);
});
test("Stripe calls use exact pinned SDK endpoints with no retries and finite timeout", async () => {
  const reads = createPaymentReads();
  await reads.event("evt_1");
  await reads.allocations({
    payment: { type: "payment_intent", payment_intent: "pi_1" },
    limit: 100,
  });
  expect(provider.events.retrieve).toHaveBeenCalledWith(
    "evt_1",
    {},
    { timeout: 1500, maxNetworkRetries: 0 },
  );
  expect(provider.invoicePayments.list).toHaveBeenCalledWith(
    { payment: { type: "payment_intent", payment_intent: "pi_1" }, limit: 100 },
    { timeout: 1500, maxNetworkRetries: 0 },
  );
});
test("billing account comes from customer mapping", async () => {
  query.maybeSingle.mockResolvedValue({ data: { user_id: "u" }, error: null });
  expect(await createPaymentReads().account("cus_1")).toBe("u");
  expect(query.eq).toHaveBeenCalledWith("stripe_customer_id", "cus_1");
});
test("original revoked lifetime grants remain purchase evidence", async () => {
  query.maybeSingle
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({
      data: { plan_id: "agency", source: "lifetime_purchase" },
      error: null,
    });
  expect(await createPaymentReads().reconciledOneOff("pi_1", "u")).toEqual({
    productId: "lifetime_agency",
    quantity: 1,
  });
  expect(query.eq).not.toHaveBeenCalledWith("revoked_at", null);
});
test("recovering settlement requires processed successful original PI event", async () => {
  query.maybeSingle.mockResolvedValue({
    data: { stripe_event_id: "evt_old" },
    error: null,
  });
  expect(await createPaymentReads().successfulPaymentEvent("pi_1")).toBe(
    "evt_old",
  );
  expect(query.eq).toHaveBeenCalledWith("processed", true);
  expect(query.eq).toHaveBeenCalledWith(
    "event_type",
    "payment_intent.succeeded",
  );
  expect(query.eq).toHaveBeenCalledWith("data->object->>id", "pi_1");
});

test("permanently unavailable old Stripe event is explicit unknown evidence", async () => {
  provider.events.retrieve.mockRejectedValueOnce({
    type: "StripeInvalidRequestError",
    code: "resource_missing",
  });
  await expect(createPaymentReads().event("evt_old")).rejects.toMatchObject({
    name: "PaymentEvidenceUnavailable",
  });
});
test("overall read budget prevents slow history from extending the source deadline", async () => {
  const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
  const reads = createPaymentReads();
  clock.mockReturnValue(11001);
  await expect(reads.event("evt_late")).rejects.toMatchObject({
    name: "PaymentReadBudgetExceeded",
  });
  expect(provider.events.retrieve).not.toHaveBeenCalled();
  clock.mockRestore();
});
