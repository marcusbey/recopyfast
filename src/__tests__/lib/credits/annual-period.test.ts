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
    let ordering: { column: string; ascending: boolean } | null = null;
    let rowLimit: number | null = null;

    const rows = (): Row[] => db[table] ?? [];
    const run = (): RowsResult => {
      let data = rows().filter((row) =>
        predicates.every((predicate) => predicate(row)),
      );

      if (ordering) {
        const { column, ascending } = ordering;
        data = [...data].sort((left, right) => {
          const comparison = String(left[column] ?? "").localeCompare(
            String(right[column] ?? ""),
          );
          return ascending ? comparison : -comparison;
        });
      }

      if (rowLimit !== null) {
        data = data.slice(0, rowLimit);
      }

      return { data, error: null };
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: readonly unknown[]) => {
        predicates.push((row) => values.includes(row[column]));
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
      order: (column: string, options?: { ascending?: boolean }) => {
        ordering = { column, ascending: options?.ascending ?? true };
        return builder;
      },
      limit: (count: number) => {
        rowLimit = count;
        return builder;
      },
      maybeSingle: async () => {
        const { data } = run();
        return data && data.length > 1
          ? {
              data: null,
              error: {
                message: "JSON object requested, multiple rows returned",
              },
            }
          : { data: data?.[0] ?? null, error: null };
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

import { LIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/effective-plan";
import { getUserCreditBalance } from "@/lib/credits/system";

const USER_ID = "user-1";

function monthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString();
}

function subscription(
  periodStart: string,
  status = "active",
  options: { periodEnd?: string; createdAt?: string } = {},
): Row {
  const defaultPeriodEnd = new Date(periodStart);
  defaultPeriodEnd.setUTCFullYear(defaultPeriodEnd.getUTCFullYear() + 1);

  return {
    id: "row_1",
    user_id: USER_ID,
    status,
    plan: "pro",
    current_period_start: periodStart,
    current_period_end: options.periodEnd ?? defaultPeriodEnd.toISOString(),
    created_at: options.createdAt ?? periodStart,
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
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-24T15:30:00.000Z"));
    jest.clearAllMocks();
    db = {
      billing_subscriptions: [],
      credit_usage: [],
      credit_purchases: [],
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Guard for the former expected-failure assertion below. An expected failure
   * passes on ANY failure, including a broken mock or a fixture the query never
   * matches, so the audit marker needs a sibling proving the read really
   * happened. Here: the plan's allowance and the purchased pot both resolve,
   * so a wrong `total` can only come from the usage window. True on both sides
   * of the fix.
   */
  it("guard: the balance read resolves the plan allowance for the same fixture", async () => {
    db.billing_subscriptions = [subscription(monthsAgo(11))];
    db.credit_usage = [usage(MONTHLY_CREDITS, monthsAgo(10))];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.included).toBe(MONTHLY_CREDITS);
    expect(balance.purchased).toBe(0);
  });

  test("an annual subscriber's allowance resets monthly, not once a year", async () => {
    // Eleven months into a yearly term, having spent the allowance ten months
    // ago. Ten monthly resets have been and gone.
    db.billing_subscriptions = [subscription(monthsAgo(11))];
    db.credit_usage = [usage(MONTHLY_CREDITS, monthsAgo(10))];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.included).toBe(MONTHLY_CREDITS);
    expect(balance.usedThisMonth).toBe(0);
    expect(balance.total).toBe(MONTHLY_CREDITS);
  });

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

  test("spend from earlier months does not eat into this month's allowance", async () => {
    db.billing_subscriptions = [subscription(monthsAgo(11))];
    db.credit_usage = [
      usage(MONTHLY_CREDITS, monthsAgo(10)),
      usage(100, new Date().toISOString()),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(100);
    expect(balance.total).toBe(MONTHLY_CREDITS - 100);
  });

  /**
   * Fix-stable: the monthly subscriber is correct today and stays correct.
   */
  it("counts a monthly subscriber's spend inside the current period", async () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const nextMonth = new Date(fiveDaysAgo);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

    db.billing_subscriptions = [
      subscription(fiveDaysAgo.toISOString(), "active", {
        periodEnd: nextMonth.toISOString(),
      }),
    ];
    db.credit_usage = [usage(200, new Date().toISOString())];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(200);
    expect(balance.total).toBe(MONTHLY_CREDITS - 200);
  });

  it("keeps the February 28 Stripe period as the window until a March 31 renewal", async () => {
    jest.setSystemTime(new Date("2025-03-29T12:00:00.000Z"));
    db.billing_subscriptions = [
      subscription("2025-02-28T10:00:00.000Z", "active", {
        periodEnd: "2025-03-31T10:00:00.000Z",
      }),
    ];
    db.credit_usage = [
      usage(175, "2025-03-01T10:00:00.000Z"),
      usage(40, "2025-03-29T11:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(215);
    expect(balance.total).toBe(MONTHLY_CREDITS - 215);
  });

  it("keeps the April 30 Stripe period as the window until a May 31 renewal", async () => {
    jest.setSystemTime(new Date("2025-05-30T12:00:00.000Z"));
    db.billing_subscriptions = [
      subscription("2025-04-30T10:00:00.000Z", "active", {
        periodEnd: "2025-05-31T10:00:00.000Z",
      }),
    ];
    db.credit_usage = [
      usage(125, "2025-05-01T10:00:00.000Z"),
      usage(25, "2025-05-30T11:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(150);
    expect(balance.total).toBe(MONTHLY_CREDITS - 150);
  });

  it("uses the newest live subscription row for the allowance window", async () => {
    jest.setSystemTime(new Date("2025-05-30T12:00:00.000Z"));
    db.billing_subscriptions = [
      subscription("2024-06-01T00:00:00.000Z", "past_due", {
        periodEnd: "2025-06-01T00:00:00.000Z",
        createdAt: "2024-06-01T00:00:00.000Z",
      }),
      subscription("2025-04-30T10:00:00.000Z", "active", {
        periodEnd: "2025-05-31T10:00:00.000Z",
        createdAt: "2025-04-30T10:00:00.000Z",
      }),
    ];
    db.credit_usage = [
      // The newest monthly row starts on April 30, while the older annual row
      // steps to May 1. This charge makes choosing the wrong row observable.
      usage(200, "2025-04-30T11:00:00.000Z"),
      usage(75, "2025-05-01T00:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(275);
    expect(balance.total).toBe(MONTHLY_CREDITS - 275);
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

  it.each(LIVE_SUBSCRIPTION_STATUSES)(
    "uses the monthly allowance window for a %s subscription",
    async (status) => {
      db.billing_subscriptions = [
        subscription("2025-10-15T08:45:30.250Z", status),
      ];
      db.credit_usage = [
        usage(MONTHLY_CREDITS, "2026-09-10T08:45:30.250Z"),
        usage(75, "2026-09-24T15:29:59.999Z"),
      ];

      const balance = await getUserCreditBalance(USER_ID);

      expect(balance.usedThisMonth).toBe(75);
      expect(balance.total).toBe(MONTHLY_CREDITS - 75);
    },
  );

  it("clamps a January 31 anchor to February month-end without losing its UTC timestamp", async () => {
    jest.setSystemTime(new Date("2025-02-28T10:15:30.250Z"));
    db.billing_subscriptions = [subscription("2025-01-31T10:15:30.250Z")];
    db.credit_usage = [
      usage(300, "2025-02-28T10:15:30.249Z"),
      usage(125, "2025-02-28T10:15:30.250Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(125);
    expect(balance.total).toBe(MONTHLY_CREDITS - 125);
  });

  it("clamps a January 31 anchor to February 29 in a leap year", async () => {
    jest.setSystemTime(new Date("2024-02-29T10:15:30.250Z"));
    db.billing_subscriptions = [subscription("2024-01-31T10:15:30.250Z")];
    db.credit_usage = [
      usage(300, "2024-02-29T10:15:30.249Z"),
      usage(80, "2024-02-29T10:15:30.250Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(80);
    expect(balance.total).toBe(MONTHLY_CREDITS - 80);
  });

  it("restores the original day after a clamped month and includes the exact boundary", async () => {
    jest.setSystemTime(new Date("2025-03-31T10:15:30.250Z"));
    db.billing_subscriptions = [subscription("2025-01-31T10:15:30.250Z")];
    db.credit_usage = [
      usage(210, "2025-03-31T10:15:30.249Z"),
      usage(90, "2025-03-31T10:15:30.250Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(90);
    expect(balance.total).toBe(MONTHLY_CREDITS - 90);
  });

  it("keeps the previous clamped window before the original anchored day arrives", async () => {
    jest.setSystemTime(new Date("2025-03-30T12:00:00.000Z"));
    db.billing_subscriptions = [subscription("2025-01-31T10:15:30.250Z")];
    db.credit_usage = [
      usage(300, "2025-02-28T10:15:30.249Z"),
      usage(60, "2025-02-28T10:15:30.250Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(60);
    expect(balance.total).toBe(MONTHLY_CREDITS - 60);
  });
});
