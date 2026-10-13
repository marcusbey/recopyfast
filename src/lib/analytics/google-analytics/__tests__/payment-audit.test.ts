/** @jest-environment node */
import { readPaymentEvidenceAudit } from "../payment-audit";
const query = {
    select: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    abortSignal: jest.fn(),
  },
  from = jest.fn(() => query),
  rpc = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ from, rpc }),
}));
jest.mock("../payment-reads", () => ({ createPaymentReads: () => ({}) }));
jest.mock("../payment-history", () => ({
  classifyAccountPaymentHistory: async () => ({
    complete: true,
    transactions: [],
    currentPaidEntitlement: false,
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  for (const method of ["select", "order", "limit"] as const)
    query[method].mockReturnValue(query);
  query.abortSignal.mockResolvedValue({
    data: [{ user_id: "one" }, { user_id: "two" }],
    error: null,
  });
  rpc.mockReturnValue({ abortSignal: async () => ({ data: {}, error: null }) });
});
test("operator report states its stored-billing-account scope and does not turn a partial scan into zero total net", async () => {
  expect(await readPaymentEvidenceAudit(1)).toMatchObject({
    scope: "stored_billing_accounts",
    scanned_accounts: 1,
    account_scan_complete: false,
    net_retained_minor: null,
    payer_count_is_lower_bound: true,
  });
  expect(from).toHaveBeenCalledWith("billing_customers");
});
test("invalid scan bound is rejected before database access", async () => {
  await expect(readPaymentEvidenceAudit(101)).rejects.toThrow(
    "Invalid account bound",
  );
  expect(from).not.toHaveBeenCalled();
});
