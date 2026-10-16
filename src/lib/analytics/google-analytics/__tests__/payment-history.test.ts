/** @jest-environment node */
import { classifyAccountPaymentHistory } from "../payment-history";
const rpc = jest.fn(),
  normalize = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
jest.mock("../payment-conversions", () => ({
  normalizePaymentSource: (...args: unknown[]) => normalize(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  normalize.mockResolvedValue({
    state: "normalized",
    purchases: [{ sourceKey: "live:invoice:in_1", accountId: "u" }],
  });
});
function history(data: unknown) {
  rpc.mockReturnValue({ abortSignal: async () => ({ data, error: null }) });
}
test("all retained references and processed source proof establish complete history", async () => {
  history({
    complete: true,
    expected_keys: ["invoice:in_1"],
    sources: [{ event_type: "invoice.payment_succeeded" }],
  });
  expect(await classifyAccountPaymentHistory("u", {} as never)).toMatchObject({
    complete: true,
    transactions: [{ sourceKey: "live:invoice:in_1" }],
  });
});
test("a legacy reference missing provider proof prevents claiming new", async () => {
  history({
    complete: true,
    expected_keys: ["invoice:in_1", "invoice:older"],
    sources: [{}],
  });
  expect((await classifyAccountPaymentHistory("u", {} as never)).complete).toBe(
    false,
  );
});
test("unavailable or unprocessed evidence remains incomplete", async () => {
  history({ complete: true, expected_keys: [], sources: [{}] });
  normalize.mockResolvedValue({ state: "unknown", purchases: [] });
  expect((await classifyAccountPaymentHistory("u", {} as never)).complete).toBe(
    false,
  );
});
test("a proven automatic return is accounted for without becoming a prior payer", async () => {
  history({
    complete: true,
    expected_keys: ["invoice:in_1"],
    sources: [
      {
        event_type: "invoice.payment_succeeded",
        data: { object: { id: "in_1" } },
      },
    ],
  });
  normalize.mockResolvedValue({
    state: "suppressed",
    reason: "automatically_returned",
    purchases: [],
  });
  expect(await classifyAccountPaymentHistory("u", {} as never)).toEqual({
    complete: true,
    transactions: [],
    currentPaidEntitlement: null,
  });
});

test("history RPC is inside the shared source deadline", async () => {
  const historyBudget = jest.fn(() => {
    throw new Error("deadline");
  });
  await expect(
    classifyAccountPaymentHistory("u", { historyBudget } as never),
  ).rejects.toThrow("deadline");
  expect(rpc).not.toHaveBeenCalled();
});
test("current paid entitlement needs verified live backing; empty trial-only refs mean no paid access", async () => {
  history({
    complete: true,
    expected_keys: ["invoice:in_1"],
    sources: [{}],
    current_paid_reference_keys: ["invoice:in_1"],
    current_paid_references_complete: true,
  });
  expect(
    (await classifyAccountPaymentHistory("u", {} as never))
      .currentPaidEntitlement,
  ).toBe(true);
  history({
    complete: true,
    expected_keys: [],
    sources: [],
    current_paid_reference_keys: [],
    current_paid_references_complete: true,
  });
  expect(
    (await classifyAccountPaymentHistory("u", {} as never))
      .currentPaidEntitlement,
  ).toBe(false);
});
