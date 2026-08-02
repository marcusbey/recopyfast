/**
 * Granting credits must survive a database that has not had migration
 * 20260802020000 applied yet.
 *
 * Code and schema deploy separately and the code can arrive first. While
 * `credit_purchases.expires_at` is still NOT NULL, inserting NULL raises 23502;
 * the webhook turns that into a 500, Stripe retries forever, and the customer
 * is charged for credits that never arrive. These tests pin the fallback that
 * closes that window, and pin that it disappears once the migration lands.
 */

const insert = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => ({ insert })),
  })),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));

import { addPurchasedCredits, refundCredits } from "@/lib/credits/system";

const NOT_NULL_VIOLATION = {
  code: "23502",
  message: 'null value in column "expires_at"',
};
const UNIQUE_VIOLATION = { code: "23505", message: "duplicate key" };

/** The single value the fallback is allowed to write. */
const NEVER = "9999-12-31T23:59:59.999Z";

beforeEach(() => {
  insert.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("granting credits on a migrated database", () => {
  it("records 'never expires' as NULL and does not retry", async () => {
    insert.mockResolvedValueOnce({ error: null });

    const result = await addPurchasedCredits("user-1", 1000, "pi_123", 900);

    expect(result).toEqual({ success: true, duplicate: false });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      user_id: "user-1",
      credits_purchased: 1000,
      credits_remaining: 1000,
      stripe_payment_intent_id: "pi_123",
      expires_at: null,
    });
  });
});

describe("granting credits before the migration has run", () => {
  it("still credits the customer instead of throwing", async () => {
    insert
      .mockResolvedValueOnce({ error: NOT_NULL_VIOLATION })
      .mockResolvedValueOnce({ error: null });

    const result = await addPurchasedCredits("user-1", 1000, "pi_123", 900);

    expect(result).toEqual({ success: true, duplicate: false });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("writes an expiry far enough out to count as never", async () => {
    insert
      .mockResolvedValueOnce({ error: NOT_NULL_VIOLATION })
      .mockResolvedValueOnce({ error: null });

    await addPurchasedCredits("user-1", 1000, "pi_123", 900);

    expect(insert.mock.calls[1][0].expires_at).toBe(NEVER);
    // Spendable under the `expires_at.gt.<now>` arm of the balance filter.
    expect(new Date(NEVER).getTime()).toBeGreaterThan(Date.now());
  });

  it("credits the same amount it would have on a migrated database", async () => {
    insert
      .mockResolvedValueOnce({ error: NOT_NULL_VIOLATION })
      .mockResolvedValueOnce({ error: null });

    await addPurchasedCredits("user-1", 1000, "pi_123", 900);

    // Everything except the expiry must be identical between the two attempts.
    const withoutExpiry = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).filter(([column]) => column !== "expires_at"),
      );

    expect(withoutExpiry(insert.mock.calls[1][0])).toEqual(
      withoutExpiry(insert.mock.calls[0][0]),
    );
  });

  it("says out loud that the migration is missing", async () => {
    insert
      .mockResolvedValueOnce({ error: NOT_NULL_VIOLATION })
      .mockResolvedValueOnce({ error: null });

    await addPurchasedCredits("user-1", 1000, "pi_123", 900);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("20260802020000"),
    );
  });

  it("refunds survive the same schema gap", async () => {
    insert
      .mockResolvedValueOnce({ error: NOT_NULL_VIOLATION })
      .mockResolvedValueOnce({ error: null });

    const result = await refundCredits("user-1", 50, "ai_failed");

    expect(result.success).toBe(true);
    expect(insert.mock.calls[1][0].expires_at).toBe(NEVER);
  });
});

describe("errors that are not the schema gap", () => {
  it("reports a redelivered webhook as a duplicate, not a failure", async () => {
    insert.mockResolvedValueOnce({ error: UNIQUE_VIOLATION });

    const result = await addPurchasedCredits("user-1", 1000, "pi_123", 900);

    expect(result).toEqual({ success: false, duplicate: true });
    // A duplicate must never be retried: the credits are already granted.
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("throws on an unrelated failure so Stripe retries", async () => {
    insert.mockResolvedValueOnce({
      error: { code: "08006", message: "connection failure" },
    });

    await expect(
      addPurchasedCredits("user-1", 1000, "pi_123", 900),
    ).rejects.toThrow("connection failure");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the fallback itself fails", async () => {
    insert
      .mockResolvedValueOnce({ error: NOT_NULL_VIOLATION })
      .mockResolvedValueOnce({
        error: { code: "23502", message: "price_cents" },
      });

    await expect(
      addPurchasedCredits("user-1", 1000, "pi_123", 900),
    ).rejects.toThrow("price_cents");
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("refuses a non-positive amount without touching the database", async () => {
    const result = await addPurchasedCredits("user-1", 0, "pi_123");

    expect(result.success).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});
