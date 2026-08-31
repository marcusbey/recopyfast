/**
 * createOrGetCustomer — a stored Stripe customer id the current key cannot
 * see must be discarded and re-enrolled, not surfaced as a 500.
 *
 * Live and test mode share the database, so an account that ever checked out
 * against test Stripe carries `billing_customers.stripe_customer_id =
 * cus_test…`. The moment production runs on the live key,
 * `stripe.customers.retrieve` answers `resource_missing` ("a similar object
 * exists in test mode, but a live mode key was used") and, before this fix,
 * every checkout for that account failed forever.
 */

const retrieveMock = jest.fn();
const createMock = jest.fn();
const delMock = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    customers: {
      retrieve: (...args: unknown[]) => retrieveMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      del: (...args: unknown[]) => delMock(...args),
    },
  },
}));

const deleteEq = jest.fn().mockResolvedValue({ error: null });
let storedRow: Record<string, unknown> | null;
const insertedRow = {
  id: "row-2",
  user_id: "user-1",
  stripe_customer_id: "cus_live_fresh",
  email: "a@b.c",
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: storedRow }),
        }),
      }),
      delete: () => ({ eq: deleteEq }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: insertedRow, error: null }),
        }),
      }),
    }),
  }),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

import { createOrGetCustomer } from "@/lib/stripe/customer";

describe("createOrGetCustomer with a stale stored customer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storedRow = {
      id: "row-1",
      user_id: "user-1",
      stripe_customer_id: "cus_test_stale",
      email: "a@b.c",
    };
  });

  it("re-enrols when the stored id belongs to the other Stripe mode", async () => {
    const missing = Object.assign(new Error("No such customer"), {
      code: "resource_missing",
    });
    retrieveMock.mockRejectedValueOnce(missing);
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });

    const result = await createOrGetCustomer("user-1", "a@b.c");

    expect(deleteEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(createMock).toHaveBeenCalled();
    expect(result.customer.stripe_customer_id).toBe("cus_live_fresh");
  });

  it("re-enrols when the stored customer was deleted at Stripe", async () => {
    retrieveMock.mockResolvedValueOnce({ id: "cus_test_stale", deleted: true });
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });

    const result = await createOrGetCustomer("user-1", "a@b.c");

    expect(deleteEq).toHaveBeenCalled();
    expect(result.customer.stripe_customer_id).toBe("cus_live_fresh");
  });

  it("still surfaces unrelated Stripe failures", async () => {
    retrieveMock.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { code: "rate_limit" }),
    );

    await expect(createOrGetCustomer("user-1", "a@b.c")).rejects.toThrow(
      "rate limited",
    );
    expect(deleteEq).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});
