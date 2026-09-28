/**
 * s47a — the founding offer includes 100 AI credits a month.
 *
 * The offer row is the account's one trial row, and a trial row resolves to
 * the full `pro` catalogue row: 500 credits. The offer's 100 applies only when
 * the offer is the ONLY thing conferring `pro` — every live `pro` grant is an
 * offer row and no live subscription bills `pro` — and even then it is a floor
 * over everything else the account holds (ADR 038's `withAllowanceFloor`),
 * never a ceiling on it.
 *
 * Same harness as lifetime-agency-allowance.test.ts: the shipped catalogue
 * parser, resolver and credit arithmetic over an in-memory database, with the
 * Agency and Founding Agency rows read out of the migrations.
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

import {
  readGrantedPlanIds,
  readTrialGrant,
  resolveEntitlement,
} from "@/lib/billing/effective-plan";
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
const FOUNDING_AGENCY_LIMITS = JSON.parse(
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

function catalogue(starterMonthlyCredits = 0): Row[] {
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
        monthly_credits: starterMonthlyCredits,
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
      limits: FOUNDING_AGENCY_LIMITS,
      grants_plan_id: "agency",
      sort_order: 45,
    }),
  ];
}

// ---------------------------------------------------------------------------
// The account's rows, behind a PostgREST-shaped double that filters for itself
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

function accountClient(): SupabaseClient {
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

const ACCOUNT = "founding-offer-account";
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

/** What claim_founding_offer_spot writes (20260928120000_founding_offer.sql). */
function offerRow(overrides: Row = {}): Row {
  return {
    user_id: ACCOUNT,
    plan_id: "pro",
    source: "trial",
    stripe_payment_intent_id: null,
    offer_id: "founding_20",
    granted_at: at(-10),
    expires_at: at(80),
    revoked_at: null,
    ...overrides,
  };
}

/** What grantTrialEntitlement writes: the same row, 14 days, no offer. */
const PLAIN_TRIAL = offerRow({ offer_id: null, expires_at: at(4) });

function purchase(planId: string, paymentIntent: string): Row {
  return {
    user_id: ACCOUNT,
    plan_id: planId,
    source: "lifetime_purchase",
    stripe_payment_intent_id: paymentIntent,
    offer_id: null,
    granted_at: at(-30),
    expires_at: null,
    revoked_at: null,
  };
}

function subscription(plan: string, status = "active"): Row {
  return {
    user_id: ACCOUNT,
    plan,
    status,
    created_at: at(-5),
    current_period_start: at(-5),
    current_period_end: at(25),
  };
}

const PRO_EXCEPT_CREDITS = {
  websites: 5,
  collaborators: 5,
  aiFeatures: true,
  translations: -1,
  abTesting: true,
};

async function allowanceOf() {
  const client = accountClient();
  const entitlement = await resolveEntitlement(client, ACCOUNT);
  const balance = await getUserCreditBalance(ACCOUNT, client);
  return { entitlement, balance };
}

