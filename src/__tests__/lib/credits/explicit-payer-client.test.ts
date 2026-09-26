/**
 * s40 — billing can charge an explicit payer through an explicit client.
 *
 * `POST /api/ai/suggest` is called by the widget on a customer's origin. It has
 * no cookie session, so every billing function that built its own cookie client
 * resolved the owner's plan as "none" and refused the spend, even after the
 * editor had been authorised. The route now authorises the editor, resolves
 * the site owner, and hands these functions a service-role client for THAT
 * payer.
 *
 * What these tests hold the explicit path to:
 *   - every read and write of the call goes through the client it was given,
 *   - the cookie client (`createClient`) is never opened,
 *   - the cookie-bound `getEffectivePlan` is never consulted — the entitlement
 *     is resolved with `resolveEntitlement(client, …)` against the same rows.
 *
 * `createClient`, `getEffectivePlan` and `createServiceRoleClient` all throw if
 * touched, so a path that quietly falls back to one of them fails loudly here
 * rather than silently reading the wrong wallet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type RowsResult = { data: Row[] | null; error: { message: string } | null };

interface RecordedOp {
  table: string;
  operation: "select" | "insert" | "update";
  values?: Row;
  filters: Array<[string, unknown]>;
}

let db: Record<string, Row[]> = {};
let ops: RecordedOp[] = [];

/**
 * The builder shape of `concurrency.test.ts`, plus the few links the
 * entitlement reads use (`is`, `returns`), and a log of every operation so a
 * test can assert what went through THIS client.
 */
function createRecordingClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    const op: RecordedOp = { table, operation: "select", filters: [] };

    const rows = (): Row[] => db[table] ?? [];
    const matched = (): Row[] =>
      rows().filter((row) => predicates.every((predicate) => predicate(row)));

    const run = (): RowsResult => {
      ops.push(op);
      switch (op.operation) {
        case "insert": {
          const stored = { created_at: new Date().toISOString(), ...op.values };
          db[table] = [...rows(), stored];
          return { data: [stored], error: null };
        }
        case "update": {
          const hits = matched();
          db[table] = rows().map((row) =>
            hits.includes(row) ? { ...row, ...op.values } : row,
          );
          return {
            data: hits.map((row) => ({ ...row, ...op.values })),
            error: null,
          };
        }
        default:
          return { data: matched(), error: null };
      }
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        predicates.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        predicates.push((row) => (row[column] ?? null) === value);
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
      // spendableFilter(): every fixture row here has `expires_at: null` or a
      // future date, which that filter accepts.
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      returns: () => builder,
      insert: (payload: Row) => {
        op.operation = "insert";
        op.values = payload;
        return builder;
      },
      update: (payload: Row) => {
        op.operation = "update";
        op.values = payload;
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      then: <T>(
        resolve: (result: RowsResult) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };

    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error(
      "the cookie client must not be opened for an explicit payer",
    );
  }),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => {
    throw new Error("no second client may be opened for an explicit payer");
  }),
}));

// Mocked the way the existing billing suites mock it: the resolution is
// replaced, `hasAnyEntitlement` stays the real predicate. Here the resolution
// THROWS, because the explicit path must not reach it at all.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(() => {
    throw new Error(
      "getEffectivePlan reads the caller's cookie, not the payer",
    );
  }),
  hasAnyEntitlement: jest.requireActual("@/lib/billing/effective-plan")
    .hasAnyEntitlement,
}));

// The catalogue, not the wallet: which plan ids exist and what they include.
// Fixed here so a gate regression cannot hide behind a seed change.
jest.mock("@/lib/stripe/plans", () => {
  const limits = (aiFeatures: boolean, monthlyCredits: number) => ({
    websites: 5,
    collaborators: 5,
    aiFeatures,
    translations: aiFeatures ? -1 : 0,
    abTesting: aiFeatures,
    monthlyCredits,
  });
  const catalogue: Record<string, unknown> = {
    starter: { id: "starter", name: "Starter", limits: limits(false, 0) },
    pro: { id: "pro", name: "Pro", limits: limits(true, 500) },
  };
  return {
    findPlanById: jest.fn(async (planId: string) => catalogue[planId] ?? null),
  };
});

import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { getUserCreditBalance } from "@/lib/credits/system";
import {
  canUseAIFeatures,
  consumeFeatureUsage,
} from "@/lib/feature-gating/permissions";

const OWNER = "owner-1";

function subscription(plan: string): Row {
  return {
    id: "sub_1",
    user_id: OWNER,
    plan,
    status: "active",
    current_period_start: "2000-01-01T00:00:00.000Z",
    current_period_end: "2000-01-31T00:00:00.000Z",
    created_at: "2000-01-01T00:00:00.000Z",
  };
}

function purchase(credits: number): Row {
  return {
    id: "cp_1",
    user_id: OWNER,
    credits_purchased: credits,
    credits_remaining: credits,
    expires_at: null,
    created_at: "2000-01-01T00:00:00.000Z",
  };
}

