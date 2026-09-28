/**
 * s48 — a refund returns a charge to where it came from, keyed by its receipt.
 *
 * The old refund took `(userId, credits, reason)`, could not know where a charge
 * came from, so it minted a fresh never-expiring "purchased" row every time
 * (probe P2) — and that row alone let a lapsed, never-paying trial through the
 * paywall (probe P3). `refundCharge` hands the receipt `spend_credits` returned
 * to `refund_credit_usage`, which puts the credits back into the rows and the
 * allowance they came from. The SQL is proved in
 * `src/__tests__/db/credit-spend.test.ts`; this is the TypeScript contract.
 */

type Row = Record<string, unknown>;

const rpc = jest.fn();
const from = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc, from })),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error("a refund never runs as the caller's cookie session");
  }),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/service";
import { refundCharge, type CreditCharge } from "@/lib/credits/system";

const RECEIPT: CreditCharge = {
  usageId: "usage-1",
  userId: "owner-1",
  credits: 5,
};

function refunded(row: Row) {
  return { data: [row], error: null };
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  rpc.mockResolvedValue(
    refunded({ refunded: 5, to_purchased: 3, to_allowance: 2 }),
  );
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("refundCharge", () => {
  it("refundCharge calls refund_credit_usage through the service role with the receipt's usage id, user id and credits", async () => {
    const result = await refundCharge(RECEIPT);

    expect(createServiceRoleClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("refund_credit_usage", {
      p_usage_id: "usage-1",
      p_user_id: "owner-1",
      p_credits: 5,
    });
    expect(result).toEqual({ success: true, refunded: 5 });
  });

  it("a partial amount is sent as given", async () => {
    rpc.mockResolvedValue(
      refunded({ refunded: 2, to_purchased: 2, to_allowance: 0 }),
    );

    const result = await refundCharge(RECEIPT, 2);

    expect(rpc).toHaveBeenCalledWith("refund_credit_usage", {
      p_usage_id: "usage-1",
      p_user_id: "owner-1",
      p_credits: 2,
    });
    expect(result).toEqual({ success: true, refunded: 2 });
  });

  it("0, negative, fractional or more than the charge is refused without calling the database", async () => {
    for (const credits of [0, -1, 1.5, 6, Number.NaN]) {
      const result = await refundCharge(RECEIPT, credits);

      expect(result).toEqual({ success: false, refunded: 0 });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an RPC error resolves { success: false, refunded: 0 }, logged, never thrown", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "no such charge for this user" },
    });
    await expect(refundCharge(RECEIPT)).resolves.toEqual({
      success: false,
      refunded: 0,
    });

    rpc.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(refundCharge(RECEIPT)).resolves.toEqual({
      success: false,
      refunded: 0,
    });

    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("never inserts a credit_purchases row", async () => {
    await refundCharge(RECEIPT);
    await refundCharge(RECEIPT, 1);

    // The only door is the function. A refund that writes a row is the
    // P2/P3 mint all over again.
    expect(from).not.toHaveBeenCalled();
  });
});
