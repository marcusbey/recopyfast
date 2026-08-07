/**
 * A-19 — annual subscribers get 500 credits per year, not per month.
 *
 * `src/lib/credits/system.ts:128-144` takes the subscription's
 * `current_period_start` as the usage window. For a yearly plan that is twelve
 * months back, while `monthly_credits: 500`
 * (`20260802000000_plans_catalog.sql:295`) is defined per month — the local is
 * even called `usedThisMonth`. An annual Pro customer pays ~$189 up front and
 * gets one twelfth of the advertised allowance, then is told to buy credit
 * packs. Extends B-2.
 *
 * Assertions are on `getUserCreditBalance`'s output for a real fixture rather
 * than on arithmetic reproduced in the test, which is what
 * `src/__tests__/lib/credits/system.test.ts` does and why it cannot see this.
 */

type Row = Record<string, unknown>;
type FakeError = { message: string };
type RowsResult = { data: Row[] | null; error: FakeError | null };

let db: Record<string, Row[]> = {};

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];

    const rows = (): Row[] => db[table] ?? [];
    const run = (): RowsResult => ({
      data: rows().filter((row) =>
        predicates.every((predicate) => predicate(row)),
      ),
      error: null,
    });

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      gt: (column: string, value: number) => {
        predicates.push((row) => Number(row[column] ?? 0) > value);
        return builder;
      },
      gte: (column: string, value: string) => {
        predicates.push((row) => String(row[column] ?? "") >= value);
        return builder;
      },
      // spendableFilter(): the fixtures use `expires_at: null`.
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const { data } = run();
        return { data: data?.[0] ?? null, error: null };
      },
      then: <T>(
        resolve: (result: RowsResult) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };

    return builder;
  };

  return { from };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => createFakeClient()),
}));

const MONTHLY_CREDITS = 500;

// The plan's allowance comes from the catalogue; the window is what is under
// test here, so the plan is fixed rather than loaded.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(async () => ({
    kind: "plan",
    plan: { id: "pro", limits: { monthlyCredits: 500 } },
  })),
}));

import { getUserCreditBalance } from "@/lib/credits/system";

const USER_ID = "user-1";

function monthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString();
}

function subscription(periodStart: string): Row {
  return {
    id: "row_1",
    user_id: USER_ID,
    status: "active",
    plan: "pro",
    current_period_start: periodStart,
  };
}

function usage(credits: number, createdAt: string): Row {
  return {
    id: `usage_${createdAt}`,
    user_id: USER_ID,
    credits_used: credits,
    operation: "ai_translation",
    created_at: createdAt,
  };
}

describe("A-19: the included-credit window for an annual subscriber", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db = {
      billing_subscriptions: [],
      credit_usage: [],
      credit_purchases: [],
    };
  });

  /**
   * Guard for the `test.failing` below. `test.failing` passes on ANY failure,
   * including a broken mock or a fixture the query never matches, so each
   * marker needs a sibling proving the read really happened. Here: the plan's
   * allowance and the purchased pot both resolve, so a wrong `total` can only
   * come from the usage window. True on both sides of the fix.
   */
  it("guard: the balance read resolves the plan allowance for the same fixture", async () => {
    db.billing_subscriptions = [subscription(monthsAgo(11))];
    db.credit_usage = [usage(MONTHLY_CREDITS, monthsAgo(10))];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.included).toBe(MONTHLY_CREDITS);
    expect(balance.purchased).toBe(0);
  });

  test.failing(
    "an annual subscriber's allowance resets monthly, not once a year",
    async () => {
      // Eleven months into a yearly term, having spent the allowance ten months
      // ago. Ten monthly resets have been and gone.
      db.billing_subscriptions = [subscription(monthsAgo(11))];
      db.credit_usage = [usage(MONTHLY_CREDITS, monthsAgo(10))];

      const balance = await getUserCreditBalance(USER_ID);

      expect(balance.included).toBe(MONTHLY_CREDITS);
      expect(balance.usedThisMonth).toBe(0);
      expect(balance.total).toBe(MONTHLY_CREDITS);
    },
  );

  it("guard: both usage rows are visible to the balance read", async () => {
    db.billing_subscriptions = [subscription(monthsAgo(11))];
    db.credit_usage = [
      usage(MONTHLY_CREDITS, monthsAgo(10)),
      usage(100, new Date().toISOString()),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    // 600 is both rows counted — the window is wrong, but nothing is missing.
    // A fixture the query could not see would read 0 and the failing case
    // below would be meaningless.
    expect(balance.usedThisMonth).toBeGreaterThanOrEqual(100);
  });

  test.failing(
    "spend from earlier months does not eat into this month's allowance",
    async () => {
      db.billing_subscriptions = [subscription(monthsAgo(11))];
      db.credit_usage = [
        usage(MONTHLY_CREDITS, monthsAgo(10)),
        usage(100, new Date().toISOString()),
      ];

      const balance = await getUserCreditBalance(USER_ID);

      expect(balance.usedThisMonth).toBe(100);
      expect(balance.total).toBe(MONTHLY_CREDITS - 100);
    },
  );

  /**
   * Fix-stable: the monthly subscriber is correct today and stays correct.
   */
  it("counts a monthly subscriber's spend inside the current period", async () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    db.billing_subscriptions = [subscription(fiveDaysAgo.toISOString())];
    db.credit_usage = [usage(200, new Date().toISOString())];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(200);
    expect(balance.total).toBe(MONTHLY_CREDITS - 200);
  });

  it("falls back to the calendar month when there is no subscription", async () => {
    db.credit_usage = [
      usage(MONTHLY_CREDITS, monthsAgo(3)),
      usage(50, new Date().toISOString()),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(50);
    expect(balance.total).toBe(MONTHLY_CREDITS - 50);
  });

  it("adds purchased credits on top of whatever the window says", async () => {
    db.billing_subscriptions = [subscription(monthsAgo(11))];
    db.credit_usage = [usage(MONTHLY_CREDITS, monthsAgo(10))];
    db.credit_purchases = [
      {
        id: "cp_1",
        user_id: USER_ID,
        credits_purchased: 1000,
        credits_remaining: 1000,
        expires_at: null,
      },
    ];

    const balance = await getUserCreditBalance(USER_ID);

    // True on both sides of the fix: purchased credits are a separate pot and
    // are never touched by the included-allowance window.
    expect(balance.purchased).toBe(1000);
    expect(balance.total).toBeGreaterThanOrEqual(1000);
  });
});
