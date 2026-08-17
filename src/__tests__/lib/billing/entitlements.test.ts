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

type Row = Record<string, unknown>;

/** Per-table results the stubbed query builder resolves to. */
const results: Record<string, QueryResult> = {};

/**
 * Per-table ROWS the stubbed builder filters for itself.
 *
 * `results` answers with a fixed value whatever was asked, which is all the
 * precedence cases below need. An expiring grant needs more: the question is
 * whether an expired row is excluded *by the query* or discarded *after* it,
 * and only a stub that actually applies `.or()`/`.neq()` can tell those apart.
 * A post-query check returns null for an expired row and skips the
 * subscription read underneath it — un-entitling a customer who has converted
 * and is paying. See ADR 014.
 */
const tables: Record<string, Row[]> = {};

/** One arm of a PostgREST `.or()` expression, e.g. `expires_at.gt.<iso>`. */
function armPredicate(arm: string): (row: Row) => boolean {
  const [column, operator, ...rest] = arm.split(".");
  const value = rest.join(".");

  if (operator === "is" && value === "null") {
    return (row) => (row[column] ?? null) === null;
  }
  if (operator === "gt") {
    return (row) => String(row[column] ?? "") > value;
  }
  throw new Error(`Unsupported or() arm in test stub: ${arm}`);
}

