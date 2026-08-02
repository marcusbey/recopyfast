/**
 * Reading a credit balance for an account with no plan.
 *
 * This read sits on the path the billing dashboard takes, so it has to answer
 * rather than throw for someone who has not subscribed — that is the state the
 * page exists to get them out of. It previously resolved the plan through a
 * `free` fallback, which meant the balance depended on a catalogue row that the
 * product no longer sells and that switching off would have turned this read
 * into a 500.
 */

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

const results: Record<string, QueryResult> = {};

const mockSupabase = {
  from: jest.fn((table: string) => {
    const result = () => results[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {
      then: (resolve: (value: QueryResult) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    for (const method of [
      "select",
      "eq",
      "gt",
      "gte",
      "or",
      "order",
      "limit",
    ]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.maybeSingle = jest.fn(() => Promise.resolve(result()));
    return chain;
  }),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));

import { getUserCreditBalance } from "@/lib/credits/system";
import { getEffectivePlan } from "@/lib/billing/entitlements";

const asMock = (fn: unknown) => fn as jest.Mock;

const UNENTITLED = { entitled: false, planId: null, plan: null };

const USER = "user-1";

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(results)) delete results[key];
  asMock(getEffectivePlan).mockResolvedValue(UNENTITLED);
});

describe("credit balance without a plan", () => {
  it("reads without throwing and includes nothing", async () => {
    const balance = await getUserCreditBalance(USER);

    expect(balance.included).toBe(0);
    expect(balance.total).toBe(0);
  });

  it("still reports credits the account bought", async () => {
    // A wallet balance was paid for. Having no plan gates what it can be spent
    // on; it does not make the credits disappear.
    results.credit_purchases = {
      data: [{ credits_remaining: 300 }, { credits_remaining: 200 }],
      error: null,
    };

    const balance = await getUserCreditBalance(USER);

    expect(balance.purchased).toBe(500);
    expect(balance.included).toBe(0);
    expect(balance.total).toBe(500);
  });

  it("never reports a negative total when usage exceeds a zero allowance", async () => {
    results.credit_usage = { data: [{ credits_used: 40 }], error: null };

    const balance = await getUserCreditBalance(USER);

    expect(balance.usedThisMonth).toBe(40);
    expect(balance.total).toBe(0);
  });

  it("still surfaces a failed wallet read rather than reporting zero", async () => {
    results.credit_purchases = { data: null, error: { message: "boom" } };

    await expect(getUserCreditBalance(USER)).rejects.toThrow(
      /credit_purchases read failed/,
    );
  });
});
