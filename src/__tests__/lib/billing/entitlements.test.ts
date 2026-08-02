/**
 * Resolving what plan an account has, including the case where it has none.
 *
 * `getEffectivePlanId` used to end in `?? "free"`, so "has never paid" and "is
 * on a plan" came back as the same kind of value and every gate downstream
 * evaluated the free row's limits instead of asking whether the account was
 * entitled at all. These tests pin the absence of that fallback.
 */

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Per-table results the stubbed query builder resolves to. */
const results: Record<string, QueryResult> = {};

const mockSupabase = {
  from: jest.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
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
  it("resolves an unpaid account to UNENTITLED without consulting the catalogue", async () => {
    const entitlement = await getEffectivePlan(USER);

    expect(entitlement).toEqual(UNENTITLED);
    expect(entitlement.entitled).toBe(false);
    expect(entitlement.plan).toBeNull();
    expect(entitlement.planId).toBeNull();
    // The catalogue is not asked for a plan that does not exist. It used to be
    // asked for "free", which threw the moment that row was switched off.
    expect(findPlanById).not.toHaveBeenCalled();
  });

  it("carries the plan and its id for a subscriber", async () => {
    setRows({ billing_subscriptions: { data: { plan: "pro" }, error: null } });

    const entitlement = await getEffectivePlan(USER);

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.plan).toBe(PRO);
  });

  it("treats a plan id with no catalogue row as unentitled", async () => {
    // A plan retired years ago can still be sitting in an old subscription row.
    // It used to fall back to free, so a plan that no longer exists kept
    // conferring access.
    setRows({
      billing_subscriptions: { data: { plan: "enterprise" }, error: null },
    });
    asMock(findPlanById).mockResolvedValue(null);

    await expect(getEffectivePlan(USER)).resolves.toEqual(UNENTITLED);
  });

  it("still resolves a grandfathered free row while that plan is seeded", async () => {
    // Existing rows holding plan='free' keep working. What changed is that
    // nothing new arrives at that id by fallback.
    const free = { ...PRO, id: "free" as const, name: "Free" };
    setRows({ billing_subscriptions: { data: { plan: "free" }, error: null } });
    asMock(findPlanById).mockResolvedValue(free);

    const entitlement = await getEffectivePlan(USER);

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.planId).toBe("free");
  });
});