const mockSupabase = {
  from: jest.fn((table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let sort: { column: string; ascending: boolean } | null = null;
    let cap: number | null = null;

    const matching = (): Row[] => {
      let selected = (tables[table] ?? []).filter((row) =>
        predicates.every((predicate) => predicate(row)),
      );
      if (sort) {
        const { column, ascending } = sort;
        selected = [...selected].sort(
          (a, b) =>
            String(a[column] ?? "").localeCompare(String(b[column] ?? "")) *
            (ascending ? 1 : -1),
        );
      }
      return cap === null ? selected : selected.slice(0, cap);
    };

    const many = (): QueryResult =>
      table in tables
        ? { data: matching(), error: null }
        : (results[table] ?? { data: [], error: null });

    const one = (): QueryResult =>
      table in tables
        ? { data: matching()[0] ?? null, error: null }
        : (results[table] ?? { data: null, error: null });

    const chain: Record<string, unknown> = {
      // credit_purchases is awaited directly; the others end in maybeSingle().
      then: (resolve: (value: QueryResult) => unknown) =>
        Promise.resolve(many()).then(resolve),
    };
    for (const method of ["select", "returns"]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.eq = jest.fn((column: string, value: unknown) => {
      predicates.push((row) => row[column] === value);
      return chain;
    });
    chain.neq = jest.fn((column: string, value: unknown) => {
      predicates.push((row) => row[column] !== value);
      return chain;
    });
    chain.is = jest.fn((column: string, value: unknown) => {
      predicates.push((row) => (row[column] ?? null) === value);
      return chain;
    });
    chain.in = jest.fn((column: string, values: unknown[]) => {
      predicates.push((row) => values.includes(row[column]));
      return chain;
    });
    chain.gt = jest.fn((column: string, value: number) => {
      predicates.push((row) => Number(row[column] ?? 0) > value);
      return chain;
    });
    chain.or = jest.fn((expression: string) => {
      const arms = expression.split(",").map(armPredicate);
      predicates.push((row) => arms.some((arm) => arm(row)));
      return chain;
    });
    chain.order = jest.fn(
      (column: string, options?: { ascending?: boolean }) => {
        sort = { column, ascending: options?.ascending !== false };
        return chain;
      },
    );
    chain.limit = jest.fn((count: number) => {
      cap = count;
      return chain;
    });
    chain.maybeSingle = jest.fn(() => Promise.resolve(one()));
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
  getGrantedPlanIds,
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
  for (const key of Object.keys(tables)) delete tables[key];
  Object.assign(results, rows);
}

/** Stored rows the stub filters for itself — see `tables` above. */
function setTable(table: string, rows: Row[]) {
  tables[table] = rows;
}

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): string {
  return new Date(NOW + days * DAY_MS).toISOString();
}

/** A `plan_entitlements` row, defaulting to a live permanent grant. */
function grant(overrides: Partial<Row> = {}): Row {
  return {
    user_id: USER,
    plan_id: "pro",
    source: "lifetime_purchase",
    granted_at: daysFromNow(-30),
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

/** The 14-day Pro trial, `days` into its window. */
function trial(daysElapsed: number): Row {
  return grant({
    source: "trial",
    granted_at: daysFromNow(-daysElapsed),
    expires_at: daysFromNow(14 - daysElapsed),
  });
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

/**
 * The 14-day trial, as a time-boxed row in the same grant table a $199
 * Lifetime purchase writes into (ADR 014).
 *
 * Two things decide whether this is safe, and both are read-shaped rather than
 * write-shaped, which is why they are pinned here at the chokepoint rather than
 * beside the writer.
 */
describe("a trial grant in plan_entitlements", () => {
  it("entitles a brand-new account to Pro with no subscription row anywhere", async () => {
    setTable("plan_entitlements", [trial(0)]);
    setTable("billing_subscriptions", []);

    const entitlement = await getEffectivePlan(USER);

    expect(entitlement.kind).toBe("plan");
    expect(entitlement.planId).toBe("pro");
    // The limits a gate reads come from the catalogue row verbatim, so a
    // trialling account gets Pro's, not a reduced copy of them.
    expect(entitlement.plan).toBe(PRO);
  });

  it("stops entitling once the fourteen days have passed", async () => {
    setTable("plan_entitlements", [trial(15)]);
    setTable("billing_subscriptions", []);

    await expect(getEffectivePlan(USER)).resolves.toEqual(UNENTITLED);
  });

  it("keeps a converted customer entitled when their earlier trial lapses", async () => {
    // THE case that distinguishes an inside-the-query filter from a check on
    // the row after `.maybeSingle()` returns it. A post-query check answers
    // null for the expired row and never reaches the subscription below it, so
    // someone who converted mid-trial and is now paying is shown the paywall.
    setTable("plan_entitlements", [trial(20)]);
    setTable("billing_subscriptions", [
      {
        user_id: USER,
        plan: "starter",
        status: "active",
        created_at: daysFromNow(-3),
      },
    ]);

    await expect(getEffectivePlanId(USER)).resolves.toBe("starter");
  });

  it("falls an expired trial through to a live grant underneath it", async () => {
    // The trial is the newest row, so `.limit(1)` would pick it if the expiry
    // predicate were not in the query. The older permanent grant is what should
    // answer once the window has closed.
    setTable("plan_entitlements", [
      trial(20),
      grant({
        plan_id: "starter",
        source: "support_comp",
        granted_at: daysFromNow(-40),
      }),
    ]);
    setTable("billing_subscriptions", []);

    await expect(getEffectivePlanId(USER)).resolves.toBe("starter");
  });

  it("keeps the newest live grant in force while a trial is still running", async () => {
    // Fix-stable ordering guard: adding an expiry predicate must not change
    // which of two *live* grants wins. Conversion relies on this — the trial is
    // left to lapse on its own clock rather than being revoked at payment, so
    // no request can observe a gap.
    setTable("plan_entitlements", [
      trial(3),
      grant({
        plan_id: "starter",
        source: "support_comp",
        granted_at: daysFromNow(-1),
      }),
    ]);
    setTable("billing_subscriptions", []);

    await expect(getEffectivePlanId(USER)).resolves.toBe("starter");
  });

  it("does not entitle through a revoked trial", async () => {
    setTable("plan_entitlements", [
      { ...trial(2), revoked_at: daysFromNow(-1) },
    ]);
    setTable("billing_subscriptions", []);

    await expect(getEffectivePlan(USER)).resolves.toEqual(UNENTITLED);
  });
});

describe("getGrantedPlanIds with a trial in the table", () => {
  it("never reports a trial as a plan the account has paid for outright", async () => {
    // A trial answering "yes, you already hold pro" refuses the $199 Lifetime
    // purchase with a 409 that reads as intentional, and hides the offer card —
    // for every trialling account. This is the defect effective-plan.ts:113-129
    // documents having already shipped once, arriving through a second door.
    setTable("plan_entitlements", [trial(1)]);

    await expect(getGrantedPlanIds(USER)).resolves.toEqual([]);
  });

  it("still reports a real grant sitting beside a trial", async () => {
    setTable("plan_entitlements", [
      trial(1),
      grant({ plan_id: "starter", source: "support_comp" }),
    ]);

    await expect(getGrantedPlanIds(USER)).resolves.toEqual(["starter"]);
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
