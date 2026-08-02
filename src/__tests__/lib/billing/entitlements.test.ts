/**
 * Resolving what an account is entitled to: a plan, spendable credits, or
 * nothing.
 *
 * Two rules meet here and their order matters. `free` is retired, so a row
 * still holding it grants no plan; and purchased credits are an entitlement in
 * their own right, because the holder paid for a delivered good. An account
 * with `plan='free'` AND credits is therefore a credit holder, not a lost one —
 * the case most likely to be missed.
 */

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Per-table results the stubbed query builder resolves to. */
const results: Record<string, QueryResult> = {};

const mockSupabase = {
  from: jest.fn((table: string) => {
    const chain: Record<string, unknown> = {
      // credit_purchases is awaited directly; the others end in maybeSingle().
      then: (resolve: (value: QueryResult) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], error: null }).then(
          resolve,
        ),
    };
    for (const method of [
      "select",
      "eq",
      "is",
      "in",
      "gt",
      "or",
      "order",
      "limit",
    ]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.maybeSingle = jest.fn(() =>
      Promise.resolve(results[table] ?? { data: null, error: null }),
    );
    return chain;
  }),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

jest.mock("@/lib/stripe/plans", () => ({
  findPlanById: jest.fn(),
}));

import {
  getEffectivePlan,
  getEffectivePlanId,
  hasAnyEntitlement,
  UNENTITLED,
} from "@/lib/billing/entitlements";
import { findPlanById } from "@/lib/stripe/plans";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";

const asMock = (fn: unknown) => fn as jest.Mock;

const PRO: SubscriptionPlan = {
  id: "pro",
  name: "Pro",
  description: "",
  price: 19,
  yearlyPrice: 15.77,
  features: [],
  limits: {
    websites: 5,
    collaborators: 5,
    aiFeatures: true,
    translations: -1,
    abTesting: true,
    monthlyCredits: 500,
  },
  additionalSitePrice: 5,
  sortOrder: 20,
};

const USER = "user-1";

function setRows(rows: Partial<Record<string, QueryResult>>) {
  for (const key of Object.keys(results)) delete results[key];
  Object.assign(results, rows);
}

/** A wallet holding `n` spendable credits. */
function wallet(n: number): QueryResult {
  return { data: n > 0 ? [{ credits_remaining: n }] : [], error: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  setRows({});
  asMock(findPlanById).mockResolvedValue(PRO);
});

describe("getEffectivePlanId", () => {
  it("returns null when there is neither an entitlement nor a subscription", async () => {
    await expect(getEffectivePlanId(USER)).resolves.toBeNull();
  });

  it("returns the subscription's plan when there is no entitlement", async () => {
    setRows({
      billing_subscriptions: { data: { plan: "starter" }, error: null },
    });

    await expect(getEffectivePlanId(USER)).resolves.toBe("starter");
  });

  it("lets a lifetime entitlement win over a live subscription", async () => {
    setRows({
      plan_entitlements: { data: { plan_id: "pro" }, error: null },
      billing_subscriptions: { data: { plan: "starter" }, error: null },
    });

    await expect(getEffectivePlanId(USER)).resolves.toBe("pro");
  });

  it.each([
    ["a subscription row", "billing_subscriptions", { plan: "free" }],
    ["a grant", "plan_entitlements", { plan_id: "free" }],
  ])(
    "normalises a retired free plan on %s to no plan at all",
    async (_label, table, data) => {
      setRows({ [table]: { data, error: null } });

      await expect(getEffectivePlanId(USER)).resolves.toBeNull();
    },
  );

  it("falls through a free grant to a real subscription underneath it", async () => {
    setRows({
      plan_entitlements: { data: { plan_id: "free" }, error: null },
      billing_subscriptions: { data: { plan: "pro" }, error: null },
    });

    await expect(getEffectivePlanId(USER)).resolves.toBe("pro");
  });

  it.each([
    ["plan_entitlements", /Failed to read plan entitlements/],
    ["billing_subscriptions", /Failed to read billing subscriptions/],
  ])(
    "throws rather than reporting no plan when %s cannot be read",
    async (table, message) => {
      // A read failure is not the same answer as "has not paid", and conflating
      // the two would lock a paying customer out on a transient error.
      setRows({ [table]: { data: null, error: { message: "boom" } } });

      await expect(getEffectivePlanId(USER)).rejects.toThrow(message);
    },
  );
});

