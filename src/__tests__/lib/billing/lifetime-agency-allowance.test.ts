/**
 * s45 — the lifetime Founding Agency includes 250 AI credits a month.
 *
 * Operator decision 2026-09-26: a lifetime Founding Agency owner gets
 * everything Agency has except the monthly AI-credit allowance, which is 250
 * instead of Agency's 1,000. Agency subscribers are unchanged.
 *
 * Everything that decides the answer is the shipped code: the catalogue parser
 * (`src/lib/stripe/plans.ts`), the entitlement resolver
 * (`src/lib/billing/effective-plan.ts`) and the credit arithmetic
 * (`src/lib/credits/system.ts`). Only the database is a double. The Agency and
 * Founding Agency rows are read out of the migrations themselves, so this
 * asserts what production will hold once 20260926120000 is applied — not a
 * fixture that could drift from it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

let catalogueRows: Row[] = [];

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            returns: async () => ({
              data: catalogueRows.filter((row) => row.is_active === true),
              error: null,
            }),
          }),
        }),
      }),
    }),
  })),
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error("the cookie client must not be opened for a payer client");
  }),
}));

import { resolveEntitlement } from "@/lib/billing/effective-plan";
import { getUserCreditBalance } from "@/lib/credits/system";
import { clearPlanCatalogueCache } from "@/lib/stripe/plans";

// ---------------------------------------------------------------------------
// The catalogue, as the migrations leave it
// ---------------------------------------------------------------------------

function migration(file: string): string {
  return readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
}

/** The first `'{…}'::jsonb` literal in the seed tuple that starts at `marker`. */
function seededLimits(sql: string, marker: string): Row {
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const tuple = sql.slice(start, sql.indexOf("\n  )", start));
  const literal = tuple.match(/'(\{[^']*\})'::jsonb/);
  expect(literal).not.toBeNull();
  return JSON.parse((literal as RegExpMatchArray)[1]) as Row;
}

const FOUNDING_SEED = migration(
  "20260924065000_agency_plan_and_founding_capacity.sql",
);
const AGENCY_LIMITS = seededLimits(FOUNDING_SEED, "'agency', 'subscription'");
const FOUNDING_LIMITS_BEFORE = seededLimits(
  FOUNDING_SEED,
  "'lifetime_agency', 'one_time'",
);
const FOUNDING_LIMITS_AFTER = JSON.parse(
  (
    migration("20260926120000_lifetime_agency_monthly_credits.sql")
      .replace(/--.*$/gm, "")
      .match(/limits = '(\{[^']*\})'::jsonb/) as RegExpMatchArray
  )[1],
) as Row;

function row(overrides: Row): Row {
  return {
    description: "",
    price_monthly: "0.00",
    price_yearly_monthly_equivalent: null,
    price_yearly_total: null,
    stripe_price_id_test: null,
    stripe_price_id_live: null,
    stripe_yearly_price_id_test: null,
    stripe_yearly_price_id_live: null,
    features: [],
    additional_site_price: null,
    grants_plan_id: null,
    is_active: true,
    ...overrides,
  };
}

function catalogue(foundingLimits: Row): Row[] {
  return [
    row({
      id: "starter",
      kind: "subscription",
      name: "Starter",
      price_monthly: "9.00",
      limits: {
        websites: 1,
        collaborators: 0,
        ai_features: false,
        translations: 0,
        ab_testing: false,
        monthly_credits: 0,
      },
      sort_order: 10,
    }),
    row({
      id: "pro",
      kind: "subscription",
      name: "Pro",
      price_monthly: "19.00",
      limits: {
        websites: 5,
        collaborators: 5,
        ai_features: true,
        translations: -1,
        ab_testing: true,
        monthly_credits: 500,
      },
      sort_order: 20,
    }),
    row({
      id: "agency",
      kind: "subscription",
      name: "Agency",
      price_monthly: "49.00",
      price_yearly_monthly_equivalent: "40.83",
      price_yearly_total: "490.00",
      limits: AGENCY_LIMITS,
      additional_site_price: "4.00",
      sort_order: 25,
    }),
    row({
      id: "credits",
      kind: "one_time",
      name: "Credits",
      price_monthly: "19.00",
      limits: { credits_per_pack: 1000, max_packs_per_purchase: 100 },
      sort_order: 30,
    }),
    row({
      id: "lifetime_pro",
      kind: "one_time",
      name: "Lifetime Pro",
      price_monthly: "199.00",
      limits: {},
      grants_plan_id: "pro",
      sort_order: 40,
    }),
    row({
      id: "lifetime_agency",
      kind: "one_time",
      name: "Founding Agency (lifetime)",
      price_monthly: "299.00",
      limits: foundingLimits,
      grants_plan_id: "agency",
      sort_order: 45,
    }),
  ];
}

