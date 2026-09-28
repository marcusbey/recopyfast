/**
 * s48 — probe P3: a refunded failure must not keep a lapsed trial past the
 * paywall.
 *
 * Before s48 every AI refund minted a never-expiring `credit_purchases` row
 * (`stripe_payment_intent_id` = `refund_<reason>_<user>_…`, price 0). Any
 * positive purchased balance entitles its holder (`kind: "credits"`), so a
 * trial that lapsed without paying, with one refunded failure, passed the
 * middleware; the control account resolved to `none`
 * (`.omx/qa-20260927/credits-probes-results.txt`, P3).
 *
 * s48 fixes it forward: refunds no longer write rows (`refund_credit_usage`),
 * and legacy `refund_` rows — which stay spendable, since nobody can tell which
 * of them made up for purchased credits — stop counting as an entitlement.
 *
 * Everything that decides the answer is shipped code: `resolveEntitlement` and
 * `spendable.ts`. Only the database is a double, one that applies its filters
 * the way PostgREST does (template: lifetime-agency-allowance.test.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

// A lapsed account holds no live plan, so the catalogue is never consulted.
jest.mock("@/lib/stripe/plans", () => ({
  findPlanById: jest.fn(async () => null),
  findPurchasedPlanById: jest.fn(async () => null),
}));

import { resolveEntitlement } from "@/lib/billing/effective-plan";

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

function client(): SupabaseClient {
  const from = (table: string) => {
    const predicates: Array<(candidate: Row) => boolean> = [];
    let cap: number | null = null;

    const matching = (): Row[] => {
      const selected = (db[table] ?? []).filter((candidate) =>
        predicates.every((predicate) => predicate(candidate)),
      );
      return cap === null ? selected : selected.slice(0, cap);
    };

    const builder = {
      select: () => builder,
      returns: () => builder,
      order: () => builder,
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
      or: (expression: string) => {
        const arms = expression.split(",").map(armPredicate);
        predicates.push((candidate) => arms.some((arm) => arm(candidate)));
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

const USER = "lapsed-trial-user";
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

/** What grantTrialEntitlement writes, fourteen days after it lapsed. */
function lapsedTrial(): Row {
  return {
    user_id: USER,
    plan_id: "pro",
    source: "trial",
    stripe_payment_intent_id: null,
    granted_at: at(-15),
    expires_at: at(-1),
    revoked_at: null,
  };
}

function purchaseRow(overrides: Row): Row {
  return {
    user_id: USER,
    credits_purchased: 1,
    credits_remaining: 1,
    price_cents: 0,
    stripe_payment_intent_id: null,
    expires_at: null,
    created_at: at(-3),
    ...overrides,
  };
}

/** The row the pre-s48 owner-keyed refund wrote (`refund_${reason}_…`). */
const LEGACY_REFUND = purchaseRow({
  stripe_payment_intent_id: `refund_ai_suggestion_failed_${USER}_4b1c9e0a-0000-4000-8000-000000000000_1790000000000`,
});

const PAID_PACK = purchaseRow({
  credits_purchased: 1000,
  credits_remaining: 400,
  price_cents: 1900,
  stripe_payment_intent_id: "pi_3PaidPack",
});

/** 20260802020000_…sql:119-130 carried paid wallets over at price 0. */
const MIGRATED_WALLET = purchaseRow({
  credits_purchased: 50,
  credits_remaining: 50,
  stripe_payment_intent_id: `migrated_wallet_${USER}`,
});

beforeEach(() => {
  db = {
    plan_entitlements: [lapsedTrial()],
    billing_subscriptions: [],
    credit_purchases: [],
    credit_usage: [],
  };
});

describe("P3: a lapsed trial with a refunded AI failure", () => {
  it("P3 legacy: a lapsed trial holding only a legacy refund_ credit resolves to none", async () => {
    db.credit_purchases = [LEGACY_REFUND];

    const entitlement = await resolveEntitlement(client(), USER);

    expect(entitlement.kind).toBe("none");
  });

  it("P3: a lapsed trial whose failed charge was refunded to its allowance resolves to none", async () => {
    // What credit-spend.test.ts's P3 case leaves behind: the trial has
    // expired, the refunded charge is a usage row at net 0, and no purchase
    // row was ever written.
    db.credit_usage = [
      {
        user_id: USER,
        credits_used: 0,
        credits_refunded: 1,
        credits_from_purchased: 0,
        purchase_debits: [],
        operation: "ai_suggestion",
        created_at: at(-5),
      },
    ];

    const entitlement = await resolveEntitlement(client(), USER);

    expect(entitlement.kind).toBe("none");
  });

  it("a paid pack still resolves to credits", async () => {
    db.credit_purchases = [PAID_PACK];

    expect((await resolveEntitlement(client(), USER)).kind).toBe("credits");
  });

  it("a migrated_wallet_ row with price 0 still resolves to credits", async () => {
    // Why the predicate is keyed on the `refund_` prefix and never on
    // price_cents = 0: these wallets were paid for, and are recorded at 0.
    db.credit_purchases = [MIGRATED_WALLET];

    expect((await resolveEntitlement(client(), USER)).kind).toBe("credits");
  });

  it("a row with a NULL payment intent still resolves to credits", async () => {
    db.credit_purchases = [purchaseRow({ credits_remaining: 7 })];

    expect((await resolveEntitlement(client(), USER)).kind).toBe("credits");
  });

  it("a paid pack plus a legacy refund row resolves to credits", async () => {
    db.credit_purchases = [LEGACY_REFUND, PAID_PACK];

    expect((await resolveEntitlement(client(), USER)).kind).toBe("credits");
  });
});