describe("getEffectivePlan", () => {
  it("carries the plan and its id for a subscriber", async () => {
    setRows({ billing_subscriptions: { data: { plan: "pro" }, error: null } });

    const entitlement = await getEffectivePlan(USER);

    expect(entitlement.kind).toBe("plan");
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.plan).toBe(PRO);
  });

  it("does not read the wallet when a plan already resolved", async () => {
    setRows({ billing_subscriptions: { data: { plan: "pro" }, error: null } });

    await getEffectivePlan(USER);

    // A subscriber's gate checks must not get slower because credits can now
    // entitle someone.
    expect(mockSupabase.from).not.toHaveBeenCalledWith("credit_purchases");
  });

  it("resolves an account with nothing to UNENTITLED", async () => {
    const entitlement = await getEffectivePlan(USER);

    expect(entitlement).toEqual(UNENTITLED);
    expect(entitlement.kind).toBe("none");
    expect(entitlement.plan).toBeNull();
    expect(findPlanById).not.toHaveBeenCalled();
  });

  it("resolves a wallet with credits and no plan to credits", async () => {
    setRows({ credit_purchases: wallet(250) });

    const entitlement = await getEffectivePlan(USER);

    expect(entitlement.kind).toBe("credits");
    // Credits confer no plan, so there is nothing here to read limits off.
    expect(entitlement.plan).toBeNull();
    expect(entitlement.planId).toBeNull();
  });

  it("resolves a drained wallet to nothing", async () => {
    // Spending the last credit must move the holder to the paywall rather than
    // stranding them in a half-lit dashboard.
    setRows({ credit_purchases: wallet(0) });

    await expect(getEffectivePlan(USER)).resolves.toEqual(UNENTITLED);
  });

  it("treats a plan id with no catalogue row as no plan", async () => {
    setRows({
      billing_subscriptions: { data: { plan: "enterprise" }, error: null },
    });
    asMock(findPlanById).mockResolvedValue(null);

    await expect(getEffectivePlan(USER)).resolves.toEqual(UNENTITLED);
  });

  it("falls a dead plan id through to the wallet rather than off a cliff", async () => {
    setRows({
      billing_subscriptions: { data: { plan: "enterprise" }, error: null },
      credit_purchases: wallet(100),
    });
    asMock(findPlanById).mockResolvedValue(null);

    expect((await getEffectivePlan(USER)).kind).toBe("credits");
  });

  it("composes the two rules: a free row plus credits is a credit holder", async () => {
    // The case most likely to be missed. `free` retires to no plan, and the
    // wallet is then what decides — so they keep spending what they bought.
    setRows({
      billing_subscriptions: { data: { plan: "free" }, error: null },
      credit_purchases: wallet(500),
    });

    const entitlement = await getEffectivePlan(USER);

    expect(entitlement.kind).toBe("credits");
    expect(findPlanById).not.toHaveBeenCalled();
  });

  it("composes them the other way: a free row with an empty wallet is nothing", async () => {
    setRows({
      billing_subscriptions: { data: { plan: "free" }, error: null },
      credit_purchases: wallet(0),
    });

    await expect(getEffectivePlan(USER)).resolves.toEqual(UNENTITLED);
  });
});

describe("hasAnyEntitlement", () => {
  it.each([
    ["a plan", { kind: "plan", planId: "pro", plan: PRO } as const, true],
    ["credits", { kind: "credits", planId: null, plan: null } as const, true],
    ["nothing", UNENTITLED, false],
  ])("is %s → %s", (_label, entitlement, expected) => {
    expect(hasAnyEntitlement(entitlement)).toBe(expected);
  });
});