/**
 * A usage row stamped "now". The subscription fixture's period is a single
 * month in 2000, so the allowance window starts at its `current_period_start`
 * and every row made here counts against this period's allowance.
 */
function usage(credits: number): Row {
  return {
    id: `usage_${credits}`,
    user_id: OWNER,
    credits_used: credits,
    operation: "ai_suggestion",
    created_at: new Date().toISOString(),
  };
}

function tablesTouched(): string[] {
  return Array.from(new Set(ops.map((op) => op.table)));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  ops = [];
  db = {
    billing_subscriptions: [],
    plan_entitlements: [],
    credit_purchases: [],
    credit_usage: [],
    usage_tracking: [],
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getUserCreditBalance with an explicit client", () => {
  it("reads the subscription, purchases, usage and trial grant through the client it was given", async () => {
    db.billing_subscriptions = [subscription("pro")];
    db.credit_purchases = [purchase(5)];
    db.credit_usage = [usage(20)];
    const client = createRecordingClient();

    const balance = await getUserCreditBalance(OWNER, client);

    expect(balance).toEqual({
      included: 500,
      purchased: 5,
      total: 485,
      usedThisMonth: 20,
    });
    expect(tablesTouched()).toEqual(
      expect.arrayContaining([
        "billing_subscriptions",
        "credit_purchases",
        "credit_usage",
        "plan_entitlements",
      ]),
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(getEffectivePlan).not.toHaveBeenCalled();
  });
});

describe("canUseAIFeatures with an explicit client", () => {
  it("denies a Starter owner with no purchased credits, with the gate's own sentence", async () => {
    db.billing_subscriptions = [subscription("starter")];
    const client = createRecordingClient();

    const permission = await canUseAIFeatures(OWNER, 1, client);

    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain("does not include AI credits");
    expect(createClient).not.toHaveBeenCalled();
    expect(getEffectivePlan).not.toHaveBeenCalled();
  });

  it("allows a Starter owner who has purchased credits — the balance decides", async () => {
    db.billing_subscriptions = [subscription("starter")];
    db.credit_purchases = [purchase(5)];
    const client = createRecordingClient();

    const permission = await canUseAIFeatures(OWNER, 1, client);

    expect(permission.allowed).toBe(true);
    expect(getEffectivePlan).not.toHaveBeenCalled();
  });

  it("refuses an owner with no entitlement at all", async () => {
    const client = createRecordingClient();

    const permission = await canUseAIFeatures(OWNER, 1, client);

    expect(permission).toEqual({
      allowed: false,
      reason: "This account has no active plan. Choose a plan to continue.",
      upgradeRequired: true,
    });
    expect(getEffectivePlan).not.toHaveBeenCalled();
  });
});

describe("consumeFeatureUsage with an explicit client", () => {
  it("charges the payer's included credits and records the usage through the client", async () => {
    db.billing_subscriptions = [subscription("pro")];
    const client = createRecordingClient();

    const result = await consumeFeatureUsage(
      OWNER,
      "ai_suggestion",
      { siteId: "site-1" },
      client,
    );

    expect(result).toEqual({ success: true });
    expect(db.credit_usage).toEqual([
      expect.objectContaining({
        user_id: OWNER,
        credits_used: 1,
        operation: "ai_suggestion",
      }),
    ]);
    expect(db.usage_tracking).toEqual([
      expect.objectContaining({
        user_id: OWNER,
        feature_type: "ai_suggestion",
        metadata: { siteId: "site-1", credits_used: 1 },
      }),
    ]);
    // Included credits cover it: no purchased pack is touched.
    expect(
      ops.filter(
        (op) => op.table === "credit_purchases" && op.operation === "update",
      ),
    ).toHaveLength(0);
    expect(createClient).not.toHaveBeenCalled();
    expect(getEffectivePlan).not.toHaveBeenCalled();
  });

  it("decrements purchased credits by compare-and-swap through the client once the allowance is spent", async () => {
    db.billing_subscriptions = [subscription("pro")];
    db.credit_usage = [usage(500)];
    db.credit_purchases = [purchase(5)];
    const client = createRecordingClient();

    const result = await consumeFeatureUsage(
      OWNER,
      "ai_suggestion",
      undefined,
      client,
    );

    expect(result).toEqual({ success: true });
    const deduction = ops.find(
      (op) => op.table === "credit_purchases" && op.operation === "update",
    );
    expect(deduction?.values).toEqual({ credits_remaining: 4 });
    // The compare half of compare-and-swap: the row is only written if it
    // still holds the balance that was read.
    expect(deduction?.filters).toEqual(
      expect.arrayContaining([
        ["id", "cp_1"],
        ["credits_remaining", 5],
      ]),
    );
    expect(db.credit_purchases?.[0]?.credits_remaining).toBe(4);
    expect(createClient).not.toHaveBeenCalled();
    expect(getEffectivePlan).not.toHaveBeenCalled();
  });
});
