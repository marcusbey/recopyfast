/**
 * createOrGetCustomer — a stored Stripe customer id the current key cannot
 * see must be replaced in place and checkout must continue, not 500.
 *
 * Live and test mode share the database, so an account that ever checked out
 * against test Stripe carries `billing_customers.stripe_customer_id =
 * cus_test…`. Under the live key `stripe.customers.retrieve` answers
 * `resource_missing` ("a similar object exists in test mode, but a live mode
 * key was used").
 *
 * The first fix DELETED the stale row and inserted a new one. That cannot
 * work for any account with billing history: `billing_subscriptions` and
 * `billing_invoices` reference `billing_customers(id)` with no ON DELETE
 * action, so the delete is refused (23503, unchecked), the insert then hits
 * the `user_id` UNIQUE (23505), the "raced" branch re-reads the SAME stale row
 * and retrieves it again → resource_missing → "Failed to start checkout".
 * Observed live on 2026-10-20 (req_rvMVo5WjK0VyJ4) for a QA account with a
 * legacy Pro record.
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

type Row = Record<string, unknown>;

let storedRow: Row | null;
/** What the conditional UPDATE matches; null = another request already swapped it. */
let updateMatches: boolean;
let updateError: { code: string; message: string } | null;
const updateCalls: Array<{ values: Row; filters: Array<[string, unknown]> }> =
  [];
const deleteMock = jest.fn();
const insertMock = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: storedRow, error: null }),
        }),
      }),
      update: (values: Row) => {
        const call = { values, filters: [] as Array<[string, unknown]> };
        updateCalls.push(call);
        const chain = {
          eq: (column: string, value: unknown) => {
            call.filters.push([column, value]);
            return chain;
          },
          select: () => chain,
          maybeSingle: () => {
            if (updateError) {
              return Promise.resolve({ data: null, error: updateError });
            }
            if (!updateMatches) {
              return Promise.resolve({ data: null, error: null });
            }
            storedRow = { ...storedRow, ...values };
            return Promise.resolve({ data: storedRow, error: null });
          },
        };
        return chain;
      },
      delete: (...args: unknown[]) => {
        deleteMock(...args);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (...args: unknown[]) => {
        insertMock(...args);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              }),
          }),
        };
      },
    }),
  }),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

import { createOrGetCustomer } from "@/lib/stripe/customer";

const missing = () =>
  Object.assign(
    new Error(
      "No such customer: 'cus_test_stale'; a similar object exists in test mode, but a live mode key was used to make this request.",
    ),
    { code: "resource_missing", type: "StripeInvalidRequestError" },
  );

describe("createOrGetCustomer with a stale stored customer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps queued *Once implementations; drop them too.
    retrieveMock.mockReset();
    createMock.mockReset();
    updateCalls.length = 0;
    updateMatches = true;
    updateError = null;
    storedRow = {
      id: "row-1",
      user_id: "user-1",
      stripe_customer_id: "cus_test_stale",
      email: "a@b.c",
    };
  });

  it("replaces a cross-mode customer id in place and continues", async () => {
    retrieveMock.mockRejectedValueOnce(missing());
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });

    const result = await createOrGetCustomer("user-1", "a@b.c");

    expect(result.stripeCustomer.id).toBe("cus_live_fresh");
    expect(result.customer.stripe_customer_id).toBe("cus_live_fresh");
    // Same row, so billing_subscriptions / billing_invoices keep their FK.
    expect(result.customer.id).toBe("row-1");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values).toEqual({
      stripe_customer_id: "cus_live_fresh",
    });
    // Compare-and-swap on the stale id: a concurrent recovery cannot be
    // overwritten by a second fresh customer.
    expect(updateCalls[0].filters).toEqual(
      expect.arrayContaining([
        ["id", "row-1"],
        ["stripe_customer_id", "cus_test_stale"],
      ]),
    );
    // Nothing is deleted — not the row, not a Stripe customer.
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("is idempotent: the replacement customer is created under a key derived from the stale id", async () => {
    retrieveMock.mockRejectedValueOnce(missing());
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });

    await createOrGetCustomer("user-1", "a@b.c", "Ada");

    expect(createMock).toHaveBeenCalledTimes(1);
    const [params, options] = createMock.mock.calls[0];
    expect(params).toMatchObject({
      email: "a@b.c",
      name: "Ada",
      metadata: { user_id: "user-1" },
    });
    expect(options).toEqual({
      idempotencyKey: "billing-customer-replace:user-1:cus_test_stale",
    });
  });

  it("adopts the customer a concurrent recovery already stored", async () => {
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });
    updateMatches = false;
    retrieveMock
      .mockImplementationOnce(async () => {
        // While this request is recovering, another one swaps the row.
        storedRow = { ...storedRow, stripe_customer_id: "cus_live_winner" };
        throw missing();
      })
      .mockResolvedValueOnce({ id: "cus_live_winner", deleted: false });

    const result = await createOrGetCustomer("user-1", "a@b.c");

    expect(result.stripeCustomer.id).toBe("cus_live_winner");
    expect(result.customer.stripe_customer_id).toBe("cus_live_winner");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("replaces a customer that was deleted at Stripe", async () => {
    retrieveMock.mockResolvedValueOnce({ id: "cus_test_stale", deleted: true });
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });

    const result = await createOrGetCustomer("user-1", "a@b.c");

    expect(result.customer.stripe_customer_id).toBe("cus_live_fresh");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("fails loudly when the replacement cannot be persisted", async () => {
    retrieveMock.mockRejectedValueOnce(missing());
    createMock.mockResolvedValue({ id: "cus_live_fresh", deleted: false });
    updateError = { code: "08006", message: "connection failure" };

    await expect(createOrGetCustomer("user-1", "a@b.c")).rejects.toThrow(
      "connection failure",
    );
    // The idempotency key makes the retry reuse this customer; deleting it
    // would make the replayed response point at a deleted customer.
    expect(delMock).not.toHaveBeenCalled();
  });

  it("still surfaces unrelated Stripe failures", async () => {
    retrieveMock.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { code: "rate_limit" }),
    );

    await expect(createOrGetCustomer("user-1", "a@b.c")).rejects.toThrow(
      "rate limited",
    );
    expect(updateCalls).toHaveLength(0);
    expect(createMock).not.toHaveBeenCalled();
  });
});
