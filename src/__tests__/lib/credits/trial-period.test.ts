/**
 * A trial's included AI allowance is granted once, for the whole trial.
 *
 * A trial resolves to `pro`, and `getUserCreditBalance` reads
 * `plan.limits.monthlyCredits` from the catalogue — so a trialling account gets
 * Pro's 500 credits without anyone granting anything. The defect is the window,
 * not the number: with no `billing_subscriptions` row the period start is the
 * start of the CALENDAR month, so a trial begun on the 25th draws 500 credits,
 * then 500 more on the 1st. That is 1,000 credits of OpenAI spend on a 14-day
 * card-less trial, which is the "never grants uncapped spend" half of AC 8
 * failing outright.
 *
 * The window has to come from the trial's own `granted_at` — one non-renewing
 * grant for fourteen days, whichever dates they happen to span. Assertions are
 * on `getUserCreditBalance`'s real output for a fixture, not on arithmetic
 * reproduced in the test, which is why `system.test.ts` cannot see this.
 */

type Row = Record<string, unknown>;
type RowsResult = { data: Row[] | null; error: { message: string } | null };

let db: Record<string, Row[]> = {};

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];

    const run = (): RowsResult => ({
      data: (db[table] ?? []).filter((row) =>
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
      // spendableFilter(): every fixture here has `expires_at: null`.
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

// The allowance comes from the catalogue; the window is what is under test, so
// the plan is fixed rather than loaded. A trial resolves to exactly this.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(async () => ({
    kind: "plan",
    planId: "pro",
    plan: { id: "pro", limits: { monthlyCredits: 500 } },
  })),
}));

import { getUserCreditBalance } from "@/lib/credits/system";

const USER_ID = "user-1";

/** Three days into September, with the trial started in August. */
const TODAY = new Date("2026-09-03T10:00:00.000Z");
const TRIAL_GRANTED_AT = "2026-08-25T09:00:00.000Z";
const TRIAL_EXPIRES_AT = "2026-09-08T09:00:00.000Z";

function trialRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "grant_1",
    user_id: USER_ID,
    plan_id: "pro",
    source: "trial",
    granted_at: TRIAL_GRANTED_AT,
    expires_at: TRIAL_EXPIRES_AT,
    revoked_at: null,
    ...overrides,
  };
}

function usage(credits: number, createdAt: string): Row {
  return {
    id: `usage_${createdAt}`,
    user_id: USER_ID,
    credits_used: credits,
    operation: "ai_suggestion",
    created_at: createdAt,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: TODAY });
  db = {
    plan_entitlements: [],
    billing_subscriptions: [],
    credit_usage: [],
    credit_purchases: [],
  };
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the included-credit window during a trial", () => {
  it("does not hand out a second allowance when the trial crosses a month boundary", async () => {
    db.plan_entitlements = [trialRow()];
    // Spent on 26 August — inside the trial, before the 1st of this month.
    db.credit_usage = [usage(400, "2026-08-26T12:00:00.000Z")];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(400);
    expect(balance.total).toBe(MONTHLY_CREDITS - 400);
  });

  it("caps total spend across the whole fourteen days at one allowance", async () => {
    db.plan_entitlements = [trialRow()];
    db.credit_usage = [
      usage(300, "2026-08-26T12:00:00.000Z"),
      usage(200, "2026-09-02T12:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(MONTHLY_CREDITS);
    // At zero, `canUseAIFeatures` denies — the "stops at zero" half of AC 8,
    // which needs no change of its own once the window is right.
    expect(balance.total).toBe(0);
  });

  it("ignores spend from before the trial started", async () => {
    // Credits bought and burned as a credit-only holder are not the trial's
    // problem; the window opens when the trial does.
    db.plan_entitlements = [trialRow()];
    db.credit_usage = [
      usage(450, "2026-08-01T12:00:00.000Z"),
      usage(50, "2026-08-30T12:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(50);
  });

  it("falls back to the calendar month once the trial has expired", async () => {
    db.plan_entitlements = [
      trialRow({
        granted_at: "2026-07-25T09:00:00.000Z",
        expires_at: "2026-08-08T09:00:00.000Z",
      }),
    ];
    db.credit_usage = [
      usage(400, "2026-08-01T12:00:00.000Z"),
      usage(20, "2026-09-02T12:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    // A lapsed trial must not pin the window open for ever after.
    expect(balance.usedThisMonth).toBe(20);
  });

  it("ignores a revoked trial's window", async () => {
    db.plan_entitlements = [
      trialRow({ revoked_at: "2026-08-27T09:00:00.000Z" }),
    ];
    db.credit_usage = [
      usage(400, "2026-08-26T12:00:00.000Z"),
      usage(30, "2026-09-02T12:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(30);
  });
});

describe("the included-credit window outside a trial", () => {
  it("leaves an account with no trial on the calendar month", async () => {
    // Regression guard: the fixture is identical to the first case above minus
    // the trial row, and must behave exactly as it did before this story.
    db.credit_usage = [usage(400, "2026-08-26T12:00:00.000Z")];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(0);
    expect(balance.total).toBe(MONTHLY_CREDITS);
  });

  it("keeps a subscriber's billing period ahead of any trial row", async () => {
    // Converting mid-trial hands the window back to the thing being billed.
    db.plan_entitlements = [trialRow()];
    db.billing_subscriptions = [
      {
        id: "sub_1",
        user_id: USER_ID,
        status: "active",
        plan: "pro",
        current_period_start: "2026-09-01T00:00:00.000Z",
      },
    ];
    db.credit_usage = [
      usage(400, "2026-08-26T12:00:00.000Z"),
      usage(10, "2026-09-02T12:00:00.000Z"),
    ];

    const balance = await getUserCreditBalance(USER_ID);

    expect(balance.usedThisMonth).toBe(10);
  });
});
