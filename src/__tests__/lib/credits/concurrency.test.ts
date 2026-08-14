/**
 * A-18 — credit deduction is a lost update, and the ledger is written first.
 *
 * `src/lib/credits/system.ts:207-212` inserts `credit_usage`, then `:227-252`
 * does a read-modify-write on `credits_remaining` with no lock and no
 * compare-and-swap. `refundCredits` (`:349`) keys its idempotency on
 * `Date.now()`, which collides at millisecond resolution.
 *
 * The invariant these tests hold the system to is conservation:
 *
 *     spendable balance + recorded usage === starting balance
 *
 * Stated that way rather than as "credits_remaining must be 0", so any fix —
 * a transactional RPC, a conditional update, a compare-and-swap loop — passes.
 * Today the ledger and the wallet disagree, in the customer's favour on the
 * concurrent path and against them on the failed one.
 */

type Row = Record<string, unknown>;
type FakeError = { code?: string; message: string; details?: string };
type RowsResult = { data: Row[] | null; error: FakeError | null };

let db: Record<string, Row[]> = {};

/**
 * Runs before a query executes, so a test can hold two callers at the same
 * point and produce a genuine interleaving rather than hoping for one.
 */
let beforeRun: (table: string, operation: string) => Promise<void> = async () =>
  undefined;

/** Makes `credit_purchases` reject the deduction, modelling a write failure. */
let failPurchaseUpdate = false;

/** `credit_purchases.stripe_payment_intent_id` is UNIQUE in the schema. */
const UNIQUE_COLUMN: Record<string, string> = {
  credit_purchases: "stripe_payment_intent_id",
};

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "update" = "select";
    let values: Row = {};

    const rows = (): Row[] => db[table] ?? [];
    const matched = (): Row[] =>
      rows().filter((predicateRow) =>
        predicates.every((predicate) => predicate(predicateRow)),
      );

    const run = (): RowsResult => {
      switch (operation) {
        case "insert": {
          const unique = UNIQUE_COLUMN[table];
          const clashes =
            unique !== undefined &&
            values[unique] !== undefined &&
            rows().some((row) => row[unique] === values[unique]);

          if (clashes) {
            return {
              data: null,
              error: {
                code: "23505",
                message: `duplicate key value violates unique constraint "${table}_${unique}_key"`,
              },
            };
          }

          // `created_at` is a column default in the schema, not something the
          // caller supplies — the billing-period filter reads it.
          const stored = {
            created_at: new Date().toISOString(),
            ...values,
          };
          db[table] = [...rows(), stored];
          return { data: [stored], error: null };
        }

        case "update": {
          if (table === "credit_purchases" && failPurchaseUpdate) {
            return {
              data: null,
              error: { code: "40001", message: "could not serialize access" },
            };
          }
          const hits = matched();
          db[table] = rows().map((row) =>
            hits.includes(row) ? { ...row, ...values } : row,
          );
          return {
            data: hits.map((row) => ({ ...row, ...values })),
            error: null,
          };
        }

        default:
          return { data: matched(), error: null };
      }
    };

    const settle = async (): Promise<RowsResult> => {
      await beforeRun(table, operation);
      return run();
    };

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
      // spendableFilter(): every fixture row here has `expires_at: null`, which
      // that filter's first arm already accepts.
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (payload: Row) => {
        operation = "insert";
        values = payload;
        return builder;
      },
      update: (payload: Row) => {
        operation = "update";
        values = payload;
        return builder;
      },
      single: async () => {
        const { data, error } = await settle();
        if (error) return { data: null, error };
        if (!data || data.length !== 1) {
          return {
            data: null,
            error: {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
            },
          };
        }
        return { data: data[0], error: null };
      },
      maybeSingle: async () => {
        const { data, error } = await settle();
        if (error) return { data: null, error };
        return { data: data?.[0] ?? null, error: null };
      },
      then: <T>(
        resolve: (result: RowsResult) => T,
        reject?: (reason: unknown) => T,
      ) => settle().then(resolve, reject),
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

// A credit-only holder: purchased credits, no plan, so no included allowance
// muddies the arithmetic. Not the code under test.
jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(async () => ({ kind: "credits", credits: 10 })),
}));

import { consumeCredits, refundCredits } from "@/lib/credits/system";

const USER_ID = "user-1";
const STARTING_BALANCE = 10;

/** Releases both callers only once both have reached the same point. */
function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    await gate;
  };
}

function spendableBalance(): number {
  return (db.credit_purchases ?? []).reduce(
    (sum, row) => sum + Number(row.credits_remaining ?? 0),
    0,
  );
}

function recordedUsage(): number {
  return (db.credit_usage ?? []).reduce(
    (sum, row) => sum + Number(row.credits_used ?? 0),
    0,
  );
}

