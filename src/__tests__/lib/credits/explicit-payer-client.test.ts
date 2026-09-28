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

interface RecordedRpc {
  name: string;
  args: Row;
}

let rpcs: RecordedRpc[] = [];

/** What `spend_credits` answers; the SQL itself is proved in credit-spend.test.ts. */
const CHARGED: Row = {
  outcome: "charged",
  usage_id: "usage-1",
  from_allowance: 1,
  from_purchased: 0,
  remaining: 499,
};

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

  const rpc = async (name: string, args: Row) => {
    rpcs.push({ name, args });
    return { data: [CHARGED], error: null };
  };

  return { from, rpc } as unknown as SupabaseClient;
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
  rpcs = [];
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
      // s48: the window the allowance was summed over, passed to spend_credits.
      windowStart: "2000-01-01T00:00:00.000Z",
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
  it("charges through spend_credits on the payer client with the allowance and window it computed", async () => {
    db.billing_subscriptions = [subscription("pro")];
    const client = createRecordingClient();

    const result = await consumeFeatureUsage(
      OWNER,
      "ai_suggestion",
      { siteId: "site-1" },
      client,
    );

    // The whole charge is one database function (s48): the allowance and the
    // window are the TypeScript half, computed here and passed in, so no plan
    // or window rule is copied into SQL (ADR 035, ADR 040).
    expect(rpcs).toEqual([
      {
        name: "spend_credits",
        args: {
          p_user_id: OWNER,
          p_credits: 1,
          p_included: 500,
          p_window_start: "2000-01-01T00:00:00.000Z",
          p_operation: "ai_suggestion",
          p_metadata: { siteId: "site-1" },
        },
      },
    ]);
    // The P4 loss was TypeScript writing the wallet row by row. It writes
    // neither table any more.
    expect(
      ops.filter(
        (op) =>
          (op.table === "credit_purchases" || op.table === "credit_usage") &&
          op.operation !== "select",
      ),
    ).toEqual([]);
    expect(db.usage_tracking).toEqual([
      expect.objectContaining({
        user_id: OWNER,
        feature_type: "ai_suggestion",
        metadata: { siteId: "site-1", credits_used: 1 },
      }),
    ]);
    expect(createClient).not.toHaveBeenCalled();
    expect(getEffectivePlan).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      charge: { usageId: "usage-1", userId: OWNER, credits: 1 },
    });
  });

  it("passes a live trial's granted_at, and the calendar month for a credits-only wallet, as the window", async () => {
    const grantedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    db.plan_entitlements = [
      {
        user_id: OWNER,
        plan_id: "pro",
        source: "trial",
        stripe_payment_intent_id: null,
        granted_at: grantedAt,
        expires_at: new Date(Date.now() + 12 * 86_400_000).toISOString(),
        revoked_at: null,
      },
    ];

    await consumeFeatureUsage(
      OWNER,
      "ai_suggestion",
      undefined,
      createRecordingClient(),
    );

    expect(rpcs[0]?.args).toMatchObject({
      p_included: 500,
      p_window_start: grantedAt,
    });

    rpcs = [];
    db.plan_entitlements = [];
    db.credit_purchases = [purchase(5)];

    await consumeFeatureUsage(
      OWNER,
      "ai_suggestion",
      undefined,
      createRecordingClient(),
    );

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    expect(rpcs[0]?.args).toMatchObject({
      p_included: 0,
      p_window_start: startOfMonth.toISOString(),
    });
  });
});
