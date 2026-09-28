/**
 * s48 — "Total purchased" counts paid credits only.
 *
 * Before s48 every AI refund minted a `credit_purchases` row
 * (`refund_<reason>_<user>_…`, price 0), and `getCreditWallet` summed
 * `credits_purchased` over every row — so each failed suggestion added a credit
 * to what the dashboard called "Total purchased". Refunds no longer write rows;
 * legacy ones stay spendable (nobody can tell which of them made up for paid
 * credits) but stop counting as purchases.
 *
 * And because a refund now lowers the charge's net `credits_used`, a fully
 * refunded request is a usage row at 0: the history must not show it as a
 * zero-credit consumption.
 */

type Row = Record<string, unknown>;

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

function client() {
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

  return { from };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => client()),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => {
    throw new Error("the dashboard reads run as the signed-in user");
  }),
}));

// A credit holder: no plan, so no allowance. Not the code under test.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(async () => ({
    kind: "credits",
    planId: null,
    plan: null,
  })),
}));

import {
  getCreditTransactions,
  getCreditWallet,
  getUserCreditBalance,
} from "@/lib/credits/system";

const USER = "wallet-user";

function purchase(overrides: Row): Row {
  return {
    id: `cp_${String(overrides.stripe_payment_intent_id ?? "null")}`,
    user_id: USER,
    credits_purchased: 1,
    credits_remaining: 1,
    price_cents: 0,
    stripe_payment_intent_id: null,
    expires_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const PAID_PACK = purchase({
  credits_purchased: 1000,
  credits_remaining: 400,
  price_cents: 1900,
  stripe_payment_intent_id: "pi_3PaidPack",
});
/** 20260802020000_…sql:119-130 carried paid wallets over at price 0. */
const MIGRATED_WALLET = purchase({
  credits_purchased: 50,
  credits_remaining: 50,
  stripe_payment_intent_id: `migrated_wallet_${USER}`,
});
const NO_INTENT = purchase({ credits_purchased: 20, credits_remaining: 20 });
/** What the pre-s48 owner-keyed refund wrote. */
const LEGACY_REFUND = purchase({
  credits_purchased: 1,
  credits_remaining: 1,
  stripe_payment_intent_id: `refund_ai_suggestion_failed_${USER}_4b1c9e0a-0000-4000-8000-000000000000_1790000000000`,
});

beforeEach(() => {
  db = {
    billing_subscriptions: [],
    plan_entitlements: [],
    credit_purchases: [PAID_PACK, MIGRATED_WALLET, NO_INTENT, LEGACY_REFUND],
    credit_usage: [],
  };
});

describe("paid totals (s48)", () => {
  it("totalPurchased counts packs and migrated wallets, not legacy refund_ rows", async () => {
    const wallet = await getCreditWallet(USER);

    expect(wallet.totalPurchased).toBe(1000 + 50 + 20);
  });

  it("transaction history omits fully refunded usage rows and shows partial ones at their net", async () => {
    db.credit_purchases = [];
    db.credit_usage = [
      {
        id: "u_refunded",
        user_id: USER,
        credits_used: 0,
        credits_refunded: 1,
        operation: "ai_suggestion",
        created_at: "2026-09-03T00:00:00.000Z",
      },
      {
        id: "u_partial",
        user_id: USER,
        credits_used: 3,
        credits_refunded: 2,
        operation: "translation",
        created_at: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "u_kept",
        user_id: USER,
        credits_used: 1,
        credits_refunded: 0,
        operation: "ai_suggestion",
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ];

    const history = await getCreditTransactions(USER);

    expect(
      history.map((entry) => ({ id: entry.id, amount: entry.amount })),
    ).toEqual([
      { id: "u_partial", amount: 3 },
      { id: "u_kept", amount: 1 },
    ]);
  });

  it("the spendable balance still includes legacy refund_ rows", async () => {
    // Spendable is not the same question as paid: a legacy row may have made
    // up for paid credits, and zeroing it could take away value someone paid
    // for. It stays spendable; it just stops counting as a purchase.
    const balance = await getUserCreditBalance(USER);

    expect(balance.purchased).toBe(400 + 50 + 20 + 1);
  });
});