describe("A-18: credit deduction under concurrency and failure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    beforeRun = async () => undefined;
    failPurchaseUpdate = false;
    db = {
      billing_subscriptions: [],
      credit_usage: [],
      credit_purchases: [
        {
          id: "cp_1",
          user_id: USER_ID,
          credits_purchased: STARTING_BALANCE,
          credits_remaining: STARTING_BALANCE,
          price_cents: 1000,
          stripe_payment_intent_id: "pi_pack_1",
          expires_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
  });

  /**
   * Guard for the `test.failing` below. `test.failing` passes on ANY failure,
   * including a barrier that deadlocks into a timeout or a mock that never
   * resolves, so each marker needs a sibling proving the machinery works. Here:
   * the barrier releases, both spends complete, and both usage rows are
   * written — so the failing case is measuring a lost update, not a hang.
   */
  it("guard: the barrier releases and both concurrent spends complete", async () => {
    const bothReadFirst = createBarrier(2);
    beforeRun = async (table, operation) => {
      if (table === "credit_purchases" && operation === "update") {
        await bothReadFirst();
      }
    };

    const results = await Promise.all([
      consumeCredits(USER_ID, 5, "ai_translation"),
      consumeCredits(USER_ID, 5, "ai_translation"),
    ]);

    expect(results.map((result) => result.success)).toEqual([true, true]);
    expect(db.credit_usage).toHaveLength(2);
  });

  it("two concurrent 5-credit spends against a 10-credit balance deduct 10", async () => {
    // Both spends are held at the deduction write until both have taken their
    // snapshot of `credits_remaining` — the window the read-modify-write
    // leaves open every time two AI operations overlap.
    const bothReadFirst = createBarrier(2);
    beforeRun = async (table, operation) => {
      if (table === "credit_purchases" && operation === "update") {
        await bothReadFirst();
      }
    };

    const [first, second] = await Promise.all([
      consumeCredits(USER_ID, 5, "ai_translation"),
      consumeCredits(USER_ID, 5, "ai_translation"),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(recordedUsage()).toBe(10);
    expect(spendableBalance()).toBe(0);
    expect(spendableBalance() + recordedUsage()).toBe(STARTING_BALANCE);
  });

  it("guard: the injected deduction failure is the one the code reports", async () => {
    failPurchaseUpdate = true;

    const result = await consumeCredits(USER_ID, 5, "ai_translation");

    // Reached the deduction and failed there — not at the balance check, and
    // not by throwing out of the fake.
    expect(result.error).toBe("Failed to deduct purchased credits");
    expect(spendableBalance()).toBe(STARTING_BALANCE);
  });

  it("a deduction that fails does not leave the usage on the customer's ledger", async () => {
    failPurchaseUpdate = true;

    const result = await consumeCredits(USER_ID, 5, "ai_translation");

    expect(result.success).toBe(false);
    // The wallet still holds 10 and the ledger says 5 were spent. The customer
    // is billed for an operation that did not happen, and `refundCredits`
    // cannot compensate it — nothing calls it on this path.
    expect(spendableBalance() + recordedUsage()).toBe(STARTING_BALANCE);
  });

  it("guard: a single refund lands, so the collision below is about the key", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1785484800000);

    const only = await refundCredits(USER_ID, 5, "translation_failed");

    expect(only.success).toBe(true);
    expect(spendableBalance()).toBe(STARTING_BALANCE + 5);
    // The key really is time-derived, which is the whole mechanism.
    expect(
      db.credit_purchases?.some((row) =>
        String(row.stripe_payment_intent_id).endsWith("1785484800000"),
      ),
    ).toBe(true);
  });

  it("two refunds for one user in the same millisecond both land", async () => {
    // `refund_${reason}_${userId}_${Date.now()}` is the whole idempotency key,
    // so two refunds inside one millisecond are indistinguishable to the
    // UNIQUE constraint. A pinned clock is the deterministic form of a real
    // burst; the resolution is milliseconds, not the microseconds a retry
    // loop or a batch would actually take.
    jest.spyOn(Date, "now").mockReturnValue(1785484800000);

    const first = await refundCredits(USER_ID, 5, "translation_failed");
    const second = await refundCredits(USER_ID, 5, "translation_failed");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(spendableBalance()).toBe(STARTING_BALANCE + 10);
  });

  /**
   * Fix-stable: the sequential path is correct today and must stay correct.
   */
  it("deducts correctly when the two spends do not overlap", async () => {
    await consumeCredits(USER_ID, 5, "ai_translation");
    const second = await consumeCredits(USER_ID, 5, "ai_translation");

    expect(second.success).toBe(true);
    expect(spendableBalance()).toBe(0);
    expect(recordedUsage()).toBe(10);
  });

  it("refuses a spend larger than the balance without writing a usage row", async () => {
    const result = await consumeCredits(USER_ID, 25, "bulk_ai_operation");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Insufficient credits/);
    expect(recordedUsage()).toBe(0);
    expect(spendableBalance()).toBe(STARTING_BALANCE);
  });
});