beforeEach(() => {
  clearPlanCatalogueCache();
  catalogueRows = catalogue();
  db = {
    plan_entitlements: [],
    billing_subscriptions: [],
    credit_purchases: [],
    credit_usage: [],
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("the founding offer's allowance", () => {
  it("gives an offer-only account every Pro limit and 100 AI credits a month", async () => {
    const grant = offerRow();
    db.plan_entitlements = [grant];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.kind).toBe("plan");
    // Still `pro`: every gate and every Pro check keys off it.
    expect(entitlement.planId).toBe("pro");
    expect(entitlement.plan?.limits).toEqual({
      ...PRO_EXCEPT_CREDITS,
      monthlyCredits: 100,
    });
    expect(balance).toEqual({
      included: 100,
      purchased: 0,
      total: 100,
      usedThisMonth: 0,
      // s48's spend window: ten days in, still the grant's first month.
      windowStart: grant.granted_at,
    });
  });

  it("keeps the offer's 100 under a Starter subscription (the grant wins, ADR 029)", async () => {
    db.plan_entitlements = [offerRow()];
    db.billing_subscriptions = [subscription("starter")];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe("pro");
    expect(balance.included).toBe(100);
  });

  it("never lowers a higher allowance the account holds elsewhere", async () => {
    // Hypothetical catalogue: were Starter ever to include 300, a Starter
    // subscriber holding the offer keeps 300, not 100.
    catalogueRows = catalogue(300);
    db.plan_entitlements = [offerRow()];
    db.billing_subscriptions = [subscription("starter")];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe("pro");
    expect(balance.included).toBe(300);
  });

  it("stacks purchased credit packs on top of the 100", async () => {
    const grant = offerRow();
    db.plan_entitlements = [grant];
    db.credit_purchases = [
      { user_id: ACCOUNT, credits_remaining: 1000, expires_at: null },
    ];
    db.credit_usage = [
      { user_id: ACCOUNT, credits_used: 40, created_at: at(0) },
    ];

    const { balance } = await allowanceOf();

    expect(balance).toEqual({
      included: 100,
      purchased: 1000,
      total: 60 + 1000,
      usedThisMonth: 40,
      windowStart: grant.granted_at,
    });
  });

  it("logs and resolves as a plain trial when an offer row names an offer with no terms", async () => {
    // Unreachable while `offer_id` has a foreign key to founding_offers and
    // the terms cover every seeded id — which is exactly why it must not
    // silently pick a number if the two ever drift.
    jest.spyOn(console, "error").mockImplementation(() => {});
    db.plan_entitlements = [offerRow({ offer_id: "founding_99" })];

    const { entitlement } = await allowanceOf();

    expect(entitlement.planId).toBe("pro");
    expect(entitlement.plan?.limits.monthlyCredits).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("founding_99"),
    );
  });
});

describe("what the offer does not change", () => {
  it.each<{
    who: string;
    grants: Row[];
    subscriptions: Row[];
    planId: string;
    expected: number;
  }>([
    {
      who: "an offer account that starts a Pro subscription",
      grants: [offerRow()],
      subscriptions: [subscription("pro")],
      planId: "pro",
      expected: 500,
    },
    {
      who: "an offer account that buys Lifetime Pro",
      grants: [offerRow(), purchase("pro", "pi_lifetime_pro")],
      subscriptions: [],
      planId: "pro",
      expected: 500,
    },
    {
      who: "an offer account that starts an Agency subscription",
      grants: [offerRow()],
      subscriptions: [subscription("agency")],
      planId: "agency",
      expected: 1000,
    },
    {
      // The offer is a trial: it neither outranks the purchase nor lifts it.
      who: "an offer account that buys Founding Agency",
      grants: [offerRow(), purchase("agency", "pi_founding_agency")],
      subscriptions: [],
      planId: "agency",
      expected: 250,
    },
    {
      who: "a plain 14-day trial",
      grants: [PLAIN_TRIAL],
      subscriptions: [],
      planId: "pro",
      expected: 500,
    },
  ])("$who gets $planId with $expected", async (fixture) => {
    db.plan_entitlements = fixture.grants;
    db.billing_subscriptions = fixture.subscriptions;

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.planId).toBe(fixture.planId);
    expect(balance.included).toBe(fixture.expected);
  });

  it("lapses an expired offer to no plan at all", async () => {
    db.plan_entitlements = [
      offerRow({ granted_at: at(-91), expires_at: at(-1) }),
    ];

    const { entitlement, balance } = await allowanceOf();

    expect(entitlement.kind).toBe("none");
    expect(balance.included).toBe(0);
  });

  it("leaves an offer account's granted plans empty, so it can still buy Lifetime Pro", async () => {
    db.plan_entitlements = [offerRow()];

    await expect(readGrantedPlanIds(accountClient(), ACCOUNT)).resolves.toEqual(
      [],
    );
  });
});

describe("readTrialGrant and the offer (s47a)", () => {
  it("reports the founding offer a trial row was claimed under", async () => {
    const grant = offerRow();
    db.plan_entitlements = [grant];

    await expect(readTrialGrant(accountClient(), ACCOUNT)).resolves.toEqual({
      grantedAt: grant.granted_at,
      expiresAt: grant.expires_at,
      isActive: true,
      offerId: "founding_20",
    });
  });

  it("reports the offer on a lapsed offer row, which the lapsed copy needs", async () => {
    db.plan_entitlements = [
      offerRow({ granted_at: at(-91), expires_at: at(-1) }),
    ];

    await expect(
      readTrialGrant(accountClient(), ACCOUNT),
    ).resolves.toMatchObject({ isActive: false, offerId: "founding_20" });
  });

  it.each([
    ["a plain trial", null],
    ["an offer id it has no terms for", "founding_99"],
  ])("reports no offer for %s", async (_label, offerId) => {
    db.plan_entitlements = [offerRow({ offer_id: offerId })];

    const grant = await readTrialGrant(accountClient(), ACCOUNT);

    expect(grant).toMatchObject({ isActive: true });
    expect(grant).not.toHaveProperty("offerId");
  });
});