// ---------------------------------------------------------------------------
// The payer's rows, behind a PostgREST-shaped double that filters for itself
// ---------------------------------------------------------------------------

let db: Record<string, Row[]> = {};

/** One arm of a PostgREST `.or()` expression, e.g. `expires_at.gt.<iso>`. */
function armPredicate(arm: string): (candidate: Row) => boolean {
  const [column, operator, ...rest] = arm.split(".");
  const value = rest.join(".");
  if (operator === "is" && value === "null") {
    return (candidate) => (candidate[column] ?? null) === null;
  }
  if (operator === "gt") {
    return (candidate) => String(candidate[column] ?? "") > value;
  }
  throw new Error(`Unsupported or() arm in test double: ${arm}`);
}

function payerClient(): SupabaseClient {
  const from = (table: string) => {
    const predicates: Array<(candidate: Row) => boolean> = [];
    let sort: { column: string; ascending: boolean } | null = null;
    let cap: number | null = null;

    const matching = (): Row[] => {
      let selected = (db[table] ?? []).filter((candidate) =>
        predicates.every((predicate) => predicate(candidate)),
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

    const builder = {
      select: () => builder,
      returns: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((candidate) => candidate[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        predicates.push((candidate) => candidate[column] !== value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        predicates.push((candidate) => (candidate[column] ?? null) === value);
        return builder;
      },
      in: (column: string, values: readonly unknown[]) => {
        predicates.push((candidate) => values.includes(candidate[column]));
        return builder;
      },
      gt: (column: string, value: number) => {
        predicates.push((candidate) => Number(candidate[column] ?? 0) > value);
        return builder;
      },
      gte: (column: string, value: string) => {
        predicates.push(
          (candidate) => String(candidate[column] ?? "") >= value,
        );
        return builder;
      },
      or: (expression: string) => {
        const arms = expression.split(",").map(armPredicate);
        predicates.push((candidate) => arms.some((arm) => arm(candidate)));
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        sort = { column, ascending: options?.ascending !== false };
        return builder;
      },
      limit: (count: number) => {
        cap = count;
        return builder;
      },
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      then: <T>(resolve: (result: { data: Row[]; error: null }) => T) =>
        Promise.resolve({ data: matching(), error: null }).then(resolve),
    };
    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "founding-owner";
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

/** What complete_founding_agency_purchase writes (20260925110000:98-102). */
function foundingGrant(overrides: Row = {}): Row {
  return {
    user_id: OWNER,
    plan_id: "agency",
    source: "lifetime_purchase",
    stripe_payment_intent_id: "pi_founding_1",
    granted_at: at(-10),
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function agencySubscription(status: string): Row {
  return {
    user_id: OWNER,
    plan: "agency",
    status,
    created_at: at(-40),
    current_period_start: at(-5),
    current_period_end: at(25),
  };
}

const AGENCY_EXCEPT_CREDITS = {
  websites: 10,
  collaborators: -1,
  aiFeatures: true,
  translations: -1,
  abTesting: true,
};

async function allowanceOf(userId = OWNER) {
  const client = payerClient();
  const entitlement = await resolveEntitlement(client, userId);
  const balance = await getUserCreditBalance(userId, client);
  return { entitlement, balance };
}

beforeEach(() => {
  clearPlanCatalogueCache();
  catalogueRows = catalogue(FOUNDING_LIMITS_AFTER);
  db = {
    plan_entitlements: [],
    billing_subscriptions: [],
    credit_purchases: [],
    credit_usage: [],
  };
});

// ---------------------------------------------------------------------------

describe("lifetime Founding Agency allowance", () => {
  it("reads the rows these tests rely on out of the migrations", () => {
    expect(AGENCY_LIMITS.monthly_credits).toBe(1000);
    expect(FOUNDING_LIMITS_BEFORE).toEqual({});
    expect(FOUNDING_LIMITS_AFTER).toEqual({ monthly_credits: 250 });
  });

  it("gives a lifetime owner every Agency limit and 250 monthly AI credits", async () => {
    db.plan_entitlements = [foundingGrant()];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.kind).toBe("plan");
    // Still `agency`: every Agency check (nav, offers, checkout) keys off it.
    expect(entitlement.planId).toBe("agency");
    expect(entitlement.plan?.limits).toEqual({
      ...AGENCY_EXCEPT_CREDITS,
      monthlyCredits: 250,
    });
    expect(balance).toEqual({
      included: 250,
      purchased: 0,
      total: 250,
      usedThisMonth: 0,
    });
  });

  it("keeps purchased credit packs spendable on top of the 250", async () => {
    db.plan_entitlements = [foundingGrant()];
    db.credit_purchases = [
      { user_id: OWNER, credits_remaining: 1000, expires_at: null },
    ];
    db.credit_usage = [{ user_id: OWNER, credits_used: 40, created_at: at(0) }];

    const { balance } = await allowanceOf();

    expect(balance).toEqual({
      included: 250,
      purchased: 1000,
      total: 210 + 1000,
      usedThisMonth: 40,
    });
  });

  it("leaves an Agency subscriber at 1,000", async () => {
    db.billing_subscriptions = [agencySubscription("active")];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe("agency");
    expect(entitlement.plan?.limits).toEqual({
      ...AGENCY_EXCEPT_CREDITS,
      monthlyCredits: 1000,
    });
    expect(balance.included).toBe(1000);
  });

  it("keeps 1,000 while an Agency subscription the buyer already paid for runs out, then 250", async () => {
    // The webhook cancels the subscription at period end, and the offer card
    // promises "You keep the period you have already paid for".
    db.plan_entitlements = [foundingGrant()];
    db.billing_subscriptions = [agencySubscription("active")];

    expect((await allowanceOf()).balance.included).toBe(1000);

    db.billing_subscriptions = [agencySubscription("canceled")];

    expect((await allowanceOf()).balance.included).toBe(250);
  });

  it("leaves an unpaid Agency comp at 1,000", async () => {
    db.plan_entitlements = [
      foundingGrant({ source: "support_comp", stripe_payment_intent_id: null }),
    ];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe("agency");
    expect(balance.included).toBe(1000);
  });

  it("keeps ADR 029 precedence: a newer Pro trial neither outranks the founding grant nor lifts it", async () => {
    db.plan_entitlements = [
      foundingGrant({ granted_at: at(-10) }),
      {
        user_id: OWNER,
        plan_id: "pro",
        source: "trial",
        stripe_payment_intent_id: null,
        granted_at: at(-1),
        expires_at: at(13),
        revoked_at: null,
      },
    ];

    const { entitlement } = await allowanceOf();

    expect(entitlement.planId).toBe("agency");
    expect(entitlement.plan?.limits.monthlyCredits).toBe(250);
  });

  it("leaves a Lifetime Pro owner at Pro's 500", async () => {
    db.plan_entitlements = [
      foundingGrant({ plan_id: "pro", stripe_payment_intent_id: "pi_pro_1" }),
    ];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe("pro");
    expect(balance.included).toBe(500);
  });

  it("gives an owner 1,000 until the migration is applied, so either deploy order is safe", async () => {
    catalogueRows = catalogue(FOUNDING_LIMITS_BEFORE);
    db.plan_entitlements = [foundingGrant()];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe("agency");
    expect(balance.included).toBe(1000);
  });
});
