/**
 * A-18 — credit deduction is a lost update, and the ledger is written first.
 *
 * The invariant is conservation:
 *
 *     spendable balance + recorded usage === starting balance
 *
 * History. A-18 found a read-modify-write on `credits_remaining`. The fix was a
 * per-row compare-and-swap loop, tested here against a fake client — and probe
 * P4 (`.omx/qa-20260927/REPORT.md`) then measured that loop losing 2–9 credits
 * per round under twelve concurrent charges: on a collision it restarted with
 * the full amount without undoing the rows it had already decremented. A fake
 * client could not see that, because the defect lived in how Postgres
 * interleaves real transactions.
 *
 * s48 moved the whole charge into `spend_credits` (migration 20260928110000,
 * ADR 040). The concurrency proof is now `src/__tests__/db/credit-spend.test.ts`,
 * on real Postgres, which CI runs by name: barrier-synchronised and
 * unsynchronised races asserting conservation row by row and zero refusals.
 *
 * What remains here is the TypeScript half as a contract with that function:
 * how its answer is mapped, and that `consumeCredits` never writes the wallet
 * or the ledger itself.
 */

type Row = Record<string, unknown>;
type RowsResult = { data: Row[] | null; error: { message: string } | null };

interface RecordedOp {
  table: string;
  operation: "select" | "insert" | "update";
}

let db: Record<string, Row[]> = {};
let ops: RecordedOp[] = [];
let rpcCalls: Array<{ name: string; args: Row }> = [];
let rpcAnswer: RowsResult = { data: [], error: null };

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    const op: RecordedOp = { table, operation: "select" };

    const run = (): RowsResult => {
      ops.push(op);
      return {
        data: (db[table] ?? []).filter((row) =>
          predicates.every((predicate) => predicate(row)),
        ),
        error: null,
      };
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
      // spendableFilter(): every fixture row here has `expires_at: null`.
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: () => {
        op.operation = "insert";
        return builder;
      },
      update: () => {
        op.operation = "update";
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
    rpcCalls.push({ name, args });
    return rpcAnswer;
  };

  return { from, rpc };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => createFakeClient()),
}));

// A credit-only holder: purchased credits, no plan, so no included allowance
// muddies the arithmetic. Not the code under test.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(async () => ({
    kind: "credits",
    planId: null,
    plan: null,
  })),
}));

import { consumeCredits } from "@/lib/credits/system";

const USER_ID = "user-1";

function charged(overrides: Row = {}): RowsResult {
  return {
    data: [
      {
        outcome: "charged",
        usage_id: "usage-9",
        from_allowance: 0,
        from_purchased: 5,
        remaining: 5,
        ...overrides,
      },
    ],
    error: null,
  };
}

describe("A-18: consumeCredits as a contract with spend_credits", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    ops = [];
    rpcCalls = [];
    rpcAnswer = charged();
    db = {
      billing_subscriptions: [],
      plan_entitlements: [],
      credit_usage: [],
      credit_purchases: [
        {
          id: "cp_1",
          user_id: USER_ID,
          credits_purchased: 10,
          credits_remaining: 10,
          expires_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("maps charged to success with the receipt and remaining credits", async () => {
    const result = await consumeCredits(USER_ID, 5, "translation", {
      siteId: "site-1",
    });

    expect(result).toEqual({
      success: true,
      remainingCredits: 5,
      charge: { usageId: "usage-9", userId: USER_ID, credits: 5 },
    });
    expect(rpcCalls).toEqual([
      {
        name: "spend_credits",
        args: {
          p_user_id: USER_ID,
          p_credits: 5,
          p_included: 0,
          p_window_start: expect.any(String),
          p_operation: "translation",
          p_metadata: { siteId: "site-1" },
        },
      },
    ]);
  });

  it("maps insufficient to the existing sentence with the available amount and no receipt", async () => {
    rpcAnswer = {
      data: [
        {
          outcome: "insufficient",
          usage_id: null,
          from_allowance: 0,
          from_purchased: 0,
          remaining: 3,
        },
      ],
      error: null,
    };

    const result = await consumeCredits(USER_ID, 5, "translation");

    // The amount is the function's, read under its lock — not a balance
    // TypeScript read before the call, which a concurrent charge can make
    // stale.
    expect(result).toEqual({
      success: false,
      error: "Insufficient credits. You need 5 credits but only have 3.",
    });
  });

  it("an RPC error, no row or an unknown outcome is a failure that charged nothing, logged, never thrown", async () => {
    const answers: RowsResult[] = [
      {
        data: null,
        error: { message: "function spend_credits does not exist" },
      },
      { data: [], error: null },
      charged({ outcome: "mystery" }),
    ];

    for (const answer of answers) {
      rpcAnswer = answer;
      consoleError.mockClear();

      const result = await consumeCredits(USER_ID, 5, "translation");

      expect(result).toEqual({
        success: false,
        error: "Failed to charge credits",
      });
      expect(consoleError).toHaveBeenCalled();
    }
  });

  it("never writes credit_purchases or credit_usage itself", async () => {
    await consumeCredits(USER_ID, 5, "translation");

    expect(
      ops.filter(
        (op) =>
          (op.table === "credit_purchases" || op.table === "credit_usage") &&
          op.operation !== "select",
      ),
    ).toEqual([]);
    expect(rpcCalls.map((call) => call.name)).toEqual(["spend_credits"]);
  });
});
